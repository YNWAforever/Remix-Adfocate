# Admin SaaS Shell + Insights Dashboard — Design

**Date:** 2026-06-24
**Initiative:** SaaS-style operator console (left sidebar + insights to drive creator engagement & personalisation)
**Branch:** `feat/admin-saas-insights` (off `main` @ `990e3c1`)
**Migration:** none (Slice 0 + Slice 1 are read-only / frontend; writes arrive in later slices)
**Primary user:** internal Fimmick operators, cross-workspace

## 1. Summary

Evolve the existing `/admin` operator console from a flat top-tab layout into a
**SaaS-style shell** — a persistent grouped **left sidebar** + top bar — and add the first
**Insights** dashboard so operators can *measure* creator engagement before they act on it.

This is the first of a five-slice initiative ("measure → surface → segment → act"). Only
**Slice 0 (shell)** and **Slice 1 (Insights)** are specified here for implementation;
Slices 2–4 are captured as roadmap (§9) and will each get their own spec.

Both slices in this doc are **additive and low-risk**: no schema migration, no new external
dependency, no write paths. Slice 0 is pure frontend re-layout; Slice 1 adds one guarded,
read-only aggregation endpoint computed on-read from existing tables.

## 2. Scope (locked in brainstorming)

| Decision | Choice |
|---|---|
| Primary user | **Internal Fimmick operators**, cross-workspace (aggregate all by default) |
| Engagement capabilities (full initiative) | Engagement analytics · At-risk/opportunity radar · Creator segmentation · Personalised nudges |
| Nudge channel (Slice 4) | **In-app only**, reusing the N1 notifications system |
| Sequencing | **Approach A** — shell first, then measure → surface → segment → act |
| This spec covers | **Slice 0 (SaaS shell)** + **Slice 1 (Insights dashboard)** |
| Sidebar IA | Grouped: **Analytics** / **Review queue** / **Audience** / **Library** |
| Default landing | `/admin` → **`/admin/insights`** (was `/admin/applications`) |
| Roadmap items in nav | **Shown as locked placeholders** (e.g. "Segments — soon") |
| Slice 1 contents | 6 KPI cards + Δ · engagement funnel · level distribution · **time-series trend chart** · window selector (7/30/90d) |
| Cash | **Cash paid (HK$) is its own KPI** alongside Points issued |

**Explicitly deferred (out of scope here):** at-risk radar, segmentation, nudges (Slices
2–4); any write/mutation from the Insights page; CSV/export; per-operator dashboard
customisation; Supabase Realtime (polling/`staleTime` only).

## 3. Slice 0 — SaaS shell

### 3.1 What changes

The admin shell lives in `src/routes/admin.tsx` (the layout, not root). Today it renders
`StaffAuthGate → AdminAuthContext → AdminWorkspaceProvider → centered max-w-5xl div`
containing a header + `AdminTabs` (horizontal) + `<Outlet/>`.

**Target layout:**

```
┌──────────────────────────────────────────────────────────┐
│ AdminSideNav (fixed, w-60, border-r-2 ink)  │  Top bar    │  ← page title · WorkspaceSwitcher · staff identity · sign-out
│  Adfocate OPS                               │─────────────│
│  ANALYTICS                                  │             │
│   • Insights            (active = acid bg)  │  <Outlet/>  │
│  REVIEW QUEUE                               │  (lg:pl-60) │
│   • Applications  [7]                        │             │
│   • Submissions   [12]                       │             │
│   • Engaged                                  │             │
│  AUDIENCE                                    │             │
│   • Creators                                 │             │
│   • Segments      soon  (locked)             │             │
│  LIBRARY                                     │             │
│   • Missions                                 │             │
│   • Content                                  │             │
│  ── staff avatar · name ──                   │             │
└──────────────────────────────────────────────────────────┘
```

### 3.2 Components & files

