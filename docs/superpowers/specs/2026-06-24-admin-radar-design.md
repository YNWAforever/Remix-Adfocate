# Admin At-risk & Opportunity Radar — Design

**Date:** 2026-06-24
**Initiative:** SaaS-style operator console — Slice 2 of 4 (measure → **surface** → segment → act)
**Branch:** `feat/admin-radar` (off `main` after PR #43 merges)
**Migration:** none (pure read-only, computed on-read)
**Primary user:** internal Fimmick operators

## 1. Summary

Add a **/admin/radar** page that surfaces four actionable creator & submission queues
operators can act on right now — without building or persisting derived views. All data is
computed on each request from existing tables via `serviceClient()`.

This is Slice 2 of the engagement-analytics initiative. It builds on the SaaS shell from
Slice 0 (PR #43) and unlocks the previously-locked "Radar" nav placeholder in the Analytics
group. **No migration, no new env var, no write paths.**

## 2. Scope (locked in brainstorming)

| Decision | Choice |
|---|---|
| Queues included | **All four:** at-risk/churning · SLA-breaching submissions · rising performers · new/unactivated |
| At-risk window | **30 days** (last activity > 30d ago = at-risk) |
| Page location | **New `/admin/radar` page** under the Analytics nav group |
| Cap per queue | **Top-20**, with an explicit "+N more" count indicator below the list |
| UI container | **Four `.pastel-card` panels** in `lg:grid-cols-2` |
| Persistence | **None** — computed on-read; no snapshot table |
| Write actions | **None** (nudges arrive in Slice 4) |

**Explicitly deferred:** nudge/invite actions (Slice 4); saved segments (Slice 3); real-time
push; per-mission SLA configuration (current deadline is 48 h from `0005` migration);
CSV/export; configurable at-risk threshold.

## 3. Backend

### 3.1 Data flow

```
/admin/radar (admin.radar.tsx)
  └─ useQuery(adminKeys.radar(workspace, days)) → fetchRadar(workspace, days)
       └─ GET /api/admin/radar?workspace=<uuid?>&days=<30>
            └─ adminRoutes.route("/radar", adminRadarRoutes)  [inherits staff auth]
                 └─ serviceClient() reads → shapeRadar(input) → { queues }
```

- New route file **`src/routes/admin.radar.tsx`** (dot-notation; requires `tsr generate`
  via `npm run type-check`).
- New Hono sub-route **`server/routes/adminRadar.ts`**, registered in
  `server/routes/admin.ts` via `adminRoutes.route("/radar", adminRadarRoutes)`.
  The existing staff-auth middleware on `adminRoutes` covers it — **add no second guard**.
- All queue logic in a **pure `shapeRadar()` in `server/lib/radar.ts`** (no DB/async inside —
  takes pre-fetched rows), mirroring `shapeInsights` / `engagedRoster`.
- DB reads use `serviceClient()` — never leak to user-facing code.
- **Workspace scope:** `?workspace` optional; omitted ⇒ aggregate all workspaces (same
  pattern as `/insights`). Present ⇒ filter on `mission_submissions.workspace_id` /
  `missions.workspace_id`.
- **`.js` extension is mandatory** on every relative import in `server/routes/*` and
  `server/lib/*` — `check:esm` guards this; omitting it caused a prior ~1-day prod outage.

### 3.2 Query inputs to `shapeRadar`

The Hono route fetches four independent row-sets and passes them to the pure shaper:

```ts
type ShapeRadarInput = {
  days: number;                       // validated: must equal 30 (only value today; 422 otherwise)
  // Queue A — at-risk
  pastCreators: AtRiskRow[];          // creators with ≥1 historical participation, last activity > days
  // Queue B — SLA-breaching
  overdueSubmissions: OverdueRow[];   // status ∈ submitted|under_review AND review_deadline < now()
  // Queue C — rising performers
  risingRows: RisingRow[];            // approved in last `days` days, with quality signals
  // Queue D — new/unactivated
  newCreators: NewCreatorRow[];       // created_at in last `days` days, zero participations
};
```

The Hono route fires all four PostgREST queries in parallel (`Promise.all`), validates
`?days` (must be 30, else 422), and passes results to `shapeRadar`.

### 3.3 Queue definitions

#### Queue A — At-risk / churning

**Signal:** creator had ≥1 past participation (`mission_submissions` row in any historical
status), but their most-recent activity (latest of `created_at`, `submitted_at`,
`reviewed_at` across all their rows) is older than `days` ago, **and** they have no
currently-active row (status ∈ `joined` | `submitted` | `under_review`).

**PostgREST query strategy:** service-role query on `mission_submissions` grouped by
`creator_id`, selecting:
- `creator_id`
- `max(greatest(created_at, coalesce(submitted_at, created_at), coalesce(reviewed_at, created_at))) as last_active`
- `max(case when status in ('joined','submitted','under_review') then 1 else 0 end) as has_active`

Filter post-select: `last_active < now() - interval '30 days'` AND `has_active = 0`.
Join to `creators` for `display_name` + `phone`.

**Ranking:** most-stale-first (smallest `last_active`). Cap at top-20.

**Row shape:**
```ts
type AtRiskRow = {
  creator_id: string;
  display_name: string | null;
  phone: string | null;
  last_active: string;        // ISO
  days_idle: number;          // Math.floor(now - last_active) in days
};
```

#### Queue B — SLA-breaching submissions

**Signal:** `mission_submissions` with `status ∈ ('submitted', 'under_review')` and
`review_deadline < now()` (overdue). A soft "due soon" sub-flag applies when
`review_deadline < now() + interval '2 days'` (but still future — i.e., not yet overdue).
Both are returned together; the shaper sets `urgency: "overdue" | "due_soon"`.

**PostgREST query:** filter `status=in.(submitted,under_review)&review_deadline=lte.{now+2d}`,
order by `review_deadline asc`. Join to `creators` for `display_name`; join to `missions`
for `title`.

**Ranking:** most-overdue-first (smallest `review_deadline`). Cap at top-20.

**Row shape:**
```ts
type OverdueRow = {
  submission_id: string;
  creator_id: string;
  display_name: string | null;
  mission_title: string;
  status: "submitted" | "under_review";
  review_deadline: string;    // ISO
  urgency: "overdue" | "due_soon";
  hours_overdue: number;      // negative = future (due_soon); positive = overdue
};
```

#### Queue C — Rising performers

**Signal:** creator with ≥1 approved submission in the last `days` days, plus a
`quality_rating` signal. Rank by a composite score: `recent_approvals × avg_quality`
(where `avg_quality` defaults to 3 when all ratings are null — neutral, neither boosted
nor penalised).

**PostgREST query:** filter `status=eq.approved&reviewed_at=gte.{cutoff}`, group by
`creator_id`, select count + avg(`quality_rating`). Join to `creators` for `display_name`,
`level`, `xp`.

**Ranking:** highest composite score first. Cap at top-20.

**Row shape:**
```ts
type RisingRow = {
  creator_id: string;
  display_name: string | null;
  level: string;              // L0..L6
  recent_approvals: number;
  avg_quality: number | null; // null if no rated submissions in window
  score: number;              // recent_approvals × (avg_quality ?? 3)
};
```

#### Queue D — New / unactivated

**Signal:** creator whose `creators.created_at >= now() - interval '30 days'` and who has
**zero rows** in `mission_submissions` (never joined any mission).

**PostgREST query:** service-role query on `creators` filtered by `created_at >= cutoff`,
then anti-join against `mission_submissions` (subquery `creator_id NOT IN (SELECT DISTINCT
creator_id FROM mission_submissions)`). Select `id`, `display_name`, `phone`, `created_at`,
`level`.

**Ranking:** newest-first (largest `created_at`). Cap at top-20.

**Row shape:**
```ts
type NewCreatorRow = {
  creator_id: string;
  display_name: string | null;
  phone: string | null;
  created_at: string;         // ISO
  days_since_join: number;
};
```

### 3.4 Response shape

```ts
type RadarQueue<T> = {
  items: T[];
  total: number;    // full count before the top-20 cap (for "+N more" indicator)
};

type Radar = {
  window: { days: number; from: string };    // ISO cutoff
  atRisk:      RadarQueue<AtRiskRow>;
  slaBreaching: RadarQueue<OverdueRow>;
  rising:      RadarQueue<RisingRow>;
  newUnactivated: RadarQueue<NewCreatorRow>;
};
```

Error shape follows house convention: `{ error: string, code: string }` with
`bad_token`/`no_admin` (401), `not_staff` (403), `validation` (422), `db_error` (500).

### 3.5 `server/lib/radar.ts` — pure shaper

```ts
// Pure function — no DB/async inside
export function shapeRadar(input: ShapeRadarInput): Radar
```

Accepts raw row arrays (already filtered + joined by the route), applies:
- top-20 cap + `total` count for each queue
- `days_idle` / `hours_overdue` / `days_since_join` integer derivation
- composite `score` for rising performers
- `urgency` classification for SLA queue (`review_deadline < now` → overdue, else due_soon)

Returns the typed `Radar` object. All date math is relative to a `now` parameter injected
by the route (not `Date.now()` inside the shaper, so it's fully testable without time mocks).

## 4. Frontend

### 4.1 Nav item

Add `{ to: "/admin/radar", labelKey: "app.admin.tabRadar", icon: Radar /* lucide */, exact: false }`
to the Analytics group in `adminNavItems.ts` — **after** Insights, **replacing** nothing.
This unlocks the previously-locked Segments placeholder pattern (Radar was never listed as
locked; it's just absent until this PR). No changes to the locked Segments item.

New i18n key `app.admin.tabRadar` added (en: "Radar" / zh: "雷達"). Also add `app.admin.title`
if it doesn't exist yet for the fallback page title.

### 4.2 Client wiring (`src/lib/admin.ts`)

Add to `adminKeys`:
```ts
radar: (workspace: string, days: number) => ["admin-radar", workspace, days] as const,
```

Add `fetchRadar(workspace = "", days = 30): Promise<Radar>` — follows `fetchInsights` exactly
(wsq builder + adminFetch + AdminAuthError on 401).

Add `Radar`, `RadarQueue`, `AtRiskRow`, `OverdueRow`, `RisingRow`, `NewCreatorRow` types.

### 4.3 Page layout (`src/routes/admin.radar.tsx`)

```
/admin/radar
├── <h2> "今日雷達 / Today's Radar" (i18n)
│
├── lg:grid-cols-2 grid gap-4
│   ├── .pastel-card  Queue A: At-risk creators
│   ├── .pastel-card  Queue B: SLA-breaching submissions
│   ├── .pastel-card  Queue C: Rising performers
│   └── .pastel-card  Queue D: New & unactivated
│
└── skeleton / error states
```

Each panel:
- **Heading** (i18n): icon + label + count badge (total from server).
- **List** (max 20 items): each row = avatar initial + `display_name | phone` + right-side
  detail (days idle / deadline / score / days since join).
- **"+N more"** footer line when `total > items.length`, rendered in muted ink.
- **Empty state:** brief muted text (e.g. "沒有待跟進的創作者") when `items.length === 0`.

**Design details:**
- Queue B (SLA): `urgency === "overdue"` rows use `.metric-down` (magenta) text on the
  deadline; `due_soon` rows use `.metric-neutral` (soft-ink).
- Queue C (rising): level chip (`.level-pill`) beside display name; score rendered as plain
  number in ink.
- No action buttons in this slice — rows are read-only with a deep-link to the relevant
  creator or submission page where appropriate.
- **Loading:** `.skeleton-acid` cards, one per panel (not per row).
- **Error (non-auth):** inline error message `t("app.radar.loadError")` inside the page
  area (not a full-page error).
- **Auth error:** `useEffect(() => { if (q.error instanceof AdminAuthError) reportAuthError(q.error); }, [...])` — identical pattern to the other admin pages.

### 4.4 i18n

New `app.radar.*` namespace, added simultaneously to both `en` and `zh` in
`src/lib/i18n.dict.ts`:

| Key | en | zh |
|---|---|---|
| `app.radar.heading` | "Today's Radar" | "今日雷達" |
| `app.radar.atRiskTitle` | "At-risk Creators" | "有流失風險的創作者" |
| `app.radar.atRiskEmpty` | "No at-risk creators right now." | "目前沒有流失風險的創作者。" |
| `app.radar.slaTitle` | "SLA Breaching" | "審核逾期" |
| `app.radar.slaEmpty` | "All submissions within SLA." | "所有提交均在審核期限內。" |
| `app.radar.risingTitle` | "Rising Performers" | "上升中的創作者" |
| `app.radar.risingEmpty` | "No standout performers this period." | "本期暫無突出創作者。" |
| `app.radar.newTitle` | "New & Unactivated" | "新加入未啟動" |
| `app.radar.newEmpty` | "No new inactive creators." | "沒有新加入但未啟動的創作者。" |
| `app.radar.moreItems` | "+{n} more" | "+{n} 更多" |
| `app.radar.daysIdle` | "{n}d idle" | "閒置 {n} 天" |
| `app.radar.hoursOverdue` | "{n}h overdue" | "逾期 {n} 小時" |
| `app.radar.dueSoon` | "Due soon" | "即將到期" |
| `app.radar.daysSinceJoin` | "Joined {n}d ago" | "{n} 天前加入" |
| `app.radar.loadError` | "Couldn't load radar data." | "無法載入雷達數據。" |
| `app.admin.tabRadar` | "Radar" | "雷達" |

(Use `t(key, { n })` — the i18n helper's `interpolate()` supports `{n}`-style named params via `/\{(\w+)\}/g` regex.)

## 5. Testing

### 5.1 Unit — `server/lib/radar.test.ts`

Model on `server/lib/insights.test.ts`. Factory helpers with overrides. Tests:
- All empty inputs → valid `Radar` with empty queues, no throw.
- Top-20 cap: pass 25 rows → `items.length === 20`, `total === 25`.
- `days_idle` derived correctly (integer floor of day diff).
- `hours_overdue` positive for past deadlines, negative for future.
- `urgency` "overdue" vs "due_soon" classification.
- Rising performer `score` = `recent_approvals × avg_quality`; null quality defaults to 3.
- Queue A excludes creators with active row (`has_active = 1`).
- Queue D: creator with zero `mission_submissions` rows included; creator with ≥1 row excluded.

### 5.2 Component — `src/components/admin/RadarQueue.test.tsx`

If the four panels are extracted into a reusable `RadarQueueCard` component, test it in
isolation (heading, list, "+N more", empty state). If inlined in the page, test via the
route stub instead.

### 5.3 Route stub — `src/routes/-admin.radar.test.tsx`

Leading-dash convention. `vi.hoisted` + `vi.mock` for `@/lib/admin`, contexts, supabase.
Extract `Route.options.component`. Cover:
- Loading: renders `.skeleton-acid` (or skeleton text).
- Populated: renders at-risk heading + at least one creator row.
- Auth error: `reportAuthError` called with `AdminAuthError`.
- Non-auth error: renders `app.radar.loadError` string.

### 5.4 Integration — `server/test/radar.test.ts`

Model on `server/test/insights.test.ts`. `const suite = hasSupabaseEnv ? describe : describe.skip`.
Seed a creator + a `mission_submissions` row older than 30d via `server/test/helpers.ts`.
Tests:
- `GET /admin/radar` without auth → 401.
- `GET /admin/radar?days=7` → 422 (only 30 is valid).
- `GET /admin/radar` with staff auth → 200 `{ queues }` shape.
- Workspace filter `?workspace=<uuid>` → 200, no crash.

**Append `server/test/radar.test.ts` to the explicit file list in `package.json`
`test:integration`** (it is not glob-based).

### 5.5 Gates (all must pass)

`npm run type-check` (runs `tsr generate` — required after adding `admin.radar.tsx`) →
`npm run lint` → `npm run build` (runs `check:esm`) → `npm test` →
`npm run test:integration` (`RUN_INTEGRATION=1`, `--no-file-parallelism`).

## 6. Architecture & isolation

- **Pure core, thin edges.** `shapeRadar()` is pure + fully unit-testable; the Hono route
  only fetches + passes rows; the React page only queries + renders. Same pattern as
  `shapeInsights` / `shapeEngagedRoster`.
- **No new deps, no migration, no writes.** All data already exists in
  `mission_submissions` (status, review_deadline, quality_rating, submitted_at, reviewed_at,
  workspace_id) and `creators` (created_at, display_name, phone, level, xp).
- **Parallel DB fetches.** The Hono route fires all four PostgREST queries in `Promise.all`
  so wall-clock ≈ slowest single query, not the sum.
- **`now` injected** into `shapeRadar` by the route (not `Date.now()` inside the shaper) —
  keeps the shaper deterministic and testable without time mocks.

## 7. Risks & gotchas

- **Route codegen:** adding `admin.radar.tsx` requires `tsr generate` via `npm run
  type-check` — bare `tsc` will not regenerate `routeTree.gen.ts`.
- **ESM `.js`:** every relative import in `server/**` must end in `.js` (`check:esm` guards;
  prior outage cause).
- **`/admin` is unguarded in `app.ts`** — auth lives inside `adminRoutes`; the new sub-route
  inherits it. Do not add a second guard.
- **Break-glass secret** sets `staff.userId = null` (`viaSecret: true`) — don't key logic
  off `userId` without a null guard.
- **`serviceClient()` bypasses RLS** — validate `days`/`workspace` inputs; never expose to
  user-facing code.
- **`days` validation:** only `30` is valid today (future: 7/60 extension). Reject other
  values with 422 to avoid open-ended query parameters.
- **Anti-join for Queue D:** PostgREST doesn't support `NOT IN` natively — use a raw SQL
  query via `serviceClient().rpc(...)` or a subquery in the PostgREST filter
  (`creator_id=not.in.(select:mission_submissions(creator_id))`). Confirm the exact
  PostgREST filter syntax at build time; fall back to raw SQL RPC if needed.
- **`quality_rating` nullable:** many submissions have `quality_rating = null`
  (operators didn't rate them). The rising-performer `score` uses default 3 for null — make
  this explicit in the unit tests.
- **`review_deadline` nullable:** migration `0005` adds the column but early rows may have
  `null` (pre-migration data). The SLA query filters on `review_deadline IS NOT NULL` to
  exclude legacy rows.
- **i18n parity:** en/zh keys must be identical; no empty values. The build fails otherwise.
- **`{n}` substitution:** `t(key, { n })` works — the helper's `interpolate()` uses
  `/\{(\w+)\}/g` (confirmed in `src/lib/i18n.tsx`).
- **Lucide `Radar` icon:** confirmed exported from the installed `lucide-react` version.
- **Workspace scope on Queue D:** `creators` table does not have a `workspace_id` column
  (creators are global, not workspace-scoped). Queue D therefore returns **all**
  unactivated creators regardless of `?workspace`. This is intentional: a new creator
  hasn't joined any mission, so they have no workspace association yet. Document this in
  a comment in `shapeRadar`.

## 8. Rollout

1. Branch `feat/admin-radar` off `main` **after PR #43 merges** (the SaaS shell is a
   prerequisite — `AdminSideNav`, `adminNavItems.ts`, and the routing structure are needed).
2. No prod migration, no new env var — safe to merge and auto-deploy via Vercel Git at any
   time once gates are green.
3. Standard flow: local gates green → PR → merge → Vercel Git deploy.
   Never `vercel --prod` from local (mis-bundles the API).
4. `ADMIN_SECRET` must remain set in Vercel (break-glass path, already done).

## 9. What this is NOT

- No creator-segment persistence (Slice 3).
- No nudge/invite actions (Slice 4).
- No configurable at-risk threshold (hardcoded 30d for now).
- No realtime subscription — polling via `staleTime` + manual refresh is fine.
- No CSV/export.
