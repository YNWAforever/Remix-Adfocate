# Brand Portal Slice 2 — Review & Payout — Design Spec

**Date:** 2026-06-27
**Depends on:** Brand Portal Slice 1 (`feat/brand-portal-slice1`, PR #46) — `requireBrand`, `BrandEnv`, the `/brand` route tree, `src/lib/brand.ts`.

## Goal

A logged-in brand reviews the creators working on **its own** missions and drives the earn loop to completion:

- **Applications** (for `access_type='application'` missions): accept or decline.
- **Submissions**: approve (the **payout** — credits the creator's points + cash) or reject, with an optional 1–5 content quality rating.
- **Engaged roster**: a read-only view of who is currently working on the brand's missions.

All scoped to the brand's single workspace. No new env vars. **No database migration** (see Architecture).

## Architecture

**Trust boundary = the `requireBrand` identity.** `requireBrand` (Slice 1) verifies the JWT and sets `c.var.brand = { userId, email, workspaceId, role }` from the brand's `brand_users` row. `workspaceId` is the only workspace the brand may touch.

**Reads:** brand review lists use `serviceClient()` (privileged) with a hard `.eq("missions.workspace_id", brand.workspaceId)` filter. The workspace comes from the verified identity, never a request param. This mirrors the operator `/admin` review endpoints (`server/routes/admin.ts` `/submissions`, `/applications`, `/engaged`), which use the same `serviceClient` + workspace-filter shape with a `?workspace=` param — the brand version forces the workspace from identity. `serviceClient` is required because the lists join `creators` (display name, content URLs, avatar/level), which a brand user cannot read via RLS.

**Writes (the 4 actions):** the action RPCs (`approve_submission`, `reject_submission`, `accept_application`, `decline_application`) are `SECURITY DEFINER` and do not check brand ownership. So each action endpoint first verifies ownership — fetch the submission/application row constrained by `missions.workspace_id = brand.workspaceId`; if it doesn't resolve, return **404** *before* calling the RPC. Only then does it invoke the existing RPC via `serviceClient`. This is the same "RLS/identity-scoped read gates the privileged write" pattern Slice 1 uses for mission CRUD.

**Why not RLS on `mission_submissions` (the rejected Option B):** brands still can't RLS-read `creators`, so the list joins would break and fall back to `serviceClient` anyway — a migration that buys nothing. Option A keeps the slice migration-free and consistent with the operator endpoints.

**Isolation guarantee:** every read is filtered to `brand.workspaceId`; every write is gated by an ownership check against `brand.workspaceId`. A brand can neither see nor act on another workspace's applications/submissions. The integration tests prove this with a two-brand setup.

## Components

### Server — `server/routes/brandReview.ts` (new)

`export const brandReviewRoutes = new Hono<BrandEnv>()`, mounted inside `server/routes/brand.ts` as `guarded.route("/review", brandReviewRoutes)` so it inherits `requireBrand` and `c.var.brand`. Reuses `enrichAdminMissionRows` (`server/lib/operatorCrm/repo.ts`), `shapeEngagedRoster` (`server/lib/engagedRoster.ts`), and `persistScores` (`server/lib/persistScores.ts`). All relative imports carry `.js`.

A shared ownership gate:
```
// Returns true iff submission `id` belongs to a mission in `workspaceId`.
async function brandOwnsSubmission(svc, id, workspaceId): Promise<boolean>
  → svc.from("mission_submissions").select("id, missions!inner(workspace_id)")
       .eq("id", id).eq("missions.workspace_id", workspaceId).maybeSingle() → !!data
```

Endpoints (all under `/api/brand/review`, all `requireBrand`-gated, `ws = c.var.brand.workspaceId`):

| Method + path | Behaviour |
|---|---|
| `GET /submissions?status=` | `mission_submissions` rows (default `status='submitted'`; also accepts `under_review`) on the brand's missions: `select(id, mission_id, status, content_urls, submitted_at, created_at, creator_id, creators!inner(display_name), missions!inner(slug, title, points_reward)).eq("status", status).eq("missions.workspace_id", ws)` → `enrichAdminMissionRows(svc, rows)` → `{ submissions }` |
| `GET /applications` | same shape with `status='applied'` (no `content_urls`) → `enrichAdminMissionRows` → `{ applications }` |
| `GET /engaged` | `select(id, mission_id, creator_id, status, points_awarded, created_at, submitted_at, reviewed_at, review_deadline, creators!inner(id, display_name, avatar_url, level, xp), missions!inner(slug, title)).in("status", ["joined","submitted","under_review","approved"]).eq("missions.workspace_id", ws)` → `shapeEngagedRoster(rows)` → `{ creators }` |
| `POST /submissions/:id/approve` `{notes?, quality_rating?}` | validate `quality_rating` is integer 1–5 or null (else 400 `bad_rating`); ownership-gate → 404; `rpc("approve_submission", {p_submission, p_notes, p_quality_rating})` (400 `rpc_error` on failure); `await persistScores(result.creator_id)`; return the RPC result. **This is the payout** (points + cash credited to the creator). |
| `POST /submissions/:id/reject` `{notes?}` | ownership-gate → 404; `rpc("reject_submission", {p_submission, p_notes})`; `persistScores`; return result |
| `POST /applications/:id/accept` | ownership-gate → 404; `rpc("accept_application", {p_submission})`; return result |
| `POST /applications/:id/decline` `{notes?}` | ownership-gate → 404; `rpc("decline_application", {p_submission, p_notes})`; return result |

Error shape matches the codebase: 404 `not_found`, 400 `bad_rating`/`rpc_error`, 500 `db_error`.

**Notifications:** the N1 DB triggers fire creator notifications on submission/application status changes regardless of caller — brand actions notify creators automatically, no extra code.

### Client — extend `src/lib/brand.ts`

- `brandKeys.submissions(status)`, `brandKeys.applications()`, `brandKeys.engaged()`
- `fetchBrandSubmissions(status='submitted')`, `fetchBrandApplications()`, `fetchBrandEngaged()`
- `approveBrandSubmission(id, { notes?, quality_rating? })`, `rejectBrandSubmission(id, { notes? })`, `acceptBrandApplication(id)`, `declineBrandApplication(id, { notes? })`
- Reuse the response row types from `@/lib/admin` where they match (`MissionActivityRow` for submissions/applications; the engaged roster type) to avoid re-declaring shapes — types only, consistent with Slice 1's reuse of `AdminRequestError`/`MissionDraftInput`.

### UI — `/brand/review`

- `src/routes/brand.review.tsx` — `createFileRoute("/brand/review")`; a tabbed page (local tab state: `applications | engaged | submissions`, default `submissions`) rendering one panel component each.
- `src/components/brand/BrandReviewTabs.tsx` (or three small panel components) — each panel `useQuery`s its fetcher and renders rows in the Acid Y2K card idiom, mirroring the operator review components (`src/components/admin/*` / `src/routes/admin.*`) but using brand fetchers and `useBrandAuth` (the admin ones are coupled to `useAdminAuth`/workspace context, so we mirror rather than import). Action buttons wire the mutations; on `BrandAuthError` call `reportAuthError`. Approve presents a minimal inline 1–5 quality control before firing `approveBrandSubmission`.
- `src/components/brand/BrandNav.tsx` — add a third item `審核 / Review` → `/brand/review` (icon `ClipboardCheck` from lucide).

### i18n — `app.brand.review.*` (en + zh, parity-enforced)

Tab labels (applications/engaged/submissions), action labels (accept/decline/approve/reject), the quality-rating prompt, status chips, and empty states. Incidental status/queue strings may stay inline-zh consistent with the operator review precedent; the tab/nav/action labels go through i18n.

## Testing

**Integration — `server/test/brandReview.test.ts`** (skips without local stack; extends the Slice 1 brand helpers): seed two brands A/B in distinct workspaces, each with a mission; seed a `submitted` submission and an `applied` application on A's mission.
- A's `GET /review/submissions` includes A's submission; B's does not.
- B approving A's submission → 404; B accepting A's application → 404.
- A approving its submission with `quality_rating=5` → 200, and the creator's points balance increases by the mission's reward (payout proof) and the creator receives a notification row.
- A's `GET /review/applications` and `/engaged` are workspace-scoped (B sees none of A's).
- A rejecting an out-of-range rating (`quality_rating=7`) → 400.
- Append `server/test/brandReview.test.ts` to `package.json` `test:integration`.

**Route-stub — `src/routes/-brand.review.test.tsx`** (mirror `-brand.test.tsx`): mock `@/lib/brand` + `useBrandAuth` + partial-mock `@tanstack/react-router`; assert the submissions tab renders a seeded submission and an approve action; assert the applications tab renders an applicant with accept/decline.

## File map

| File | Status | Responsibility |
|---|---|---|
| `server/routes/brandReview.ts` | Create | Brand-scoped review lists + 4 ownership-gated action endpoints |
| `server/routes/brand.ts` | Modify | Mount `guarded.route("/review", brandReviewRoutes)` |
| `server/test/brandReview.test.ts` | Create | Two-brand isolation + payout + rating-validation integration |
| `package.json` | Modify | Append `server/test/brandReview.test.ts` to `test:integration` |
| `src/lib/brand.ts` | Modify | review keys + fetchers + action mutations |
| `src/routes/brand.review.tsx` | Create | Tabbed review page |
| `src/components/brand/BrandReview*.tsx` | Create | Tab panels + row/action UI |
| `src/components/brand/BrandNav.tsx` | Modify | Add Review nav item |
| `src/routes/-brand.review.test.tsx` | Create | Route-stub tests |
| `src/lib/i18n.dict.ts` | Modify | `app.brand.review.*` keys (en + zh) |

**No migration. No new env vars.** Deploy = code push only (reuses the existing RPCs, which are already in prod).

## Out of scope (future Slice 3)

Brand budget / pre-funding / billing / a brand-side wallet. Approve credits the creator's existing points + cash balances; there is **no** brand-side debit or spend cap in this slice. This is the natural next slice once review is in place.

## Pattern sources to mirror

`server/routes/admin.ts` (`/submissions`, `/submissions/:id/approve|reject`, `/applications`, `/applications/:id/accept|decline`, `/engaged` — the exact query shapes, RPC calls, `persistScores`, and `enrichAdminMissionRows`/`shapeEngagedRoster` usage); `server/routes/brand.ts` (the guarded sub-app + `bearer`/identity idiom); `src/lib/brand.ts` (fetcher + error-class reuse); `src/routes/-brand.test.tsx` (route-stub mocking); Slice 1 brand test helpers (`makeBrand`, `seedMission`).
