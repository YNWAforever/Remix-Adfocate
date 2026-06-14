# Adfocate 2.0 — Slice 4: Mission Writes (Design)

> **Status:** design approved (2026-06-14), spec written. Next: `writing-plans`.
> **Branch:** `feat/slice4-mission-writes` (off `main` @ `9d23fdf`, the merged Slice 3).
> **Roadmap ref:** Slice 4 in [architecture rebaseline §4](./2026-06-13-adfocate-2.0-architecture-supabase-rebaseline.md) · product scope: full spec [`adfocate-2-spec.md`](./adfocate-2-spec.md) §6/§7/§9, Phase 2.

## 1. Goal

Turn the read-only KOCmax portal into a working earn loop: a creator can **join** an open mission, **submit** content, an **operator approves** it, and **points + XP are awarded** with the points balance updating live. This is the first slice that writes mission/points state.

## 2. Where this sits

Slices 1–3 are live and merged: substrate (Supabase + RLS + Hono/Vercel), the KOCmax re-skin, and Onboarding & Auth (WhatsApp-primary). Today a KOC can sign up and browse missions/points/wallet, but **nothing they do changes state**. Slice 4 adds the write path. It stays strictly **additive** on the live foundation — no rebuild, no schema rewrites of existing tables (only a new table + new RPCs + new routes + additive UI).

## 3. Scope

