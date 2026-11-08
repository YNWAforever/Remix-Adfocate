// @vitest-environment node
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../app";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../lib/supabase.js", () => ({ serviceClient: () => h.db, makeUserClient: () => h.db }));

import { mcpSkillRoutes } from "../routes/mcp";

type Row = Record<string, unknown>;
const SERVER_ID = "11111111-1111-4111-8111-111111111111";
const SERVER_ID_TWO = "22222222-2222-4222-8222-222222222222";

function db(rows: Record<string, Row[]>) {
  const writes: Array<{ table: string; op: string; values?: Row }> = [];
  const from = (table: string) => {
    let single = false;
    let op: "select" | "insert" | "update" | "delete" = "select";
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
      delete() { op = "delete"; writes.push({ table, op }); return q; },
      then(resolve: (value: unknown) => unknown) {
        if (op === "insert") return Promise.resolve({ data: single ? { id: "new-server" } : null, error: null }).then(resolve);
        if (op === "update" || op === "delete") return Promise.resolve({ data: null, error: null }).then(resolve);
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

function app(userId: string) {
  return new Hono<Env>()
    .use("*", async (c, next) => { c.set("userId", userId); c.set("workspaceId", "w1"); c.set("jwt", "jwt"); await next(); })
    .route("/mcp", mcpSkillRoutes());
}

const staff = (role: string) => ({ user_id: "owner", workspace_id: "w1", role, active: true, revision: 1 });
function rows() {
  return {
    staff_workspace_roles: [staff("workspace_admin")],
    mcp_servers: [
      { id: SERVER_ID, name: "notes", url: "https://mcp.example.test/rpc", enabled: true, read_only: true, workspace_id: "w1" },
      { id: SERVER_ID_TWO, name: "empty", url: "https://mcp.example.test/empty", enabled: false, read_only: true, workspace_id: "w1" },
    ],
    mcp_server_tools: [
      { server_id: SERVER_ID, tool_name: "lookup_note" },
      { server_id: SERVER_ID, tool_name: "get_brief" },
    ],
  };
}

beforeEach(() => {
  vi.stubEnv("STUDIO_MCP_ENABLED", "true");
  vi.stubEnv("STUDIO_MCP_REGISTRY", "true");
  h.db = db(rows()).client;
});
afterEach(() => vi.unstubAllEnvs());

describe("mcp owner registry API", () => {
  it("requires the workspace-admin role for every registry operation", async () => {
    h.db = db({ ...rows(), staff_workspace_roles: [staff("reviewer")] }).client;
    for (const [method, path] of [["GET", "/mcp/registry"], ["POST", "/mcp/registry"], ["PATCH", `/mcp/registry/${SERVER_ID}`], ["DELETE", `/mcp/registry/${SERVER_ID}`]]) {
      const response = await app("owner").request(path, { method, ...(method === "POST" ? { body: JSON.stringify({ name: "x", url: "https://mcp.test/rpc", tools: ["a"] }), headers: { "content-type": "application/json" } } : {}) });
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(await response.json()).toMatchObject({ code: "OWNER_REQUIRED" });
    }
  });

  it("lists every configured server with its allowlist", async () => {
    h.db = db(rows()).client;
    const response = await app("owner").request("/mcp/registry");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ servers: [
      { id: SERVER_ID, name: "notes", enabled: true, tools: ["lookup_note", "get_brief"] },
      { id: SERVER_ID_TWO, name: "empty", enabled: false, tools: [] },
    ] });
  });

  it("creates a disabled read-only server with tools", async () => {
    const fake = db(rows());
    h.db = fake.client;
    const response = await app("owner").request("/mcp/registry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "fixture", url: "https://mcp.example.test/rpc", tools: ["lookup_note"] }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ server: { name: "fixture", enabled: false, tools: ["lookup_note"] } });
    expect(fake.writes[0]).toMatchObject({ table: "mcp_servers", op: "insert", values: { name: "fixture", read_only: true, enabled: false, workspace_id: "w1" } });
    expect(fake.writes[1]).toMatchObject({ table: "mcp_server_tools", op: "insert" });
  });

  it("rejects insecure urls and empty allowlists", async () => {
    const fake = db(rows());
    h.db = fake.client;
    for (const body of [
      { name: "plain", url: "http://mcp.example.test/rpc", tools: ["lookup_note"] },
      { name: "plain", url: "https://mcp.example.test/rpc", tools: [] },
      { name: "BAD NAME", url: "https://mcp.example.test/rpc", tools: ["lookup_note"] },
      { name: "plain", url: "https://user:pass@mcp.example.test/rpc", tools: ["lookup_note"] },
    ]) {
      const response = await app("owner").request("/mcp/registry", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      expect(response.status).toBe(400);
    }
    expect(fake.writes).toHaveLength(0);
  });

  it("enables, replaces tools and deletes servers", async () => {
    const fake = db(rows());
    h.db = fake.client;
    expect((await app("owner").request(`/mcp/registry/${SERVER_ID}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: false, tools: ["lookup_note"] }) })).status).toBe(200);
    expect(fake.writes.some(write => write.table === "mcp_servers" && write.op === "update" && write.values?.enabled === false)).toBe(true);
    expect(fake.writes.some(write => write.table === "mcp_server_tools" && write.op === "delete")).toBe(true);
    expect((await app("owner").request(`/mcp/registry/${SERVER_ID}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true }) })).status).toBe(200);
    expect((await app("owner").request(`/mcp/registry/${SERVER_ID}`, { method: "DELETE" })).status).toBe(200);
    expect(fake.writes.at(-1)).toMatchObject({ table: "mcp_servers", op: "delete" });
  });

  it("does not enable a server without tools", async () => {
    h.db = db(rows()).client;
    const response = await app("owner").request(`/mcp/registry/${SERVER_ID_TWO}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_INPUT" });
  });
});
