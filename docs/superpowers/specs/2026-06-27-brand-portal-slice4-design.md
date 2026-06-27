# Brand Portal Slice 4 — Brand Analytics / Insights (design)

**Date:** 2026-06-27
**Branch:** `feat/brand-portal-slice4` (stacked on `feat/brand-portal-slice3` → `slice2` → `slice1`)
**Status:** approved design, ready for implementation plan

## Context & goal

After Slices 1–3 a brand can author missions, review/approve/pay creators, and fund a
HK$ wallet — but it has **no view of what that spend buys**. This slice adds a read-only,
brand-facing **analytics dashboard** at `/brand/insights`, scoped to the brand's own
workspace, covering four things the brand asked for: **mission performance**, **HK$ spend &
ROI**, **top creators**, and an **activity trend chart**.

It mirrors the proven operator insights pattern (`server/lib/insights.ts` +
`server/routes/adminInsights.ts` + `src/routes/admin.insights.tsx`) but with a **dedicated,
brand-tuned shaping function** — not the operator's function — because the audiences and KPI
sets differ. It is **read-only, one migration-free slice**: pure aggregation over existing rows.

## Locked decisions (from brainstorming)

1. **Slice** — Brand Analytics / Insights (chosen over notifications / team-mgmt / payments).
2. **Focus** — all four lenses: mission performance, spend & ROI, top creators, activity trend.
3. **Spend basis** — **HK$ cash only** (cash payouts = the brand's real money). Points are a
   platform-funded loyalty currency (Slice 3 decision); they are shown **separately** as
   "loyalty points distributed" (informational), never counted as cost. ROI =
   HK$ **cost-per-approved-deliverable**.
4. **Architecture — Approach A** — a new pure `shapeBrandInsights()` producing brand-right
   KPIs + top-creators + trend, reusing only the small shared primitives' style (`Metric`,
   `deltaPct`, `num`, `round*`, `inRange`) and the existing `TrendChart` component. The
   operator's `shapeInsights` is left untouched (no shared mega-function, no operator refactor).

## Section 1 — Scope, data sources & trust boundary

**No migration.** All reads via `serviceClient` **hard-filtered to `c.var.brand.workspaceId`**
— the Slice 2 brand-review trust-boundary pattern, used because `mission_submissions` has no
brand RLS policy. The workspace id always comes from the verified `requireBrand` identity,
**never** from a request param/body.

Row sources (all `.eq("workspace_id", ws)`):

| Source | Columns | Used for |
|---|---|---|
| `mission_submissions` | creator_id, mission_id, status, points_awarded, quality_rating, created_at, submitted_at, reviewed_at | performance, completions, approval rate, trend, top creators, points distributed |
| `earnings_transactions` | amount, created_at, type (`'earn'`) | **HK$ cash paid** (brand spend) |
| `missions` | status, quota, filled | live-mission count + fill rate |
| `creators` | id, display_name | name map for the top-creators leaderboard |

**Window:** reuse the operator **7 / 30 / 90-day** selector; each KPI compares the current
window against the immediately-prior equal-length window via the shared
`Metric { value, prev, deltaPct }` shape (`deltaPct` returns `null` when prior is 0 → renders "—").

## Section 2 — Pure shaping function `shapeBrandInsights`

New `server/lib/brandInsights.ts` — pure, no DB/async, fully unit-tested. Mirrors the style and
helpers of `insights.ts` (reuse `num()` for PostgREST string-numerics, `round1`/`round2`,
`deltaPct`, `inRange`).

```
shapeBrandInsights({ to, days, submissions, earnings, missions, creators }) → BrandInsights
```

**`BrandInsights`:**
- `window: { days, from, to }`
- `kpis` (each `Metric { value, prev, deltaPct }`). Two kinds:
  **with prior-window comparison** (real `prev` + `deltaPct`, like the operator KPIs) —
  `submissionsReceived`, `approvalRate`, `completions`, `cashPaid`, `pointsDistributed`;
  **current snapshot** (`prev = 0`, `deltaPct = null` → renders no badge) —
  `liveMissions`, `missionFillRate`, `costPerDeliverable`.
  - `liveMissions` — count of `status='active'` missions *(snapshot)*
  - `missionFillRate` — Σfilled / Σquota over active missions, % *(snapshot)*
  - `submissionsReceived` — rows with `submitted_at` in window *(compared)*
  - `approvalRate` — approved ÷ submitted in window, % *(compared: cur vs prior ratio, like operator `submitToApprove`)*
  - `completions` — approved (`reviewed_at` in window) *(compared)*
  - `cashPaid` — Σ `earnings_transactions.amount` in window (HK$) *(compared)*
  - `costPerDeliverable` — `cashPaid ÷ completions` (HK$; 0 when completions=0) *(snapshot)*
  - `pointsDistributed` — Σ `points_awarded` on approved-in-window *(informational; compared)*
