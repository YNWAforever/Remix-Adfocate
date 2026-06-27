import { describe, it, expect } from "vitest";
import { shapeBrandInsights, type BrandSubmissionRow } from "./brandInsights";

const TO = "2026-02-01T00:00:00.000Z"; // "now"
// helpers to place a timestamp N days before TO
const daysAgo = (n: number) => new Date(Date.parse(TO) - n * 86_400_000).toISOString();

function sub(p: Partial<BrandSubmissionRow>): BrandSubmissionRow {
  return {
    creator_id: "c1",
    status: "approved",
    points_awarded: 0,
    quality_rating: null,
    created_at: daysAgo(1),
    submitted_at: daysAgo(1),
    reviewed_at: daysAgo(1),
    ...p,
  };
}

describe("shapeBrandInsights", () => {
  it("empty input → all-zero KPIs, no top creators, zeroed trend buckets", () => {
    const r = shapeBrandInsights({ to: TO, days: 7, submissions: [], earnings: [], missions: [], creators: [] });
    expect(r.kpis.liveMissions.value).toBe(0);
    expect(r.kpis.approvalRate.value).toBe(0);
    expect(r.kpis.costPerDeliverable.value).toBe(0);
    expect(r.topCreators).toEqual([]);
    expect(r.trend.length).toBe(7);
    expect(r.trend.every((b) => b.joined === 0 && b.submitted === 0 && b.approved === 0)).toBe(true);
  });

  it("counts submissions/completions in window and compares to the prior window", () => {
    const subs = [
      sub({ submitted_at: daysAgo(2), reviewed_at: daysAgo(1), status: "approved" }), // current
      sub({ submitted_at: daysAgo(2), reviewed_at: daysAgo(1), status: "approved" }), // current
      sub({ submitted_at: daysAgo(10), reviewed_at: daysAgo(9), status: "approved" }), // prior (7-day window)
    ];
    const r = shapeBrandInsights({ to: TO, days: 7, submissions: subs, earnings: [], missions: [], creators: [] });
    expect(r.kpis.submissionsReceived.value).toBe(2);
    expect(r.kpis.submissionsReceived.prev).toBe(1);
    expect(r.kpis.completions.value).toBe(2);
    expect(r.kpis.completions.deltaPct).toBe(100); // (2-1)/1*100
  });

  it("approvalRate = approved/submitted %, and is 0 (not NaN) when nothing submitted", () => {
    const subs = [
      sub({ submitted_at: daysAgo(1), reviewed_at: daysAgo(1), status: "approved" }),
      sub({ submitted_at: daysAgo(1), reviewed_at: null, status: "submitted" }),
    ];
    const r = shapeBrandInsights({ to: TO, days: 7, submissions: subs, earnings: [], missions: [], creators: [] });
    expect(r.kpis.approvalRate.value).toBe(50);
    const empty = shapeBrandInsights({ to: TO, days: 7, submissions: [], earnings: [], missions: [], creators: [] });
    expect(empty.kpis.approvalRate.value).toBe(0);
  });

  it("cashPaid sums string-numeric amounts; costPerDeliverable = cash/approved (0 when none)", () => {
    const subs = [sub({ reviewed_at: daysAgo(1), status: "approved" }), sub({ reviewed_at: daysAgo(1), status: "approved" })];
    const earnings = [
      { amount: "30.00", created_at: daysAgo(1) },
      { amount: 50, created_at: daysAgo(2) },
      { amount: 999, created_at: daysAgo(40) }, // outside the 7-day window
    ];
    const r = shapeBrandInsights({ to: TO, days: 7, submissions: subs, earnings, missions: [], creators: [] });
    expect(r.kpis.cashPaid.value).toBe(80);
    expect(r.kpis.costPerDeliverable.value).toBe(40); // 80 / 2
    const noApprove = shapeBrandInsights({ to: TO, days: 7, submissions: [], earnings, missions: [], creators: [] });
    expect(noApprove.kpis.costPerDeliverable.value).toBe(0);
  });

  it("pointsDistributed sums points_awarded on approved-in-window and is NOT folded into cash", () => {
    const subs = [sub({ reviewed_at: daysAgo(1), status: "approved", points_awarded: 100 })];
    const r = shapeBrandInsights({ to: TO, days: 7, submissions: subs, earnings: [], missions: [], creators: [] });
    expect(r.kpis.pointsDistributed.value).toBe(100);
    expect(r.kpis.cashPaid.value).toBe(0);
  });

  it("liveMissions counts active missions; missionFillRate = filled/quota %", () => {
    const missions = [
      { status: "active", quota: 10, filled: 4 },
      { status: "active", quota: 10, filled: 1 },
      { status: "closed", quota: 5, filled: 5 },
    ];
    const r = shapeBrandInsights({ to: TO, days: 7, submissions: [], earnings: [], missions, creators: [] });
    expect(r.kpis.liveMissions.value).toBe(2);
    expect(r.kpis.liveMissions.deltaPct).toBe(null); // snapshot
    expect(r.kpis.missionFillRate.value).toBe(25); // 5 / 20
  });

  it("topCreators ranks by approved count, averages non-null ratings, resolves names, caps at 5", () => {
    const subs = [
      sub({ creator_id: "a", reviewed_at: daysAgo(1), status: "approved", quality_rating: 5 }),
      sub({ creator_id: "a", reviewed_at: daysAgo(1), status: "approved", quality_rating: 3 }),
      sub({ creator_id: "b", reviewed_at: daysAgo(1), status: "approved", quality_rating: null }),
    ];
    const creators = [{ id: "a", display_name: "Alice" }, { id: "b", display_name: null }];
    const r = shapeBrandInsights({ to: TO, days: 7, submissions: subs, earnings: [], missions: [], creators });
    expect(r.topCreators[0]).toEqual({ creatorId: "a", name: "Alice", approved: 2, avgQuality: 4 });
    expect(r.topCreators[1]).toEqual({ creatorId: "b", name: "—", approved: 1, avgQuality: 0 });
  });

  it("uses weekly buckets for the 90-day window", () => {
    const r = shapeBrandInsights({ to: TO, days: 90, submissions: [], earnings: [], missions: [], creators: [] });
    expect(r.trend.length).toBe(Math.ceil(90 / 7)); // 13 weekly buckets
  });
});
