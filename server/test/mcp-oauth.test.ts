// @vitest-environment node
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../app";
import { createPkcePair, decryptSecret, encryptSecret } from "../lib/mcp/oauthCrypto";
import { loadOAuthProviders } from "../lib/mcp/oauthProviders";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../lib/supabase.js", () => ({ serviceClient: () => h.db, makeUserClient: () => h.db }));

import { mcpOAuthCallbackRoutes, mcpOAuthRoutes } from "../routes/mcpOAuth";

type Row = Record<string, unknown>;
const SERVER_ID = "11111111-1111-4111-8111-111111111111";
const KEY = Buffer.alloc(32, 7).toString("base64");
const PROVIDERS = JSON.stringify({
  fixture: {
    authorizationUrl: "https://auth.example.test/authorize",
    tokenUrl: "https://auth.example.test/token",
    redirectUri: "https://adfocate-2.vercel.app/api/mcp-oauth/callback",
    clientId: "client-1",
    clientSecret: "secret-1",
    scopes: ["read_basic", "read_media"],
  },
});

function db(rows: Record<string, Row[]>, options: { fail?: boolean } = {}) {
  const writes: Array<{ table: string; op: string; values?: Row }> = [];
  const from = (table: string) => {
    let single: "maybe" | "one" | null = null;
    let op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
    const filters: Row = {};
    const q: Record<string, unknown> = {
      select() { return q; },
      eq(key: string, value: unknown) { filters[key] = value; return q; },
      in(key: string, value: unknown) { filters[key] = value; return q; },
      is(key: string, value: unknown) { filters[key] = value; return q; },
      order() { return q; },
      limit() { return q; },
      maybeSingle() { single = "maybe"; return q; },
      single() { single = "one"; return q; },
      insert(value: Row) { op = "insert"; writes.push({ table, op, values: value }); return q; },
      upsert(value: Row) { op = "upsert"; writes.push({ table, op, values: value }); return q; },
      update(value: Row) { op = "update"; writes.push({ table, op, values: value }); return q; },
      delete() { op = "delete"; writes.push({ table, op }); return q; },
      then(resolve: (value: unknown) => unknown) {
        if (options.fail) return Promise.resolve({ data: null, error: { message: "42P01" } }).then(resolve);
        if (op !== "select") {
          const data = op === "insert" && single === "one" ? { id: "new-id" } : null;
          return Promise.resolve({ data, error: null }).then(resolve);
        }
        const data = (rows[table] ?? []).filter(row => Object.entries(filters).every(([key, value]) => {
          if (Array.isArray(value)) return value.includes(row[key]);
          if (value === null) return row[key] === null || row[key] === undefined;
          return row[key] === value;
        }));
        return Promise.resolve({ data: single ? (data[0] ?? null) : data, error: null }).then(resolve);
      },
    };
    return q;
  };
  return { client: { from }, writes };
}

const serverRow = (over: Row = {}) => ({
  id: SERVER_ID, name: "notes", enabled: true, read_only: true,
  auth_mode: "oauth", oauth_provider: "fixture", oauth_scopes: ["read_basic"],
  workspace_id: "w1", url: "https://mcp.example.test/rpc", ...over,
});

function guardedApp() {
  return new Hono<Env>()
    .use("*", async (c, next) => { c.set("userId", "creator"); c.set("workspaceId", "w1"); c.set("jwt", "jwt"); await next(); })
    .route("/mcp", mcpOAuthRoutes());
}
function callbackApp() {
  return new Hono().route("/mcp-oauth", mcpOAuthCallbackRoutes());
}