- **`src/components/admin/AdminSideNav.tsx`** (new) — cloned from the proven
  `src/components/SideNav.tsx` pattern (`hidden lg:flex fixed inset-y-0 left-0 z-40 w-60
  flex-col border-r-2 border-[var(--color-ink)] bg-[var(--color-paper)] p-4`). Renders
  grouped nav from a new `ADMIN_NAV_GROUPS` config; reuses the `ITEM`/`ITEM_ACTIVE` class
  idiom (active = `border-ink bg-[var(--color-acid)]` bold) and `Link.activeOptions={{
  exact }}` + `activeProps`.
- **`src/components/admin/adminNavItems.ts`** (new) — typed config:
  ```ts
  type AdminNavItem = { to: string; labelKey: string; icon: LucideIcon; exact: boolean; locked?: boolean; countKey?: "applications" | "submissions" };
  type AdminNavGroup = { labelKey: string; items: AdminNavItem[] };
  ```
  Groups: Analytics(Insights) · Review queue(Applications, Submissions, Engaged) ·
  Audience(Creators, Segments[locked]) · Library(Missions, Content).
- **Count badges** — Applications & Submissions show live counts. Extract the existing
  React-Query count logic from `AdminTabs.tsx` (it already queries `adminKeys.applications`
  and `adminKeys.submissions("submitted")`) into a small `useAdminQueueCounts()` hook so
  both the old tabs (during transition) and the new sidebar share one cache — **no extra
  fetch**.
- **`src/routes/admin.tsx`** (edit) — container changes from `mx-auto max-w-5xl p-4` to a
  sidebar layout: render `<AdminSideNav/>` + a `<main className="lg:pl-60">` wrapping a
  **sticky top bar** + `<Outlet/>`. The top bar holds the page title, the existing
  `WorkspaceSwitcher` (moved out of the old header), and staff identity + sign-out.
  Providers (`AdminAuthContext`, `AdminWorkspaceProvider`) and `StaffAuthGate` stay exactly
  where they are.
- **`src/components/admin/AdminTabs.tsx`** — **removed** once the sidebar lands (its count
  logic migrates to `useAdminQueueCounts()`). Remove its render from `admin.tsx`.
- **`src/routes/admin.index.tsx`** (edit) — redirect target `/admin/applications` →
  `/admin/insights`.

### 3.3 Locked placeholder behaviour

A `locked: true` nav item renders greyed (`opacity-60`, muted `#E4E4E4` bg, soft-ink text)
with a dashed "soon" pill and is **non-navigating** (a `<span>`/`<div>`, not a `<Link>`) —
matching the Academy locked-track idiom. No route file is created for it.

### 3.4 Mobile

No admin mobile-nav precedent exists today (`SideNav` is `hidden lg:flex`; `BottomNav` is
creator-side only). Operators are desktop-primary, so define a minimal pattern: a hamburger
button in the top bar (shown `< lg`) toggles the sidebar as an in-flow slide-in drawer
(state held locally in `admin.tsx`; overlay uses normal-flow layout, **never**
`position: fixed`). No bottom nav.

### 3.5 i18n

Add nav-group + item keys under `app.admin.*` to **both** `en` and `zh` in
`src/lib/i18n.dict.ts` simultaneously (parity test `i18n.test.tsx` fails the build
otherwise). Reuse existing `tabMissions`/`tabApplications`/`tabEngaged`/`tabSubmissions`/
`tabCreators`/`tabContent`; add `navGroupAnalytics`, `navGroupReview`, `navGroupAudience`,
`navGroupLibrary`, `tabInsights`, `tabSegments`, `segmentsSoon`, plus top-bar
`signOut`/identity strings. Never inline `lang === 'en' ? …`.

## 4. Slice 1 — Insights dashboard

### 4.1 Route & data flow

```
/admin/insights (admin.insights.tsx)
  └─ useQuery(adminKeys.insights(workspace, window)) → fetchInsights(workspace, window)
       └─ GET /api/admin/insights?workspace=<slug?>&window=<7|30|90>
            └─ adminRoutes.route("/insights", adminInsightsRoutes)   [inherits staff auth]
                 └─ serviceClient() reads → shapeInsights(rows, window) → { insights }
```

