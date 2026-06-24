// server/lib/insights.ts
// Pure aggregation for the operator Insights dashboard. Takes already-fetched rows
// (mission_submissions, earnings_transactions, creators, missions) + the window and
// produces KPIs, an engagement funnel, a level histogram, and a time-series trend.
// No DB / no async — fully unit-tested. Mirrors engagedRoster.ts / missionActivity.ts.

export type InsightsWindowDays = 7 | 30 | 90;

export type InsightsSubmissionRow = {
  creator_id: string;
  status: string;
  points_awarded: number | null;
  created_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
};

export type InsightsEarningRow = {
  amount: number | string | null; // numeric(10,2) may arrive from PostgREST as a string
  created_at: string;
};

export type InsightsCreatorRow = { level: string | null };

export type InsightsMissionRow = { status: string; quota: number | null; filled: number | null };

export type Metric = { value: number; prev: number; deltaPct: number | null };

export type Insights = {
  window: { days: InsightsWindowDays; from: string; to: string };
  kpis: {
    activeCreators: Metric;
    submitToApprove: Metric;
    pointsIssued: Metric;
    cashPaid: Metric;
    missionFillRate: Metric;
    completions: Metric;
  };
  funnel: { joined: number; submitted: number; approved: number; joinToSubmit: number; submitToApprove: number };
  levels: Array<{ level: string; count: number }>;
  trend: Array<{ bucket: string; joined: number; submitted: number; approved: number }>;
};

export type ShapeInsightsInput = {
  to: string; // ISO instant treated as "now"
  days: InsightsWindowDays;
  submissions: InsightsSubmissionRow[];
  earnings: InsightsEarningRow[];
  creators: InsightsCreatorRow[];
  missions: InsightsMissionRow[];
};

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(["joined", "submitted", "under_review"]);
// "Loop" statuses = participations that actually entered the earn loop. We intentionally
// EXCLUDE 'applied' (pending application — hasn't joined yet) and 'declined' (rejected
// application — never joined), so funnel.joined counts creators who joined the earn loop,
// not pending/rejected applicants. App-gated missions whose participants are all still
// 'applied' correctly show 0 joined until they are accepted.
const LOOP_STATUSES: ReadonlySet<string> = new Set([
  "joined",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "expired",
]);
const LEVELS = ["L0", "L1", "L2", "L3", "L4", "L5", "L6"] as const;
const DAY_MS = 86_400_000;

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

function activeCreatorCount(subs: InsightsSubmissionRow[], fromMs: number, toMs: number): number {
  const ids = new Set<string>();
  for (const r of subs) {
    if (!ACTIVE_STATUSES.has(r.status)) continue;
    if (inRange(r.created_at, fromMs, toMs) || inRange(r.submitted_at, fromMs, toMs)) ids.add(r.creator_id);
  }
  return ids.size;
}

function funnelCounts(subs: InsightsSubmissionRow[], fromMs: number, toMs: number) {
  let joined = 0;
  let submitted = 0;
  let approved = 0;
  for (const r of subs) {
    if (LOOP_STATUSES.has(r.status) && inRange(r.created_at, fromMs, toMs)) joined += 1;
    // Status-agnostic on purpose: a row that later expired still genuinely reached the
    // submitted stage, so it counts toward funnel.submitted.
    if (inRange(r.submitted_at, fromMs, toMs)) submitted += 1;
    if (r.status === "approved" && inRange(r.reviewed_at, fromMs, toMs)) approved += 1;
  }
  return { joined, submitted, approved };
}

function pointsIssued(subs: InsightsSubmissionRow[], fromMs: number, toMs: number): number {
  let sum = 0;
  for (const r of subs) {
    if (r.status === "approved" && inRange(r.reviewed_at, fromMs, toMs)) sum += r.points_awarded ?? 0;
  }
  return sum;
}

function cashPaid(earnings: InsightsEarningRow[], fromMs: number, toMs: number): number {
  let sum = 0;
  for (const e of earnings) {
    if (inRange(e.created_at, fromMs, toMs)) sum += num(e.amount);
  }
  return round2(sum);
}