### 3.1 In scope
- New `mission_submissions` table (lean form of the spec's `MissionSubmission`).
- Full lifecycle for **open** missions: `joined → submitted → approved | rejected`.
- Atomic **quota** enforcement on join; `required_level` gate.
- **Points award** on approval (one `point_transactions` row + `point_balances` update) — reuses the `award_welcome_bonus` SECURITY-DEFINER pattern.
- **XP award** on `join (+10) / submit (+25) / approved (+100)` per spec §7.2 (increments `creators.xp` only).
- KOC-facing write API: `POST /missions/:slug/join`, `PUT /missions/:slug/submit`, `GET /missions/my`; `my_status` surfaced on the existing list.
- Operator **admin** API (shared-secret guarded): list pending, approve, reject.
- Frontend: Join + Submit on mission detail; a "My Missions" view; React Query mutations/queries.
- Backend integration tests + frontend component tests.

### 3.2 Explicitly out (deferred, seams left)
| Deferred | Lands in |
|---|---|
| AI content review (`ai_approved`, `ai_review_result`) | Slice 7 (Copilot/Content Review) |
| Brand review queue UI, real reviewer identity | Slice 8 (Brand Dashboard) |
| Gated **application** acceptance (`access_type='application'`) | Slice 8 |
| SLA-cron auto-approve + auto-expiry (`expired`) | Slice 9 / hardening |
| **Cash** payout (`cash_reward`) — stays pending/read-only | Slice 5 (Earnings) |
| CPM view-tracking + settlement (`cpm_*`) | Slice 9 (CPM track) |
| Affiliate conversion tracking | later |
| Level / score / badge recomputation (L0–L6) | Slice 6 (Creator Passport) |
| Quota slot release on reject/expire | YAGNI — not now |

## 4. Design decisions (resolved in brainstorming)

1. **Approval path = operator admin endpoint.** With no AI reviewer (S7) or Brand Dashboard (S8) yet, the `submitted → approved` transition is driven by an operator calling a service-role admin route. The full state machine is built now; AI/brand reviewers later call the *same* `approve_submission` RPC behind their own UIs.
2. **Points + XP, no level recompute.** Award spendable `points_reward` on approval and increment `creators.xp` on join/submit/approve. Level (L0–L6) derivation, scores, badges stay in Slice 6.
3. **Open missions only.** `access_type='open'` is fully handled. `access_type='application'` missions render a disabled "需要申請 · coming soon" CTA and `POST /apply` returns `409 {code:'not_available'}`. Application vetting is a brand-side responsibility (Slice 8).

## 5. Data model

### 5.1 New migration `supabase/migrations/0005_mission_submissions.sql`

```sql
create table public.mission_submissions (
  id uuid primary key default gen_random_uuid(),
  mission_id   uuid not null references public.missions(id) on delete cascade,
  creator_id   uuid not null references public.creators(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  status text not null default 'joined'
    check (status in ('joined','submitted','under_review','approved','rejected','expired')),
  content_urls    text[] not null default '{}',
  submission_data jsonb  not null default '{}',
  reviewer_notes  text,
  xp_awarded      integer not null default 0,   -- cumulative XP this submission has driven
  points_awarded  integer not null default 0,   -- points awarded on approval
  submitted_at    timestamptz,
  reviewed_at     timestamptz,
  review_deadline timestamptz,
  created_at      timestamptz not null default now(),
  unique (mission_id, creator_id)
);

create index mission_submissions_creator_idx  on public.mission_submissions (creator_id);
create index mission_submissions_mission_idx  on public.mission_submissions (mission_id);
create index mission_submissions_status_idx   on public.mission_submissions (workspace_id, status);

alter table public.mission_submissions enable row level security;

-- A creator sees only their own submissions.
create policy submissions_self on public.mission_submissions
  for select using (creator_id = auth.uid());
-- No INSERT/UPDATE policy for authenticated: all writes go through the
-- SECURITY-DEFINER RPCs below (quota + awards must be atomic; xp/points stay
-- service-controlled, exactly as Slice 3's creators_self_update excludes xp).
```

Notes:
- The `under_review` and `expired` statuses exist in the CHECK so later slices (AI pickup, expiry cron) don't need another migration, but **Slice 4 only ever sets `joined/submitted/approved/rejected`**.
- The spec's `ai_review_result`, `cash_awarded`, `cpm_views_tracked`, `cpm_settled` columns are **omitted** — added by their owning slices to avoid dead columns now.

### 5.2 Grants (`0005`, same pattern as `0004`)
```sql
grant select on public.mission_submissions to authenticated;
grant all    on public.mission_submissions to service_role;
```
(`auto_expose_new_tables=false` is already pinned, so a fresh table gets no grants without this — the Slice 3 lesson.)

## 6. Transitions — 4 SECURITY-DEFINER RPCs

All live in `0005`, all `security definer set search_path = public`, mirroring `public.award_welcome_bonus`.

### 6.1 `join_mission(p_mission uuid) returns public.mission_submissions`
- **Caller:** the KOC (`auth.uid()`), via the guarded KOC route.
- **Guards (raise on violation):** mission exists in caller's workspace; `status='active'`; `access_type='open'`; `deadline` is null or `>= current_date`; caller's `level` ordinal `>=` `required_level` ordinal; no existing submission for `(mission, creator)`.
- **Atomic quota:** `update public.missions set filled = filled + 1 where id = p_mission and filled < quota` — if `0` rows updated, raise `'mission full'`. This is the concurrency guard against overfill.
- **Effect:** insert `mission_submissions` row `status='joined'`, `xp_awarded=10`; `update creators set xp = xp + 10`. Return the row.

### 6.2 `submit_mission(p_mission uuid, p_urls text[], p_data jsonb) returns public.mission_submissions`
- **Caller:** the KOC.
- **Guards:** caller's submission for `p_mission` exists and `status='joined'` (else raise); `p_urls` non-empty.
- **Effect:** `status='submitted'`, set `content_urls=p_urls`, `submission_data=p_data`, `submitted_at=now()`, `review_deadline = now() + (mission.review_sla_hours || 48) * interval '1 hour'`, `xp_awarded = xp_awarded + 25`; `update creators set xp = xp + 25`. Return the row.

### 6.3 `approve_submission(p_submission uuid, p_notes text) returns public.mission_submissions`
- **Caller:** operator (service role) via the admin route.
- **Guards:** submission exists; `status in ('submitted','under_review')` — **idempotent**: if already `approved`, return the row unchanged without re-awarding (status guard prevents double-award).
- **Effect (atomic):** read `mission.points_reward`; insert `point_transactions` (`type='earn'`, `delta=points_reward`, `balance_after = new balance`, `source_ref = 'mission_submission:'||p_submission`, `description = mission.title`); `update point_balances set balance = balance + points_reward, updated_at = now()`; set submission `status='approved'`, `reviewed_at=now()`, `reviewer_notes=p_notes`, `points_awarded=mission.points_reward`, `xp_awarded = xp_awarded + 100`; `update creators set xp = xp + 100`. Raise if the creator's `point_balances` row is missing (same defensive check added to `award_welcome_bonus` in Slice 3).

### 6.4 `reject_submission(p_submission uuid, p_notes text) returns public.mission_submissions`
- **Caller:** operator (service role).
- **Guards:** `status in ('submitted','under_review')`.
- **Effect:** `status='rejected'`, `reviewed_at=now()`, `reviewer_notes=p_notes`. No award. Quota slot stays consumed.

> `required_level` ordinal map: `L0<L1<L2<L3<L4<L5<L6`. Because levels are not recomputed until Slice 6, every creator is `L0`, so **only `required_level='L0'` missions are joinable in practice** — higher-level missions remain honestly gated until Slice 6.

## 7. API

### 7.1 KOC group (`server/routes/missions.ts`, guarded, base `/api/missions`)
Order matters in Hono — register `/my` **before** `/:slug`.

| Method/path | Effect |
|---|---|
| `GET /` (existing) | now also returns `my_status` per mission (caller's submission status, or null). Implemented by fetching the caller's submissions once and mapping. |
| `GET /:slug` (existing) | unchanged. |
| `GET /my` | caller's submissions joined to their missions, grouped/filterable by `?status=`. |
| `POST /:slug/join` | resolve slug→id in caller's workspace; `rpc('join_mission')`; map RPC raises to `409 {code}` (`mission_full`, `already_joined`, `not_open`, `closed`, `level_locked`). |
| `PUT /:slug/submit` | body `{ content_urls: string[], submission_data?: object }`; `rpc('submit_mission')`; `409` on wrong state / empty urls. |
| `POST /:slug/apply` | stub → `409 {code:'not_available'}` (gated deferred to S8). |

### 7.2 Admin group (`server/routes/admin.ts`, base `/api/admin`, new)
Middleware checks header `x-admin-secret === env.ADMIN_SECRET` (interim operator auth; replaced by real admin-auth / Brand Dashboard later). Uses the **service** client.

| Method/path | Effect |
|---|---|
| `GET /submissions?status=submitted` | list pending submissions (id, mission title, creator display_name, submitted_at, content_urls) for the review queue. |
| `POST /submissions/:id/approve` | body `{ notes?: string }`; `rpc('approve_submission')`. |
| `POST /submissions/:id/reject` | body `{ notes?: string }`; `rpc('reject_submission')`. |

Register both groups in `server/app.ts` (KOC group already mounted; add `app.route('/api/admin', adminRoutes)`).

## 8. Frontend

- **`src/lib/queries/kocmax.ts`:** add `useMyMissions()` (query `GET /missions/my`), `useJoinMission()` and `useSubmitMission()` (mutations → on success invalidate `['me']`, `['missions']`, `['wallet']`). Points balance is already realtime (`point_balances` in `supabase_realtime`), so approval reflects live without a manual refetch.
- **Mission detail (`src/routes/kocmax.$slug.mission.$missionSlug.tsx`):** if `access_type='open'` and not yet joined → **加入任務** CTA (calls join); if joined → show status badge + a **submit form** (one-or-more content URL inputs) wired to submit; if `access_type='application'` → disabled **需要申請 · 即將推出** CTA. Show awarded points once approved.
- **My Missions:** a view backed by `useMyMissions`, grouped by status (進行中 / 審批中 / 已通過 / 未通過). Reachable from the existing mission list/nav (follow current navigation patterns; no new nav framework).
- i18n stays hardcoded zh-Hant-HK (consistent with prior slices — no i18n framework exists in this app).

## 9. Error handling

- RPC violations `raise exception` with stable messages; route handlers map them to `409` (or `404` for unknown slug/submission) with a typed `{error, code}` body — same convention as existing routes. No swallowed errors.
- Admin routes return `401 {code:'no_admin'}` when the secret header is absent/wrong.
- Awards are **idempotent**: the status guard in `approve_submission` ensures points/XP are granted exactly once even if the admin endpoint is called twice.

## 10. Testing

### 10.1 Backend integration (`server/test/`, runs in the existing CI `integration` job)
Seeds a mission in `DEMO_WS` via the service client. Cases:
- **join:** ok (row created, `filled` incremented, +10 XP); quota-full (`filled=quota` → 409); duplicate join (409); non-open mission (409); closed/past-deadline mission (409).
- **submit:** ok (status→submitted, +25 XP, `review_deadline` set); wrong state (submit before join → 409); empty urls (409).
- **approve:** awards `points_reward` + 100 XP **exactly once**; second approve call is a no-op (balance unchanged) — idempotency assertion.
- **reject:** status→rejected, no award.
- **`GET /my`:** returns the caller's submissions with status; respects `?status=` filter.
- **admin guard:** approve/reject without the secret header → 401.

Extend `server/test/helpers.ts` with a `makeMission(opts)` seeder. Add a `mission_submissions` cleanup pass keyed off the test workspace.

### 10.2 Frontend component tests (mirror existing `-kocmax.*.test.tsx`)
- Mission detail: open mission shows Join → after join, submit form appears.
- Submit: filling a URL and submitting flips the status badge to 審批中.
- Application mission: CTA is disabled and labelled coming-soon.

## 11. User-gated / operational follow-ups
- Set an `ADMIN_SECRET` env var in Vercel + the CI integration job (a test value for CI). Without it, admin endpoints stay closed.
- Operator approves submissions by calling `POST /api/admin/submissions/:id/approve` with the secret header (curl / a tiny internal tool) until the Brand Dashboard (S8) provides a UI.

## 12. Risks
- **Double-award under concurrency:** mitigated by the atomic quota `update … where filled<quota` and the status-guarded award (a row can only leave `submitted` once).
- **Operator-secret leakage:** interim mechanism; keep the secret out of the client bundle (server-only env), rotate on the Brand Dashboard cutover.
- **Honest dead-ends:** application missions and >L0 missions are visibly gated. Acceptable and intentional for this slice; copy makes it clear they're upcoming.
