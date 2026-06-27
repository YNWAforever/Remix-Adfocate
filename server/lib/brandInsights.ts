// server/lib/brandInsights.ts
// Pure aggregation for the brand-facing Insights dashboard. Takes already-fetched,
// workspace-scoped rows (mission_submissions, earnings_transactions, missions, creators)
// + the window and produces brand KPIs, a top-creators leaderboard, and a TrendChart series.
// No DB / no async — fully unit-tested. Mirrors server/lib/insights.ts (operator) with a
// brand-tuned KPI set; the tiny numeric helpers are re-implemented locally so the two
// modules stay decoupled (no operator-engine coupling/refactor).

export type BrandInsightsWindowDays = 7 | 30 | 90;

export type BrandSubmissionRow = {
  creator_id: string;
  status: string;
  points_awarded: number | null;
  quality_rating: number | null;
  created_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
};
export type BrandEarningRow = { amount: number | string | null; created_at: string };
export type BrandMissionRow = { status: string; quota: number | null; filled: number | null };
export type BrandCreatorRow = { id: string; display_name: string | null };

export type Metric = { value: number; prev: number; deltaPct: number | null };
export type BrandTopCreator = { creatorId: string; name: string; approved: number; avgQuality: number };

export type BrandInsights = {
  window: { days: BrandInsightsWindowDays; from: string; to: string };
  kpis: {
    liveMissions: Metric;
    missionFillRate: Metric;
    submissionsReceived: Metric;
    approvalRate: Metric;
    completions: Metric;
    cashPaid: Metric;
    costPerDeliverable: Metric;
    pointsDistributed: Metric;
  };
  topCreators: BrandTopCreator[];
  trend: Array<{ bucket: string; joined: number; submitted: number; approved: number }>;
};

export type ShapeBrandInsightsInput = {
  to: string; // ISO instant treated as "now"
  days: BrandInsightsWindowDays;
  submissions: BrandSubmissionRow[];
  earnings: BrandEarningRow[];
  missions: BrandMissionRow[];
  creators: BrandCreatorRow[];
};

const DAY_MS = 86_400_000;
// Participations that entered the earn loop (used only for the trend's "joined" line; mirrors
// the operator engine's LOOP_STATUSES — excludes pending 'applied' / rejected 'declined').
const LOOP_STATUSES: ReadonlySet<string> = new Set([
  "joined",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "expired",
]);

