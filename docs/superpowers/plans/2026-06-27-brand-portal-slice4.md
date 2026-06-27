# Brand Portal Slice 4 — Brand Analytics / Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a brand a read-only `/brand/insights` dashboard — mission performance, HK$ spend & ROI, top creators, and an activity trend — scoped to its own workspace, with zero new tables.

**Architecture:** A dedicated pure `shapeBrandInsights()` (mirrors `server/lib/insights.ts` but brand-tuned) over workspace-scoped rows fetched via `serviceClient` hard-filtered to `c.var.brand.workspaceId` (the Slice 2 trust boundary, since `mission_submissions` has no brand RLS). A new `GET /brand/insights` route + a brand page reusing the operator's `TrendChart` and KPI-card styling. No migration, no env, no flag-day.

**Tech Stack:** Hono server routes, Supabase (`serviceClient` reads only), TanStack Router + React Query + Tailwind (Acid-Y2K tokens), Vitest (unit + integration + route-stub).

**Spec:** `docs/superpowers/specs/2026-06-27-brand-portal-slice4-design.md`

**Conventions (read before starting):**
- Every relative import in a non-test `server/**` file MUST carry the `.js` ESM extension (CI-guarded by `npm run build`). `src/**` and `*.test.*` use `@/...`/relative with NO `.js`.
- `src/lib/i18n.dict.ts` has an `en` block and a `zh` block; a unit test asserts the key SETS are identical — every key added to one block MUST be added to the other.
- The integration suite (`server/test/*.test.ts`) auto-skips locally without a Supabase stack (`hasSupabaseEnv`); it runs in CI. Local verification for server tasks = `npm run type-check` + `npm run lint` + `npm run build`. Do NOT try to make the integration suite pass locally.
- New TanStack route files require `npm run type-check` (which runs `tsr generate`) to regenerate the route tree; `src/routeTree.gen.ts` is gitignored — do NOT commit it.
- **Slice-3 regression lesson:** adding a new `@/lib/brand` export that a SHARED brand component consumes breaks other brand route-stub tests whose `vi.mock("@/lib/brand")` lacks it. This slice's new `@/lib/brand` exports are consumed only by NEW files, so no existing stub needs updating — but verify by running the full `npm run test` at the end.

---

## File structure

**Create:**
- `server/lib/brandInsights.ts` — pure `shapeBrandInsights()` (Task 1)
- `server/lib/brandInsights.test.ts` — unit tests (Task 1)
- `server/routes/brandInsights.ts` — `GET /brand/insights` (Task 2)
- `server/test/brandInsights.test.ts` — integration test (Task 2)
- `src/routes/brand.insights.tsx` — brand insights page (Task 5)
- `src/routes/-brand.insights.test.tsx` — route-stub test (Task 6)

**Modify:**
- `server/routes/brand.ts` — mount `brandInsightsRoutes` under `guarded` (Task 2)
- `package.json` — register `brandInsights.test.ts` in `test:integration` (Task 2)
- `src/lib/brand.ts` — `brandKeys.insights`, types, `fetchBrandInsights` (Task 3)
- `src/lib/i18n.dict.ts` — `app.brand.navInsights` + `app.brand.insights.*` (Task 4)
- `src/components/brand/BrandNav.tsx` — add an Insights nav item (Task 5)

---

## Task 1: Pure `shapeBrandInsights` + unit tests

**Files:**
- Create: `server/lib/brandInsights.ts`
- Create: `server/lib/brandInsights.test.ts`

This is TDD: write the function and its tests together; the unit suite runs locally (no stack needed).

- [ ] **Step 1: Create `server/lib/brandInsights.ts`** with EXACTLY this content:

```ts
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
```

- [ ] **Step 2: Create `server/lib/brandInsights.test.ts`** with EXACTLY this content:

```ts
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
```

- [ ] **Step 3: Run the unit tests**

Run: `npm run test -- server/lib/brandInsights.test.ts`
Expected: 8 passing.

- [ ] **Step 4: Gates**

