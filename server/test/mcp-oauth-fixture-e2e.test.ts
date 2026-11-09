// @vitest-environment node
// A2.3 path proof without a real provider: local OAuth provider + MCP server fixture,
// exercised through the real start/callback routes, the registry loader and the MCP client.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../app";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../lib/supabase.js", () => ({ serviceClient: () => h.db, makeUserClient: () => h.db }));

import { createMcpRuntime } from "../lib/mcp/client";
import { loadWorkspaceMcpServers } from "../lib/mcp/registry";
import { mcpOAuthCallbackRoutes, mcpOAuthRoutes } from "../routes/mcpOAuth";

const CREATOR = "creator-1";
const WORKSPACE = "workspace-1";
const SERVER_ID = "11111111-1111-4111-8111-111111111111";
const THREAD_TOOL = "read_fixture";
const KEY = Buffer.alloc(32, 4).toString("base64");

type Row = Record<string, unknown>;
type Store = {
  rows: Record<string, Row[]>;
  client: { from: (table: string) => unknown };
  writes: Array<{ table: string; op: string; values?: Row }>;
};

function fakeStore(rows: Record<string, Row[]>): Store {
  const writes: Store["writes"] = [];
  const from = (table: string) => {
    let single = false;
    let op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
    const filters: Row = {};
    let values: Row | undefined;
    const q: Record<string, unknown> = {
      select() { return q; },
      eq(key: string, value: unknown) { filters[key] = value; return q; },
      in(key: string, value: unknown) { filters[key] = value; return q; },
      is(key: string, value: unknown) { filters[key] = value; return q; },
      order() { return q; },
      limit() { return q; },
      maybeSingle() { single = true; return q; },
      single() { single = true; return q; },
      insert(value: Row) { op = "insert"; values = value; writes.push({ table, op, values: value }); (rows[table] ??= []).push(value); return q; },
      upsert(value: Row) { op = "upsert"; values = value; writes.push({ table, op, values: value }); rows[table] = [value]; return q; },
      update(value: Row) { op = "update"; values = value; writes.push({ table, op, values: value }); return q; },
      delete() { op = "delete"; writes.push({ table, op }); return q; },
      then(resolve: (value: unknown) => unknown) {
        if (op !== "select") {
          const data = op === "insert" && single ? { id: `${table}-new` } : null;
          return Promise.resolve({ data, error: null }).then(resolve);
        }
        const data = (rows[table] ?? []).filter(row => Object.entries(filters).every(([key, value]) => {
          if (Array.isArray(value)) return value.includes(row[key]);
          if (value === null) return row[key] === null || row[key] === undefined;
          return row[key] === value;
        }));
        void values;
        return Promise.resolve({ data: single ? (data[0] ?? null) : data, error: null }).then(resolve);
      },
    };
    return q;
  };
  return { rows, client: { from }, writes };
}

const closeables: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closeables.length) await closeables.pop()?.();
  vi.unstubAllEnvs();
  h.db = null;
});

async function startFixture() {
  const seenAuth: string[] = [];
  const server = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/token") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      const verifier = form.get("code_verifier") ?? "";
      if (!verifier) { res.writeHead(400); return res.end("missing verifier"); }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ access_token: "fixture-access", refresh_token: "fixture-refresh", token_type: "Bearer", expires_in: 3600, scope: "read_basic" }));
    }
    if (req.method === "POST" && req.url === "/mcp") {
      const auth = req.headers.authorization ?? "";
      seenAuth.push(auth);
      if (auth !== "Bearer fixture-access") { res.writeHead(401); return res.end(); }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const respond = (result: unknown) => {
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "fixture-session" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id ?? null, result }));
      };
      if (body.method === "initialize") return respond({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "oauth-fixture" } });
      if (body.method === "notifications/initialized") { res.writeHead(202); return res.end(); }
      if (body.method === "tools/list") return respond({ tools: [{ name: THREAD_TOOL, description: "Read the fixture", inputSchema: { type: "object" } }] });
      if (body.method === "tools/call") return respond({ content: [{ type: "text", text: "OAUTH-FIXTURE-PAYLOAD" }] });
      res.writeHead(400); res.end();
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  closeables.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, seenAuth };
}

