// @vitest-environment node
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminEnv } from "../lib/staffAuth";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../lib/supabase.js", () => ({ serviceClient: () => h.db, makeUserClient: () => h.db }));

import { adminMcpRoutes } from "../routes/adminMcp";
import { staffRouteRequirement } from "../lib/staffCapabilities";

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

function app() {
  return new Hono<AdminEnv>()
    .use("*", async (c, next) => {
      c.set("staff", { userId: "staff-owner", email: "owner@example.test", active: true });
      c.set("authorizedWorkspace", { workspaceId: "w1", workspaceSlug: "owned", userId: "staff-owner" });
      await next();
    })
    .route("/mcp", adminMcpRoutes);
}

function rows() {
  return {
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
});
afterEach(() => vi.unstubAllEnvs());

describe("admin mcp registry API", () => {
  it("requires the access.manage capability on every mounted route", () => {
    for (const [method, path] of [["GET", "mcp/registry"], ["POST", "mcp/registry"], ["PATCH", "mcp/registry/:id"], ["DELETE", "mcp/registry/:id"], ["GET", "mcp/audit"]]) {
      expect(staffRouteRequirement(method, path), `${method} ${path}`).toEqual({ kind: "workspace", anyOf: ["access.manage"] });
    }
  });

  it("is dark unless the MCP flags are on", async () => {
    vi.stubEnv("STUDIO_MCP_ENABLED", "false");
    expect((await app().request("/mcp/registry")).status).toBe(404);
  });

  it("lists every configured server with its allowlist", async () => {
    h.db = db(rows()).client;
    const response = await app().request("/mcp/registry");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ servers: [
      { id: SERVER_ID, name: "notes", enabled: true, tools: ["lookup_note", "get_brief"] },
      { id: SERVER_ID_TWO, name: "empty", enabled: false, tools: [] },
    ] });
  });

  it("creates a disabled read-only server with tools", async () => {
    const fake = db(rows());
    h.db = fake.client;
    const response = await app().request("/mcp/registry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "fixture", url: "https://mcp.example.test/rpc", tools: ["lookup_note"] }),
    });
    expect(response.status).toBe(201);
    expect(fake.writes[0]).toMatchObject({ table: "mcp_servers", op: "insert", values: { name: "fixture", read_only: true, enabled: false, workspace_id: "w1", created_by: "staff-owner" } });
    expect(fake.writes[1]).toMatchObject({ table: "mcp_server_tools", op: "insert" });
  });

  it("rejects insecure urls, empty allowlists and bad names", async () => {
    const fake = db(rows());
    h.db = fake.client;
    for (const body of [
      { name: "plain", url: "http://mcp.example.test/rpc", tools: ["lookup_note"] },
      { name: "plain", url: "https://mcp.example.test/rpc", tools: [] },
      { name: "BAD NAME", url: "https://mcp.example.test/rpc", tools: ["lookup_note"] },
      { name: "plain", url: "https://user:pass@mcp.example.test/rpc", tools: ["lookup_note"] },
    ]) {
      expect((await app().request("/mcp/registry", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).status).toBe(400);
    }
    expect(fake.writes).toHaveLength(0);
  });

  it("enables, replaces tools and deletes servers", async () => {
    const fake = db(rows());
    h.db = fake.client;
    expect((await app().request(`/mcp/registry/${SERVER_ID}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: false, tools: ["lookup_note"] }) })).status).toBe(200);
    expect(fake.writes.some(write => write.table === "mcp_servers" && write.op === "update" && write.values?.enabled === false)).toBe(true);
    expect(fake.writes.some(write => write.table === "mcp_server_tools" && write.op === "delete")).toBe(true);
    expect((await app().request(`/mcp/registry/${SERVER_ID}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true }) })).status).toBe(200);
    expect((await app().request(`/mcp/registry/${SERVER_ID}`, { method: "DELETE" })).status).toBe(200);
    expect(fake.writes.at(-1)).toMatchObject({ table: "mcp_servers", op: "delete" });
  });

  it("lists recent MCP calls for the workspace without payloads", async () => {
    const fake = db({ mcp_call_audit: [
      { workspace_id: "w1", server_name: "notes", tool_name: "lookup_note", outcome: "ok", duration_ms: 12, created_at: "2026-11-09T00:00:00Z" },
      { workspace_id: "w2", server_name: "other", tool_name: "read", outcome: "ok", duration_ms: 4, created_at: "2026-11-09T00:00:00Z" },
    ] });
    h.db = fake.client;
    const response = await app().request("/mcp/audit");
    expect(response.status).toBe(200);
    const body = await response.json() as { calls: Array<Record<string, unknown>>; summary: Record<string, unknown>; health: Array<Record<string, unknown>> };
    expect(body.calls).toHaveLength(1);
    expect(body.calls[0]).toMatchObject({ server_name: "notes", tool_name: "lookup_note", outcome: "ok", duration_ms: 12 });
    expect(body.summary).toEqual({ total: 1, ok: 1, errors: 0, avg_duration_ms: 12, outcomes: { ok: 1 } });
    expect(body.health).toEqual([{ server_name: "notes", calls: 1, ok: 1, errors: 0, avg_duration_ms: 12, p50_ms: 12, p95_ms: 12, last_ok_at: "2026-11-09T00:00:00Z", last_error_at: null, outcomes: { ok: 1 } }]);
  });

  it("breaks failures down by outcome code per server", async () => {
    h.db = db({ mcp_call_audit: [
      { workspace_id: "w1", server_name: "hasdata", tool_name: "search", outcome: "ok", duration_ms: 900, created_at: "2026-11-10T00:00:00Z" },
      { workspace_id: "w1", server_name: "hasdata", tool_name: "search", outcome: "mcp_timeout", duration_ms: 15000, created_at: "2026-11-10T00:00:01Z" },
      { workspace_id: "w1", server_name: "hasdata", tool_name: "search", outcome: "mcp_timeout", duration_ms: 15000, created_at: "2026-11-10T00:00:02Z" },
      { workspace_id: "w1", server_name: "mysocial", tool_name: "search", outcome: "mcp_tool_error", duration_ms: 200, created_at: "2026-11-10T00:00:03Z" },
    ] }).client;
    const body = await (await app().request("/mcp/audit")).json() as { summary: { outcomes: Record<string, number> }; health: Array<{ server_name: string; outcomes: Record<string, number> }> };
    expect(body.summary.outcomes).toEqual({ ok: 1, mcp_timeout: 2, mcp_tool_error: 1 });
    expect(body.health.find(item => item.server_name === "hasdata")?.outcomes).toEqual({ ok: 1, mcp_timeout: 2 });
    expect(body.health.find(item => item.server_name === "mysocial")?.outcomes).toEqual({ mcp_tool_error: 1 });
  });

  it("reports 24h/7d call usage and top tools as a credit proxy", async () => {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    h.db = db({ mcp_call_audit: [
      { workspace_id: "w1", server_name: "hasdata", tool_name: "tiktok_search", outcome: "ok", duration_ms: 900, created_at: hourAgo },
      { workspace_id: "w1", server_name: "hasdata", tool_name: "tiktok_search", outcome: "ok", duration_ms: 800, created_at: hourAgo },
      { workspace_id: "w1", server_name: "hasdata", tool_name: "instagram_search", outcome: "mcp_timeout", duration_ms: 15000, created_at: threeDaysAgo },
      { workspace_id: "w2", server_name: "other", tool_name: "read", outcome: "ok", duration_ms: 4, created_at: hourAgo },
    ] }).client;
    const body = await (await app().request("/mcp/audit")).json() as { usage: Array<{ server_name: string; calls_24h: number; calls_7d: number; tools: Array<{ tool_name: string; count: number }> }> };
    expect(body.usage).toEqual([
      { server_name: "hasdata", calls_24h: 2, calls_7d: 3, tools: [{ tool_name: "tiktok_search", count: 2 }, { tool_name: "instagram_search", count: 1 }] },
    ]);
  });

  it("does not enable a server without tools", async () => {
    h.db = db(rows()).client;
    const response = await app().request(`/mcp/registry/${SERVER_ID_TWO}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true }) });
    expect(response.status).toBe(400);
  });
});
