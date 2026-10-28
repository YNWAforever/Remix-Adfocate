import { grantStaffFixture } from "./helpers";
import { fixtureName } from "./helpers";
// server/test/insights.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { DEMO_WS, makeStaff, makeCreator, seedSubmission, cleanup, hasSupabaseEnv, serviceForTests } from "./helpers";

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
    staff = await makeStaff(fixtureName("insights-staff@test.local"), DEMO_WS);
    await grantStaffFixture(staff.userId,DEMO_WS,"operator");
    creator = await makeCreator(fixtureName("insights-koc@test.local"), 0);
    await seedSubmission(creator.userId, "joined", fixtureName("test-insights-joined"));
    await seedSubmission(creator.userId, "submitted", fixtureName("test-insights-submitted"));
    // D17 reports completed Hong Kong days; keep seeded activity inside that window.
    const previousDay = new Date(Date.now() - 86_400_000).toISOString();
    const dated = await serviceForTests().from("mission_submissions").update({ created_at: previousDay, submitted_at: previousDay }).eq("creator_id", creator.userId);
    if (dated.error) throw dated.error;
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

  it("rejects an inaccessible workspace without leaking data", async () => {
    const res = await adminReq("/admin/insights?window=30&workspace=00000000-0000-0000-0000-0000000000ff", staff.jwt);
    expect(res.status).toBe(404);
    expect((await res.json()).insights).toBeUndefined();
  });
});