function guardedApp() {
  return new Hono<Env>()
    .use("*", async (c, next) => { c.set("userId", CREATOR); c.set("workspaceId", WORKSPACE); c.set("jwt", "jwt"); await next(); })
    .route("/mcp", mcpOAuthRoutes());
}
const callbackApp = () => new Hono().route("/mcp-oauth", mcpOAuthCallbackRoutes());

beforeEach(() => {
  vi.stubEnv("STUDIO_MCP_ENABLED", "true");
  vi.stubEnv("STUDIO_MCP_OAUTH", "true");
  vi.stubEnv("MCP_OAUTH_ENCRYPTION_KEY", KEY);
});

describe("A2.3 fixture OAuth end-to-end", () => {
  it("connects a provider, exposes the skill and calls it over MCP with the stored token", async () => {
    const { base, seenAuth } = await startFixture();
    vi.stubEnv("MCP_OAUTH_PROVIDERS", JSON.stringify({
      fixture: {
        authorizationUrl: `${base}/authorize`,
        tokenUrl: `${base}/token`,
        redirectUri: `${base}/callback`,
        clientId: "client-1",
        clientSecret: "secret-1",
        scopes: ["read_basic"],
      },
    }));

    const store = fakeStore({
      mcp_servers: [{
        id: SERVER_ID, name: "oauth_notes", url: `${base}/mcp`, enabled: true, read_only: true,
        workspace_id: WORKSPACE, auth_mode: "oauth", oauth_provider: "fixture", oauth_scopes: ["read_basic"],
      }],
      mcp_server_tools: [{ server_id: SERVER_ID, tool_name: THREAD_TOOL, enabled: true }],
      mcp_consents: [{ server_id: SERVER_ID, creator_id: CREATOR, workspace_id: WORKSPACE, revoked_at: null }],
      mcp_oauth_connections: [],
      mcp_oauth_pending: [],
    });
    h.db = store.client;

    // 1. start: provider auth URL + encrypted PKCE verifier pending
    const start = await guardedApp().request(`/mcp/oauth/${SERVER_ID}/start`);
    expect(start.status).toBe(200);
    const authUrl = new URL((await start.json() as { authorizationUrl: string }).authorizationUrl);
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    const pending = store.rows.mcp_oauth_pending[0];
    const verifier = await import("../lib/mcp/oauthCrypto").then(module => module.decryptSecret(String(pending.code_verifier_encrypted)));
    expect(verifier.length).toBeGreaterThan(20);

    // 2. callback: real HTTP exchange against the fixture provider, encrypted upsert
    const callback = await callbackApp().request(`/mcp-oauth/callback?code=fixture-code&state=${authUrl.searchParams.get("state")}`);
    expect(callback.status).toBe(303);
    expect(callback.headers.get("location")).toBe("/connections?mcp=connected");
    const connection = store.rows.mcp_oauth_connections[0];
    expect(connection).toBeTruthy();
    const { decryptSecret } = await import("../lib/mcp/oauthCrypto");
    expect(decryptSecret(String(connection.access_token_encrypted))).toBe("fixture-access");

    // 3. registry exposes the OAuth server only with the live connection + decrypted header
    const registry = await loadWorkspaceMcpServers(store.client as Parameters<typeof loadWorkspaceMcpServers>[0], WORKSPACE, CREATOR);
    expect(registry.servers.map(server => server.name)).toEqual(["oauth_notes"]);
    expect(registry.servers[0].headers).toMatchObject({ Authorization: "Bearer fixture-access" });

    // 4. MCP client uses the fixture server with that token
    const runtime = createMcpRuntime(registry.servers);
    const defs = await runtime.prepare();
    expect(defs.map(definition => definition.function.name)).toEqual([`mcp__oauth_notes__${THREAD_TOOL}`]);
    const output = await runtime.run(`mcp__oauth_notes__${THREAD_TOOL}`, "{}");
    expect(output).toBe("OAUTH-FIXTURE-PAYLOAD");
    expect(seenAuth.at(-1)).toBe("Bearer fixture-access");
  });

  it("rejects an unknown state and does not call the provider", async () => {
    h.db = fakeStore({ mcp_oauth_pending: [] }).client;
    const response = await callbackApp().request("/mcp-oauth/callback?code=x&state=missing");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/connections?mcp=error");
  });
});