Run: `npm run type-check && npm run lint`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add server/lib/brandInsights.ts server/lib/brandInsights.test.ts
git commit -m "feat(brand): shapeBrandInsights pure aggregation + unit tests"
```

---

## Task 2: `GET /brand/insights` route + mount + integration test

**Files:**
- Create: `server/routes/brandInsights.ts`
- Modify: `server/routes/brand.ts`
- Create: `server/test/brandInsights.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Create `server/routes/brandInsights.ts`** with EXACTLY this content (`.js` on every relative import):

```ts
// server/routes/brandInsights.ts
import { Hono } from "hono";
import { serviceClient } from "../lib/supabase.js";
import { shapeBrandInsights, type BrandInsightsWindowDays } from "../lib/brandInsights.js";
import type { BrandEnv } from "../lib/brandAuth.js";

/** Brand-facing READ-ONLY analytics. Mounted under requireBrand; reads via serviceClient
 *  hard-filtered to c.var.brand.workspaceId (mission_submissions has no brand RLS policy, so we
 *  use the Slice 2 trust-boundary pattern — workspace comes from the verified identity, never a
 *  param). All relative imports carry .js. */
export const brandInsightsRoutes = new Hono<BrandEnv>();

const VALID_WINDOWS: BrandInsightsWindowDays[] = [7, 30, 90];
const DAY_MS = 86_400_000;

brandInsightsRoutes.get("/insights", async (c) => {
  const raw = c.req.query("window");
  const days = (raw ? Number(raw) : 30) as BrandInsightsWindowDays;
  if (!VALID_WINDOWS.includes(days)) {
    return c.json({ error: "window must be 7, 30 or 90", code: "validation" }, 422);
  }
  const ws = c.var.brand.workspaceId;
  const to = new Date().toISOString();
  const priorFromIso = new Date(Date.parse(to) - 2 * days * DAY_MS).toISOString();
  const svc = serviceClient();

  const subs = await svc
    .from("mission_submissions")
    .select("creator_id, status, points_awarded, quality_rating, created_at, submitted_at, reviewed_at")
    .eq("workspace_id", ws)
    .or(`created_at.gte.${priorFromIso},submitted_at.gte.${priorFromIso},reviewed_at.gte.${priorFromIso}`);
  if (subs.error) return c.json({ error: subs.error.message, code: "db_error" }, 500);

  const earn = await svc
    .from("earnings_transactions")
    .select("amount, created_at")
    .eq("workspace_id", ws)
    .eq("type", "earn")
    .gte("created_at", priorFromIso);
  if (earn.error) return c.json({ error: earn.error.message, code: "db_error" }, 500);

  const missions = await svc.from("missions").select("status, quota, filled").eq("workspace_id", ws);
  if (missions.error) return c.json({ error: missions.error.message, code: "db_error" }, 500);

  const creators = await svc.from("creators").select("id, display_name").eq("workspace_id", ws);
  if (creators.error) return c.json({ error: creators.error.message, code: "db_error" }, 500);

  const insights = shapeBrandInsights({
    to,
    days,
    submissions: subs.data ?? [],
    earnings: earn.data ?? [],
    missions: missions.data ?? [],
    creators: creators.data ?? [],
  });
  return c.json({ insights });
});
```

- [ ] **Step 2: Mount it in `server/routes/brand.ts`**

Add the import right after `import { brandBudgetRoutes } from "./brandBudget.js";`:

```ts
import { brandInsightsRoutes } from "./brandInsights.js";
```

Add the mount immediately after the existing `guarded.route("/", brandBudgetRoutes);` line (and before the final `brandRoutes.route("/", guarded);`):

```ts
guarded.route("/", brandInsightsRoutes);
```

- [ ] **Step 3: Create `server/test/brandInsights.test.ts`** with EXACTLY this content:

```ts
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
```

- [ ] **Step 4: Register the suite in `package.json`**

In the `"test:integration"` script, append ` server/test/brandInsights.test.ts` to the end of the space-separated file list (after `server/test/brandBudget.test.ts`). Change nothing else.

- [ ] **Step 5: Gates**

