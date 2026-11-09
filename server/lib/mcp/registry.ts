import type { SupabaseClient } from "@supabase/supabase-js";
import type { McpRemoteTool, McpServerConfig } from "./policy.js";
import { decryptSecret, encryptSecret } from "./oauthCrypto.js";
import { findOAuthProvider, loadOAuthProviders, type OAuthProviderConfig } from "./oauthProviders.js";

type Store = Pick<SupabaseClient, "from">;

const SERVER_NAME = /^[a-z0-9_]{1,32}$/;
const TOOL_NAME = /^[A-Za-z0-9_]{1,64}$/;

const DEFAULT_TIMEOUT_MS = 8000;

type RefreshedToken = { accessToken: string; refreshToken?: string; expiresAt: string | null };

/** Best-effort refresh-token exchange; returns null on any failure (the server is then skipped). */
async function refreshOAuthAccessToken(provider: OAuthProviderConfig, refreshToken: string): Promise<RefreshedToken | null> {
  try {
    const response = await fetch(provider.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: (() => {
        const form = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: provider.clientId,
        });
        if (provider.clientSecret) form.set("client_secret", provider.clientSecret);
        return form;
      })(),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const body = await response.json() as Record<string, unknown>;
    if (typeof body.access_token !== "string" || !body.access_token) return null;
    return {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
      expiresAt: typeof body.expires_in === "number" ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null,
    };
  } catch {
    return null;
  }
}

/** Validates an owner-supplied server URL: https, or http on a loopback fixture, never with userinfo. */
export function parseServerUrl(raw: unknown): string | null {
  let url: URL;
  try { url = new URL(String(raw)); } catch { return null; }
  if (url.username || url.password) return null;
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  return url.toString();
}

/** Validates an owner-supplied tool allowlist: 1-10 unique lowercase names. */
export function parseToolNames(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10) return null;
  const tools: string[] = [];
  for (const tool of value) {
    if (typeof tool !== "string" || !TOOL_NAME.test(tool) || tools.includes(tool)) return null;
    tools.push(tool);
  }
  return tools;
}

export function validServerName(name: string): boolean {
  return SERVER_NAME.test(name);
}

export type McpWorkspaceRegistry = Readonly<{
  /** false when the optional registry tables are absent or unreadable. */
  available: boolean;
  servers: readonly McpServerConfig[];
  /** server name → registry row id, used for mid-turn consent fencing. */
  serverIds: ReadonlyMap<string, string>;
  errors: readonly string[];
}>;

/**
 * Loads the workspace registry (owner-configured servers) and keeps only servers the creator has
 * consented to. Read-only is required here as well as in the table definition.
 */