beforeEach(() => {
  vi.stubEnv("STUDIO_MCP_ENABLED", "true");
  vi.stubEnv("STUDIO_MCP_OAUTH", "true");
  vi.stubEnv("MCP_OAUTH_ENCRYPTION_KEY", KEY);
  vi.stubEnv("MCP_OAUTH_PROVIDERS", PROVIDERS);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("mcp oauth crypto and provider config", () => {
  it("encrypts and decrypts secrets and rejects tampering", () => {
    const sealed = encryptSecret("access-token");
    expect(sealed).not.toContain("access-token");
    expect(decryptSecret(sealed)).toBe("access-token");
    const tampered = Buffer.from(sealed, "base64");
    tampered[tampered.length - 1] ^= 1;
    expect(() => decryptSecret(tampered.toString("base64"))).toThrow();
    expect(() => { vi.stubEnv("MCP_OAUTH_ENCRYPTION_KEY", ""); encryptSecret("x"); }).toThrow();
  });

  it("builds a PKCE S256 pair", () => {
    const { verifier, challenge } = createPkcePair();
    expect(verifier.length).toBeGreaterThan(40);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHashForTest(verifier));
  });

  it("loads valid providers and rejects insecure ones", () => {
    const valid = loadOAuthProviders(PROVIDERS);
    expect(valid.errors).toEqual([]);
    expect(valid.providers.fixture?.scopes).toEqual(["read_basic", "read_media"]);
    const insecure = loadOAuthProviders(JSON.stringify({ bad: { ...JSON.parse(PROVIDERS).fixture, tokenUrl: "http://example.test/token" } }));
    expect(insecure.providers).toEqual({});
    expect(insecure.errors.length).toBeGreaterThan(0);
  });
});

function createHashForTest(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

describe("mcp oauth routes", () => {
  it("is dark unless both flags are on", async () => {
    h.db = db({ mcp_servers: [serverRow()] }).client;
    vi.stubEnv("STUDIO_MCP_OAUTH", "false");
    expect((await guardedApp().request(`/mcp/oauth/${SERVER_ID}/start`)).status).toBe(404);
  });

  it("starts an authorization with state and S256 PKCE", async () => {
    const fake = db({ mcp_servers: [serverRow()] });
    h.db = fake.client;
    const response = await guardedApp().request(`/mcp/oauth/${SERVER_ID}/start`);
    expect(response.status).toBe(200);
    const body = await response.json() as { authorizationUrl: string; provider: string };
    expect(body.provider).toBe("fixture");
    const url = new URL(body.authorizationUrl);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("read_basic");
    const state = url.searchParams.get("state");
    expect(state).toBeTruthy();
    const pending = fake.writes.find(write => write.table === "mcp_oauth_pending" && write.op === "insert");
    expect(pending?.values).toMatchObject({ state, creator_id: "creator", workspace_id: "w1", server_id: SERVER_ID, provider: "fixture" });
    const verifier = decryptSecret(String(pending?.values?.code_verifier_encrypted));
    expect(createHashForTest(verifier)).toBe(url.searchParams.get("code_challenge"));
  });

  it("exchanges the callback code, encrypts tokens and clears the pending state", async () => {
    const { verifier } = createPkcePair();
    const fake = db({ mcp_oauth_pending: [{
      state: "state-1", creator_id: "creator", workspace_id: "w1", server_id: SERVER_ID,
      provider: "fixture", code_verifier_encrypted: encryptSecret(verifier),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    }] });
    h.db = fake.client;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      access_token: "ACCESS", refresh_token: "REFRESH", expires_in: 3600, scope: "read_basic", token_type: "Bearer",
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const response = await callbackApp().request("/mcp-oauth/callback?code=CODE&state=state-1");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/connections?mcp=connected");
    const upsert = fake.writes.find(write => write.table === "mcp_oauth_connections" && write.op === "upsert");
    expect(upsert).toBeTruthy();
    expect(decryptSecret(String(upsert?.values?.access_token_encrypted))).toBe("ACCESS");
    expect(decryptSecret(String(upsert?.values?.refresh_token_encrypted))).toBe("REFRESH");
    expect(upsert?.values).toMatchObject({ server_id: SERVER_ID, creator_id: "creator", workspace_id: "w1", provider: "fixture" });
    expect(fake.writes.some(write => write.table === "mcp_oauth_pending" && write.op === "delete")).toBe(true);
  });

  it("rejects an unknown or expired state without exchanging anything", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    h.db = db({}).client;
    expect((await callbackApp().request("/mcp-oauth/callback?code=C&state=nope")).headers.get("location")).toBe("/connections?mcp=error");
    h.db = db({ mcp_oauth_pending: [{
      state: "old", creator_id: "creator", workspace_id: "w1", server_id: SERVER_ID,
      provider: "fixture", code_verifier_encrypted: encryptSecret("v"),
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    }] }).client;
    expect((await callbackApp().request("/mcp-oauth/callback?code=C&state=old")).headers.get("location")).toBe("/connections?mcp=error");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("disconnects a live connection", async () => {
    const fake = db({});
    h.db = fake.client;
    const response = await guardedApp().request(`/mcp/oauth/${SERVER_ID}`, { method: "DELETE" });
    expect(response.status).toBe(200);
    expect(fake.writes.find(write => write.table === "mcp_oauth_connections" && write.op === "update")?.values).toMatchObject({ revoked_at: expect.any(String) });
  });
});
