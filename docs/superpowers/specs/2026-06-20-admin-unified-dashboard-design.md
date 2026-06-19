# Unified `/admin` Dashboard — Design

**Date:** 2026-06-20
**Status:** Approved (brainstorm), pending implementation plan
**Branch:** `feat/admin-unified-dashboard` (off `main` @ a627de2)
**Migration:** none

## Problem

The operator/admin tooling is real but scattered and partly invisible:

- `/operator` — pending **applications** queue (`status='applied'`), accept/decline.
- `/operator/creators` — creator **review queue** (filters: status, risk, search, sort).
- `/operator/creators/:id` — per-creator detail (review, notes, shortlists, social, portfolio, mission history).
- `/operator/missions/:id` — mission shortlist / selection.
- Server: `/api/admin/applications`, `/api/admin/submissions`, `/api/admin/creators/review`, `/api/admin/creators/:id`, shortlist endpoints — all behind a shared `x-admin-secret` gate.

Gaps:

1. **No "engaged users" view.** Creators who have actually *joined* a mission and are working it (`status` `joined` / `submitted` / `under_review`) are not surfaced anywhere. The existing pages are about *vetting* and *applications*, not *active participants*.
2. **Submissions have no UI.** `/api/admin/submissions` (+ approve/reject) exists, but nothing renders it.
3. The operator pages are reachable only by typing the URL (no nav), and the list views are split across separate routes.

## Goal

One **tabbed `/admin` dashboard** that unifies the operator's daily surfaces — Applications, Engaged users, Submissions, Creator review queue — with row drill-downs that navigate to the existing detail pages. Internal tool, unchanged interim shared-secret auth.

## Non-goals

- Real per-workspace role auth and multi-workspace scoping stay deferred (interim shared secret; the Brand Dashboard replaces this later). The new endpoint keeps the same single-operator / single-workspace caveat as its siblings.
- No DB migration — Engaged users is a pure read-aggregation over existing tables.
- Do **not** rebuild the existing detail pages (`/operator/creators/:id`, `/operator/missions/:id`); link to them.
- Engaged tab is **read-only** — no actions on active participations beyond linking out. Actions live in Applications/Submissions tabs.
- Not added to the creator-facing nav (BottomNav/SideNav). URL + secret only, as today.

## Architecture (Approach A: nested layout route + child tab routes)

TanStack file routes, matching the repo's existing `_app` layout + children and `operator` family conventions.

```
/admin                 → admin.tsx (layout): OperatorAuthGate + AdminTabs + <Outlet/>
  index                → redirect to /admin/applications
  /admin/applications  → admin.applications.tsx   (existing /admin/applications endpoint)
  /admin/engaged       → admin.engaged.tsx          (NEW /admin/engaged endpoint)
  /admin/submissions   → admin.submissions.tsx      (existing /admin/submissions endpoint)
  /admin/creators      → admin.creators.tsx         (existing /admin/creators/review endpoint)
```

- `admin.tsx` owns the **single** auth gate (`OperatorAuthGate`) and the tab bar (`AdminTabs`); each child tab assumes it is authed.
- Tab labels carry a count badge where cheap (pending applications, pending submissions), populated from each tab's own query — **no** dedicated summary endpoint (YAGNI).
- Each tab is a small, independently-testable route file.

Layout sketch:

```
┌─ 營運後台 ──────────────────────────────────────────────────────┐
│ [申請 Applications] [活躍創作者 Engaged] [作品 Submissions] [審核 Creators] │
├─────────────────────────────────────────────────────────────────┤
│  <active tab content: table / roster>                           │
└─────────────────────────────────────────────────────────────────┘
```

## Tabs

### Applications
Move the current `/operator` body here verbatim (accept/decline rows). The `Application` type + query move from `operator.tsx` into `lib/admin.ts` for reuse. Rows link to `/operator/missions/:id` (mission selection) as today. Uses existing `GET /admin/applications` + `POST /admin/applications/:id/accept|decline`.

### Submissions (new UI, existing backend)
List `status='submitted'` from `GET /admin/submissions`. Each row:
- **Approve** with a 1–5 quality rating → `POST /admin/submissions/:id/approve` `{ notes?, quality_rating }`.
- **Reject** with a note → `POST /admin/submissions/:id/reject` `{ notes? }`.

