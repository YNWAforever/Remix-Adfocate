// @vitest-environment node
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../lib/supabase.js", () => ({ serviceClient: () => h.db, makeUserClient: () => h.db }));

import { mcpPilotRoutes } from "../routes/mcpPilot";

type Row = Record<string, unknown>;
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const ZERO_WORKSPACE = "00000000-0000-0000-0000-0000000000aa";
const TOKEN = "pilot-secret";

function db(rows: Record<string, Row[]> = {}) {
  const from = (table: string) => {
    const filters: Row = {};
    const q: Record<string, unknown> = {
      select() { return q; },
      eq(key: string, value: unknown) { filters[key] = value; return q; },
      order() { return q; },
      limit() { return q; },
      then(resolve: (value: unknown) => unknown) {
        const data = (rows[table] ?? []).filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return q;
  };
  return { from };
}

const app = () => new Hono().route("/mcp-pilot", mcpPilotRoutes());
function post(body: Record<string, unknown>, query = `ws=${WORKSPACE}&token=${TOKEN}`) {
  return app().request(`/mcp-pilot?${query}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", ...body }) });
}

beforeEach(() => { vi.stubEnv("MCP_PILOT_TOKEN", TOKEN); });
afterEach(() => vi.unstubAllEnvs());

describe("mcp pilot server", () => {
  it("rejects missing or wrong tokens and malformed workspaces", async () => {
    expect((await post({ id: 1, method: "initialize" }, `ws=${WORKSPACE}&token=nope`)).status).toBe(401);
    expect((await post({ id: 1, method: "initialize" }, `ws=not-a-uuid&token=${TOKEN}`)).status).toBe(401);
    expect((await post({ id: 1, method: "initialize" }, `ws=${WORKSPACE}`)).status).toBe(401);
    expect((await post({ id: 1, method: "initialize" }, `ws=${ZERO_WORKSPACE}&token=${TOKEN}`)).status).toBe(200);
  });

  it("speaks initialize and tools/list", async () => {
    h.db = db();
    const init = await post({ id: 1, method: "initialize" });
    expect(init.status).toBe(200);
    expect(await init.json()).toMatchObject({ result: { protocolVersion: "2025-03-26", serverInfo: { name: "kocmax-workspace-pilot" } } });
    const list = await post({ id: 2, method: "tools/list" });
    expect(await list.json()).toMatchObject({ result: { tools: [{ name: "list_open_missions" }] } });
  });

  it("returns workspace-scoped open missions for the allowlisted tool only", async () => {
    h.db = db({
      missions: [
        { workspace_id: WORKSPACE, status: "active", slug: "tea", title: "Tea story", points_reward: 400, cash_reward: 0, deadline: "2026-12-15T00:00:00Z", platforms: ["instagram"] },
        { workspace_id: "other", status: "active", slug: "secret", title: "Other", points_reward: 100, cash_reward: 0, deadline: null, platforms: [] },
      ],
    });
    const response = await post({ id: 3, method: "tools/call", params: { name: "list_open_missions", arguments: {} } });
    const body = await response.json() as { result: { content: Array<{ text: string }> } };
    const payload = JSON.parse(body.result.content[0].text) as { missions: Array<{ title: string }> };
    expect(payload.missions.map(mission => mission.title)).toEqual(["Tea story"]);
    const unknown = await post({ id: 4, method: "tools/call", params: { name: "delete_mission", arguments: {} } });
    expect(await unknown.json()).toMatchObject({ result: { isError: true } });
  });
});