export async function loadWorkspaceMcpServers(
  store: Store,
  workspaceId: string,
  creatorId: string,
): Promise<McpWorkspaceRegistry> {
  const servers = await store
    .from("mcp_servers")
    .select("id,name,url,enabled,read_only,auth_mode,oauth_provider,oauth_scopes")
    .eq("workspace_id", workspaceId)
    .eq("enabled", true)
    .eq("read_only", true);
  if (servers.error) return { available: false, servers: [], serverIds: new Map(), errors: ["registry unavailable"] };
  const rows = (servers.data ?? []) as Array<{ id: string; name: string; url: string; auth_mode?: string | null; oauth_provider?: string | null }>;
  if (!rows.length) return { available: true, servers: [], serverIds: new Map(), errors: [] };

  const ids = rows.map(row => row.id);
  const [tools, consents] = await Promise.all([
    store.from("mcp_server_tools").select("server_id,tool_name,enabled").in("server_id", ids).eq("enabled", true),
    store.from("mcp_consents").select("server_id,revoked_at").in("server_id", ids)
      .eq("creator_id", creatorId).eq("workspace_id", workspaceId).is("revoked_at", null),
  ]);
  if (tools.error || consents.error) return { available: false, servers: [], serverIds: new Map(), errors: ["registry unavailable"] };

  const toolsByServer = new Map<string, McpRemoteTool[]>();
  for (const row of (tools.data ?? []) as Array<{ server_id: string; tool_name: string }>) {
    if (!TOOL_NAME.test(row.tool_name)) continue;
    const list = toolsByServer.get(row.server_id) ?? [];
    if (!list.some(tool => tool.name === row.tool_name)) list.push({ name: row.tool_name });
    toolsByServer.set(row.server_id, list);
  }
  const consented = new Set(((consents.data ?? []) as Array<{ server_id: string }>).map(row => row.server_id));

  const oauthServerIds = rows.filter(row => row.auth_mode === "oauth").map(row => row.id);
  const connections = oauthServerIds.length
    ? await store.from("mcp_oauth_connections").select("server_id,access_token_encrypted,refresh_token_encrypted,expires_at")
        .in("server_id", oauthServerIds).eq("creator_id", creatorId).eq("workspace_id", workspaceId).is("revoked_at", null)
    : { data: [] as Array<Record<string, unknown>>, error: null };
  if (connections.error) return { available: false, servers: [], serverIds: new Map(), errors: ["registry unavailable"] };
  type ConnectionState = { accessToken: string | null; refreshToken: string | null; expiresAt: string | null; expired: boolean };
  const connectionStates = new Map<string, ConnectionState>();
  for (const row of (connections.data ?? []) as Array<{ server_id: string; access_token_encrypted: string; refresh_token_encrypted?: string | null; expires_at?: string | null }>) {
    let accessToken: string | null = null;
    let refreshToken: string | null = null;
    try { accessToken = decryptSecret(row.access_token_encrypted); } catch { /* fail closed */ }
    if (row.refresh_token_encrypted) {
      try { refreshToken = decryptSecret(row.refresh_token_encrypted); } catch { refreshToken = null; }
    }
    connectionStates.set(row.server_id, {
      accessToken,
      refreshToken,
      expiresAt: row.expires_at ?? null,
      expired: Boolean(row.expires_at && Date.parse(row.expires_at) <= Date.now()),
    });
  }

  const result: McpServerConfig[] = [];
  const serverIds = new Map<string, string>();
  for (const row of rows) {
    if (!SERVER_NAME.test(row.name) || !consented.has(row.id)) continue;
    const url = parseServerUrl(row.url);
    const allowlistedTools = toolsByServer.get(row.id) ?? [];
    if (!url || !allowlistedTools.length) continue;
    let headers: Record<string, string> = {};
    if (row.auth_mode === "oauth") {
      const state = connectionStates.get(row.id);
      if (!state) continue;
      let token = state.accessToken;
      if ((!token || state.expired) && state.refreshToken) {
        const provider = findOAuthProvider(loadOAuthProviders(), row.oauth_provider);
        if (provider) {
          const refreshed = await refreshOAuthAccessToken(provider, state.refreshToken);
          if (refreshed) {
            token = refreshed.accessToken;
            state.accessToken = refreshed.accessToken;
            state.refreshToken = refreshed.refreshToken ?? state.refreshToken;
            state.expiresAt = refreshed.expiresAt;
            state.expired = false;
            await store.from("mcp_oauth_connections").update({
              access_token_encrypted: encryptSecret(refreshed.accessToken),
              refresh_token_encrypted: state.refreshToken ? encryptSecret(state.refreshToken) : null,
              expires_at: refreshed.expiresAt,
              updated_at: new Date().toISOString(),
            }).eq("server_id", row.id).eq("creator_id", creatorId).eq("workspace_id", workspaceId).is("revoked_at", null);
          }
        }
      }
      if (!token || state.expired) continue;
      headers = { Authorization: `Bearer ${token}` };
    }
    result.push({ name: row.name, url, timeoutMs: DEFAULT_TIMEOUT_MS, headers, tools: allowlistedTools });
    serverIds.set(row.name, row.id);
  }
  return { available: true, servers: result, serverIds, errors: [] };
}

/** Best-effort call audit; the table is optional and malformed/oversized outcomes are bounded. */
export async function recordMcpCall(
  store: Store,
  input: {
    requestId?: string | null;
    serverName: string;
    toolName: string;
    creatorId: string;
    workspaceId: string;
    outcome: string;
    durationMs: number;
  },
): Promise<void> {
  try {
    await store.from("mcp_call_audit").insert({
      request_id: input.requestId ?? null,
      server_name: input.serverName.slice(0, 64),
      tool_name: input.toolName.slice(0, 64),
      creator_id: input.creatorId,
      workspace_id: input.workspaceId,
      outcome: input.outcome.slice(0, 40),
      duration_ms: Math.max(0, Math.min(120000, Math.round(input.durationMs))),
    });
  } catch {
    /* Audit table optional (or insert rejected): never fail a chat turn for audit. */
  }
}

/** Mid-turn fencing: a tool result is usable only while the creator's consent row is still live. */
export async function hasLiveConsent(
  store: Store,
  serverId: string,
  creatorId: string,
  workspaceId: string,
): Promise<boolean> {
  try {
    const result = await store.from("mcp_consents").select("id")
      .eq("server_id", serverId).eq("creator_id", creatorId).eq("workspace_id", workspaceId)
      .is("revoked_at", null).maybeSingle();
    if (result.error) return false;
    return Boolean(result.data);
  } catch {
    return false;
  }
}

/** Runs one MCP tool call and drops its payload if consent was revoked while it ran. */
export async function runFencedMcpTool(
  store: Store,
  state: { serverId?: string; creatorId: string; workspaceId: string },
  run: () => Promise<string>,
): Promise<{ result: string; outcome: string }> {
  const result = await run();
  const outcome = result.startsWith("error:") ? result.slice(7, 40) : "ok";
  if (!state.serverId) return { result, outcome };
  if (await hasLiveConsent(store, state.serverId, state.creatorId, state.workspaceId)) return { result, outcome };
  return { result: "error: consent_revoked", outcome: "consent_revoked" };
}
