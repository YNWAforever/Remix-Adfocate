// server/lib/insights.test.ts
import { describe, it, expect } from "vitest";
import {
  shapeInsights,
  type InsightsSubmissionRow,
  type InsightsEarningRow,
  type InsightsCreatorRow,
  type InsightsMissionRow,
  type InsightsPointRow,
} from "./insights";

const TO = "2026-06-30T00:00:00.000Z"; // "now" for the window
const inWin = "2026-06-20T00:00:00.000Z"; // within last 30d
const inPrior = "2026-05-20T00:00:00.000Z"; // within prior 30d (31..60d ago)

let n = 0;
function sub(over: Partial<InsightsSubmissionRow> & { status: string }): InsightsSubmissionRow {
  return {
    creator_id: over.creator_id ?? `c${n++}`,
    status: over.status,
    points_awarded: over.points_awarded ?? 0,
    created_at: over.created_at ?? inWin,
    submitted_at: over.submitted_at ?? null,
    reviewed_at: over.reviewed_at ?? null,
  };
}

function base(over: {
  submissions?: InsightsSubmissionRow[];
  earnings?: InsightsEarningRow[];
  creators?: InsightsCreatorRow[];
  missions?: InsightsMissionRow[];
  points?: InsightsPointRow[];
}) {
  return shapeInsights({
    to: TO,
    days: 30,
    submissions: over.submissions ?? [],
    earnings: over.earnings ?? [],
    creators: over.creators ?? [],
    missions: over.missions ?? [],
    points: over.points ?? [],
  });
}

describe("shapeInsights", () => {
  it("returns all-zero metrics and a 7-level histogram on empty input (no throw)", () => {
    const r = base({});
    expect(r.kpis.activeCreators.value).toBe(0);
    expect(r.kpis.cashPaid.value).toBe(0);
    expect(r.kpis.activeCreators.deltaPct).toBeNull(); // prev 0 -> null
    expect(r.levels.map((l) => l.level)).toEqual(["L0", "L1", "L2", "L3", "L4", "L5", "L6"]);
    expect(r.levels.every((l) => l.count === 0)).toBe(true);
    expect(r.window.days).toBe(30);
    expect(Array.isArray(r.trend)).toBe(true);
  });

  it("counts distinct active creators in-window only", () => {
    const r = base({
      submissions: [
        sub({ creator_id: "a", status: "joined", created_at: inWin }),
        sub({ creator_id: "a", status: "submitted", created_at: inWin, submitted_at: inWin }),
        sub({ creator_id: "b", status: "joined", created_at: inWin }),
        sub({ creator_id: "old", status: "joined", created_at: inPrior }), // prior window, not current
      ],
    });
    expect(r.kpis.activeCreators.value).toBe(2); // a, b
  });

  it("computes the funnel and its conversion percentages", () => {
    const r = base({
      points: [{ type: "earn", delta: 100, created_at: inWin }, { type: "earn", delta: 50, created_at: inWin }],
      submissions: [
        sub({ creator_id: "a", status: "joined", created_at: inWin }),
        sub({ creator_id: "b", status: "submitted", created_at: inWin, submitted_at: inWin }),
        sub({ creator_id: "c", status: "approved", created_at: inWin, submitted_at: inWin, reviewed_at: inWin, points_awarded: 100 }),
        sub({ creator_id: "d", status: "approved", created_at: inWin, submitted_at: inWin, reviewed_at: inWin, points_awarded: 50 }),
      ],
    });
    expect(r.funnel.joined).toBe(4); // all four are loop-status rows created in-window
    expect(r.funnel.submitted).toBe(3); // b, c, d have submitted_at in-window
    expect(r.funnel.approved).toBe(2); // c, d
    expect(r.funnel.joinToSubmit).toBe(75); // 3/4
    expect(r.funnel.submitToApprove).toBeCloseTo(66.7, 1); // 2/3
    expect(r.kpis.pointsIssued.value).toBe(150);
    expect(r.kpis.completions.value).toBe(2);
  });

  it("computes deltaPct vs the prior equal-length window", () => {
    const r = base({
      points: [{ type: "earn", delta: 200, created_at: inWin }, { type: "earn", delta: 100, created_at: inPrior }],
      submissions: [
        sub({ creator_id: "a", status: "approved", created_at: inWin, submitted_at: inWin, reviewed_at: inWin, points_awarded: 200 }),
        sub({ creator_id: "b", status: "approved", created_at: inPrior, submitted_at: inPrior, reviewed_at: inPrior, points_awarded: 100 }),
      ],
    });
    // current points = 200, prior = 100 -> +100%
    expect(r.kpis.pointsIssued.value).toBe(200);
    expect(r.kpis.pointsIssued.prev).toBe(100);
    expect(r.kpis.pointsIssued.deltaPct).toBe(100);
  });

  it("sums cash from earnings credits in-window", () => {
    const r = base({
      earnings: [
        { amount: "150.50", created_at: inWin },
        { amount: 49.5, created_at: inWin },
        { amount: 999, created_at: "2026-01-01T00:00:00.000Z" }, // far past, excluded
      ],
    });
    expect(r.kpis.cashPaid.value).toBe(200); // 150.50 + 49.50
  });

  it("computes mission fill rate over active missions (snapshot, null delta)", () => {
    const r = base({
      missions: [
        { status: "active", quota: 10, filled: 4 },
        { status: "active", quota: 10, filled: 1 },
        { status: "draft", quota: 100, filled: 0 }, // ignored
      ],
    });
    expect(r.kpis.missionFillRate.value).toBe(25); // 5/20
    expect(r.kpis.missionFillRate.deltaPct).toBeNull();
  });

  it("builds a level histogram from creator levels", () => {
    const r = base({ creators: [{ level: "L0" }, { level: "L3" }, { level: "L3" }, { level: null }] });
    const byLevel = Object.fromEntries(r.levels.map((l) => [l.level, l.count]));
    expect(byLevel.L0).toBe(2); // L0 + null defaults to L0
    expect(byLevel.L3).toBe(2);
    expect(byLevel.L6).toBe(0);
  });

  it("buckets the trend by day for 7d/30d and by week for 90d", () => {
    const sevenSubs = [sub({ creator_id: "a", status: "joined", created_at: inWin })];
    const day = shapeInsights({ to: TO, days: 30, submissions: sevenSubs, earnings: [], creators: [], missions: [] });
    expect(day.trend.length).toBe(30); // 30 daily buckets
    const week = shapeInsights({ to: TO, days: 90, submissions: sevenSubs, earnings: [], creators: [], missions: [] });
    expect(week.trend.length).toBeGreaterThanOrEqual(12); // ~13 weekly buckets
    expect(week.trend.length).toBeLessThanOrEqual(14);
    const sevenDay = shapeInsights({ to: TO, days: 7, submissions: sevenSubs, earnings: [], creators: [], missions: [] });
    expect(sevenDay.trend.length).toBe(7);
  });
});
