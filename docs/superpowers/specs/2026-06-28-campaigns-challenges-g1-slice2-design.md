# Campaigns & Challenges (G1) — Slice 2 ("Finish Campaigns") — Design

**Date:** 2026-06-28
**Slice:** G1 Slice 2 (follows Slice 1 = PR #50 merged, Slice 1b = PR #51 brand self-serve, open)
**Branch:** `feat/campaigns-g1-s2` (off `origin/main` @ `a4e7bc1`, the #50 merge)
**Migration:** `0026_campaigns_s2.sql`
**Source spec (Slice 1):** [`2026-06-28-campaigns-challenges-g1-design.md`](2026-06-28-campaigns-challenges-g1-design.md)

## 1. Summary

Slice 1 shipped a working campaigns loop (operator + creator) but left it **manual and
passive**: an operator must remember to close every campaign at its deadline, creators only
discover campaigns by visiting the list page, and the live leaderboard has no sense of
motion. Slice 2 finishes the feature by making it **automated and engaging**, with **zero
changes to the exactly-once payout core**:

- **A — Cron auto-close.** A daily job transitions past-deadline `active` campaigns to
  `closed`. **Settlement stays a manual human gate** (no auto-settle), so cash payout still
  requires an operator/brand action.
- **B — `campaign_started` matched broadcast.** On publish, fan out an in-app notification to
  the creators who actually fit the campaign (category + level matched), reusing the existing
  Mission Matcher logic. This is the system's **first one-event-to-many-recipients
  notification** (N1 explicitly deferred broadcasts).
- **C — Leaderboard rank-movement.** Daily snapshots of each campaign's ranking let the
  leaderboard render `↑N / ↓N / NEW` movement since the last snapshot.

Everything is additive. `approve_submission`, the approval trigger
(`campaign_progress_on_approval`), `grant_campaign_completion_bonus`, and `settle_campaign`
are **not modified**.

## 2. Scope (locked in brainstorming)

| Decision | Choice |
|---|---|
| Items in this slice | Auto-close + `campaign_started` broadcast + rank-movement |
| Multi-metric goals | **Deferred** to a later slice (touches the payout core) |
| Broadcast audience | **Category/level-matched creators only** (reuse Mission Matcher fit logic) |
| Broadcast mechanism | **App-layer** fan-out (matcher is TS; cannot live in a trigger without duplication) |
| Cron strategy | **Fold into the existing daily cron** — stay at 2 crons (Hobby cap) |
| Settlement | **Stays manual** (auto-close ≠ auto-settle) |

### Two judgment-call defaults (flag during spec review if you disagree)

1. **Cron path is renamed** `/api/cron/publish-scheduled` → `/api/cron/daily` (honest naming
   for a multi-task daily pass). Alternative: keep the `publish-scheduled` path and just
   extend its handler.
2. **The matched-broadcast predicate excludes creators who have set no niches** (their
   `categoryTerm` is the 0.5 neutral value, never a `1` match). Alternative: include
   no-niche creators as a relaxed match.

### Out of scope (unchanged)

Multi-metric / per-tier goals, `campaign_started` for un-matched creators, external push
(WhatsApp/email), Supabase Realtime, snapshot pruning/retention, rank-movement on the
creator's own `my_progress` block (leaderboard rows only).

## 3. Migration `0026_campaigns_s2.sql` (additive)

All objects `security definer set search_path = public`, executable by `service_role` only,
mirroring the Slice-1 RPC grant idiom.

### 3.1 `campaign_rank_snapshots`

```sql
create table if not exists public.campaign_rank_snapshots (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.campaigns(id) on delete cascade,
  workspace_id uuid not null,
  creator_id   uuid not null,
  rank         int  not null,
  approved     int  not null,
  captured_at  timestamptz not null default now()
);
create index if not exists campaign_rank_snapshots_campaign_captured_idx
  on public.campaign_rank_snapshots (campaign_id, captured_at desc);

alter table public.campaign_rank_snapshots enable row level security;
-- service_role only: the leaderboard route reads via serviceClient; no authenticated grants.
grant all on public.campaign_rank_snapshots to service_role;
```

### 3.2 `close_due_campaigns() → int`

Closes every past-deadline `active` campaign in one statement; returns the count. Idempotent
(a re-run finds none). Never settles.

```sql
create or replace function public.close_due_campaigns()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update public.campaigns
     set status = 'closed', closed_at = now(), updated_at = now()
   where status = 'active' and ends_at <= now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;
```

### 3.3 `snapshot_campaign_leaderboards() → int`

Captures a single timestamped batch of `rank_campaign()` rows for every `active` campaign;
returns the number of snapshot rows written.

```sql
create or replace function public.snapshot_campaign_leaderboards()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  insert into public.campaign_rank_snapshots (campaign_id, workspace_id, creator_id, rank, approved, captured_at)
  select c.id, c.workspace_id, r.creator_id, r.rank, r.approved, now()
    from public.campaigns c
    cross join lateral public.rank_campaign(c.id) r
   where c.status = 'active';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
```

### 3.4 `broadcast_campaign_started(p_campaign uuid, p_creator_ids uuid[])`

The privileged, **idempotent** insert. Matching is decided in TS (§5); this RPC only writes
one `campaign_started` notification per id, skipping any creator who already has one for this
campaign (`not exists`). Best-effort by construction (caller wraps it; nothing here rolls back
a publish).

```sql
create or replace function public.broadcast_campaign_started(p_campaign uuid, p_creator_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare v_ws uuid; v_title text; v_slug text; v_n int;
begin
  select workspace_id, title, slug into v_ws, v_title, v_slug
    from public.campaigns where id = p_campaign;
  if v_ws is null then return 0; end if;

  insert into public.notifications (user_id, workspace_id, type, entity_type, entity_id, data)
  select cid, v_ws, 'campaign_started', 'campaign', p_campaign,
         jsonb_build_object('campaign_title', coalesce(v_title,''), 'campaign_slug', coalesce(v_slug,''))
    from unnest(p_creator_ids) as cid
   where not exists (
     select 1 from public.notifications n
      where n.user_id = cid and n.type = 'campaign_started' and n.entity_id = p_campaign);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
```

### 3.5 Extend the `notifications` type CHECK

Add `'campaign_started'` to the existing 8-value list (→ 9). **Prod note:** verify the live
constraint name first (`select conname from pg_constraint where
conrelid='public.notifications'::regclass and contype='c';`) — house migration-tracker drift.

```sql
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'submission_approved','submission_rejected','redemption_ready',
    'level_up','application_accepted','application_declined',
    'campaign_goal_reached','campaign_prize_awarded','campaign_started'));
```

All four functions get the standard `revoke all … from public/anon/authenticated; grant
execute … to service_role;` trailer.

## 4. Feature A — daily cron (auto-close + snapshot)

The existing daily cron handler is generalized into one **daily maintenance pass** that runs
three isolated RPCs; each is wrapped so one failure cannot block the others, and the response
aggregates their results.

- **Route** `server/routes/cron.ts`: rename `GET /publish-scheduled` → `GET /daily`. Same
  `CRON_SECRET` bearer-auth guard. Body (in order):
  1. `content_publish_scheduled` — existing behavior, unchanged.
  2. `snapshot_campaign_leaderboards()` — captured **before** closing, so final pre-close
     ranks are recorded.
  3. `close_due_campaigns()`.
  Returns `{ published, snapshotted, campaignsClosed }`; per-task errors logged and surfaced
  as a `null`/error field for that task without failing the whole pass.
- **`vercel.json`**: change the daily entry `path` to `/api/cron/daily` (schedule unchanged
  `0 0 * * *`). `social-refresh` (weekly) untouched → **exactly 2 crons** (Hobby cap
  respected; see the prod-deploy-frozen incident).
- **Test**: rename/extend `server/test/cron-publish-scheduled.test.ts` → covers auth, the
  three-RPC orchestration, and per-task isolation (one RPC erroring still returns 200 with the
  others' results).

## 5. Feature B — `campaign_started` matched broadcast (app-layer)

### 5.1 Pure match predicate (reuses the matcher; unit-tested)

New export in `server/lib/missionMatch.ts`:

```ts
// A creator qualifies if SOME campaign mission is both unlocked for them and a niche match.
export function creatorQualifiesForCampaign(creator: MatchCreator, missions: MatchMission[]): boolean {
  return missions.some((m) => levelFitTerm(creator, m) === 1 && categoryTerm(creator, m) === 1);
}
```

`categoryTerm` returns `1` only when `creator.categories` includes the mission's category, so
**no-niche creators (0.5) do not match** — judgment-call default #2.

### 5.2 I/O helper + wiring (best-effort)

`server/lib/notifyCampaignStarted.ts` — `notifyCampaignStarted(svc, campaignId)`:
1. Load the campaign's **active** missions (`category, required_level`, …) via
   `campaign_missions … removed_at is null`.
2. Load **active** creators in the campaign's workspace (`id, level, categories`).
3. `matchedIds = creators.filter(c => creatorQualifiesForCampaign(toMatchCreator(c), missions)).map(id)`.
4. `await svc.rpc('broadcast_campaign_started', { p_campaign, p_creator_ids: matchedIds })`.
- Always uses a **`serviceClient`** internally (notifications insert is service-only; reading
  all workspace creators is privileged). The whole helper is wrapped in try/catch and called
  **after** the publish update succeeds in both handlers, so a broadcast failure **never**
  changes the publish response.
- **Call sites:** `server/routes/adminCampaigns.ts` `POST /campaigns/:id/publish` and
  `server/routes/brandCampaigns.ts` `POST /:id/publish`, after the `status:'active'` update
  returns ok.

### 5.3 Render-at-read

- `src/lib/notifications.ts`: add `campaign_started` to `NotificationType`, a `renderNotification`
  case → `{ title, body, href: '/campaigns/' + data.campaign_slug, icon }`, `data =
  { campaign_title, campaign_slug }`. Missing fields degrade gracefully.
- `src/lib/i18n.dict.ts`: `app.notif.campaign_started.{title,body}` (zh-HK + en).
- `src/lib/notifications.test.ts`: render case (interpolation + href + fallback).

## 6. Feature C — leaderboard rank-movement

- **Capture:** §3.3 RPC, daily (§4).
- **Read** (`server/routes/campaigns.ts` `GET /:slug/leaderboard`): after the live
  `rank_campaign` rows, fetch the latest snapshot batch for the campaign — one
  `select captured_at … order by captured_at desc limit 1`, then one
  `select creator_id, rank where captured_at = <that>` — and build a `prevRank` map.
- **Shape** (`server/lib/campaignLeaderboard.ts`): `shapeLeaderboard(rows, profiles,
  prevRanks?)` gains `movement: number | null` per entry = `prevRank − currentRank`
  (`+` up, `−` down, `null` = NEW / no prior snapshot). Optional 3rd arg keeps existing
  callers/tests valid; new cases added.
- **UI:** the leaderboard row component renders `↑N` (up, accent), `↓N` (down, muted), `—`
  (no change), `NEW` (first snapshot), with bilingual `aria-label`s. Pure-shaper; no
  payout-core touch.

## 7. Invariants & testing

**Invariants**
- Auto-close is idempotent and only touches `active && ends_at <= now()`; never settles.
- Broadcast is idempotent (`not exists`); fires once per publish (state machine is monotonic
  `draft → active`).
- Snapshots are append-only; the leaderboard read is unaffected when no snapshot exists yet.
- Payout RPCs and the approval trigger are byte-unchanged.

**Unit**
- `creatorQualifiesForCampaign`: match / niche-miss / no-niche / level-locked.
- `shapeLeaderboard` movement: up / down / unchanged / NEW / missing prevRanks (back-compat).
- `renderNotification('campaign_started', …)`: title/body interpolation, href, fallback.

**Integration** (local Supabase stack; added to the explicit `test:integration` list)
- `close_due_campaigns`: closes only past-deadline `active` (not future-deadline, not draft,
  not already-closed); idempotent on re-run; does not settle.
- `snapshot_campaign_leaderboards`: writes ranked rows for `active` campaigns only; row count
  matches `rank_campaign`.
- `broadcast_campaign_started`: inserts for the passed ids once; second call is a no-op.
- Publish → matched creator receives a `campaign_started` notification; a non-matched
  (wrong niche / under-level) creator does **not**.

**House rules**
- `.js` extensions on relative imports in new `server/**` files (`npm run check:esm`).
- `npm run type-check` after touching routes (TanStack route-tree codegen).
- New integration test files added to the explicit `test:integration` list in `package.json`.

## 8. File manifest

**New (server):** `supabase/migrations/0026_campaigns_s2.sql`,
`server/lib/notifyCampaignStarted.ts`, `server/lib/notifyCampaignStarted.test.ts` (or fold
the pure predicate test into `missionMatch.test.ts`), `server/test/campaigns-s2.test.ts`.
**Modified (server):** `server/routes/cron.ts` (rename + 3-RPC pass),
`server/lib/missionMatch.ts` (`creatorQualifiesForCampaign`),
`server/lib/campaignLeaderboard.ts` (+ test) (`movement`),
`server/routes/campaigns.ts` (leaderboard prevRank join),
`server/routes/adminCampaigns.ts` + `server/routes/brandCampaigns.ts` (publish → broadcast),
`server/app.ts` if cron mount path text references change, `package.json` (test list).
**New/Modified (client):** `src/lib/notifications.ts` (+ `.test.ts`),
`src/lib/i18n.dict.ts`, the campaign leaderboard UI component (movement rendering),
leaderboard response types in `src/lib/queries/kocmax.ts`.
**Config:** `vercel.json` (daily cron path).

## 9. Sequencing, deployment & dependencies

- **Independent of #51 (Slice 1b).** S2 touches cron / notifications / snapshots; 1b touches
  brand routes/UI. Built off `origin/main` (#50). The only shared edit is the **publish**
  handler — `adminCampaigns.ts` (on main) gets the broadcast call now; `brandCampaigns.ts`
  arrives with #51, so its broadcast call lands cleanly whether #51 merges before or after S2
  (no conflict — different files).
- **Prod apply (after merge):** apply `0026` to prod (`mhkoayftiuojxlrkollf`) via **raw SQL /
  Supabase MCP `execute_sql`** (tracker drift — a `db push` would conflict), **after verifying
  the live `notifications_type_check` constraint name**, then `notify pgrst, 'reload schema'`.
  Ship the `vercel.json` cron-path change in the same deploy. **No new env vars.**
- **Never** `vercel --prod` from local (mis-bundles the API) — deploy via Git.