- New route file **`src/routes/admin.insights.tsx`** (dot-notation; requires `tsr generate`
  via `npm run type-check` — bare `tsc` will not regenerate `routeTree.gen.ts`).
- New Hono sub-route **`server/routes/adminInsights.ts`**, registered in
  `server/routes/admin.ts` via `adminRoutes.route("/insights", adminInsightsRoutes)`. The
  existing staff-auth middleware on `adminRoutes` covers it — **add no second guard**.
- All aggregation in a **pure `shapeInsights()` in `server/lib/insights.ts`** (no DB/async
  inside — takes already-fetched rows), mirroring `engagedRoster.ts` / `missionActivity.ts`.
- DB reads use `serviceClient()` (RLS-bypassing; never leaked to user code).
- **Workspace scope:** `?workspace` optional. Omitted ⇒ aggregate **all** workspaces (the
  "All workspaces" default in the switcher). Present ⇒ filter on `missions.workspace_id`.
- **`.js` import extension is mandatory** on every relative import in `server/routes/*` and
  `server/lib/*` (`from "../lib/supabase.js"`). `npm run check:esm` guards it; omitting it
  caused a prior ~1-day prod outage.

### 4.2 Response shape

```ts
type Insights = {
  window: { days: 7 | 30 | 90; from: string; to: string };   // ISO; prior window = same length immediately before `from`
  kpis: {
    activeCreators:   Metric;   // distinct creator_id w/ status ∈ joined|submitted|under_review
    submitToApprove:  Metric;   // % of submitted that reached approved in window (0..100)
    pointsIssued:     Metric;   // Σ points_awarded in window
    cashPaid:         Metric;   // Σ earnings_transactions credits in window (HK$, 2dp)
    missionFillRate:  Metric;   // Σ filled / Σ quota across active missions (0..100)
    completions:      Metric;   // count status→approved in window
  };
  funnel: { joined: number; submitted: number; approved: number;
            joinToSubmit: number; submitToApprove: number };  // conversion % derived
  levels: Array<{ level: string; count: number }>;            // L0..L6 histogram
  trend:  Array<{ bucket: string; joined: number; submitted: number; approved: number }>; // time-bucketed
};
type Metric = { value: number; prev: number; deltaPct: number | null };  // deltaPct null when prev = 0
```

Error shape follows house convention: `{ error: string, code: string }` with
`bad_token`/`no_admin` (401), `not_staff` (403), `validation` (422), `db_error` (500).

### 4.3 Metrics — sources (all on-read, no migration)

| Metric | Source table / columns | Notes |
|---|---|---|
| Active creators | `mission_submissions` distinct `creator_id`, status ∈ joined/submitted/under_review | Compute directly — do **not** reuse `shapeEngagedRoster` (it drops 0-active creators) |
| Submit→approve % | `mission_submissions` status + `submitted_at`/`reviewed_at` in window | New conversion shaper (none exists yet) |
| Points issued | `mission_submissions.points_awarded` summed in window | Points only; cash is separate |
| Cash paid (HK$) | `earnings_transactions` credits in window, `numeric(10,2)` | Separate ledger from points |
| Mission fill rate | `missions` filled vs quota (reuse `shapeMissionActivity` fill logic) | **Confirm the `missions` quota column name at build time** (research left it unnamed) |
| Completions | `mission_submissions` count → approved in window | |
| Engagement funnel | `mission_submissions` timestamps `created_at → submitted_at → reviewed_at` | joined→submitted→approved + conversion % |
| Level distribution | `creators.level` (L0–L6 via `level_for_xp()` trigger) | Histogram |
| Trend (time-series) | `created_at`/`submitted_at`/`reviewed_at` bucketed by day (7/30d) or week (90d) | |
| Deltas (Δ) | current window vs **prior equal-length** window | `deltaPct = null` when prior = 0 (render "—", not ∞) |

