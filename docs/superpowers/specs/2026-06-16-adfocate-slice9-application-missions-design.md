# Slice 9 — Application-Gated Missions (申請制) Design

**Date:** 2026-06-16
**Status:** Approved (brainstorming)
**Branch:** `feat/slice9-application-missions` off `main` @ `1544b1b` (includes Slice 8 / PR #15)

## 1. Goal

Let creators **apply** (one-tap) to `access_type='application'` missions, let an operator **accept/decline** applicants via an admin API **and** a minimal internal page, and route an **accepted** applicant straight into the existing submit flow. This closes the visible disabled stub (「需要申請 · 即將推出」) on the mission page and the `POST /:slug/apply` → 409 `not_available` stub in `server/routes/missions.ts`.

## 2. Decisions (from brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Apply payload | **One-tap** (no pitch note) | Simplest RPC + UI; operator vets on profile/passport. |
| Operator surface | **Admin API + minimal `/operator` page** | API mirrors today's submission approve/reject; the page is the first internal operator UI. |
| Data model | **Reuse `mission_submissions`, no new table** | Add two states; an accepted applicant becomes `joined` and reuses `submit_mission` unchanged. |
| XP | **0 on apply, +10 on accept** | Parity with `join_mission` (+10 on join) — acceptance is the join-equivalent engagement milestone. |
| Notifications | **None this slice** | Creator sees state on revisit, same as approval today. |

## 3. Data model — extend `mission_submissions`

No new table. Add two states to the existing `status` check constraint: **`applied`** and **`declined`**. The per-creator `unique(mission_id, creator_id)` row now spans:

```
                 ┌── accept ──▶ joined ──submit──▶ submitted ──▶ approved / rejected
applied (apply) ─┤
                 └── decline ─▶ declined
```

Key property: **accepted = `joined`**, so the downstream earn loop (`submit_mission`, `approve_submission`, points/XP, passport) is **untouched**. Open missions still go `join → joined` directly; application missions go `apply → applied → (accept) → joined`.

## 4. Migration `0010_applications.sql`

> Applied to the **production** DB manually by the user via the Supabase SQL editor (the cloud migration *tracker* is intentionally behind — do NOT `db push`). Irreversible; user-gated.

1. **Relax the status check:**
   ```sql
   alter table public.mission_submissions drop constraint mission_submissions_status_check;
   alter table public.mission_submissions add constraint mission_submissions_status_check
     check (status in ('applied','joined','submitted','under_review','approved','rejected','expired','declined'));
   ```

2. **`apply_mission(p_mission uuid)`** — SECURITY DEFINER, `authenticated`. Mirrors `join_mission`'s validation but for application missions and **without** consuming quota:
   - `auth.uid()` not null (else `not_authenticated`); creator's workspace looked up (else `not_found`).
   - mission in caller's workspace (else `not_found`); `status='active'` (else `closed`); `access_type='application'` (else **`not_application`**); not past deadline (else `closed`).
   - no existing row for `(mission, creator)` (else **`already_applied`**) — backed by the `unique` constraint as the real guard (translate `unique_violation` → `already_applied`).
   - insert row `status='applied'`, `xp_awarded=0`. **No `filled++`** (applications can over-subscribe; quota is enforced only at accept). Return the row.

3. **`accept_application(p_submission uuid)`** — SECURITY DEFINER, **service-only**. Mirrors the quota+XP half of `join_mission`:
   - row exists (else `not_found`); if already `joined` → return it (**idempotent**); else must be `applied` (else `wrong_state`).
   - `update missions set filled = filled + 1 where id = mission_id and filled < quota`; if 0 rows → `mission_full`.
   - set submission `status='joined'`, `xp_awarded = xp_awarded + 10`; `update creators set xp = xp + 10`. Return the row.

4. **`decline_application(p_submission uuid, p_notes text)`** — SECURITY DEFINER, **service-only**.
   - row exists (else `not_found`); if already `declined` → return it (**idempotent**); else must be `applied` (else `wrong_state`).
   - set `status='declined'`, `reviewer_notes = p_notes`, `reviewed_at = now()`. No XP, no quota change. Return the row.

5. **Grants:**
   ```sql
   revoke all on function public.apply_mission(uuid) from public, anon;
   grant execute on function public.apply_mission(uuid) to authenticated, service_role;
   revoke all on function public.accept_application(uuid) from public, anon, authenticated;
   grant execute on function public.accept_application(uuid) to service_role;
   revoke all on function public.decline_application(uuid, text) from public, anon, authenticated;
   grant execute on function public.decline_application(uuid, text) to service_role;
   ```

## 5. Backend — routes

### 5.1 `server/routes/missions.ts`
- Replace the `/:slug/apply` 409 stub with a real handler mirroring `/:slug/join`: look up the mission id by slug+workspace (404 `not_found` if missing), then `supabase.rpc("apply_mission", { p_mission })`, mapping errors via the existing `rpcError`.
- Extend the `RPC_409` set with `"not_application"` and `"already_applied"`. (`apply_mission` never raises `mission_full` — quota is only touched by the operator accept path, which returns a flat 400.)

### 5.2 `server/routes/admin.ts` (shared-secret + service client, same as today)
- **`GET /admin/applications`** — list `mission_submissions` where `status='applied'`, joined to `creators!inner(display_name)` and `missions!inner(slug, title, points_reward)`, ordered by `created_at asc`. Returns `{ applications: [...] }`.
- **`POST /admin/applications/:id/accept`** — `svc.rpc("accept_application", { p_submission: id })`; RPC error → 400 `rpc_error`; return the row. (No `persistScores` — acceptance awards no points/quality.)
- **`POST /admin/applications/:id/decline`** — body `{ notes?: string }`; `svc.rpc("decline_application", { p_submission: id, p_notes: notes ?? null })`; RPC error → 400; return the row.

## 6. Frontend — creator (mission page)

`src/routes/_app.mission.$missionSlug.tsx` — replace the disabled application stub with real states driven by the caller's submission (`sub = mine.data?.find(...)`):

- `access_type='application'` **and no `sub`** → **`申請任務`** button → `useApplyMission(slug)`.
- `sub.status='applied'` → 「審批中」 status card.
- `sub.status='joined'` (accepted) → the **existing** submit form (no new code — falls through to the current `joined` branch).
- `sub.status='declined'` → 「申請未獲接受」 status card.
- approved/rejected → existing status card.

`src/lib/queries/kocmax.ts`:
- `useApplyMission(slug)` mutation → `POST /missions/${slug}/apply`; on success invalidate `["my-missions"]`, `["mission", slug]`, `["missions"]`.
- `STATUS_LABEL` gains `applied: "審批中"`, `declined: "未獲接受"` (used by both the mission page and the `my_status` list badge, which already surfaces these via `GET /missions`).

The Slice 7 matcher and the Slice 8 hook trigger stay **open-mission-only** this slice (the hook block is already gated `!isApplication`).

## 7. Frontend — operator page

- New **ungated** route `src/routes/operator.tsx` → `/operator` (top-level, *outside* the `_app` creator-login gate, so an operator without a creator session can reach it).
- **Auth:** a small `src/lib/admin.ts` with `adminFetch<T>(path, init)` that reads the secret from `sessionStorage["adfocate_admin_secret"]`, attaches `x-admin-secret`, and targets the same API base as `apiFetch`. On a 401 it throws so the page can re-prompt.
- **Page UX:** if no stored secret → a single password input + 「進入」. Once set → fetch `GET /admin/applications`, render each row (creator `display_name` + mission `title`) with **接受 / 拒絕** buttons calling the accept/decline endpoints, then refetch. Minimal styling — internal tool. A wrong secret (401) clears the stored value and re-shows the input.
- ⚠️ **Security (explicit interim tradeoff):** this stores the shared `ADMIN_SECRET` in the browser, granting cross-workspace operator power to anyone with it. Acceptable as a **single-operator interim tool** — it matches the existing "interim" admin-auth caveat already documented in `admin.ts`. Real per-workspace, role-scoped auth arrives with the Brand Dashboard (Phase 4). The secret is `sessionStorage` (cleared on tab close), not `localStorage`.

## 8. Error-code → HTTP map (additions)

| RPC raise | HTTP | Where |
|---|---|---|
| `not_application` | 409 | apply (mission isn't application-type) |
| `already_applied` | 409 | apply (duplicate) |
| `closed` | 409 | apply (inactive / past deadline) — existing code |
| `not_found` | 404 | apply / accept / decline |
| `mission_full` | 400 (`rpc_error`) | accept (quota reached) — surfaced on admin path |
| `wrong_state` | 400 (`rpc_error`) | accept / decline (row not `applied`) |

(Creator-facing apply uses `rpcError` → 404/409; operator accept/decline use the admin route's flat 400 `rpc_error`, like approve/reject today.)

## 9. Test matrix

**Integration** — `server/test/applications.test.ts` (append to the `test:integration` script list in `package.json`; gated by `RUN_INTEGRATION=1` + `hasSupabaseEnv`):
1. Apply to an application mission → row `status='applied'`.
2. Operator `accept` → `joined`, mission `filled` +1, creator `xp` +10.
3. Accepted creator can `submit` (existing flow) → `submitted`.
4. Apply to an **open** mission → 409 `not_application`.
5. Double-apply → 409 `already_applied`.
6. `accept` when `filled = quota` → operator gets 400 (`mission_full`).
7. Operator `decline` → `declined`.
8. Apply with no bearer → 401 (`workspaceAuth`).

**Component:**
- `src/routes/-_app.mission.$missionSlug.test.tsx` — application mission with no sub shows `申請任務`; clicking calls the apply mutation; `applied`/`declined`/`joined` states render correctly.
- `src/routes/-operator.test.tsx` (dash-prefixed so `tsr generate` ignores it) — secret prompt when unset; with a secret, renders a pending application and 接受 calls `adminFetch` to the accept endpoint.

**No pure-lib unit** this slice — logic lives in RPCs + thin routes (integration-tested), consistent with Slices 4/5.

## 10. Scope boundaries (YAGNI)

- No pitch/note on apply (one-tap).
- No notifications on accept/decline.
- Matcher + hook trigger remain open-mission-only.
- Operator page lists **applications** only (not submissions) — submission review stays on the existing admin API.
- No applicant cap; quota enforced at accept.

## 11. Ops gotchas

- **Migration is manual on prod** (Supabase SQL editor), then `notify pgrst, 'reload schema';` so PostgREST picks up the new RPCs (Slice 6C lesson — deploy *after* applying, or `/apply` 500s on a missing function).
- **New integration test file must be added** to the `test:integration` script in `package.json`, else it only ever SKIPs under `npm test`.
- **`/operator` must NOT be under `_app`** — the `_app` `beforeLoad` gate forces a creator session + onboarding; the operator route lives at the top level (sibling of `index.tsx`).
- New TanStack routes require `npm run type-check` (runs `tsr generate`) to refresh `routeTree.gen.ts`; route test files in `src/routes/` need the `-` prefix.
- `.env.test.local` (local stack) for integration; never source `.env.local` (prod creds). `ADMIN_SECRET=test-admin-secret` is passed inline for the integration run.

## 12. Branching

Branched off `main` @ `1544b1b` (Slice 8 / PR #15 already merged). Slice 8's mission-page hook block sits *after* the action-zone ternary; Slice 9 edits the ternary's application branch — different hunks, no conflict. Finish = push + open PR (user merges).
