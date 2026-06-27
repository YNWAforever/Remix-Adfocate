import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeBrand, makeCreator, seedMission, seedBrandSubmission, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

const brandReq = (path: string, jwt: string, init: RequestInit = {}) =>
  app.request(`/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

suite("brand insights", () => {
  let A: Awaited<ReturnType<typeof makeBrand>>;
  let B: Awaited<ReturnType<typeof makeBrand>>;
  let koc: Awaited<ReturnType<typeof makeCreator>>;

  beforeAll(async () => {
    await cleanup();
    A = await makeBrand("insights-a@test.local");
    B = await makeBrand("insights-b@test.local");
    koc = await makeCreator("insights-koc@test.local", 0);
  });
  afterAll(cleanup);

  it("rejects an invalid window with 422", async () => {
    const res = await brandReq("/brand/insights?window=5", A.jwt);
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("validation");
  });

  it("returns the shaped KPI envelope for the caller's workspace", async () => {
    const res = await brandReq("/brand/insights?window=30", A.jwt);
    expect(res.status).toBe(200);
    const { insights } = await res.json();
    expect(insights).toHaveProperty("kpis.cashPaid.value");
    expect(insights).toHaveProperty("topCreators");
    expect(Array.isArray(insights.trend)).toBe(true);
  });

  it("counts an approved submission as a completion for THIS brand only", async () => {
    const m = await seedMission(A.workspaceId, { slug: "test-ins-a", status: "active", points_reward: 10, cash_reward: 20 });
    const sub = await seedBrandSubmission({ creatorId: koc.userId, workspaceId: A.workspaceId, missionId: m.id, status: "submitted" });
    const ap = await brandReq(`/brand/review/submissions/${sub}/approve`, A.jwt, { method: "POST", body: JSON.stringify({}) });
    expect(ap.status).toBe(200);

    const resA = await brandReq("/brand/insights?window=30", A.jwt);
    const a = (await resA.json()).insights;
    expect(a.kpis.completions.value).toBeGreaterThanOrEqual(1);
    expect(a.kpis.cashPaid.value).toBeGreaterThanOrEqual(20);

    // Brand B's workspace saw none of A's activity.
    const resB = await brandReq("/brand/insights?window=30", B.jwt);
    const b = (await resB.json()).insights;
    expect(b.kpis.completions.value).toBe(0);
    expect(b.kpis.cashPaid.value).toBe(0);
  });
});