Run: `npm run type-check && npm run lint && npm run build`
Expected: all pass (build runs the ESM-extension guard; the new route's imports carry `.js`). The integration suite SKIPS locally — that's expected.

- [ ] **Step 6: Commit**

```bash
git add server/routes/brandInsights.ts server/routes/brand.ts server/test/brandInsights.test.ts package.json
git commit -m "feat(brand): GET /brand/insights route + isolation integration test"
```

---

## Task 3: Client lib — key, types, fetcher

**Files:**
- Modify: `src/lib/brand.ts`

- [ ] **Step 1: Add an `insights` key to `brandKeys`**

In the `brandKeys` object in `src/lib/brand.ts` (which already has `budget`), add after the `budget` line:

```ts
  insights: (window: number) => ["brand-insights", window] as const,
```

- [ ] **Step 2: Append the types + fetcher at the bottom of `src/lib/brand.ts`**

```ts
// --- Slice 4: insights (read-only) -----------------------------------------------------------
export type BrandMetric = { value: number; prev: number; deltaPct: number | null };
export type BrandTopCreator = { creatorId: string; name: string; approved: number; avgQuality: number };
export type BrandInsights = {
  window: { days: 7 | 30 | 90; from: string; to: string };
  kpis: {
    liveMissions: BrandMetric;
    missionFillRate: BrandMetric;
    submissionsReceived: BrandMetric;
    approvalRate: BrandMetric;
    completions: BrandMetric;
    cashPaid: BrandMetric;
    costPerDeliverable: BrandMetric;
    pointsDistributed: BrandMetric;
  };
  topCreators: BrandTopCreator[];
  trend: Array<{ bucket: string; joined: number; submitted: number; approved: number }>;
};
export const fetchBrandInsights = (window: number) =>
  brandFetch<{ insights: BrandInsights }>(`/insights?window=${window}`);
```

- [ ] **Step 3: Gates**

Run: `npm run type-check && npm run lint`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/brand.ts
git commit -m "feat(brand): client insights key, types, fetcher"
```

---

## Task 4: i18n keys (en + zh)

**Files:**
- Modify: `src/lib/i18n.dict.ts`

- [ ] **Step 1: Add the English keys** in the `en` block, immediately after the line `"app.brand.budget.ledgerEmpty": "No budget activity yet.",` (the last Slice-3 brand-budget key). Insert EXACTLY:

```ts
    "app.brand.navInsights": "Insights",
    "app.brand.insights.heading": "Insights",
    "app.brand.insights.groupPerformance": "Performance",
    "app.brand.insights.groupSpend": "Spend",
    "app.brand.insights.liveMissions": "Live missions",
    "app.brand.insights.fillRate": "Fill rate",
    "app.brand.insights.submissions": "Submissions",
    "app.brand.insights.approvalRate": "Approval rate",
    "app.brand.insights.completions": "Completions",
    "app.brand.insights.cashPaid": "Cash paid",
    "app.brand.insights.costPerDeliverable": "Cost / deliverable",
    "app.brand.insights.pointsDistributed": "Points distributed",
    "app.brand.insights.topCreators": "Top creators",
    "app.brand.insights.topCreatorsEmpty": "No approved creators in this window yet.",
    "app.brand.insights.trendTitle": "Activity",
    "app.brand.insights.window7": "7d",
    "app.brand.insights.window30": "30d",
    "app.brand.insights.window90": "90d",
    "app.brand.insights.loadError": "Couldn't load insights. Try again.",
```

- [ ] **Step 2: Add the Traditional Chinese keys** in the `zh` block, immediately after the zh line `"app.brand.budget.ledgerEmpty": "暫無預算紀錄。",`. Insert EXACTLY:

```ts
    "app.brand.navInsights": "分析",
    "app.brand.insights.heading": "分析",
    "app.brand.insights.groupPerformance": "成效",
    "app.brand.insights.groupSpend": "支出",
    "app.brand.insights.liveMissions": "進行中任務",
    "app.brand.insights.fillRate": "填充率",
    "app.brand.insights.submissions": "提交數",
    "app.brand.insights.approvalRate": "批核率",
    "app.brand.insights.completions": "完成數",
    "app.brand.insights.cashPaid": "已付現金",
    "app.brand.insights.costPerDeliverable": "每件成本",
    "app.brand.insights.pointsDistributed": "已派積分",
    "app.brand.insights.topCreators": "頂尖創作者",
    "app.brand.insights.topCreatorsEmpty": "此區間暫無獲批創作者。",
    "app.brand.insights.trendTitle": "活動趨勢",
    "app.brand.insights.window7": "7日",
    "app.brand.insights.window30": "30日",
    "app.brand.insights.window90": "90日",
    "app.brand.insights.loadError": "無法載入分析，請重試。",
```

- [ ] **Step 3: Verify parity**

Run: `npm run type-check && npm run test -- src/lib/i18n`
Expected: type-check passes; the i18n parity test passes (19 keys added to each block).

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n.dict.ts
git commit -m "i18n(brand): insights keys (en + zh)"
```

---

## Task 5: Insights page + nav item

**Files:**
- Create: `src/routes/brand.insights.tsx`
- Modify: `src/components/brand/BrandNav.tsx`

- [ ] **Step 1: Create `src/routes/brand.insights.tsx`** with EXACTLY this content:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useBrandAuth } from "@/components/brand/BrandAuthContext";
import { BrandAuthError, brandKeys, fetchBrandInsights, type BrandInsights, type BrandMetric } from "@/lib/brand";
import { TrendChart } from "@/components/admin/TrendChart";