### 4.4 Frontend (Acid Y2K, no new chart dependency)

- **KPI cards** — 6 cards in a responsive grid (`grid-cols-2 lg:grid-cols-3`). Primary card
  (Active creators) uses the `.wallet-card` treatment (ink bg, acid number, `6px 6px`
  accent shadow); the rest use `.pastel-card`. Big numbers in `font-display`. Δ rendered
  with `.metric-badge` (`.metric-up` cyan / `.metric-down` magenta); `null` delta → muted "—".
- **Engagement funnel** — reuse `.segmented-bar` (flex `gap-3`, rounded spans) with stage
  labels + counts + conversion %. Colours from `.level-pill` family (acid → cyan → violet).
- **Level distribution** — horizontal bars (reuse `.xp-bar`/segmented styling) or the
  existing level-pill colours per level.
- **Trend chart** — new **`src/components/admin/TrendChart.tsx`**: a small bespoke **SVG**
  area/line chart (≈ the `ScoreRing` approach — hand-built SVG, `stroke`/`fill` from theme
  tokens, ink axis, acid/cyan series), parameterised by series. **No charting library** is
  added (codebase has none; SVG is the established primitive). Includes an empty state.
- **Window selector** — `.filter-pill` segmented control (7d / 30d / 90d) driving the query
  key; default 30d.
- **Loading** — `.skeleton-acid` card/pill/text variants (never ad-hoc shimmer).
- **Locked tile** — a greyed "At-risk radar — coming soon" card telegraphing Slice 2
  (`opacity-60`, muted bg, soft-ink), matching the locked nav idiom.
- **Client wiring** — extend `src/lib/admin.ts`: `adminKeys.insights(workspace, window)` +
  `fetchInsights(workspace, window)` using the existing `adminFetch()` (injects
  `Authorization: Bearer`, throws `AdminAuthError` on 401). On `AdminAuthError`, call
  `reportAuthError` exactly as the other admin tabs do (via `useEffect`).
- **i18n** — new `app.insights.*` namespace (heading, each KPI label, funnel stage labels,
  level labels, window options, empty/locked copy), added to en + zh together.

### 4.5 Cross-workspace correctness

`mission_submissions` is workspace-scoped only via `missions.workspace_id`; ensure the
service-role query joins/filters on that (not a non-existent `mission_submissions.workspace_id`
assumption — verify column at build). `earnings_transactions` is keyed
`(creator_id, workspace_id)` directly. When `?workspace` is omitted, sum across all.

## 5. Testing

- **Unit — `server/lib/insights.test.ts`** (model on `engagedRoster.test.ts`): factory
  helpers with overrides; assert funnel counts + conversion math, KPI sums, delta-vs-prior
  math (incl. `prev = 0 → null`), window bucketing, exclusion rules, and **empty-input**
  (all zeros, no throw).
- **Component — `src/components/admin/TrendChart.test.tsx`** + KPI card tests (model on
  `ScoreRing.test.tsx`): render with data, with zeros, with `null` deltas; assert aria and
  empty state.
- **Route stub — `src/routes/-admin.insights.test.tsx`** (leading-dash test-only
  convention): `vi.hoisted` mocks before imports; `vi.mock` `@/lib/admin`, `@/lib/supabase`,
  the admin contexts; extract `Route.options.component`; wrap in `QueryClientProvider`.
  Cover loading skeleton, populated, and auth-error → `reportAuthError`.
- **Sidebar component — `src/components/admin/AdminSideNav.test.tsx`**: groups render,
  active item styling, locked item is non-navigating, count badges show.
- **Integration — `server/test/insights.test.ts`** (model on `match.test.ts`):
  `const suite = hasSupabaseEnv ? describe : describe.skip`; seed submissions/missions via
  `server/test/helpers.ts`; `app.request('/admin/insights?...')` with staff `Authorization`;
  assert status + `{ insights }` shape + a couple of computed values. **Append the filename
  to the explicit list in `package.json` `test:integration`.**

