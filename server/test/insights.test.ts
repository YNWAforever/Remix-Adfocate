// server/test/insights.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeStaff, makeCreator, seedSubmission, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function adminReq(path: string, jwt: string) {
  return app.request(`/api${path}`, { headers: { Authorization: `Bearer ${jwt}` } });
}

suite("admin insights", () => {
  let staff: { userId: string; jwt: string };
  let creator: { userId: string; jwt: string };

  beforeAll(async () => {
    await cleanup();
    staff = await makeStaff("insights-staff@test.local");
    creator = await makeCreator("insights-koc@test.local", 0);
    await seedSubmission(creator.userId, "joined", "test-insights-joined");
    await seedSubmission(creator.userId, "submitted", "test-insights-submitted");
  });
  afterAll(cleanup);

  it("rejects an invalid window with 422", async () => {
    const res = await adminReq("/admin/insights?window=5", staff.jwt);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("validation");
  });

  it("requires staff auth (401 without a token)", async () => {
    const res = await app.request("/api/admin/insights?window=30");
    expect(res.status).toBe(401);
  });

  it("returns a well-formed insights payload for staff", async () => {
    const res = await adminReq("/admin/insights?window=30", staff.jwt);
    expect(res.status).toBe(200);
    const { insights } = await res.json();
    expect(insights.window.days).toBe(30);
    expect(insights.kpis.activeCreators.value).toBeGreaterThanOrEqual(1); // seeded joined+submitted
    expect(insights.funnel.joined).toBeGreaterThanOrEqual(1);
    expect(insights.levels).toHaveLength(7);
    expect(insights.levels[0].level).toBe("L0");
    expect(Array.isArray(insights.trend)).toBe(true);
    expect(insights.trend.length).toBe(30);
  });

  it("accepts a workspace filter without crashing", async () => {
    const res = await adminReq("/admin/insights?window=30&workspace=00000000-0000-0000-0000-0000000000ff", staff.jwt);
    expect(res.status).toBe(200);
    const { insights } = await res.json();
    expect(insights.window.days).toBe(30);
    expect(insights.levels).toHaveLength(7);
  });
});