function metric(value: number, prev: number): Metric {
  return { value, prev, deltaPct: deltaPct(value, prev) };
}

function pct(numr: number, denom: number): number {
  return denom === 0 ? 0 : round1((numr / denom) * 100);
}

function buildTrend(subs: InsightsSubmissionRow[], fromMs: number, toMs: number, days: InsightsWindowDays) {
  const stepMs = days === 90 ? 7 * DAY_MS : DAY_MS;
  const buckets: Array<{ bucket: string; start: number; end: number; joined: number; submitted: number; approved: number }> = [];
  for (let start = fromMs; start < toMs; start += stepMs) {
    const end = Math.min(start + stepMs, toMs);
    buckets.push({ bucket: new Date(start).toISOString().slice(0, 10), start, end, joined: 0, submitted: 0, approved: 0 });
  }
  // O(rows × buckets) — fine at MVP scale (hundreds of rows × ≤30 buckets). If submissions
  // ever exceed ~5k, switch to a single pass with a date→bucket-index map.
  for (const r of subs) {
    for (const b of buckets) {
      if (LOOP_STATUSES.has(r.status) && inRange(r.created_at, b.start, b.end)) b.joined += 1;
      if (inRange(r.submitted_at, b.start, b.end)) b.submitted += 1;
      if (r.status === "approved" && inRange(r.reviewed_at, b.start, b.end)) b.approved += 1;
    }
  }
  return buckets.map((b) => ({ bucket: b.bucket, joined: b.joined, submitted: b.submitted, approved: b.approved }));
}

export function shapeInsights(input: ShapeInsightsInput): Insights {
  const { to, days, submissions, earnings, creators, missions } = input;
  const toMs = Date.parse(to);
  const fromMs = toMs - days * DAY_MS;
  const priorFromMs = fromMs - days * DAY_MS;
  const priorToMs = fromMs;

  const cur = funnelCounts(submissions, fromMs, toMs);
  const prev = funnelCounts(submissions, priorFromMs, priorToMs);
  const curS2A = pct(cur.approved, cur.submitted);
  const prevS2A = pct(prev.approved, prev.submitted);

  let activeQuota = 0;
  let activeFilled = 0;
  for (const m of missions) {
    if (m.status !== "active") continue;
    activeQuota += m.quota ?? 0;
    activeFilled += m.filled ?? 0;
  }
  const fillRate = pct(activeFilled, activeQuota);

  const levelCounts = new Map<string, number>(LEVELS.map((l) => [l, 0]));
  for (const c of creators) {
    const lvl = c.level && levelCounts.has(c.level) ? c.level : "L0";
    levelCounts.set(lvl, (levelCounts.get(lvl) ?? 0) + 1);
  }

  return {
    window: { days, from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() },
    kpis: {
      activeCreators: metric(
        activeCreatorCount(submissions, fromMs, toMs),
        activeCreatorCount(submissions, priorFromMs, priorToMs),
      ),
      submitToApprove: { value: curS2A, prev: prevS2A, deltaPct: deltaPct(curS2A, prevS2A) },
      pointsIssued: metric(pointsIssued(submissions, fromMs, toMs), pointsIssued(submissions, priorFromMs, priorToMs)),
      cashPaid: metric(cashPaid(earnings, fromMs, toMs), cashPaid(earnings, priorFromMs, priorToMs)),
      missionFillRate: { value: fillRate, prev: 0, deltaPct: null }, // current snapshot, no prior comparison
      completions: metric(cur.approved, prev.approved),
    },
    funnel: {
      joined: cur.joined,
      submitted: cur.submitted,
      approved: cur.approved,
      joinToSubmit: pct(cur.submitted, cur.joined),
      submitToApprove: curS2A,
    },
    levels: LEVELS.map((level) => ({ level, count: levelCounts.get(level) ?? 0 })),
    trend: buildTrend(submissions, fromMs, toMs, days),
  };
}