**Gates (all must pass):** `npm run type-check` (runs `tsr generate` — required after adding
`admin.insights.tsx`) · `npm run lint` · `npm run build` (runs `check:esm`) · `npm test` ·
`npm run test:integration` (`RUN_INTEGRATION=1`, `--no-file-parallelism`).

## 6. Architecture & isolation

- **Pure core, thin edges.** `shapeInsights()` is pure and fully unit-testable; the Hono
  route only fetches + serialises; the React page only queries + renders. Each unit is
  understandable and testable alone.
- **Reuse over re-implement.** Sidebar = `SideNav` pattern; cards/funnel/skeleton/badges =
  existing CSS classes & `ScoreRing`-style SVG; auth/workspace/client plumbing already
  exists. The only genuinely new artefacts are `shapeInsights`, `TrendChart`, the route, and
  the nav config.
- **No migration, no writes, no new deps** in either slice — the smallest possible blast
  radius for a visible redesign + new dashboard.

## 7. Risks & gotchas (from codebase research)

- **Route codegen:** adding `admin.insights.tsx` requires `tsr generate`; dot-notation only
  (`admin.insights.tsx`, not `admin_insights.tsx`).
- **ESM `.js`:** every relative import in `server/**` must end in `.js` (`check:esm` guards;
  prior outage cause).
- **`/admin` is unguarded in `app.ts`** — auth is internal to `adminRoutes`; new sub-route
  inherits it. Don't double-guard.
- **Break-glass secret** sets `staff.userId = null` (`viaSecret = true`) — don't key logic
  off `userId` without a null guard.
- **`serviceClient()` bypasses RLS** — validate `window`/`workspace` inputs; never expose to
  user-facing code.
- **Workspace is a `?workspace` query param** for admin (not `X-Workspace-Slug`, not a route
  param); `AdminWorkspaceContext` persists via `sessionStorage` + `?ws`.
- **i18n parity** — en/zh keys identical, no empty values, or the build fails.
- **Design tokens** — no `tailwind.config.js`; card shadows are hardcoded `box-shadow`
  (not `shadow-*`); radius always `var(--radius)`; `--color-magenta-pop` decorative-only;
  skeletons must use `.skeleton-acid`.
- **`Link.activeProps` replaces `className`** on match — avoid conflicting selectors.
- **`shapeEngagedRoster` excludes 0-active creators** — compute Active-creators directly.
- **`points_awarded` excludes cash** — Cash paid comes from `earnings_transactions`.
- **Unconfirmed:** the `missions` quota column name (research left it unnamed) — confirm
  before computing fill rate.

## 8. Rollout

1. Branch `feat/admin-saas-insights` off `main` @ `990e3c1`.
2. Slice 0 (shell) and Slice 1 (Insights) can ship in one PR (no migration, no env) or two
   sequential PRs (shell first). **No prod migration / no new env var** either way.
3. Standard local gates green → PR → merge → Vercel Git deploy (never `vercel --prod` from
   local — mis-bundles the API).
4. No Supabase change, no `ADMIN_SECRET`/env additions for these two slices.

## 9. Roadmap (each its own future spec)

- **Slice 2 — At-risk & opportunity radar:** derived action queues (idle/churning creators,
  rising performers, SLA-breaching submissions via `review_deadline`). Likely on-read; may
  reuse the Insights endpoint or add `/admin/insights/radar`.
- **Slice 3 — Segmentation:** saved creator segments (filter → persist). Adds a
  `creator_segments` migration; becomes the targeting primitive. Unlocks the "Segments" nav
  item.
- **Slice 4 — Nudges:** operator → segment in-app notification — extend the `notifications`
  `type` CHECK (e.g. `operator_message`) + a service-role insert endpoint + free-text/
  bilingual payload rendered at read-time; plus "invite to mission" reusing the shortlist
  RPCs. In-app only (no external channel).
```