`quality_rating` is validated server-side as an integer 1–5 (already enforced); the UI presents a 1–5 selector.

### Creator review queue
Move the `/operator/creators` list (filters: search, status, risk, sort) here. Rows link to `/operator/creators/:id`. Uses existing `GET /admin/creators/review`.

### Engaged users (new UI + new endpoint)
Roster, one row per creator with ≥1 active participation, expandable to their active missions.

## New backend: engaged roster

`GET /api/admin/engaged` in `server/routes/admin.ts`, behind the existing `x-admin-secret` gate, service client, single-workspace interim scope (same caveat comment as siblings).

One query over `mission_submissions ⋈ creators ⋈ missions` for `status in ('joined','submitted','under_review','approved')`, shaped by a **pure, unit-tested** `shapeEngagedRoster(rows)` (new file, e.g. `server/lib/engagedRoster.ts`):

```ts
{ creators: [{
    id, displayName, avatarUrl, level, xp,
    activeCount,       // joined + submitted + under_review
    completedCount,    // approved
    pointsEarned,      // Σ points_awarded
    lastActivityAt,    // max(created_at, submitted_at, reviewed_at)
    activeMissions: [  // expand rows — active statuses only
      { submissionId, missionId, missionSlug, missionTitle, status, joinedAt, submittedAt, reviewDeadline }
    ],
}]}
// roster filtered to activeCount > 0, sorted by lastActivityAt desc
```

Notes:
- `approved` rows are pulled only to compute `completedCount` / `pointsEarned`; they are **not** nested into `activeMissions`.
- Roster membership requires `activeCount > 0` (a creator whose every participation is terminal is not "engaged").
- `joinedAt` = `mission_submissions.created_at`.
- No migration — read-only aggregation.

## Data layer (`lib/admin.ts`)

Add typed fetchers reusing `adminFetch`:
- `fetchApplications()`, `acceptApplication(id)`, `declineApplication(id)`
- `fetchSubmissions(status?)`, `approveSubmission(id, { notes?, rating })`, `rejectSubmission(id, { notes? })`
- `fetchEngagedUsers()` → typed roster above
- `fetchCreatorReviewQueue` already exists.

Move the inline `Application` type out of `operator.tsx` into `lib/admin.ts`.

## Auth & old-route handling

- Reuse `OperatorAuthGate` + the `adminFetch` 401 → clear-secret flow unchanged.
- `/operator` index → **redirect** to `/admin/applications`.
- `/operator/creators` index → **redirect** to `/admin/creators`.
  (Kills the now-duplicated list views; preserves bookmarks.)
- Keep `/operator/creators/:id` and `/operator/missions/:id` as drill-down targets.

## Error handling

- Per-tab queries use `retry: false`. `AdminAuthError` (401) bubbles to the layout gate (re-prompt); other errors render inline within the tab.
- `/admin/engaged` mirrors siblings: typed try/catch, `{ error, code }`, 500 on `db_error`.

## Testing

- **Unit:** `shapeEngagedRoster` — grouping, rollups (`activeCount` / `completedCount` / `pointsEarned`), active-only nesting, `lastActivityAt`, roster filter (`activeCount > 0`), sort.
- **Integration:** `GET /admin/engaged` — 401 without secret; correct roster shape; excludes creators with no active participation; rollups correct. Added to the existing integration suite (`.env.test.local` local stack).
- **Route tests:** one per tab (`-admin.applications.test.tsx`, `-admin.engaged.test.tsx`, `-admin.submissions.test.tsx`, `-admin.creators.test.tsx`) + a layout test (`-admin.test.tsx`: tab nav + auth gate), following the `-operator.*.test.tsx` convention (the `-` prefix is router-ignored).
- **lib:** extend `admin.test.ts` for the new fetchers (paths, query strings, body shapes).

## Gates

`npm run type-check` (runs tsr codegen for the new routes — required, not bare `tsc`), `npm run lint`, `npm run test`, integration suite, `npm run build`.

## Rollout

- Frontend-only + one read endpoint; **no migration**, nothing to apply on prod.
- Requires `ADMIN_SECRET` set in Vercel (already a known pending item from Slice 9 — confirm it is set, else the gate rejects all calls with 401).
