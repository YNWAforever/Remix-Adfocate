import { expect, it } from "vitest";
import { shapeInsights } from "./insights";
const at = "2026-10-20T01:00:00Z";
const base = { to: "2026-10-23T10:00:00Z", days: 7 as const, submissions: [], earnings: [], creators: [], missions: [] };

it("D17 closes the window at Hong Kong midnight and counts posted credits, reversals and boundaries rather than promised rewards", () => {
  const input = { ...base,
    submissions: [{ creator_id: "a", status: "approved", points_awarded: 99999, created_at: at, submitted_at: at, reviewed_at: at }],
    points: [
      { type: "earn", delta: 25, created_at: "2026-10-15T16:00:00Z" },
      { type: "adjust", delta: -8, created_at: at },
      { type: "redeem", delta: -4, created_at: at },
      { type: "earn", delta: 90, created_at: "2026-10-22T16:00:00Z" },
      { type: "earn", delta: 5, created_at: "2026-10-15T15:59:59Z" },
    ],
    earnings: [{ type: "earn", amount: "125.00", created_at: at }, { type: "adjust", amount: "-12.50", created_at: at },
      { type: "earn", amount: "999", created_at: "2026-10-22T16:00:00Z" }],
  };
  const r = shapeInsights(input);
  expect(r.window).toMatchObject({ from: "2026-10-15T16:00:00.000Z", to: "2026-10-22T16:00:00.000Z", timezone: "Asia/Hong_Kong" });
  expect(r.kpis.pointsIssued).toMatchObject({ value: 17, prev: 5 });
  expect(r.kpis.cashPaid.value).toBe(112.5);
  expect(r.trend[0].bucket).toBe("2026-10-16");
});

it("D17 approval throughput cannot inflate a submitted-cohort conversion rate and cancelled work does not enter its denominator", () => {
  const row = (id: string, status: string, submitted: string) => ({ creator_id: id, status, points_awarded: 0, created_at: submitted, submitted_at: submitted, reviewed_at: status === "approved" ? at : null });
  const r = shapeInsights({ ...base, submissions: [row("a", "approved", at), row("b", "submitted", at), row("c", "cancelled", at), row("old", "approved", "2026-10-01T00:00:00Z")] });
  expect(r.funnel.approved).toBe(2);
  expect(r.funnel.submitted).toBe(2);
  expect(r.kpis.submitToApprove.value).toBe(50);
  expect(r).toMatchObject({ denominators: { submitToApprove: { numerator: 1, denominator: 2 }, joinToSubmit: { numerator: 2, denominator: 2 } } });
});

it("D17 reports durable work outcomes with explicit missing measurements rather than fabricated zero operator/help data", () => {
  const r = shapeInsights({ ...base, outcomes: [
    { id: "one", joinedAt: "2026-10-20T00:00:00Z", firstSubmittedAt: "2026-10-20T00:10:00Z", firstReviewDecision: "approved", revisionCount: 0, required: true, deadline: "2026-10-20T01:00:00Z", approvedAt: "2026-10-20T00:30:00Z", cancelled: false },
    { id: "two", joinedAt: "2026-10-20T00:00:00Z", firstSubmittedAt: "2026-10-20T00:30:00Z", firstReviewDecision: "revision_requested", revisionCount: 2, required: true, deadline: "2026-10-20T01:00:00Z", approvedAt: null, cancelled: false },
    { id: "cancelled", joinedAt: at, firstSubmittedAt: null, firstReviewDecision: null, revisionCount: 0, required: true, deadline: at, approvedAt: null, cancelled: true },
  ] });
  expect(r).toMatchObject({ outcomes: {
    timeToFirstSubmissionMs: { samples: 2, median: 1200000 }, firstReviewAcceptance: { numerator: 1, denominator: 2, rate: 0.5 },
    revisionRounds: { samples: 2, total: 2, mean: 1 }, overdue: { numerator: 1, denominator: 2, rate: 0.5 },
    operatorHandlingMs: null, unclearStateHelpCount: null,
  } });
});

it("D17 does not dilute revision rounds with work that has no persisted first submission", () => {
  const row = { id: "pending", joinedAt: at, firstSubmittedAt: null, firstReviewDecision: null, revisionCount: 0, required: true, deadline: null, approvedAt: null, cancelled: false };
  expect(shapeInsights({ ...base, outcomes: [row] }).outcomes.revisionRounds).toEqual({ samples: 0, total: 0, mean: null });
  expect(shapeInsights({ ...base, outcomes: [row, { ...row, id: "saved", firstSubmittedAt: at, revisionCount: 2 }] }).outcomes.revisionRounds).toEqual({ samples: 1, total: 2, mean: 2 });
});
