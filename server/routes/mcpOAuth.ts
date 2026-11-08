import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../app.js";
import { serviceClient } from "../lib/supabase.js";
import { dbError } from "../lib/httpErrors.js";
import { createPkcePair, decryptSecret, encryptSecret, oauthState } from "../lib/mcp/oauthCrypto.js";
import { findOAuthProvider, loadOAuthProviders } from "../lib/mcp/oauthProviders.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONNECT_REDIRECT = "/connections?mcp=connected";
const ERROR_REDIRECT = "/connections?mcp=error";

type ServerRow = {
  id: string;
  name: string;
  enabled?: boolean;
  read_only?: boolean;
  auth_mode?: string | null;
  oauth_provider?: string | null;
  oauth_scopes?: string[] | null;
};

function oauthEnabled() {
  return process.env.STUDIO_MCP_ENABLED === "true" && process.env.STUDIO_MCP_OAUTH === "true";
}

function sameOrigin(c: Context<Env>): boolean {
  const origin = c.req.header("Origin");
  if (origin && origin !== new URL(c.req.url).origin) return false;
  return c.req.header("Sec-Fetch-Site") !== "cross-site";
}

/** Creator-auth flow endpoints: begin an OAuth authorization, or disconnect the connection. */
export function mcpOAuthRoutes() {
  const routes = new Hono<Env>();

  routes.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    if (!oauthEnabled()) return c.json({ code: "mcp_disabled" }, 404);
    if (!sameOrigin(c)) return c.json({ code: "ORIGIN_DENIED", error: "Same-origin only" }, 403);
    await next();
  });

  routes.get("/oauth/:serverId/start", async c => {
    const serverId = c.req.param("serverId");
    if (!UUID.test(serverId)) return c.json({ code: "not_found" }, 404);
    const store = serviceClient(), workspaceId = c.get("workspaceId"), creatorId = c.get("userId");
    const server = await store.from("mcp_servers")
      .select("id,name,enabled,read_only,auth_mode,oauth_provider,oauth_scopes")
      .eq("id", serverId).eq("workspace_id", workspaceId).maybeSingle();
    if (server.error) return dbError(c, server.error, "mcp_registry_unavailable", 503);
    const row = server.data as ServerRow | null;
    if (!row || row.enabled !== true || row.read_only !== true || row.auth_mode !== "oauth") return c.json({ code: "not_found" }, 404);

    const registry = loadOAuthProviders();
    if (registry.errors.length) console.info(`[mcp] oauth config: ${registry.errors.slice(0, 2).join("; ").slice(0, 300)}`);
    const provider = findOAuthProvider(registry, row.oauth_provider);
    if (!provider) return c.json({ code: "MCP_OAUTH_PROVIDER_UNAVAILABLE", error: "This skill's sign-in is not configured" }, 503);
    const providerName = String(row.oauth_provider);
    const allowedScopes = (row.oauth_scopes ?? []).filter(scope => provider.scopes.includes(scope));
    const scopes = allowedScopes.length ? allowedScopes : [...provider.scopes];

    const state = oauthState();
    const pkce = createPkcePair();
    const pending = await store.from("mcp_oauth_pending").insert({
      state,
      creator_id: creatorId,
      workspace_id: workspaceId,
      server_id: serverId,
      provider: providerName,
      code_verifier_encrypted: encryptSecret(pkce.verifier),
    });
    if (pending.error) return dbError(c, pending.error, "mcp_oauth_unavailable", 503);

    const url = new URL(provider.authorizationUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", provider.clientId);
    url.searchParams.set("redirect_uri", provider.redirectUri);
    url.searchParams.set("scope", scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", pkce.challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return c.json({ provider: providerName, authorizationUrl: url.toString() });
  });

  routes.delete("/oauth/:serverId", async c => {
    const serverId = c.req.param("serverId");
    if (!UUID.test(serverId)) return c.json({ code: "not_found" }, 404);
    const store = serviceClient(), workspaceId = c.get("workspaceId"), creatorId = c.get("userId");
    const updated = await store.from("mcp_oauth_connections")
      .update({ revoked_at: new Date().toISOString() })
      .eq("server_id", serverId).eq("creator_id", creatorId).eq("workspace_id", workspaceId).is("revoked_at", null);
    if (updated.error) return dbError(c, updated.error, "mcp_oauth_unavailable", 503);
    return c.json({ serverId, disconnected: true });
  });

  return routes;
}

/**
 * Unauthenticated provider callback (the browser lands here from the provider). The signed-in
 * creator is identified by the pending state row, never by the request body.
 */
export function mcpOAuthCallbackRoutes() {
  const routes = new Hono();

  routes.get("/callback", async c => {
    if (!oauthEnabled()) return c.json({ code: "mcp_disabled" }, 404);
    if (c.req.query("error")) return c.redirect(ERROR_REDIRECT, 303);
    const code = c.req.query("code"), state = c.req.query("state");
    if (!code || !state) return c.redirect(ERROR_REDIRECT, 303);

    const store = serviceClient();
    const pendingResult = await store.from("mcp_oauth_pending")
      .select("state,creator_id,workspace_id,server_id,provider,code_verifier_encrypted,expires_at")
      .eq("state", state).maybeSingle();
    if (pendingResult.error) return c.redirect(ERROR_REDIRECT, 303);
    const pending = pendingResult.data as {
      state: string; creator_id: string; workspace_id: string; server_id: string;
      provider: string; code_verifier_encrypted: string; expires_at: string;
    } | null;
    if (!pending) return c.redirect(ERROR_REDIRECT, 303);
    if (Date.parse(pending.expires_at) <= Date.now()) {
      await store.from("mcp_oauth_pending").delete().eq("state", state);
      return c.redirect(ERROR_REDIRECT, 303);
    }

    const provider = findOAuthProvider(loadOAuthProviders(), pending.provider);
    if (!provider) return c.redirect(ERROR_REDIRECT, 303);
    let verifier: string;
    try { verifier = decryptSecret(pending.code_verifier_encrypted); }
    catch { return c.redirect(ERROR_REDIRECT, 303); }

    let tokens: Record<string, unknown>;
    try {
      const response = await fetch(provider.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: provider.redirectUri,
          client_id: provider.clientId,
          client_secret: provider.clientSecret,
          code_verifier: verifier,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return c.redirect(ERROR_REDIRECT, 303);
      tokens = await response.json() as Record<string, unknown>;
    } catch {
      return c.redirect(ERROR_REDIRECT, 303);
    }

    if (typeof tokens.access_token !== "string" || !tokens.access_token) return c.redirect(ERROR_REDIRECT, 303);
    const now = new Date();
    const expiresAt = typeof tokens.expires_in === "number" ? new Date(now.getTime() + tokens.expires_in * 1000).toISOString() : null;
    const scopes = typeof tokens.scope === "string" && tokens.scope.trim() ? tokens.scope.split(/\s+/).slice(0, 40) : [...provider.scopes];
    const upsert = await store.from("mcp_oauth_connections").upsert({
      workspace_id: pending.workspace_id,
      server_id: pending.server_id,
      creator_id: pending.creator_id,
      provider: pending.provider,
      access_token_encrypted: encryptSecret(tokens.access_token),
      refresh_token_encrypted: typeof tokens.refresh_token === "string" ? encryptSecret(tokens.refresh_token) : null,
      token_type: typeof tokens.token_type === "string" ? tokens.token_type.slice(0, 30) : "Bearer",
      scopes,
      expires_at: expiresAt,
      revoked_at: null,
      updated_at: now.toISOString(),
    }, { onConflict: "server_id,creator_id" });
    if (upsert.error) return c.redirect(ERROR_REDIRECT, 303);
    await store.from("mcp_oauth_pending").delete().eq("state", state);
    return c.redirect(CONNECT_REDIRECT, 303);
  });

  return routes;
}

/** Exported for tests: the redirect target keeps provider responses out of the browser URL. */
export const MCP_OAUTH_REDIRECTS = { connected: CONNECT_REDIRECT, error: ERROR_REDIRECT };