function num(v: number | string | null): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}
function inRange(ts: string | null, fromMs: number, toMs: number): boolean {
  if (!ts) return false;
  const t = Date.parse(ts);
  return Number.isFinite(t) && t >= fromMs && t < toMs;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function deltaPct(value: number, prev: number): number | null {
  if (prev === 0) return null; // render "—", never ∞
  return round1(((value - prev) / prev) * 100);
}
function metric(value: number, prev: number): Metric {
  return { value, prev, deltaPct: deltaPct(value, prev) };
}
function snapshot(value: number): Metric {
  return { value, prev: 0, deltaPct: null };
}
function pct(numr: number, denom: number): number {
  return denom === 0 ? 0 : round1((numr / denom) * 100);
}

function windowAgg(subs: BrandSubmissionRow[], fromMs: number, toMs: number) {
  let submitted = 0;
  let approved = 0;
  let points = 0;
  for (const r of subs) {
    if (inRange(r.submitted_at, fromMs, toMs)) submitted += 1;
    if (r.status === "approved" && inRange(r.reviewed_at, fromMs, toMs)) {
      approved += 1;
      points += r.points_awarded ?? 0;
    }
  }
  return { submitted, approved, points };
}

function cashSum(earnings: BrandEarningRow[], fromMs: number, toMs: number): number {
  let sum = 0;
  for (const e of earnings) if (inRange(e.created_at, fromMs, toMs)) sum += num(e.amount);
  return round2(sum);
}

function buildTrend(subs: BrandSubmissionRow[], fromMs: number, toMs: number, days: BrandInsightsWindowDays) {
  const stepMs = days === 90 ? 7 * DAY_MS : DAY_MS;
  const buckets: Array<{ bucket: string; start: number; end: number; joined: number; submitted: number; approved: number }> = [];
  for (let start = fromMs; start < toMs; start += stepMs) {
    const end = Math.min(start + stepMs, toMs);
    buckets.push({ bucket: new Date(start).toISOString().slice(0, 10), start, end, joined: 0, submitted: 0, approved: 0 });
  }
  for (const r of subs) {
    for (const b of buckets) {
      if (LOOP_STATUSES.has(r.status) && inRange(r.created_at, b.start, b.end)) b.joined += 1;
      if (inRange(r.submitted_at, b.start, b.end)) b.submitted += 1;
      if (r.status === "approved" && inRange(r.reviewed_at, b.start, b.end)) b.approved += 1;
    }
  }
  return buckets.map((b) => ({ bucket: b.bucket, joined: b.joined, submitted: b.submitted, approved: b.approved }));
}

function topCreators(
  subs: BrandSubmissionRow[],
  creators: BrandCreatorRow[],
  fromMs: number,
  toMs: number,
): BrandTopCreator[] {
  const agg = new Map<string, { approved: number; ratingSum: number; ratingCount: number }>();
  for (const r of subs) {
    if (r.status !== "approved" || !inRange(r.reviewed_at, fromMs, toMs)) continue;
    const e = agg.get(r.creator_id) ?? { approved: 0, ratingSum: 0, ratingCount: 0 };
    e.approved += 1;
    if (r.quality_rating != null) {
      e.ratingSum += r.quality_rating;
      e.ratingCount += 1;
    }
    agg.set(r.creator_id, e);
  }
  const names = new Map(creators.map((c) => [c.id, c.display_name ?? "—"]));
  return [...agg.entries()]
    .map(([creatorId, e]) => ({
      creatorId,
      name: names.get(creatorId) ?? "—",
      approved: e.approved,
      avgQuality: e.ratingCount === 0 ? 0 : round1(e.ratingSum / e.ratingCount),
    }))
    .sort(
      (a, b) => b.approved - a.approved || b.avgQuality - a.avgQuality || a.creatorId.localeCompare(b.creatorId),
    )
    .slice(0, 5);
}

export function shapeBrandInsights(input: ShapeBrandInsightsInput): BrandInsights {
  const { to, days, submissions, earnings, missions, creators } = input;
  const toMs = Date.parse(to);
  const fromMs = toMs - days * DAY_MS;
  const priorFromMs = fromMs - days * DAY_MS;
  const priorToMs = fromMs;

  const cur = windowAgg(submissions, fromMs, toMs);
  const prev = windowAgg(submissions, priorFromMs, priorToMs);
  const curAR = pct(cur.approved, cur.submitted);
  const prevAR = pct(prev.approved, prev.submitted);
  const curCash = cashSum(earnings, fromMs, toMs);
  const prevCash = cashSum(earnings, priorFromMs, priorToMs);

  let liveMissions = 0;
  let activeQuota = 0;
  let activeFilled = 0;
  for (const m of missions) {
    if (m.status !== "active") continue;
    liveMissions += 1;
    activeQuota += m.quota ?? 0;
    activeFilled += m.filled ?? 0;
  }

  return {
    window: { days, from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() },
    kpis: {
      liveMissions: snapshot(liveMissions),
      missionFillRate: snapshot(pct(activeFilled, activeQuota)),
      submissionsReceived: metric(cur.submitted, prev.submitted),
      approvalRate: { value: curAR, prev: prevAR, deltaPct: deltaPct(curAR, prevAR) },
      completions: metric(cur.approved, prev.approved),
      cashPaid: metric(curCash, prevCash),
      costPerDeliverable: snapshot(cur.approved === 0 ? 0 : round2(curCash / cur.approved)),
      pointsDistributed: metric(cur.points, prev.points),
    },
    topCreators: topCreators(submissions, creators, fromMs, toMs),
    trend: buildTrend(submissions, fromMs, toMs, days),
  };
}
