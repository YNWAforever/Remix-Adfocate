// @vitest-environment node
import { describe, expect, it } from "vitest";
import { runTool } from "../lib/assistant/tools";

type ReadCall = { table: string; select?: string; filters: Record<string, unknown>; limit?: number };
function fakeClient(rows: Record<string, unknown>) {
  const calls: ReadCall[] = [];
  const from = (table: string) => {
    const call: ReadCall = { table, filters: {} };
    calls.push(call);
    const query = {
      select(fields: string) { call.select = fields; return query; },
      eq(key: string, value: unknown) { call.filters[key] = value; return query; },
      order() { return query; },
      limit(value: number) { call.limit = value; return query; },
      then(resolve: (value: { data: unknown; error: null }) => unknown) {
        return Promise.resolve({ data: rows[table] ?? [], error: null as null }).then(resolve);
      },
    };
    return query;
  };
  return { client: { from } as unknown as Parameters<typeof runTool>[2], calls };
}

describe("read-only studio tools", () => {
  it("filters mission requirements by slug and workspace and bounds the result", async () => {
    const { client, calls } = fakeClient({ missions: [{ slug: "tea", title: "Tea mission", requirements: "Include #廣告" }] });
    const output = await runTool("get_my_mission_requirements", JSON.stringify({ mission_slug: "tea" }), client, { workspaceId: "workspace" });
    expect(calls[0].table).toBe("missions");
    expect(calls[0].filters).toMatchObject({ slug: "tea", workspace_id: "workspace" });
    expect(calls[0].select).toContain("requirements");
    expect(calls[0].select).not.toMatch(/cash|reward/);
    expect(JSON.parse(output).mission).toMatchObject({ title: "Tea mission", requirements: "Include #廣告" });
  });
  it("requires a slug before reading any mission", async () => {
    const { client, calls } = fakeClient({});
    const output = await runTool("get_my_mission_requirements", JSON.stringify({}), client);
    expect(JSON.parse(output).error).toBe("mission_slug is required");
    expect(calls).toEqual([]);
  });
  it("filters mission status and caps the listed missions", async () => {
    const { client, calls } = fakeClient({ mission_submissions: [{ status: "approved" }] });
    const output = await runTool("get_my_missions", JSON.stringify({ status: "approved" }), client);
    expect(calls[0].filters).toMatchObject({ status: "approved" });
    expect(calls[0].limit).toBe(50);
    expect(JSON.parse(output).missions).toHaveLength(1);
  });
  it("returns the available earnings balance without exposing ledger rows", async () => {
    const { client, calls } = fakeClient({ earnings_balances: [{ available: "42.5" }] });
    expect(await runTool("get_my_earnings", "{}", client)).toBe(JSON.stringify({ available: 42.5 }));
    expect(calls[0].select).toBe("available");
  });
  it("returns the points balance and never executes unknown tools", async () => {
    const { client } = fakeClient({ point_balances: [{ balance: 120 }] });
    expect(await runTool("get_my_points", "{}", client)).toBe(JSON.stringify({ points: 120 }));
    expect(await runTool("award_points", "{}", client)).toBe("unknown tool: award_points");
  });
  it("lists bounded point and earnings history for the creator", async () => {
    const points = fakeClient({ point_transactions: [{ type: "earn", delta: 200, description: "mission" }] });
    const pointOut = JSON.parse(await runTool("get_my_points_history", "{}", points.client));
    expect(pointOut.transactions).toHaveLength(1);
    expect(points.calls[0].select).toContain("balance_after");
    expect(points.calls[0].limit).toBe(20);
    const earnings = fakeClient({ earnings_transactions: [{ type: "settle", amount: 30 }] });
    const earningOut = JSON.parse(await runTool("get_my_earnings_history", "{}", earnings.client));
    expect(earningOut.transactions).toHaveLength(1);
    expect(earnings.calls[0].select).toContain("amount");
    expect(earnings.calls[0].limit).toBe(20);
  });
  it("lists the creator's recent discussion threads", async () => {
    const { client, calls } = fakeClient({ studio_threads: [{ title: "Tea brief", topic: "creation" }] });
    const output = JSON.parse(await runTool("get_my_recent_threads", "{}", client));
    expect(output.threads).toHaveLength(1);
    expect(calls[0].select).toContain("topic");
    expect(calls[0].limit).toBe(10);
  });
  it("lists open workspace missions with a bounded read", async () => {
    const { client, calls } = fakeClient({ missions: [{ slug: "tea", title: "Tea", points_reward: 400 }] });
    const output = await runTool("get_open_missions", "{}", client, { workspaceId: "workspace" });
    expect(calls[0].filters).toMatchObject({ status: "active", workspace_id: "workspace" });
    expect(calls[0].limit).toBe(20);
    expect(JSON.parse(output).missions).toHaveLength(1);
  });
  it("returns redemption history and notification state without writes", async () => {
    const redemptions = fakeClient({ redemptions: [{ code: "A-1", status: "fulfilled" }] });
    expect(JSON.parse(await runTool("get_my_redemptions", "{}", redemptions.client)).redemptions).toHaveLength(1);
    expect(redemptions.calls[0].select).toContain("redemption_gifts");
    const notifications = fakeClient({ notifications: [{ type: "mission", read_at: null }] });
    expect(JSON.parse(await runTool("get_my_notifications", "{}", notifications.client)).notifications).toHaveLength(1);
    expect(notifications.calls[0].select).toContain("read_at");
  });
});