export const Route = createFileRoute("/brand/insights")({ component: BrandInsightsPage });

type Win = 7 | 30 | 90;
const fmtNum = (n: number) => n.toLocaleString();
const fmtPct = (n: number) => `${n}%`;
const fmtCash = (n: number) => `HK$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function DeltaBadge({ metric }: { metric: BrandMetric }) {
  if (metric.deltaPct === null) return null;
  const up = metric.deltaPct > 0;
  const flat = metric.deltaPct === 0;
  const cls = flat ? "metric-badge" : up ? "metric-badge metric-up" : "metric-badge metric-down";
  return <span className={cls}>{`${up ? "+" : ""}${metric.deltaPct}%`}</span>;
}

function KpiCard({ label, metric, format }: { label: string; metric: BrandMetric; format: (n: number) => string }) {
  return (
    <div className="pastel-card p-5">
      <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-soft-ink)]">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold">{format(metric.value)}</p>
      <div className="mt-2">
        <DeltaBadge metric={metric} />
      </div>
    </div>
  );
}

function WindowSelector({ value, onChange }: { value: Win; onChange: (w: Win) => void }) {
  const { t } = useI18n();
  const opts: Array<{ w: Win; label: string }> = [
    { w: 7, label: t("app.brand.insights.window7") },
    { w: 30, label: t("app.brand.insights.window30") },
    { w: 90, label: t("app.brand.insights.window90") },
  ];
  return (
    <div className="flex gap-2">
      {opts.map((o) => (
        <button
          key={o.w}
          type="button"
          onClick={() => onChange(o.w)}
          aria-pressed={value === o.w}
          className={value === o.w ? "filter-pill filter-pill-active" : "filter-pill"}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function TopCreators({ rows }: { rows: BrandInsights["topCreators"] }) {
  const { t } = useI18n();
  return (
    <div className="pastel-card p-5">
      <h2 className="font-heading text-base font-bold">{t("app.brand.insights.topCreators")}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--color-soft-ink)]">{t("app.brand.insights.topCreatorsEmpty")}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.creatorId} className="flex items-center justify-between gap-2 text-sm">
              <span className="font-semibold">{r.name}</span>
              <span className="font-mono text-xs text-[var(--color-soft-ink)]">
                {r.approved} · {r.avgQuality}★
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BrandInsightsPage() {
  const { t } = useI18n();
  const { reportAuthError } = useBrandAuth();
  const [win, setWin] = useState<Win>(30);
  const q = useQuery({ queryKey: brandKeys.insights(win), queryFn: () => fetchBrandInsights(win), retry: false });
  useEffect(() => {
    if (q.error instanceof BrandAuthError) reportAuthError(q.error);
  }, [q.error, reportAuthError]);

  const data = q.data?.insights;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold">{t("app.brand.insights.heading")}</h1>
        <WindowSelector value={win} onChange={setWin} />
      </div>

      {!data ? (
        q.isError && !(q.error instanceof BrandAuthError) ? (
          <p className="text-sm text-[var(--color-soft-ink)]">{t("app.brand.insights.loadError")}</p>
        ) : (
          <p className="text-sm">載入中…</p>
        )
      ) : (
        <>
          <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-soft-ink)]">
            {t("app.brand.insights.groupPerformance")}
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <KpiCard label={t("app.brand.insights.liveMissions")} metric={data.kpis.liveMissions} format={fmtNum} />
            <KpiCard label={t("app.brand.insights.fillRate")} metric={data.kpis.missionFillRate} format={fmtPct} />
            <KpiCard label={t("app.brand.insights.submissions")} metric={data.kpis.submissionsReceived} format={fmtNum} />
            <KpiCard label={t("app.brand.insights.approvalRate")} metric={data.kpis.approvalRate} format={fmtPct} />
            <KpiCard label={t("app.brand.insights.completions")} metric={data.kpis.completions} format={fmtNum} />
          </div>

          <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-soft-ink)]">
            {t("app.brand.insights.groupSpend")}
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <KpiCard label={t("app.brand.insights.cashPaid")} metric={data.kpis.cashPaid} format={fmtCash} />
            <KpiCard label={t("app.brand.insights.costPerDeliverable")} metric={data.kpis.costPerDeliverable} format={fmtCash} />
            <KpiCard label={t("app.brand.insights.pointsDistributed")} metric={data.kpis.pointsDistributed} format={fmtNum} />
          </div>

          <div className="pastel-card p-5">
            <h2 className="mb-2 font-heading text-base font-bold">{t("app.brand.insights.trendTitle")}</h2>
            <TrendChart data={data.trend} />
          </div>

          <TopCreators rows={data.topCreators} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the Insights nav item to `src/components/brand/BrandNav.tsx`**

Change the lucide import to add `BarChart3` (the file currently imports `LayoutDashboard, Target, ClipboardCheck, Wallet`):

```ts
import { LayoutDashboard, Target, ClipboardCheck, Wallet, BarChart3 } from "lucide-react";
```

Add a 5th `ITEMS` entry (after the `/brand/budget` entry, before the closing `] as const;`):

```ts
  { to: "/brand/insights", exact: false, icon: BarChart3, labelKey: "app.brand.navInsights" },