- `topCreators`: top 5 by approved-submission count in window —
  `{ creatorId: string; name: string; approved: number; avgQuality: number }`
  (`avgQuality` = mean of non-null `quality_rating`, rounded to 1 dp, 0 if none; `name` from the
  creators map, fallback `"—"`; ties broken by higher `avgQuality` then `creatorId`).
- `trend`: `Array<{ bucket, joined, submitted, approved }>` — the **existing `TrendChart`
  shape** (daily buckets; weekly for the 90-day window), so no new chart component. Cash stays a
  KPI, not a trend series (YAGNI — one proven chart).

Precision/empties handled exactly like `insights.ts`: divide-by-zero ratios → 0; empty input →
all-zero KPIs + empty `topCreators` + zeroed trend buckets.

## Section 3 — Server API

New `server/routes/brandInsights.ts`, mounted under the brand gate, like `brandBudget.ts`:

```
GET /brand/insights?window=<7|30|90>   (default 30)
```

- `window ∉ {7,30,90}` → **422** `{ code: "validation" }`.
- `const ws = c.var.brand.workspaceId;` (verified identity; never a param).
- Fetch the four row-sets via `serviceClient`, each `.eq("workspace_id", ws)`, spanning the
  current + prior window (submissions: `created_at/submitted_at/reviewed_at ≥ priorFrom`;
  earnings: `type='earn'` AND `created_at ≥ priorFrom`; missions: active snapshot; creators:
  name map). Mirrors `adminInsights.ts` fetch logic, minus the operator's optional-workspace branch.
- Call `shapeBrandInsights(...)`; return `{ insights }`. Any DB error → **500** `db_error`.
- Mounted in `server/routes/brand.ts` as `guarded.route("/", brandInsightsRoutes)` →
  `/api/brand/insights`. **Read-only.** ESM `.js` extensions on all relative imports.

Trust boundary identical to Slices 2/3.

## Section 4 — UI & client

- **Client lib** (`src/lib/brand.ts`): `brandKeys.insights(window)`, `fetchBrandInsights(window)`,
  and types `BrandInsights` / `BrandTopCreator` (mirroring the Slice-3 budget additions; reuse a
  local `Metric` type matching the server shape).
- **Route page** `src/routes/brand.insights.tsx` — brand adaptation of `admin.insights.tsx`:
  - 7/30/90 **window selector** (same control).
  - **KPI cards** with the existing delta-badge treatment, grouped *Performance* (live missions,
    fill rate, submissions received, approval rate, completions) and *Spend* (cash paid HK$,
    cost/deliverable HK$, points distributed).
  - **`<TrendChart data={insights.trend} />`** reused as-is.
  - **Top creators** list (name · approved count · avg ★), empty-state copy when none.
  - Auth-error wiring via `useBrandAuth().reportAuthError` on `BrandAuthError` (same `useEffect`
    pattern as the budget page).
- **Nav** (`src/components/brand/BrandNav.tsx`): a 5th `ITEMS` entry
  `{ to: "/brand/insights", exact: false, icon: BarChart3, labelKey: "app.brand.navInsights" }`
  (lucide `BarChart3`, matching the operator Insights icon).
- **i18n** (`src/lib/i18n.dict.ts`): `app.brand.navInsights` + `app.brand.insights.*` (KPI labels,
  group headers, "top creators", empty states) in **both en + zh** (parity-tested).

Acid-Y2K tokens throughout, consistent with the budget UI.

## Section 5 — Testing & rollout

- **Unit** `server/lib/brandInsights.test.ts` (load-bearing; runs everywhere): current vs prior
  window math; `approvalRate` / `costPerDeliverable` / `missionFillRate` incl. divide-by-zero → 0
  and `deltaPct` prior=0 → `null`; `topCreators` ranking + avg-quality with null ratings + tie-break;
  `cashPaid` from string-numeric `amount`; `pointsDistributed` excluded from cash; empty input →
  all zeros; trend bucket counts (daily vs weekly@90).
- **Integration** `server/test/brandInsights.test.ts` (CI): brand A sees only its own workspace's
  numbers (brand B's missions/payouts don't leak); bad `window` → 422; KPIs reflect a seeded
  approve. Registered in `package.json` `test:integration`.
- **Route-stub** `src/routes/-brand.insights.test.tsx`: mock `fetchBrandInsights`, assert a KPI value
  + a top-creator row render. **Also update any shared brand stub mocks** if a new `@/lib/brand`
  export is consumed by a shared component (the Slice-3 banner-regression lesson).
- **i18n parity** covered by the existing test.
- **Rollout:** **no migration, no env, no flag-day** — purely additive read endpoint + page.
  Ships with the normal deploy; stacks `#46 → #47 → #48 → this`.

## Out of scope (future)

- Per-mission deep-dive analytics pages / drill-down from a KPI.
- CSV/PDF export of insights.
- Cash-spend as its own trend series (a second chart) — kept as a KPI for now.
- Brand notifications / low-balance alerts (a separate slice).
- Date-range custom picker beyond the 7/30/90 presets.
