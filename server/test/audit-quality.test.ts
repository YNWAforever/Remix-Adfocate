import { readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe.skipIf(process.env.RUN_AUDIT_INTEGRATION !== "1")("D17 exact-owned durable Insights and role scope", () => {
  type Fixture = { runId: string; target: unknown; workspaceId: string; slug: string; creator: { id: string; jwt: string }; other: { id: string }; operator: { jwt: string }; noMembership: { jwt: string } };
  let fx: Fixture;
  let app: ReturnType<(typeof import("../app"))["createApp"]>["app"];
  let readSnapshot: () => unknown;
  let before: unknown;
  const results: { name: string; status: number; code?: string }[] = [];
  async function request(name: string, actor?: { jwt: string }, slug?: string) {
    const response = await app.request("/api/admin/insights?window=7", { headers: {
      ...(actor ? { Authorization: `Bearer ${actor.jwt}` } : {}), "X-Workspace-Slug": slug ?? fx.slug,
    } });
    const envelope = await response.json(); const body = envelope.insights ?? envelope; results.push({ name, status: response.status, code: body.code });
    return { response, body };
  }
  beforeAll(async () => {
    // Identity must precede fixture credentials and application/client creation. No setup/seed is performed here.
    // @ts-expect-error Native ESM verifier has no declaration file.
    const { verifiedTarget } = await import("../../scripts/audit/local-targets.mjs");
    const target = verifiedTarget("empty");
    fx = JSON.parse(readFileSync(".codex-tmp/D17-fixture.private.json", "utf8"));
    expect(isDeepStrictEqual(target.identity, fx.target)).toBe(true);
    Object.assign(process.env, target.env);
    // @ts-expect-error Native ESM snapshot helper has no declaration file.
    const { neutralitySnapshot } = await import("../../scripts/audit/neutrality-snapshot.mjs");
    readSnapshot = () => [fx.creator, fx.other].map(actor => neutralitySnapshot(target, actor.id, fx.workspaceId));
    before = readSnapshot(); app = (await import("../app")).createApp().app;
  });
  afterAll(() => {
    if (!readSnapshot) return;
    const after = readSnapshot(); expect(after).toEqual(before);
    writeFileSync("docs/verification/D17-api-contract.json", JSON.stringify({ runId: fx.runId, target: fx.target, results,
      neutrality: { before, after, allEqual: isDeepStrictEqual(before, after) }, writes: false, providers: "external HTTP blocked" }, null, 2) + "\n");
  });
  it("reloads net posted credits and all 10000 creators in complete HK calendar days", async () => {
    const { response, body } = await request("posted-ledger-and-total", fx.operator);
    expect(response.status).toBe(200); expect(body.window.timezone).toBe("Asia/Hong_Kong");
    expect(body.window.from).toContain("T16:00:00.000Z"); expect(body.window.to).toContain("T16:00:00.000Z");
    expect(body.kpis.pointsIssued.value).toBe(17); expect(body.kpis.cashPaid.value).toBe(112.5);
    expect(body.levels.reduce((sum: number, row: { count: number }) => sum + row.count, 0)).toBe(10000);
    expect(body.outcomes.operatorHandlingMs).toBeNull(); expect(body.outcomes.unclearStateHelpCount).toBeNull();
  });
  it("denies signed-in staff with no membership as a scope failure", async () => {
    const { response, body } = await request("staff-without-membership", fx.noMembership);
    expect(response.status).toBe(403); expect(body.code).toBe("WORKSPACE_MEMBERSHIP_REQUIRED");
  });
  it("denies a foreign workspace without returning its metrics", async () => {
    const { response, body } = await request("foreign-workspace", fx.operator, fx.slug + "-b");
    expect(response.status).toBe(404); expect(body.kpis).toBeUndefined();
  });
  it("denies a Creator as operator", async () => {
    const { response, body } = await request("creator-as-operator", fx.creator);
    expect(response.status).toBe(403); expect(body.kpis).toBeUndefined();
  });
  it("denies an anonymous read", async () => {
    const { response, body } = await request("anonymous");
    expect(response.status).toBe(401); expect(body.kpis).toBeUndefined();
  });
});
