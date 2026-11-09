// @vitest-environment node
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../app";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../lib/supabase.js", () => ({ serviceClient: () => h.db, makeUserClient: () => h.db }));

import { mcpSkillRoutes } from "../routes/mcp";

type Row = Record<string, unknown>;
const SERVER_ID = "11111111-1111-4111-8111-111111111111";

function db(rows: Record<string, Row[]>) {
  const writes: Array<{ table: string; op: string; values: Row }> = [];
  const from = (table: string) => {
    let single = false;
    let op: "select" | "insert" | "update" = "select";
    const filters: Row = {};
    const q: Record<string, unknown> = {
      select() { return q; },
      eq(key: string, value: unknown) { filters[key] = value; return q; },
      in(key: string, value: unknown) { filters[key] = value; return q; },
      is(key: string, value: unknown) { filters[key] = value; return q; },
      order() { return q; },
      limit() { return q; },
      maybeSingle() { single = true; return q; },
      single() { single = true; return q; },
      insert(values: Row) { op = "insert"; writes.push({ table, op, values }); return q; },
      update(values: Row) { op = "update"; writes.push({ table, op, values }); return q; },
      then(resolve: (value: unknown) => unknown) {
        if (op === "insert") return Promise.resolve({ data: single ? { id: "consent-new" } : null, error: null }).then(resolve);
        if (op === "update") return Promise.resolve({ data: null, error: null }).then(resolve);
        const data = (rows[table] ?? []).filter(row => Object.entries(filters).every(([key, value]) => {
          if (Array.isArray(value)) return value.includes(row[key]);
          if (value === null) return row[key] === null || row[key] === undefined;
          return row[key] === value;
        }));
        return Promise.resolve({ data: single ? data[0] ?? null : data, error: null }).then(resolve);
      },
    };
    return q;
  };
  return { client: { from }, writes };
}

function app() {
  return new Hono<Env>()
    .use("*", async (c, next) => { c.set("userId", "creator"); c.set("workspaceId", "w1"); c.set("jwt", "jwt"); await next(); })
    .route("/mcp", mcpSkillRoutes());
}
function enable() { vi.stubEnv("STUDIO_MCP_ENABLED", "true"); vi.stubEnv("STUDIO_MCP_REGISTRY", "true"); }
const baseRows = () => ({
  mcp_servers: [{ id: SERVER_ID, name: "notes", enabled: true, read_only: true, workspace_id: "w1" }],
  mcp_server_tools: [{ server_id: SERVER_ID, tool_name: "lookup_note", enabled: true }],
  mcp_consents: [] as Row[],
});
afterEach(() => vi.unstubAllEnvs());

describe("mcp skill consent API", () => {
  it("is dark unless both MCP flags are on", async () => {
    expect((await app().request("/mcp/skills")).status).toBe(404);
    enable();
    vi.stubEnv("STUDIO_MCP_REGISTRY", "false");
    expect((await app().request("/mcp/skills")).status).toBe(404);
  });

  it("lists enabled read-only skills with consent state", async () => {
    enable();
    h.db = db({ ...baseRows(), mcp_consents: [{ server_id: SERVER_ID, creator_id: "creator", workspace_id: "w1", revoked_at: null }] }).client;
    const response = await app().request("/mcp/skills");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      available: true,
      skills: [{ id: SERVER_ID, name: "notes", tools: ["lookup_note"], consented: true }],
    });
  });

  it("reports OAuth connect state for an OAuth-mode skill", async () => {
    enable();
    h.db = db({
      mcp_servers: [{ id: SERVER_ID, name: "notes", enabled: true, read_only: true, workspace_id: "w1", auth_mode: "oauth" }],
      mcp_server_tools: [{ server_id: SERVER_ID, tool_name: "lookup_note", enabled: true }],
      mcp_consents: [{ server_id: SERVER_ID, creator_id: "creator", workspace_id: "w1", revoked_at: null }],
      mcp_oauth_connections: [{ server_id: SERVER_ID, creator_id: "creator", workspace_id: "w1", revoked_at: null }],
    }).client;
    const response = await app().request("/mcp/skills");
    expect(await response.json()).toMatchObject({ skills: [{ id: SERVER_ID, auth_mode: "oauth", consented: true, connected: true }] });
  });

  it("marks an expired OAuth connection as expired instead of connected", async () => {
    enable();
    h.db = db({
      mcp_servers: [{ id: SERVER_ID, name: "notes", enabled: true, read_only: true, workspace_id: "w1", auth_mode: "oauth" }],
      mcp_server_tools: [{ server_id: SERVER_ID, tool_name: "lookup_note", enabled: true }],
      mcp_consents: [{ server_id: SERVER_ID, creator_id: "creator", workspace_id: "w1", revoked_at: null }],
      mcp_oauth_connections: [{ server_id: SERVER_ID, creator_id: "creator", workspace_id: "w1", revoked_at: null, expires_at: "2020-01-01T00:00:00Z" }],
    }).client;
    const response = await app().request("/mcp/skills");
    expect(await response.json()).toMatchObject({ skills: [{ id: SERVER_ID, consented: true, connected: false, expired: true }] });
  });

  it("grants consent for an enabled read-only workspace server", async () => {
    enable();
    const fake = db(baseRows());
    h.db = fake.client;
    const response = await app().request(`/mcp/skills/${SERVER_ID}/consent`, { method: "POST" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: SERVER_ID, consented: true });
    expect(fake.writes[0]).toMatchObject({
      table: "mcp_consents",
      op: "insert",
      values: { server_id: SERVER_ID, creator_id: "creator", workspace_id: "w1", scopes: {} },
    });
  });

  it("revokes a live consent instead of inserting a second row", async () => {
    enable();
    const fake = db(baseRows());
    h.db = fake.client;
    const response = await app().request(`/mcp/skills/${SERVER_ID}/consent`, { method: "DELETE" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: SERVER_ID, consented: false });
    expect(fake.writes[0].op).toBe("update");
    expect(fake.writes[0].values.revoked_at).toEqual(expect.any(String));
  });

  it("does not expose servers from another workspace or unknown ids", async () => {
    enable();
    h.db = db(baseRows()).client;
    expect((await app().request(`/mcp/skills/${SERVER_ID}/consent`, { method: "POST", headers: { Origin: "https://evil.test" } })).status).toBe(403);
    const otherWorkspace = db({ ...baseRows(), mcp_servers: [{ ...baseRows().mcp_servers[0], workspace_id: "w2" }] });
    h.db = otherWorkspace.client;
    expect((await app().request(`/mcp/skills/${SERVER_ID}/consent`, { method: "POST" })).status).toBe(404);
    expect(otherWorkspace.writes).toHaveLength(0);
  });
});