```

- [ ] **Step 3: Gates** (UI lands together so `tsr generate` registers `/brand/insights`)

Run: `npm run type-check && npm run lint && npm run build`
Expected: all pass; `<Link to="/brand/insights">` resolves after codegen. Do NOT commit `src/routeTree.gen.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/routes/brand.insights.tsx src/components/brand/BrandNav.tsx
git commit -m "feat(brand): insights page (KPIs, trend, top creators) + nav item"
```

---

## Task 6: Route-stub test for `/brand/insights`

**Files:**
- Create: `src/routes/-brand.insights.test.tsx`

- [ ] **Step 1: Create `src/routes/-brand.insights.test.tsx`** with EXACTLY this content:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ fetchBrandInsights: vi.fn(), reportAuthError: vi.fn() }));

vi.mock("@/lib/brand", () => ({
  fetchBrandInsights: h.fetchBrandInsights,
  brandKeys: { insights: (w: number) => ["brand-insights", w] },
  BrandAuthError: class extends Error {},
}));
vi.mock("@/components/brand/BrandAuthContext", () => ({
  useBrandAuth: () => ({ brand: { workspaceId: "w1" }, reportAuthError: h.reportAuthError }),
}));
vi.mock("@/components/admin/TrendChart", () => ({ TrendChart: () => <div data-testid="trend" /> }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { signOut: vi.fn() } } }));

import { Route } from "./brand.insights";

const M = (value: number) => ({ value, prev: 0, deltaPct: null });
function r() {
  const C = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <C />
    </QueryClientProvider>,
  );
}

describe("brand insights page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("lang", "zh");
  });

  it("renders a KPI value and a top-creator row", async () => {
    h.fetchBrandInsights.mockResolvedValue({
      insights: {
        window: { days: 30, from: "", to: "" },
        kpis: {
          liveMissions: M(3),
          missionFillRate: M(50),
          submissionsReceived: M(8),
          approvalRate: M(75),
          completions: M(6),
          cashPaid: M(120),
          costPerDeliverable: M(20),
          pointsDistributed: M(600),
        },
        topCreators: [{ creatorId: "a", name: "Alice", approved: 4, avgQuality: 4.5 }],
        trend: [],
      },
    });
    r();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    expect(screen.getByText("HK$120.00")).toBeInTheDocument();
  });

  it("shows the empty top-creators copy when there are none", async () => {
    h.fetchBrandInsights.mockResolvedValue({
      insights: {
        window: { days: 30, from: "", to: "" },
        kpis: {
          liveMissions: M(0),
          missionFillRate: M(0),
          submissionsReceived: M(0),
          approvalRate: M(0),
          completions: M(0),
          cashPaid: M(0),
          costPerDeliverable: M(0),
          pointsDistributed: M(0),
        },
        topCreators: [],
        trend: [],
      },
    });
    r();
    await waitFor(() => expect(screen.getByText("此區間暫無獲批創作者。")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the targeted test**

Run: `npm run test -- src/routes/-brand.insights.test.tsx`
Expected: 2 passing.

- [ ] **Step 3: Full gate (last implementation task)**

Run: `npm run type-check && npm run lint && npm run test && npm run build`
Expected: all green (full unit suite + type-check + lint + build). In particular, confirm NO existing brand route-stub test broke (this slice's new `@/lib/brand` exports are consumed only by the new page, so none should — but verify).

- [ ] **Step 4: Commit**

```bash
git add src/routes/-brand.insights.test.tsx
git commit -m "test(brand): route-stub test for /brand/insights"
```

---

## Final: holistic review + finish branch

- [ ] Dispatch a final reviewer over the whole branch diff (`git diff feat/brand-portal-slice3...HEAD`), focused on: the brand reads are `serviceClient` hard-filtered to `c.var.brand.workspaceId` (workspace from the verified identity, never a param) and the endpoint is read-only (no writes); `shapeBrandInsights` math matches the spec (snapshot vs compared KPIs, divide-by-zero → 0, `deltaPct` prior=0 → null, top-creators ranking/avg/cap-5, cash excludes points); ESM `.js` extensions on server imports; i18n en/zh parity; the `BrandInsights` client type matches the server JSON shape.
- [ ] Use superpowers:finishing-a-development-branch to open a PR (base `feat/brand-portal-slice3`, stacked; auto-retargets to main as the stack merges).

**PR deploy checklist:**
- **No migration, no env, no flag-day** — purely additive read endpoint + page.
- Merge order: this stack is #46 → #47 → #48 → this PR. Merge the lower slices first.
- Post-deploy smoke: as a brand, open `/brand/insights`, switch 7/30/90, confirm KPIs render and the numbers match that workspace's missions/payouts; confirm another brand sees only its own numbers.

## Self-review (done by plan author)

- **Spec coverage:** Section 1 (data sources + trust boundary) → Tasks 2 (route fetch). Section 2 (shaping fn + KPIs + topCreators + trend) → Task 1. Section 3 (route, 422, mount, read-only) → Task 2. Section 4 (client lib, page, nav, i18n) → Tasks 3+4+5. Section 5 (unit + integration + route-stub tests + rollout) → Tasks 1+2+6 + Final. All covered.
- **Type consistency:** `BrandInsights`/`BrandMetric`/`BrandTopCreator` server types (Task 1) are mirrored in the client `src/lib/brand.ts` (Task 3) with identical field names (`liveMissions`/`missionFillRate`/`submissionsReceived`/`approvalRate`/`completions`/`cashPaid`/`costPerDeliverable`/`pointsDistributed`, `topCreators: {creatorId,name,approved,avgQuality}`, `trend: {bucket,joined,submitted,approved}`). `brandKeys.insights(window)` / `fetchBrandInsights(window)` used consistently across lib, page, and stub. The route returns `{ insights }`; the fetcher/page read `.insights`. `window` query param validated against `[7,30,90]`.
- **No placeholders:** every code step shows complete code; every test shows real assertions.
- **Reuse note:** `TrendChart` is imported from `@/components/admin/TrendChart` (existing) and takes `{ data: {bucket,joined,submitted,approved}[] }` — matches `BrandInsights.trend`. The KPI-card / window-selector styling is re-implemented locally in the brand page (small, brand-scoped) rather than imported from the operator route file (which isn't a shared component).
