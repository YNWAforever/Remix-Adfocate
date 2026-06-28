# Campaigns & Challenges (G1) — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship time-boxed Campaigns & Challenges (operator authoring + creator loop): group a mission set, pay every goal-reacher a points+XP completion bonus, rank participants on a live leaderboard, and pay top-N cash prizes at manual settlement — all as an exactly-once payout ledger that never touches `approve_submission`.

**Architecture:** One additive migration (`0025_campaigns.sql`) on top of a vendored budget prerequisite (`0024_brand_budget.sql`). Three tables (`campaigns`, `campaign_missions`, `campaign_participants`), one shared ranker (`rank_campaign`), three SECURITY-DEFINER RPCs (`grant_campaign_completion_bonus`, `close_campaign`, `settle_campaign`), and an `AFTER UPDATE OF status` trigger on `mission_submissions` that auto-enrolls + increments + fires the bonus on goal-crossing. Money lands in the existing append-only ledgers; partial-unique indexes on `source_ref` make double-payout impossible. Two pure libs (`campaignAuthoring`, `campaignLeaderboard`), an operator route (`adminCampaigns.ts`), a creator read route (`campaigns.ts`), and the TanStack/React-Query UI.

**Tech Stack:** Supabase/Postgres (plpgsql RPCs + RLS), Hono server routes, TanStack Router file-routes + React Query, Vitest (pure unit + integration against the local stack), bilingual i18n (zh-HK default / en).

**Source spec:** [`docs/superpowers/specs/2026-06-28-campaigns-challenges-g1-design.md`](../specs/2026-06-28-campaigns-challenges-g1-design.md). Section references below (§1–§13) point at it.

---

## Critical context (read before Task 1)

- **Branch:** `feat/campaigns-g1` (already created off `main`; the design spec is committed at `b55b62b`).
- **Foundation gap (resolved):** `main` HEAD is the **#46 merge only**. The brand payout foundation (`workspace_budgets`, `workspace_budget_transactions`, `credit_workspace_budget`, the budget-aware `approve_submission`) lives in **`0024_brand_budget.sql` on the unmerged `feat/brand-portal-slice3` branch** and in **prod** (applied via raw SQL), but **not** in `main`/this branch/the local test stack. **Decision: vendor `0024_brand_budget.sql` byte-identical into this branch** as a committed prerequisite (Task 1). It is idempotent (`create table if not exists` / `create or replace`), so it is a no-op on prod and gives the local stack + integration tests the budget tables.
- **House rules (CI-guarded / hard-won):**
  - New `server/**` files MUST use `.js` extensions on relative imports (`npm run check:esm` guards this).
  - Add new integration test files to the explicit `test:integration` list in `package.json` (they do **not** auto-discover).
  - Run `npm run type-check` after adding TanStack routes (it runs the route-tree codegen, which bare `tsc` does not).
  - Never `vercel --prod` from local (mis-bundles the API). Deploy via Git.
  - `.env.local` holds **prod** creds — never source it. Integration tests run against the **local** Supabase stack with `.env.test.local` exported into the shell first (otherwise every integration test SKIPs).
- **Prod application (do at the very end, after merge — NOT during implementation):** the migration **tracker is out of sync** (records only through `0022`, yet `0018–0024` are live). A `db push` would replay `0018–0024` and conflict. Apply `0025` to prod via **raw SQL** (Supabase MCP) against `mhkoayftiuojxlrkollf`, **after verifying the live `notifications.type` constraint name first**, then issue a PostgREST schema reload. `0024_brand_budget.sql` is already in prod → do **not** re-run it there. Document both as "applied via raw SQL — not in tracker, do not re-apply."

## Column/identifier reference (verified against the codebase — use these exact names)

- `point_transactions (creator_id, workspace_id, type, delta, balance_after, source_ref, description)` — `type='bonus'`, `delta int`, `balance_after int`.
- `earnings_transactions (creator_id, workspace_id, type, amount, balance_after, source_ref, description)` — `type in ('earn','adjust')`, `amount numeric`.
- `workspace_budget_transactions (workspace_id, type, delta, balance_after, source_ref, description)` — `type in ('topup','debit','adjust')`, `delta numeric` (negative for debit).
- `point_balances (creator_id, workspace_id, balance int)` — conflict target `(creator_id, workspace_id)`.
- `earnings_balances (creator_id, workspace_id, available numeric)` — `approve_submission` credits `available`.
- `workspace_budgets (workspace_id unique, balance numeric, enforced boolean)`.
- `notifications (user_id, workspace_id, type, entity_type, entity_id, data jsonb)`.
- `creators (id, workspace_id /* HOME workspace */, xp)`.
- `mission_submissions (id, creator_id, workspace_id, mission_id, status, submitted_at, reviewed_at, quality_rating)`.
- `'campaign_bonus:'` and `'campaign_prize:'` are **both exactly 15 chars** → `left(source_ref,15)` partial-index predicate.

## File structure (created / modified)

**Migrations**
- Create: `supabase/migrations/0024_brand_budget.sql` (vendored byte-identical from `feat/brand-portal-slice3`).
- Create: `supabase/migrations/0025_campaigns.sql` (this feature).

**Server libs (pure, unit-tested)**
- Create: `server/lib/campaignAuthoring.ts` — validation, edit-lock matrix, prize-tier validation, attach-overlap guard, shared `campaignBonusRef`/`campaignPrizeRef` builders, column sets.
- Create: `server/lib/campaignAuthoring.test.ts`.
- Create: `server/lib/campaignLeaderboard.ts` — thin shaper over `rank_campaign` rows (+ numeric coercion, my-standing helper).
- Create: `server/lib/campaignLeaderboard.test.ts`.

**Server routes**
- Create: `server/routes/adminCampaigns.ts` — operator authoring + close/settle (serviceClient).
- Create: `server/routes/campaigns.ts` — creator reads (list / detail+my-progress / leaderboard).
- Modify: `server/routes/admin.ts` — mount `adminCampaignRoutes`.
- Modify: `server/app.ts` — mount `campaignRoutes` under the guarded creator router.

**Server tests**
- Create: `server/test/campaigns.test.ts` — integration (engines + RLS).
- Modify: `package.json` — add the new integration file to `test:integration`.

**Client**
- Modify: `src/lib/queries/kocmax.ts` — `useCampaigns` / `useCampaign` / `useCampaignLeaderboard`.
- Modify: `src/lib/admin.ts` — `adminKeys.campaigns*` + fetchers/mutations + admin types.
- Modify: `src/lib/notifications.ts` — two new types (icons, params, hrefs).
- Modify: `src/lib/notifications.test.ts` — render cases for the two types.
- Modify: `src/lib/i18n.dict.ts` — notif + nav + page keys (en **and** zh).
- Modify: `src/components/navItems.ts` — creator nav entry.
- Modify: `src/components/admin/adminNavItems.ts` — operator nav entry.
- Create: `src/routes/_app.campaigns.tsx` (Outlet) / `_app.campaigns.index.tsx` / `_app.campaigns.$slug.tsx`.
- Create: `src/routes/admin.campaigns.index.tsx` / `admin.campaigns.new.tsx` / `admin.campaigns.$id.tsx`.
- Create: `src/routes/-_app.campaigns.test.tsx` / `src/routes/-admin.campaigns.test.tsx`.

**Out of scope for this plan:** Slice 1b (brand self-serve `/brand/campaigns`, `brandOwnsCampaign` gate) — separate fast-follow plan, no migration. Cron auto-close, `campaign_started` broadcast, multi-metric goals.

---

## Phase A — Prerequisite + migration foundation

### Task 1: Vendor the `0024_brand_budget.sql` prerequisite and reset the local stack

**Files:**
- Create: `supabase/migrations/0024_brand_budget.sql` (copied from `feat/brand-portal-slice3`)

- [ ] **Step 1: Copy the budget migration byte-identical from the slice3 branch**

```bash
cd "/Users/willylai/Documents/Claude/Projects/New Adfocate/adfocate-2"
git show feat/brand-portal-slice3:supabase/migrations/0024_brand_budget.sql \
  > supabase/migrations/0024_brand_budget.sql
```

- [ ] **Step 2: Sanity-check the file is the budget foundation (not truncated)**

Run: `grep -c "workspace_budgets\|credit_workspace_budget\|approve_submission" supabase/migrations/0024_brand_budget.sql`
Expected: a count ≥ 5 (it defines `workspace_budgets`, `workspace_budget_transactions`, `credit_workspace_budget`, `set_workspace_budget_enforcement`, and redefines `approve_submission` with the budget hard-cap). Confirm the file ends with a closing `$$;` and `grant execute ... to service_role;` for the RPCs — it must not be cut off mid-function.

- [ ] **Step 3: Reset the local Supabase stack so it now includes 0024**

Run: `supabase db reset` (replays `0001 … 0024` into the local stack).
Expected: completes without error; the new `0024_brand_budget.sql` applies after `0023_brand_access.sql`.

- [ ] **Step 4: Verify the budget tables + RPC exist locally**

Run:
```bash
supabase db reset >/dev/null 2>&1; \
psql "$(supabase status -o json | python3 -c 'import json,sys;print(json.load(sys.stdin)["DB_URL"])')" \
  -c "\dt public.workspace_budget*" \
  -c "\df public.credit_workspace_budget"
```
(If your stack exposes the DB URL differently, use whatever connection string `.env.test.local` already points at.)
Expected: `workspace_budgets` and `workspace_budget_transactions` tables listed; `credit_workspace_budget` function listed.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0024_brand_budget.sql
git commit -m "feat(campaigns): vendor 0024_brand_budget.sql prerequisite for cash settlement

Byte-identical from feat/brand-portal-slice3; idempotent (no-op on prod which
already has it via raw SQL). Unblocks the local stack + integration tests for
0025 campaign settlement.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Migration `0025` — tables, constraints, indexes

**Files:**
- Create: `supabase/migrations/0025_campaigns.sql`

Implements §1 / §9 steps 1–4. We build the whole migration file across Tasks 2–9, then apply + smoke-test it in Task 10. Each task **appends** to the same file in the documented order.

- [ ] **Step 1: Write the header + missions composite-unique guard + the three tables**

Create `supabase/migrations/0025_campaigns.sql` with:

```sql
-- 0025_campaigns.sql
-- Campaigns & Challenges (G1) Slice 1: time-boxed challenges over a mission set, with a
-- points+XP completion bonus (live) and top-N cash prizes (manual settle). Additive payout
-- ledger — does NOT modify approve_submission. See
-- docs/superpowers/specs/2026-06-28-campaigns-challenges-g1-design.md.

-- 1. missions needs a composite unique so campaign_missions can carry a workspace-equality FK.
--    (No-op given id is already PK; guarded so re-apply is safe.)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'missions_ws_id_uniq') then
    alter table public.missions add constraint missions_ws_id_uniq unique (workspace_id, id);
  end if;
end $$;

-- 2. campaigns — config + 4-state machine (draft -> active -> closed -> settled).
create table if not exists public.campaigns (
  id                      uuid primary key default gen_random_uuid(),
  workspace_id            uuid not null references public.workspaces(id) on delete cascade,
  slug                    text not null,
  title                   text not null,
  description             text,
  status                  text not null default 'draft'
                            check (status in ('draft','active','closed','settled')),
  starts_at               timestamptz not null,
  ends_at                 timestamptz not null check (ends_at > starts_at),
  goal_metric             text not null default 'approved_submissions'
                            check (goal_metric in ('approved_submissions')),
  goal_target             int not null check (goal_target >= 1),
  completion_bonus_points int not null default 0 check (completion_bonus_points >= 0),
  completion_bonus_xp     int not null default 0 check (completion_bonus_xp >= 0),
  prize_tiers             jsonb not null default '[]'::jsonb,
  published_at            timestamptz,
  closed_at               timestamptz,
  settled_at              timestamptz,
  created_by              uuid,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (workspace_id, slug),
  unique (workspace_id, id)
);
create index if not exists campaigns_ws_status_idx on public.campaigns (workspace_id, status);
create index if not exists campaigns_window_idx     on public.campaigns (status, starts_at, ends_at);

-- 3. campaign_missions — explicit set; two composite FKs make workspace equality a DB invariant.
create table if not exists public.campaign_missions (
  campaign_id  uuid not null,
  mission_id   uuid not null,
  workspace_id uuid not null,
  added_at     timestamptz not null default now(),
  removed_at   timestamptz,
  primary key (campaign_id, mission_id),
  foreign key (workspace_id, campaign_id) references public.campaigns (workspace_id, id) on delete cascade,
  foreign key (workspace_id, mission_id) references public.missions   (workspace_id, id) on delete cascade
);
-- One active campaign per mission (locked decision #7): exactly one campaign's goal advances
-- per approved submission. The authoring overlap guard is belt; this index is suspenders.
create unique index if not exists campaign_missions_one_active_uniq
  on public.campaign_missions (mission_id) where removed_at is null;
create index if not exists campaign_missions_campaign_idx
  on public.campaign_missions (campaign_id) where removed_at is null;

-- 4. campaign_participants — auto-enroll roster + per-creator idempotency ledger.
create table if not exists public.campaign_participants (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null,
  creator_id        uuid not null references public.creators(id) on delete cascade,
  workspace_id      uuid not null,
  approved_count    int not null default 0 check (approved_count >= 0),
  goal_reached_at   timestamptz,   -- set-once when count first crosses goal_target (bonus key)
  bonus_granted_at  timestamptz,   -- set after the bonus ledger writes commit
  prize_rank        int,           -- written at settlement
  prize_granted_at  timestamptz,   -- per-winner idempotency guard
  first_approved_at timestamptz,
  last_approved_at  timestamptz,
  foreign key (workspace_id, campaign_id) references public.campaigns (workspace_id, id) on delete cascade,
  unique (campaign_id, creator_id)
);
create index if not exists campaign_participants_campaign_idx on public.campaign_participants (campaign_id);
```

- [ ] **Step 2: Verify the file parses against the local stack (apply just this slice)**

Run:
```bash
psql "$(grep -E '^DATABASE_URL|^DB_URL' .env.test.local | head -1 | cut -d= -f2-)" \
  -f supabase/migrations/0025_campaigns.sql
```
(Or paste the file into `supabase db reset` once Task 10 assembles it. For now this confirms the DDL is syntactically valid and the composite FKs resolve.)
Expected: `CREATE TABLE` / `CREATE INDEX` succeed; no error about a missing `missions (workspace_id, id)` unique (the `do $$` block added it).

- [ ] **Step 3: Commit (work-in-progress migration)**

```bash
git add supabase/migrations/0025_campaigns.sql
git commit -m "feat(campaigns): 0025 tables — campaigns, campaign_missions, campaign_participants

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Migration `0025` — RLS policies + grants (§8 / §9 step 5)

**Files:**
- Modify: `supabase/migrations/0025_campaigns.sql` (append)

Brand policies copy the `0023_brand_access.sql` idiom **verbatim** — including the `and active` durable-revocation guard. `campaign_participants` adds creator-self-read and is **never** writable by `authenticated` (all writes are SECURITY-DEFINER trigger/RPC).

- [ ] **Step 1: Append the RLS + grant block**

```sql
-- 5. RLS ---------------------------------------------------------------------------------------
alter table public.campaigns           enable row level security;
alter table public.campaign_missions   enable row level security;
alter table public.campaign_participants enable row level security;

-- campaigns: brand CRUD scoped by membership (additive; harmless without brand routes).
create policy campaigns_brand_select on public.campaigns for select to authenticated
  using (workspace_id in (select workspace_id from public.brand_users where user_id = auth.uid() and active));
create policy campaigns_brand_insert on public.campaigns for insert to authenticated
  with check (workspace_id in (select workspace_id from public.brand_users where user_id = auth.uid() and active));
create policy campaigns_brand_update on public.campaigns for update to authenticated
  using (workspace_id in (select workspace_id from public.brand_users where user_id = auth.uid() and active))
  with check (workspace_id in (select workspace_id from public.brand_users where user_id = auth.uid() and active));
create policy campaigns_brand_delete on public.campaigns for delete to authenticated
  using (workspace_id in (select workspace_id from public.brand_users bu where bu.user_id = auth.uid() and bu.active and bu.role = 'owner'));

-- campaign_missions: same idiom.
create policy campaign_missions_brand_select on public.campaign_missions for select to authenticated
  using (workspace_id in (select workspace_id from public.brand_users where user_id = auth.uid() and active));
create policy campaign_missions_brand_insert on public.campaign_missions for insert to authenticated
  with check (workspace_id in (select workspace_id from public.brand_users where user_id = auth.uid() and active));
create policy campaign_missions_brand_update on public.campaign_missions for update to authenticated
  using (workspace_id in (select workspace_id from public.brand_users where user_id = auth.uid() and active))
  with check (workspace_id in (select workspace_id from public.brand_users where user_id = auth.uid() and active));
create policy campaign_missions_brand_delete on public.campaign_missions for delete to authenticated
  using (workspace_id in (select workspace_id from public.brand_users bu where bu.user_id = auth.uid() and bu.active and bu.role = 'owner'));

-- campaign_participants: brand SELECT + creator self-read only. NO writes to authenticated.
create policy campaign_participants_brand_select on public.campaign_participants for select to authenticated
  using (workspace_id in (select workspace_id from public.brand_users where user_id = auth.uid() and active));
create policy campaign_participants_self_read on public.campaign_participants for select to authenticated
  using (creator_id = auth.uid());

grant select, insert, update, delete on public.campaigns         to authenticated;
grant select, insert, update, delete on public.campaign_missions to authenticated;
grant select                          on public.campaign_participants to authenticated;
grant all on public.campaigns            to service_role;
grant all on public.campaign_missions    to service_role;
grant all on public.campaign_participants to service_role;
```

- [ ] **Step 2: Re-apply the file to the local stack; confirm no policy/grant error**

Run: `psql "$LOCAL_DB_URL" -f supabase/migrations/0025_campaigns.sql` (idempotent re-run; `enable row level security` and `create policy` are not `if not exists`, so on a re-run drop the schema first via `supabase db reset` once Task 10 assembles everything — for an isolated check, run against a fresh `supabase db reset` then apply through Task 3's appended block).
Expected: policies and grants created without error.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0025_campaigns.sql
git commit -m "feat(campaigns): 0025 RLS + grants (brand CRUD idiom + creator self-read)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Migration `0025` — idempotency partial-unique indexes (§1 / §9 step 6)

**Files:**
- Modify: `supabase/migrations/0025_campaigns.sql` (append)

These four indexes make double-payout impossible at the DB layer. `'campaign_bonus:'` and `'campaign_prize:'` are both exactly 15 chars; `left(source_ref,15)='…'` (not `LIKE`) avoids underscore-escape ambiguity.

- [ ] **Step 1: Append the idempotency indexes**

```sql
-- 6. Idempotency backbone: per-(campaign,creator) source_ref uniqueness on the existing ledgers.
create unique index if not exists pt_campaign_bonus_uniq  on public.point_transactions
  (source_ref) where left(source_ref, 15) = 'campaign_bonus:';
create unique index if not exists pt_campaign_prize_uniq  on public.point_transactions
  (source_ref) where left(source_ref, 15) = 'campaign_prize:';
create unique index if not exists et_campaign_prize_uniq  on public.earnings_transactions
  (source_ref) where left(source_ref, 15) = 'campaign_prize:';
create unique index if not exists wbt_campaign_prize_uniq on public.workspace_budget_transactions
  (source_ref) where left(source_ref, 15) = 'campaign_prize:';
```

- [ ] **Step 2: Verify the predicate length matches the literal (guard against drift)**

Run: `node -e "for (const s of ['campaign_bonus:','campaign_prize:']) console.log(s, s.length)"`
Expected: both print `15`. (This same invariant is asserted in `campaignBonusRef`/`campaignPrizeRef` in Task 11 and in the integration test.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0025_campaigns.sql
git commit -m "feat(campaigns): 0025 idempotency partial-unique indexes (campaign_bonus/prize)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Migration `0025` — `rank_campaign()` shared ranker (§5 / §6 / §9 step 7)

**Files:**
- Modify: `supabase/migrations/0025_campaigns.sql` (append)

**One** function is the single source of truth for the leaderboard the creator sees **and** the ranks `settle_campaign` pays — no SQL-vs-TS / collation drift. A row counts iff `status='approved'` **and** `submitted_at ∈ [starts_at, ends_at)` (window, §2) **and** the mission was attached **at approval time** (`added_at <= reviewed_at AND (removed_at is null OR reviewed_at < removed_at)`, §6 — note the deliberate `reviewed_at` here vs `submitted_at` for the window). `avg_quality` averages rated rows only (0 if none). Tiebreak: `approved desc → avg_quality desc → goal_reached_at asc nulls last → creator_id asc` (raw uuid, no `::text`/locale collation). The `LEFT JOIN campaign_participants` sources `goal_reached_at` (not derivable from the submissions aggregate).

- [ ] **Step 1: Append `rank_campaign`**

```sql
-- 7. rank_campaign — single source of truth for leaderboard AND settlement ranks.
create or replace function public.rank_campaign(p_campaign uuid)
returns table (creator_id uuid, rank int, approved bigint, avg_quality numeric)
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (
    select id, workspace_id, starts_at, ends_at
      from public.campaigns where id = p_campaign
  ),
  counted as (
    select s.creator_id,
           count(*) as approved,
           coalesce(avg(s.quality_rating) filter (where s.quality_rating is not null), 0) as avg_quality
      from public.mission_submissions s
      join cfg on s.workspace_id = cfg.workspace_id
      join public.campaign_missions cm
        on cm.campaign_id = cfg.id
       and cm.mission_id  = s.mission_id
       and cm.added_at   <= s.reviewed_at
       and (cm.removed_at is null or s.reviewed_at < cm.removed_at)
     where s.status = 'approved'
       and s.submitted_at >= cfg.starts_at
       and s.submitted_at <  cfg.ends_at
     group by s.creator_id
  )
  select c.creator_id,
         row_number() over (
           order by c.approved desc,
                    c.avg_quality desc,
                    p.goal_reached_at asc nulls last,
                    c.creator_id asc
         )::int as rank,
         c.approved,
         c.avg_quality
    from counted c
    left join public.campaign_participants p
      on p.campaign_id = p_campaign and p.creator_id = c.creator_id;
$$;
revoke all on function public.rank_campaign(uuid) from public;
revoke all on function public.rank_campaign(uuid) from anon;
revoke all on function public.rank_campaign(uuid) from authenticated;
grant execute on function public.rank_campaign(uuid) to service_role;
```

- [ ] **Step 2: Verify it parses and returns an empty set for a fresh campaign**

This is exercised end-to-end by the Task 14 integration test. For now confirm it compiles: after `supabase db reset` through this point, `select * from public.rank_campaign(gen_random_uuid());` returns 0 rows with no error.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0025_campaigns.sql
git commit -m "feat(campaigns): 0025 rank_campaign — shared leaderboard/settle ranker

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Migration `0025` — `grant_campaign_completion_bonus()` (§3 / §9 step 8)

**Files:**
- Modify: `supabase/migrations/0025_campaigns.sql` (append)

Points + XP only (never cash → never budget-blocked). **Critical:** points credit the creator's **HOME** workspace (`creators.workspace_id`), **not** the campaign workspace. Ordering matters: insert the **ledger row first** (catching `unique_violation` as the dedupe) **before** mutating `point_balances`, so the DB backstop can never leave a balance double-credited. The bonus XP bump lets the `0008` level trigger fire `notify_on_level_up` for free. Only the notification insert is best-effort; the ledger writes are **not** swallowed (a real failure rolls back the approval — money is all-or-nothing).

- [ ] **Step 1: Append the bonus RPC**

```sql
-- 8a. grant_campaign_completion_bonus — points+XP to the creator's HOME workspace, exactly once.
create or replace function public.grant_campaign_completion_bonus(p_campaign uuid, p_creator uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_part   public.campaign_participants;
  v_ws     uuid;
  v_points int;
  v_xp     int;
  v_status text;
  v_title  text;
  v_slug   text;
  v_home   uuid;
  v_bal    int;
begin
  select * into v_part from public.campaign_participants
    where campaign_id = p_campaign and creator_id = p_creator for update;
  if v_part.id is null then return; end if;
  if v_part.bonus_granted_at is not null then return; end if;            -- primary idempotency guard

  select workspace_id, completion_bonus_points, completion_bonus_xp, status, title, slug
    into v_ws, v_points, v_xp, v_status, v_title, v_slug
    from public.campaigns where id = p_campaign for share;
  if v_status = 'settled' then return; end if;
  if v_part.workspace_id <> v_ws then raise exception 'workspace_mismatch'; end if;

  -- Resolve the creator's HOME workspace (where balances live) — NOT the campaign workspace.
  select workspace_id into v_home from public.creators where id = p_creator;
  if v_home is null then raise exception 'creator % not found', p_creator; end if;

  if coalesce(v_points, 0) > 0 then
    insert into public.point_balances (creator_id, workspace_id, balance)
      values (p_creator, v_home, 0) on conflict (creator_id, workspace_id) do nothing;
    select balance into v_bal from public.point_balances
      where creator_id = p_creator and workspace_id = v_home for update;
    -- Ledger insert FIRST: a duplicate (already paid) aborts here, before we touch the balance.
    begin
      insert into public.point_transactions
        (creator_id, workspace_id, type, delta, balance_after, source_ref, description)
        values (p_creator, v_home, 'bonus', v_points, v_bal + v_points,
                'campaign_bonus:' || p_campaign || ':' || p_creator, '挑戰完成獎賞');
    exception when unique_violation then
      return;   -- DB backstop; primary guard is bonus_granted_at under for update
    end;
    update public.point_balances set balance = balance + v_points, updated_at = now()
      where creator_id = p_creator and workspace_id = v_home;
  end if;

  if coalesce(v_xp, 0) > 0 then
    update public.creators set xp = xp + v_xp where id = p_creator;     -- 0008 trigger recomputes level
  end if;

  update public.campaign_participants set bonus_granted_at = now() where id = v_part.id;

  -- Notification is best-effort ONLY — never roll back the bonus.
  begin
    insert into public.notifications (user_id, workspace_id, type, entity_type, entity_id, data)
      values (p_creator, v_ws, 'campaign_goal_reached', 'campaign', p_campaign,
              jsonb_build_object('campaign_title', coalesce(v_title, ''),
                                 'campaign_slug',  coalesce(v_slug, ''),
                                 'points', coalesce(v_points, 0),
                                 'xp',     coalesce(v_xp, 0)));
  exception when others then
    raise warning 'campaign_goal_reached notification failed for campaign % creator %', p_campaign, p_creator;
  end;
end;
$$;
revoke all on function public.grant_campaign_completion_bonus(uuid, uuid) from public;
revoke all on function public.grant_campaign_completion_bonus(uuid, uuid) from anon;
revoke all on function public.grant_campaign_completion_bonus(uuid, uuid) from authenticated;
grant execute on function public.grant_campaign_completion_bonus(uuid, uuid) to service_role;
```

- [ ] **Step 2: Confirm it compiles** (exercised behaviorally by Task 13).

After a `supabase db reset` through this point, the function appears in `\df public.grant_campaign_completion_bonus`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0025_campaigns.sql
git commit -m "feat(campaigns): 0025 grant_campaign_completion_bonus (home-ws credit, ledger-first)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Migration `0025` — `close_campaign()` + `settle_campaign()` (§4 / §9 step 8)

**Files:**
- Modify: `supabase/migrations/0025_campaigns.sql` (append)

`close` stops counting and opens the review grace window. `settle` re-validates `prize_tiers` in-RPC (never trusts the app), ranks via the shared `rank_campaign`, and pays each tier. **Cash debits the CAMPAIGN workspace budget** (hard-cap, verbatim from `approve_submission`) but **credits the creator's HOME workspace earnings** — two different workspaces. Each winner is paid inside a per-winner `begin … exception when unique_violation then null` savepoint (a stray duplicate skips that winner). `insufficient_budget` is **not** caught → it propagates and rolls back the **entire** settlement (no partial payout); top-up + re-call then pays only unpaid winners (gated by `prize_granted_at` + the prize unique indexes).

- [ ] **Step 1: Append `close_campaign`**

```sql
-- 8b. close_campaign — active -> closed. Stops counting; opens the grace window.
create or replace function public.close_campaign(p_campaign uuid)
returns public.campaigns
language plpgsql security definer set search_path = public
as $$
declare v_c public.campaigns;
begin
  select * into v_c from public.campaigns where id = p_campaign for update;
  if v_c.id is null then raise exception 'not_found'; end if;
  if v_c.status <> 'active' then raise exception 'wrong_state'; end if;
  update public.campaigns set status = 'closed', closed_at = now(), updated_at = now()
    where id = p_campaign returning * into v_c;
  return v_c;
end;
$$;
revoke all on function public.close_campaign(uuid) from public;
revoke all on function public.close_campaign(uuid) from anon;
revoke all on function public.close_campaign(uuid) from authenticated;
grant execute on function public.close_campaign(uuid) to service_role;
```

- [ ] **Step 2: Append `settle_campaign`**

```sql
-- 8c. settle_campaign — closed -> settled. Re-validates tiers, ranks, pays top-N. Idempotent.
create or replace function public.settle_campaign(p_campaign uuid)
returns public.campaigns
language plpgsql security definer set search_path = public
as $$
declare
  v_c        public.campaigns;
  v_tier     jsonb;
  v_prev_to  int := 0;
  v_row      record;
  v_home     uuid;
  v_pbal     int;
  v_ebal     numeric;
  v_bgt_bal  numeric;
  v_bgt_enf  boolean;
  v_cash     numeric;
  v_points   int;
  v_xp       int;
  v_ref      text;
begin
  select * into v_c from public.campaigns where id = p_campaign for update;
  if v_c.id is null then raise exception 'not_found'; end if;
  if v_c.settled_at is not null then return v_c; end if;        -- idempotent: already settled
  if v_c.status <> 'closed' then raise exception 'wrong_state'; end if;

  -- Re-validate prize_tiers in-RPC: ascending, non-overlapping, non-negative.
  for v_tier in select * from jsonb_array_elements(v_c.prize_tiers) loop
    if (v_tier->>'rank_from')::int < 1
       or (v_tier->>'rank_to')::int < (v_tier->>'rank_from')::int
       or (v_tier->>'rank_from')::int <= v_prev_to
       or coalesce((v_tier->>'cash')::numeric, 0)  < 0
       or coalesce((v_tier->>'points')::int, 0)    < 0
       or coalesce((v_tier->>'xp')::int, 0)        < 0
    then raise exception 'invalid_prize_tiers'; end if;
    v_prev_to := (v_tier->>'rank_to')::int;
  end loop;

  -- Rank via the shared ranker; stamp prize_rank (defensively upserting any missing row).
  for v_row in select * from public.rank_campaign(p_campaign) loop
    insert into public.campaign_participants (campaign_id, creator_id, workspace_id, approved_count)
      values (p_campaign, v_row.creator_id, v_c.workspace_id, v_row.approved)
      on conflict (campaign_id, creator_id) do nothing;
    update public.campaign_participants set prize_rank = v_row.rank
      where campaign_id = p_campaign and creator_id = v_row.creator_id;
  end loop;

  -- Pay each tier. A creator wins at most one rank → one campaign_prize: ref per (campaign,creator).
  for v_tier in select * from jsonb_array_elements(v_c.prize_tiers) loop
    v_cash   := coalesce((v_tier->>'cash')::numeric, 0);
    v_points := coalesce((v_tier->>'points')::int, 0);
    v_xp     := coalesce((v_tier->>'xp')::int, 0);
    for v_row in
      select cp.id as part_id, cp.creator_id, cp.prize_rank
        from public.campaign_participants cp
       where cp.campaign_id = p_campaign
         and cp.prize_rank between (v_tier->>'rank_from')::int and (v_tier->>'rank_to')::int
         and cp.prize_granted_at is null
    loop
      v_ref := 'campaign_prize:' || p_campaign || ':' || v_row.creator_id;
      begin   -- per-winner savepoint
        select workspace_id into v_home from public.creators where id = v_row.creator_id;

        -- CASH: debit the CAMPAIGN workspace budget (hard cap); credit the HOME workspace earnings.
        if v_cash > 0 then
          select balance, enforced into v_bgt_bal, v_bgt_enf
            from public.workspace_budgets where workspace_id = v_c.workspace_id for update;
          if coalesce(v_bgt_enf, false) and coalesce(v_bgt_bal, 0) < v_cash then
            raise exception 'insufficient_budget';   -- NOT caught here → rolls back the whole settle
          end if;
          if v_bgt_bal is not null then
            update public.workspace_budgets set balance = balance - v_cash, updated_at = now()
              where workspace_id = v_c.workspace_id returning balance into v_bgt_bal;
            insert into public.workspace_budget_transactions
              (workspace_id, type, delta, balance_after, source_ref, description)
              values (v_c.workspace_id, 'debit', -v_cash, v_bgt_bal, v_ref, v_c.title);
          end if;
          insert into public.earnings_balances (creator_id, workspace_id, available)
            values (v_row.creator_id, v_home, 0) on conflict (creator_id, workspace_id) do nothing;
          select available into v_ebal from public.earnings_balances
            where creator_id = v_row.creator_id and workspace_id = v_home for update;
          insert into public.earnings_transactions
            (creator_id, workspace_id, type, amount, balance_after, source_ref, description)
            values (v_row.creator_id, v_home, 'earn', v_cash, v_ebal + v_cash, v_ref, v_c.title);
          update public.earnings_balances set available = available + v_cash, updated_at = now()
            where creator_id = v_row.creator_id and workspace_id = v_home;
        end if;

        -- POINTS: HOME workspace.
        if v_points > 0 then
          insert into public.point_balances (creator_id, workspace_id, balance)
            values (v_row.creator_id, v_home, 0) on conflict (creator_id, workspace_id) do nothing;
          select balance into v_pbal from public.point_balances
            where creator_id = v_row.creator_id and workspace_id = v_home for update;
          insert into public.point_transactions
            (creator_id, workspace_id, type, delta, balance_after, source_ref, description)
            values (v_row.creator_id, v_home, 'bonus', v_points, v_pbal + v_points, v_ref, v_c.title);
          update public.point_balances set balance = balance + v_points, updated_at = now()
            where creator_id = v_row.creator_id and workspace_id = v_home;
        end if;

        -- XP.
        if v_xp > 0 then
          update public.creators set xp = xp + v_xp where id = v_row.creator_id;
        end if;

        update public.campaign_participants set prize_granted_at = now() where id = v_row.part_id;

        begin   -- best-effort notification
          insert into public.notifications (user_id, workspace_id, type, entity_type, entity_id, data)
            values (v_row.creator_id, v_c.workspace_id, 'campaign_prize_awarded', 'campaign', p_campaign,
                    jsonb_build_object('campaign_title', coalesce(v_c.title, ''),
                                       'campaign_slug',  coalesce(v_c.slug, ''),
                                       'rank',   v_row.prize_rank,
                                       'cash',   v_cash,
                                       'points', v_points,
                                       'xp',     v_xp));
        exception when others then
          raise warning 'campaign_prize_awarded notification failed for campaign % creator %', p_campaign, v_row.creator_id;
        end;

      exception
        when unique_violation then null;   -- already paid → skip this winner (DB backstop)
      end;
    end loop;
  end loop;

  update public.campaigns set status = 'settled', settled_at = now(), updated_at = now()
    where id = p_campaign returning * into v_c;
  return v_c;
end;
$$;
revoke all on function public.settle_campaign(uuid) from public;
revoke all on function public.settle_campaign(uuid) from anon;
revoke all on function public.settle_campaign(uuid) from authenticated;
grant execute on function public.settle_campaign(uuid) to service_role;
```

> **Note on the savepoint + `insufficient_budget`:** the per-winner `begin … exception` block only catches `unique_violation`. `insufficient_budget` (a `raise exception`, SQLSTATE `P0001`) is therefore **not** caught — it aborts the whole function, and because the RPC is one transaction, every winner paid earlier in this call is rolled back too. That is the intended "no partial payout" semantics.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0025_campaigns.sql
git commit -m "feat(campaigns): 0025 close_campaign + settle_campaign (budget-cap, exactly-once)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Migration `0025` — `campaign_progress_on_approval` trigger (§3 / §9 step 9)

**Files:**
- Modify: `supabase/migrations/0025_campaigns.sql` (append)

`AFTER UPDATE OF status ON mission_submissions`, atomic with the approval (fires for **both** operator and brand approval paths). Increment-only (no decrement — `approved` is terminal). The trigger NAME must sort **before** the notification trigger so the bonus's XP bump fires `notify_on_level_up` before the submission notification. `campaign_progress_on_approval` ('c') sorts before the `0022` notification trigger name ('n'…). **Verify** with Step 2 before trusting the ordering.

- [ ] **Step 1: Append the trigger function + trigger**

```sql
-- 9. Trigger: advance the (unique) live campaign on a submission becoming approved.
create or replace function public.campaign_progress_on_approval()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_c    record;
  v_part public.campaign_participants;
begin
  -- Only the transition into 'approved' (monotonic; approved is terminal).
  if not (old.status is distinct from 'approved' and new.status = 'approved') then
    return new;
  end if;

  -- The single live campaign whose ACTIVE set contains this mission (one-active-per-mission).
  select c.id, c.workspace_id, c.starts_at, c.ends_at, c.goal_target
    into v_c
    from public.campaign_missions cm
    join public.campaigns c on c.id = cm.campaign_id and c.workspace_id = cm.workspace_id
   where cm.mission_id = new.mission_id
     and cm.removed_at is null
     and c.status <> 'settled'
   for share of c;                              -- fences against close_campaign's for update
  if v_c.id is null then return new; end if;

  -- Window eligibility keys on submitted_at (delivered-in-window), not reviewed_at/now().
  if not (new.submitted_at >= v_c.starts_at and new.submitted_at < v_c.ends_at) then
    return new;
  end if;

  -- Auto-enroll, then lock the participant row and count from the LOCKED row (never a recount).
  insert into public.campaign_participants (campaign_id, creator_id, workspace_id, approved_count)
    values (v_c.id, new.creator_id, v_c.workspace_id, 0)
    on conflict (campaign_id, creator_id) do nothing;
  select * into v_part from public.campaign_participants
    where campaign_id = v_c.id and creator_id = new.creator_id for update;

  update public.campaign_participants
     set approved_count    = approved_count + 1,
         last_approved_at   = now(),
         first_approved_at  = coalesce(first_approved_at, now())
   where id = v_part.id
   returning * into v_part;

  if v_part.approved_count >= v_c.goal_target and v_part.goal_reached_at is null then
    update public.campaign_participants set goal_reached_at = now() where id = v_part.id;
    perform public.grant_campaign_completion_bonus(v_c.id, new.creator_id);
  end if;

  return new;
end;
$$;

create trigger campaign_progress_on_approval
  after update of status on public.mission_submissions
  for each row execute function public.campaign_progress_on_approval();
```

- [ ] **Step 2: Verify trigger firing order (bonus before notification)**

Run (after a `supabase db reset` through this point):
```bash
psql "$LOCAL_DB_URL" -c \
"select tgname from pg_trigger where tgrelid='public.mission_submissions'::regclass and not tgisinternal order by tgname;"
```
Expected: `campaign_progress_on_approval` appears **before** the `0022` notification trigger in the alphabetical list. If the notification trigger's name happens to sort before `campaign_…`, rename this trigger with an earlier-sorting prefix (e.g. `a_campaign_progress_on_approval`) and re-verify.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0025_campaigns.sql
git commit -m "feat(campaigns): 0025 campaign_progress_on_approval trigger (auto-enroll + bonus)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Migration `0025` — extend the `notifications.type` CHECK (§7 / §9 step 10)

**Files:**
- Modify: `supabase/migrations/0025_campaigns.sql` (append)

The two new types ship in the **same** migration as the RPCs that emit them — otherwise the wrapped inserts fail silently. Locally the constraint is `notifications_type_check` (PG's default name for the inline `check` in `0022`). **In prod the name may differ** (raw-SQL drift) — the prod-apply step (Task 22 / final) verifies the live name first.

- [ ] **Step 1: Append the CHECK extension**

```sql
-- 10. Extend notifications.type to admit the two campaign notification literals.
--     NOTE (prod): verify the live constraint name first:
--       select conname from pg_constraint
--        where conrelid='public.notifications'::regclass and contype='c';
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'submission_approved','submission_rejected','redemption_ready',
    'level_up','application_accepted','application_declined',
    'campaign_goal_reached','campaign_prize_awarded'));
```

- [ ] **Step 2: Verify the constraint admits the new literals**

Run (after reset through this point):
```bash
psql "$LOCAL_DB_URL" -c \
"select 'campaign_goal_reached'::text = any (enum_range_check) from (select 1) t;" 2>/dev/null; \
psql "$LOCAL_DB_URL" -c \
"insert into public.notifications (user_id, workspace_id, type, entity_type, entity_id, data) \
 values (gen_random_uuid(), gen_random_uuid(), 'campaign_goal_reached', 'campaign', gen_random_uuid(), '{}'::jsonb) returning id;"
```
Expected: the insert succeeds (then `rollback`/delete it — or rely on `supabase db reset`). Before this migration the same insert would fail the CHECK.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0025_campaigns.sql
git commit -m "feat(campaigns): 0025 extend notifications.type CHECK (campaign_goal_reached/prize_awarded)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Apply the full `0025` to the local stack + schema smoke test

**Files:** none (verification only)

- [ ] **Step 1: Full reset replays 0001…0025 cleanly**

Run: `supabase db reset`
Expected: completes with no error; `0024_brand_budget.sql` then `0025_campaigns.sql` apply last.

- [ ] **Step 2: Smoke-test every new object exists**

Run:
```bash
psql "$LOCAL_DB_URL" \
  -c "\dt public.campaign*" \
  -c "\df public.rank_campaign" \
  -c "\df public.grant_campaign_completion_bonus" \
  -c "\df public.close_campaign" \
  -c "\df public.settle_campaign" \
  -c "select indexname from pg_indexes where indexname in ('pt_campaign_bonus_uniq','pt_campaign_prize_uniq','et_campaign_prize_uniq','wbt_campaign_prize_uniq');"
```
Expected: 3 `campaign*` tables, all 4 functions, all 4 idempotency indexes listed.

- [ ] **Step 3: No commit** (nothing changed). Migration phase complete.

---

## Phase B — Pure libs (TDD)

### Task 11: `campaignAuthoring.ts` — validation, edit-locks, prize-tiers, ref builders

**Files:**
- Create: `server/lib/campaignAuthoring.ts`
- Test: `server/lib/campaignAuthoring.test.ts`

Mirrors `missionAuthoring.ts`: pure (no DB, no I/O, no `new Date()` — "today" injected). Also home to the **shared `source_ref` builders** used by every paying RPC's test and by the route, asserting the 15-char prefix matches the index predicate.

- [ ] **Step 1: Write the failing test**

Create `server/lib/campaignAuthoring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  validateCampaign, validateEdit, validatePrizeTiers, canAttachMission,
  campaignBonusRef, campaignPrizeRef,
  type CampaignInput, type CampaignRecord, type PrizeTier,
} from "./campaignAuthoring.js";

const base: CampaignInput = {
  workspace_id: "ws1", slug: "test-c", title: "六月挑戰", description: "",
  starts_at: "2026-06-01T00:00:00Z", ends_at: "2026-06-30T00:00:00Z",
  goal_target: 3, completion_bonus_points: 200, completion_bonus_xp: 50, prize_tiers: [],
};
const tiers = (xs: Partial<PrizeTier>[]): PrizeTier[] =>
  xs.map((x) => ({ rank_from: 1, rank_to: 1, cash: 0, points: 0, xp: 0, ...x }));

describe("validatePrizeTiers", () => {
  it("accepts ascending non-overlapping ranges", () => {
    expect(validatePrizeTiers(tiers([{ rank_from: 1, rank_to: 1, cash: 500 }, { rank_from: 2, rank_to: 3, cash: 200 }])).ok).toBe(true);
  });
  it("rejects overlap", () => {
    expect(validatePrizeTiers(tiers([{ rank_from: 1, rank_to: 3 }, { rank_from: 3, rank_to: 4 }])).ok).toBe(false);
  });
  it("rejects rank_from < 1 and negative reward", () => {
    expect(validatePrizeTiers(tiers([{ rank_from: 0, rank_to: 1 }])).ok).toBe(false);
    expect(validatePrizeTiers(tiers([{ rank_from: 1, rank_to: 1, cash: -5 }])).ok).toBe(false);
  });
});

describe("validateCampaign", () => {
  it("draft requires workspace/slug/title only", () => {
    expect(validateCampaign({ ...base, starts_at: "", ends_at: "" }, "draft").ok).toBe(true);
    expect(validateCampaign({ ...base, slug: "" }, "draft").ok).toBe(false);
  });
  it("publish requires window, goal, a reward, valid tiers", () => {
    expect(validateCampaign(base, "publish").ok).toBe(true);
    expect(validateCampaign({ ...base, ends_at: base.starts_at }, "publish").ok).toBe(false); // ends<=starts
    expect(validateCampaign({ ...base, goal_target: 0 }, "publish").ok).toBe(false);
    expect(validateCampaign({ ...base, completion_bonus_points: 0, completion_bonus_xp: 0, prize_tiers: [] }, "publish").ok).toBe(false); // no reward
    expect(validateCampaign({ ...base, prize_tiers: tiers([{ rank_from: 2, rank_to: 1 }]) }, "publish").ok).toBe(false);
  });
});

describe("validateEdit", () => {
  const draft: CampaignRecord = { ...base, id: "c1", status: "draft", published_at: null, closed_at: null, settled_at: null };
  const active: CampaignRecord = { ...draft, status: "active", published_at: "2026-06-01T00:00:00Z" };
  it("draft: everything editable", () => {
    expect(validateEdit(draft, { ...base, slug: "test-new", goal_target: 9 }, false).ok).toBe(true);
  });
  it("active: slug + goal + bonus + tiers locked", () => {
    expect(validateEdit(active, { ...base, slug: "test-new" }, false).ok).toBe(false);
    expect(validateEdit(active, { ...base, goal_target: 9 }, false).ok).toBe(false);
    expect(validateEdit(active, { ...base, completion_bonus_points: 999 }, false).ok).toBe(false);
  });
  it("active: ends_at may extend but not shrink", () => {
    expect(validateEdit(active, { ...base, ends_at: "2026-07-15T00:00:00Z" }, false).ok).toBe(true);
    expect(validateEdit(active, { ...base, ends_at: "2026-06-10T00:00:00Z" }, false).ok).toBe(false);
  });
  it("active: title/description always editable", () => {
    expect(validateEdit(active, { ...base, title: "新名", description: "x" }, true).ok).toBe(true);
  });
});

describe("canAttachMission", () => {
  it("rejects a mission already attached to an active campaign", () => {
    expect(canAttachMission(new Set(["m1"]), "m1").ok).toBe(false);
    expect(canAttachMission(new Set(["m1"]), "m2").ok).toBe(true);
  });
});

describe("source_ref builders", () => {
  it("build per-(campaign,creator) refs with the 15-char prefix", () => {
    expect(campaignBonusRef("c1", "cr1")).toBe("campaign_bonus:c1:cr1");
    expect(campaignPrizeRef("c1", "cr1")).toBe("campaign_prize:c1:cr1");
    expect("campaign_bonus:".length).toBe(15);
    expect("campaign_prize:".length).toBe(15);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/lib/campaignAuthoring.test.ts`
Expected: FAIL — `Cannot find module './campaignAuthoring.js'`.

- [ ] **Step 3: Write the implementation**

Create `server/lib/campaignAuthoring.ts`:

```ts
// Pure campaign authoring rules — no DB, no I/O, no `new Date()` ("today" injected by the route).
// Mirrors missionAuthoring.ts. Also home to the shared payout source_ref builders.

export type PrizeTier = { rank_from: number; rank_to: number; cash: number; points: number; xp: number };

export type CampaignInput = {
  workspace_id: string;
  slug: string;
  title: string;
  description?: string | null;
  starts_at: string;
  ends_at: string;
  goal_target: number;
  completion_bonus_points: number;
  completion_bonus_xp: number;
  prize_tiers: PrizeTier[];
};

export type CampaignRecord = CampaignInput & {
  id: string;
  status: "draft" | "active" | "closed" | "settled";
  published_at: string | null;
  closed_at: string | null;
  settled_at: string | null;
};

export type ValidationResult = { ok: boolean; errors: Record<string, string> };

// Columns the operator route copies from the request body on create/edit.
export const CAMPAIGN_EDITABLE_COLS: (keyof CampaignInput)[] = [
  "slug", "title", "description", "starts_at", "ends_at",
  "goal_target", "completion_bonus_points", "completion_bonus_xp", "prize_tiers",
];

const BONUS_PREFIX = "campaign_bonus:";
const PRIZE_PREFIX = "campaign_prize:";
// Invariant: both prefixes are exactly 15 chars to match the left(source_ref,15) index predicate.
if (BONUS_PREFIX.length !== 15 || PRIZE_PREFIX.length !== 15) {
  throw new Error("campaign source_ref prefix must be 15 chars (matches the partial-index predicate)");
}
export function campaignBonusRef(campaignId: string, creatorId: string): string {
  return `${BONUS_PREFIX}${campaignId}:${creatorId}`;
}
export function campaignPrizeRef(campaignId: string, creatorId: string): string {
  return `${PRIZE_PREFIX}${campaignId}:${creatorId}`;
}

function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
function num(v: unknown): number {
  return typeof v === "number" && !Number.isNaN(v) ? v : 0;
}

export function validatePrizeTiers(tiers: PrizeTier[]): { ok: boolean; error?: string } {
  if (!Array.isArray(tiers)) return { ok: false, error: "prize_tiers must be an array" };
  let prevTo = 0;
  for (const t of tiers) {
    if (!Number.isInteger(t.rank_from) || !Number.isInteger(t.rank_to)) {
      return { ok: false, error: "rank_from/rank_to must be integers" };
    }
    if (t.rank_from < 1) return { ok: false, error: "rank_from must be >= 1" };
    if (t.rank_to < t.rank_from) return { ok: false, error: "rank_to must be >= rank_from" };
    if (t.rank_from <= prevTo) return { ok: false, error: "tiers must be ascending and non-overlapping" };
    if (num(t.cash) < 0 || num(t.points) < 0 || num(t.xp) < 0) {
      return { ok: false, error: "cash/points/xp must be >= 0" };
    }
    prevTo = t.rank_to;
  }
  return { ok: true };
}

export function validateCampaign(
  input: CampaignInput,
  mode: "draft" | "publish",
  _today?: string,
): ValidationResult {
  const errors: Record<string, string> = {};
  if (!nonEmpty(input.workspace_id)) errors.workspace_id = "必填";
  if (!nonEmpty(input.slug)) errors.slug = "必填";
  if (!nonEmpty(input.title)) errors.title = "必填";

  if (mode === "publish") {
    if (!nonEmpty(input.starts_at)) errors.starts_at = "必填";
    if (!nonEmpty(input.ends_at)) errors.ends_at = "必填";
    if (nonEmpty(input.starts_at) && nonEmpty(input.ends_at) && !(input.ends_at > input.starts_at)) {
      errors.ends_at = "結束時間必須晚於開始時間";
    }
    if (!(Number.isInteger(input.goal_target) && input.goal_target >= 1)) {
      errors.goal_target = "目標必須 >= 1";
    }
    const hasReward = num(input.completion_bonus_points) > 0 || num(input.completion_bonus_xp) > 0 || (input.prize_tiers?.length ?? 0) > 0;
    if (!hasReward) errors.reward = "至少需要完成獎勵或名次獎品";
    const tiers = validatePrizeTiers(input.prize_tiers ?? []);
    if (!tiers.ok) errors.prize_tiers = tiers.error ?? "獎品階級無效";
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

export function validateEdit(
  existing: CampaignRecord,
  patch: CampaignInput,
  hasEngagement: boolean,
): ValidationResult {
  const errors: Record<string, string> = {};
  const published = existing.status !== "draft";
  const locked = published || hasEngagement; // config frozen once live or once anyone has joined

  if (published && patch.slug !== existing.slug) errors.slug = "發佈後不可更改 slug";
  if (locked) {
    if (patch.goal_target !== existing.goal_target) errors.goal_target = "已開始，不可更改目標";
    if (patch.completion_bonus_points !== existing.completion_bonus_points) errors.completion_bonus_points = "已開始，不可更改獎勵";
    if (patch.completion_bonus_xp !== existing.completion_bonus_xp) errors.completion_bonus_xp = "已開始，不可更改獎勵";
    if (JSON.stringify(patch.prize_tiers ?? []) !== JSON.stringify(existing.prize_tiers ?? [])) errors.prize_tiers = "已開始，不可更改獎品";
    if (patch.starts_at !== existing.starts_at) errors.starts_at = "已開始，不可更改開始時間";
    // ends_at may only extend.
    if (patch.ends_at < existing.ends_at) errors.ends_at = "只可延長，不可縮短";
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

// Overlap guard backing the DB's one-active-campaign-per-mission index.
export function canAttachMission(activeMissionIds: Set<string>, missionId: string): { ok: boolean; error?: string } {
  if (activeMissionIds.has(missionId)) return { ok: false, error: "此任務已連結到另一個進行中的挑戰" };
  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run server/lib/campaignAuthoring.test.ts`
Expected: PASS (all suites green).

- [ ] **Step 5: Commit**

```bash
git add server/lib/campaignAuthoring.ts server/lib/campaignAuthoring.test.ts
git commit -m "feat(campaigns): pure campaignAuthoring lib (validation, edit-locks, source_ref builders)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: `campaignLeaderboard.ts` — pure shaper over `rank_campaign` rows

**Files:**
- Create: `server/lib/campaignLeaderboard.ts`
- Test: `server/lib/campaignLeaderboard.test.ts`

Pure decorator: takes raw `rank_campaign` rows (PostgREST numerics may arrive as strings) + a `creators` profile lookup, returns ranked entries with name/avatar/level. `num()`-coerces every numeric. `myStanding` extracts the caller's row; `spotsToPrize` computes "差 N 名入獎".

- [ ] **Step 1: Write the failing test**

Create `server/lib/campaignLeaderboard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shapeLeaderboard, myStanding, spotsToPrize, type RankRow } from "./campaignLeaderboard.js";

const rows: RankRow[] = [
  { creator_id: "a", rank: 1, approved: "5" as unknown as number, avg_quality: "4.5" as unknown as number },
  { creator_id: "b", rank: 2, approved: 3, avg_quality: 0 },
];
const profiles = [
  { id: "a", display_name: "Amy", avatar_url: "ax", level: 4 },
  { id: "b", display_name: null, avatar_url: null, level: null },
];

describe("shapeLeaderboard", () => {
  it("joins profiles and coerces numerics", () => {
    const out = shapeLeaderboard(rows, profiles);
    expect(out[0]).toMatchObject({ creator_id: "a", rank: 1, approved: 5, avg_quality: 4.5, display_name: "Amy", level: 4 });
    expect(out[1].approved).toBe(3);
    expect(out[1].display_name).toBe(""); // null name → empty string, never "null"
  });
  it("tolerates a missing profile (decorates with empty fields)", () => {
    const out = shapeLeaderboard(rows, [{ id: "a", display_name: "Amy", avatar_url: null, level: 1 }]);
    expect(out[1].display_name).toBe("");
  });
});

describe("myStanding", () => {
  it("returns the caller row or null", () => {
    expect(myStanding(rows, "b")?.rank).toBe(2);
    expect(myStanding(rows, "zzz")).toBeNull();
  });
});

describe("spotsToPrize", () => {
  it("0 when inside the cutoff, else the gap", () => {
    expect(spotsToPrize(2, 3)).toBe(0);
    expect(spotsToPrize(5, 3)).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/lib/campaignLeaderboard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `server/lib/campaignLeaderboard.ts`:

```ts
// Pure shaper for the campaign leaderboard. rank_campaign (SECURITY DEFINER) does the ranking;
// this only decorates rows with public creator profile fields and coerces PostgREST numerics.

export type RankRow = { creator_id: string; rank: number; approved: number; avg_quality: number };
export type CreatorProfile = { id: string; display_name: string | null; avatar_url?: string | null; level?: number | null };
export type LeaderboardEntry = {
  creator_id: string; rank: number; approved: number; avg_quality: number;
  display_name: string; avatar_url: string | null; level: number;
};

export function num(v: unknown): number {
  if (typeof v === "number") return Number.isNaN(v) ? 0 : v;
  if (typeof v === "string") { const n = Number(v); return Number.isNaN(n) ? 0 : n; }
  return 0;
}

export function shapeLeaderboard(rows: RankRow[], profiles: CreatorProfile[]): LeaderboardEntry[] {
  const byId = new Map(profiles.map((p) => [p.id, p]));
  return rows.map((r) => {
    const p = byId.get(r.creator_id);
    return {
      creator_id: r.creator_id,
      rank: num(r.rank),
      approved: num(r.approved),
      avg_quality: num(r.avg_quality),
      display_name: p?.display_name ?? "",
      avatar_url: p?.avatar_url ?? null,
      level: num(p?.level),
    };
  });
}

export function myStanding(rows: RankRow[], creatorId: string): RankRow | null {
  return rows.find((r) => r.creator_id === creatorId) ?? null;
}

// "差 N 名入獎": 0 if rank is within the prize cutoff, otherwise how many spots away.
export function spotsToPrize(rank: number, prizeCutoffRank: number): number {
  return rank <= prizeCutoffRank ? 0 : rank - prizeCutoffRank;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run server/lib/campaignLeaderboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/campaignLeaderboard.ts server/lib/campaignLeaderboard.test.ts
git commit -m "feat(campaigns): pure campaignLeaderboard shaper (profile decoration + numeric coercion)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase C — Integration tests (against the local stack)

> **Prerequisite for every Task 13–16 step:** export the local test env into your shell first, or every test SKIPs:
> ```bash
> set -a; source .env.test.local; set +a   # local stack creds ONLY — never .env.local (prod)
> ```
> Run individual files with: `npx vitest run --no-file-parallelism server/test/campaigns.test.ts`.

### Task 13: Integration — completion bonus exactly-once + `submitted_at` grace window

**Files:**
- Create: `server/test/campaigns.test.ts`
- Test: itself

- [ ] **Step 1: Write the test file with shared fixtures + the bonus suite**

Create `server/test/campaigns.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { serviceForTests, makeCreator, makeMission, cleanup, DEMO_WS } from "./helpers.js";
import { campaignBonusRef, campaignPrizeRef } from "../lib/campaignAuthoring.js";

const hasEnv = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const suite = hasEnv ? describe : describe.skip;
const svc = () => serviceForTests();

// ---- fixtures -------------------------------------------------------------------------------
async function makeCampaign(opts: {
  slug: string; goal_target?: number; bonus_points?: number; bonus_xp?: number;
  prize_tiers?: unknown[]; starts_at?: string; ends_at?: string; status?: string; workspace_id?: string;
}) {
  const { data, error } = await svc().from("campaigns").insert({
    workspace_id: opts.workspace_id ?? DEMO_WS,
    slug: opts.slug, title: opts.slug,
    status: opts.status ?? "active",
    starts_at: opts.starts_at ?? "2026-06-01T00:00:00Z",
    ends_at: opts.ends_at ?? "2026-06-30T00:00:00Z",
    goal_target: opts.goal_target ?? 2,
    completion_bonus_points: opts.bonus_points ?? 100,
    completion_bonus_xp: opts.bonus_xp ?? 20,
    prize_tiers: opts.prize_tiers ?? [],
    published_at: "2026-06-01T00:00:00Z",
  }).select("*").single();
  if (error) throw error;
  return data as { id: string; slug: string; workspace_id: string };
}
async function attach(campaignId: string, missionId: string, workspaceId = DEMO_WS) {
  const { error } = await svc().from("campaign_missions")
    .insert({ campaign_id: campaignId, mission_id: missionId, workspace_id: workspaceId });
  if (error) throw error;
}
// Insert a submission then flip it to approved (fires the trigger). submitted_at = delivery time,
// reviewed_at = approval time (as-of-approval mission-set key).
async function seedApprovedSub(opts: {
  creator: string; mission: string; workspace?: string;
  submitted_at: string; reviewed_at?: string; quality_rating?: number | null;
}) {
  const ws = opts.workspace ?? DEMO_WS;
  const { data: ins, error: e1 } = await svc().from("mission_submissions")
    .insert({ creator_id: opts.creator, workspace_id: ws, mission_id: opts.mission,
              status: "submitted", submitted_at: opts.submitted_at }).select("id").single();
  if (e1) throw e1;
  const id = (ins as { id: string }).id;
  const { error: e2 } = await svc().from("mission_submissions")
    .update({ status: "approved", reviewed_at: opts.reviewed_at ?? "2026-06-15T00:00:00Z",
              quality_rating: opts.quality_rating ?? null })
    .eq("id", id);
  if (e2) throw e2;
  return id;
}
async function participant(campaignId: string, creatorId: string) {
  const { data } = await svc().from("campaign_participants").select("*")
    .eq("campaign_id", campaignId).eq("creator_id", creatorId).maybeSingle();
  return data as null | { approved_count: number; goal_reached_at: string | null; bonus_granted_at: string | null };
}
async function pointTxns(ref: string) {
  const { data } = await svc().from("point_transactions").select("*").eq("source_ref", ref);
  return data ?? [];
}

suite("campaigns — completion bonus", () => {
  let koc: { userId: string };
  beforeAll(async () => { await cleanup(); koc = await makeCreator("camp-bonus@test.local", 0); });
  afterAll(cleanup);

  it("auto-enrolls, counts, and pays the bonus exactly once on goal crossing", async () => {
    const m1 = await makeMission({ slug: "test-camp-m1" });
    const m2 = await makeMission({ slug: "test-camp-m2" });
    const camp = await makeCampaign({ slug: "test-camp-bonus", goal_target: 2, bonus_points: 100, bonus_xp: 20 });
    await attach(camp.id, m1.id);
    await attach(camp.id, m2.id);

    await seedApprovedSub({ creator: koc.userId, mission: m1.id, submitted_at: "2026-06-10T00:00:00Z" });
    let p = await participant(camp.id, koc.userId);
    expect(p?.approved_count).toBe(1);
    expect(p?.goal_reached_at).toBeNull();

    await seedApprovedSub({ creator: koc.userId, mission: m2.id, submitted_at: "2026-06-11T00:00:00Z" });
    p = await participant(camp.id, koc.userId);
    expect(p?.approved_count).toBe(2);
    expect(p?.goal_reached_at).not.toBeNull();
    expect(p?.bonus_granted_at).not.toBeNull();

    const ref = campaignBonusRef(camp.id, koc.userId);
    expect((await pointTxns(ref)).length).toBe(1);             // exactly one bonus ledger row
  });

  it("counts a submission delivered in-window but reviewed during the grace window", async () => {
    const m = await makeMission({ slug: "test-camp-grace-m" });
    const camp = await makeCampaign({ slug: "test-camp-grace", goal_target: 1, ends_at: "2026-06-30T00:00:00Z" });
    await attach(camp.id, m.id);
    // delivered before ends_at, reviewed AFTER ends_at (grace). Campaign still 'active' (not settled).
    await seedApprovedSub({ creator: koc.userId, mission: m.id,
      submitted_at: "2026-06-29T00:00:00Z", reviewed_at: "2026-07-03T00:00:00Z" });
    const p = await participant(camp.id, koc.userId);
    expect(p?.approved_count).toBe(1);
    expect(p?.goal_reached_at).not.toBeNull();
  });

  it("does NOT count a submission delivered after ends_at", async () => {
    const m = await makeMission({ slug: "test-camp-late-m" });
    const camp = await makeCampaign({ slug: "test-camp-late", goal_target: 1, ends_at: "2026-06-30T00:00:00Z" });
    await attach(camp.id, m.id);
    await seedApprovedSub({ creator: koc.userId, mission: m.id, submitted_at: "2026-07-05T00:00:00Z" });
    const p = await participant(camp.id, koc.userId);
    expect(p ?? { approved_count: 0 }).toMatchObject({ approved_count: 0 }); // not enrolled / not counted
  });
});
```

> If `helpers.ts` does not already export `DEMO_WS`, add `export` to its existing constant (it is referenced by `makeCreator`/`makeMission`), or import the equivalent the file uses. Verify with `grep -n "DEMO_WS" server/test/helpers.ts`.

- [ ] **Step 2: Run the bonus suite**

Run: `npx vitest run --no-file-parallelism server/test/campaigns.test.ts`
Expected: 3 tests PASS. If they SKIP, the env wasn't sourced (re-run the `source .env.test.local` line).

- [ ] **Step 3: Commit**

```bash
git add server/test/campaigns.test.ts
git commit -m "test(campaigns): integration — completion bonus exactly-once + submitted_at grace window

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 14: Integration — settle ranks, cash debit-vs-credit split, idempotent re-settle

**Files:**
- Modify: `server/test/campaigns.test.ts` (append a suite + 2 helpers)

- [ ] **Step 1: Add helpers + the settle suite**

Append to `server/test/campaigns.test.ts`:

```ts
async function makeWorkspace(slug: string) {
  const { data, error } = await svc().from("workspaces")
    .insert({ slug, name: slug }).select("id").single();
  if (error) throw error;
  return (data as { id: string }).id;
}
async function budget(ws: string) {
  const { data } = await svc().from("workspace_budgets").select("balance, enforced").eq("workspace_id", ws).maybeSingle();
  return data as null | { balance: number; enforced: boolean };
}
async function earnTxns(ref: string) {
  const { data } = await svc().from("earnings_transactions").select("*").eq("source_ref", ref);
  return data ?? [];
}

suite("campaigns — settlement", () => {
  let a: { userId: string }, b: { userId: string };
  beforeAll(async () => {
    await cleanup();
    a = await makeCreator("camp-a@test.local", 0);   // both home = DEMO_WS
    b = await makeCreator("camp-b@test.local", 0);
  });
  afterAll(cleanup);

  it("ranks, pays the top tier in cash, and is idempotent on re-settle", async () => {
    const m = await makeMission({ slug: "test-settle-m" });
    const camp = await makeCampaign({
      slug: "test-settle", goal_target: 1, bonus_points: 0, bonus_xp: 0,
      prize_tiers: [{ rank_from: 1, rank_to: 1, cash: 500, points: 0, xp: 0 }],
    });
    await attach(camp.id, m.id);
    // A: 2 approved, B: 1 approved → A ranks 1.
    await seedApprovedSub({ creator: a.userId, mission: m.id, submitted_at: "2026-06-05T00:00:00Z" });
    // second approved for A needs a 2nd mission (one approved sub per (creator,mission) submission row).
    const m2 = await makeMission({ slug: "test-settle-m2" });
    await attach(camp.id, m2.id);
    await seedApprovedSub({ creator: a.userId, mission: m2.id, submitted_at: "2026-06-06T00:00:00Z" });
    await seedApprovedSub({ creator: b.userId, mission: m.id, submitted_at: "2026-06-07T00:00:00Z" });

    // Fund + enforce the CAMPAIGN workspace budget.
    await svc().rpc("credit_workspace_budget", { p_workspace: DEMO_WS, p_delta: 1000, p_type: "topup" });
    await svc().rpc("set_workspace_budget_enforcement", { p_workspace: DEMO_WS, p_enforced: true });

    await svc().rpc("close_campaign", { p_campaign: camp.id });
    const settled = await svc().rpc("settle_campaign", { p_campaign: camp.id });
    expect(settled.error).toBeNull();

    const pa = await participant(camp.id, a.userId);
    expect(pa).toBeTruthy();
    const { data: rowA } = await svc().from("campaign_participants").select("prize_rank, prize_granted_at")
      .eq("campaign_id", camp.id).eq("creator_id", a.userId).single();
    expect(rowA.prize_rank).toBe(1);
    expect(rowA.prize_granted_at).not.toBeNull();

    const refA = campaignPrizeRef(camp.id, a.userId);
    expect((await earnTxns(refA)).length).toBe(1);
    expect(Number((await earnTxns(refA))[0].amount)).toBe(500);   // credited to A's HOME earnings
    const after = await budget(DEMO_WS);
    expect(Number(after?.balance)).toBe(500);                      // 1000 funded − 500 debited

    // B got rank 2, no prize tier covers it → no prize ledger row.
    expect((await earnTxns(campaignPrizeRef(camp.id, b.userId))).length).toBe(0);

    // Re-settle: idempotent (settled_at already set) — no second debit, no second credit.
    const again = await svc().rpc("settle_campaign", { p_campaign: camp.id });
    expect(again.error).toBeNull();
    expect((await earnTxns(refA)).length).toBe(1);
    expect(Number((await budget(DEMO_WS))?.balance)).toBe(500);
  });

  it("debits the CAMPAIGN workspace budget but credits the creator's HOME workspace earnings", async () => {
    const ws2 = await makeWorkspace("test-camp-ws2");
    const m = await makeMission({ slug: "test-xws-m" });
    // Move this mission into ws2 so the campaign (in ws2) counts its submissions.
    await svc().from("missions").update({ workspace_id: ws2 }).eq("id", m.id);
    const camp = await makeCampaign({
      slug: "test-xws", workspace_id: ws2, goal_target: 1, bonus_points: 0, bonus_xp: 0,
      prize_tiers: [{ rank_from: 1, rank_to: 1, cash: 300, points: 0, xp: 0 }],
    });
    await attach(camp.id, m.id, ws2);
    // a.userId home = DEMO_WS, but the approved submission lives in ws2 (the campaign workspace).
    await seedApprovedSub({ creator: a.userId, mission: m.id, workspace: ws2, submitted_at: "2026-06-08T00:00:00Z" });

    await svc().rpc("credit_workspace_budget", { p_workspace: ws2, p_delta: 500, p_type: "topup" });
    await svc().rpc("set_workspace_budget_enforcement", { p_workspace: ws2, p_enforced: true });
    await svc().rpc("close_campaign", { p_campaign: camp.id });
    expect((await svc().rpc("settle_campaign", { p_campaign: camp.id })).error).toBeNull();

    const ref = campaignPrizeRef(camp.id, a.userId);
    // earnings credited on the HOME workspace (DEMO_WS), NOT ws2.
    const { data: et } = await svc().from("earnings_transactions").select("workspace_id, amount").eq("source_ref", ref).single();
    expect(et.workspace_id).toBe(DEMO_WS);
    expect(Number(et.amount)).toBe(300);
    // budget debited on the CAMPAIGN workspace (ws2).
    expect(Number((await budget(ws2))?.balance)).toBe(200);
  });
});
```

> `cleanup()` must remove `test-camp-ws2` and the campaigns. If `cleanup()` does not already cascade campaigns/workspaces created by these tests, extend it (Task 16, Step 4) to delete `campaigns`/`campaign_missions`/`campaign_participants` for `slug like 'test-%'` and `workspaces` for `slug like 'test-camp-%'`. The campaign FKs cascade participants/missions; deleting the workspace cascades the budget rows.

- [ ] **Step 2: Run the settle suite**

Run: `npx vitest run --no-file-parallelism server/test/campaigns.test.ts -t "settlement"`
Expected: both settlement tests PASS.

- [ ] **Step 3: Commit**

```bash
git add server/test/campaigns.test.ts
git commit -m "test(campaigns): integration — settle ranks, cash debit/credit split, idempotent re-settle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 15: Integration — `insufficient_budget` rolls back the whole settle; top-up + re-settle pays

**Files:**
- Modify: `server/test/campaigns.test.ts` (append a suite)

- [ ] **Step 1: Add the insufficient-budget suite**

Append:

```ts
suite("campaigns — insufficient budget", () => {
  let a: { userId: string }, b: { userId: string };
  beforeAll(async () => {
    await cleanup();
    a = await makeCreator("camp-ins-a@test.local", 0);
    b = await makeCreator("camp-ins-b@test.local", 0);
  });
  afterAll(cleanup);

  it("rolls back the entire settlement; top-up + re-settle pays only unpaid winners", async () => {
    const m1 = await makeMission({ slug: "test-ins-m1" });
    const m2 = await makeMission({ slug: "test-ins-m2" });
    const camp = await makeCampaign({
      slug: "test-ins", goal_target: 1, bonus_points: 0, bonus_xp: 0,
      prize_tiers: [{ rank_from: 1, rank_to: 2, cash: 400, points: 0, xp: 0 }],  // both A and B win 400
    });
    await attach(camp.id, m1.id);
    await attach(camp.id, m2.id);
    // A ranks 1 (2 approved), B ranks 2 (1 approved).
    await seedApprovedSub({ creator: a.userId, mission: m1.id, submitted_at: "2026-06-05T00:00:00Z" });
    await seedApprovedSub({ creator: a.userId, mission: m2.id, submitted_at: "2026-06-06T00:00:00Z" });
    await seedApprovedSub({ creator: b.userId, mission: m1.id, submitted_at: "2026-06-07T00:00:00Z" });

    // Fund only 400 + enforce → can pay ONE 400 prize, not two.
    await svc().rpc("credit_workspace_budget", { p_workspace: DEMO_WS, p_delta: 400, p_type: "topup" });
    await svc().rpc("set_workspace_budget_enforcement", { p_workspace: DEMO_WS, p_enforced: true });
    await svc().rpc("close_campaign", { p_campaign: camp.id });

    const fail = await svc().rpc("settle_campaign", { p_campaign: camp.id });
    expect(fail.error).not.toBeNull();
    expect(String(fail.error?.message)).toContain("insufficient_budget");

    // Full rollback: no prize ledger rows, budget untouched, campaign still 'closed'.
    expect((await earnTxns(campaignPrizeRef(camp.id, a.userId))).length).toBe(0);
    expect((await earnTxns(campaignPrizeRef(camp.id, b.userId))).length).toBe(0);
    expect(Number((await budget(DEMO_WS))?.balance)).toBe(400);
    const { data: c1 } = await svc().from("campaigns").select("status, settled_at").eq("id", camp.id).single();
    expect(c1.status).toBe("closed");
    expect(c1.settled_at).toBeNull();

    // Top up to cover both, then re-settle.
    await svc().rpc("credit_workspace_budget", { p_workspace: DEMO_WS, p_delta: 400, p_type: "topup" });
    const ok = await svc().rpc("settle_campaign", { p_campaign: camp.id });
    expect(ok.error).toBeNull();
    expect((await earnTxns(campaignPrizeRef(camp.id, a.userId))).length).toBe(1);
    expect((await earnTxns(campaignPrizeRef(camp.id, b.userId))).length).toBe(1);
    expect(Number((await budget(DEMO_WS))?.balance)).toBe(0);   // 800 funded − 2×400
    const { data: c2 } = await svc().from("campaigns").select("status").eq("id", camp.id).single();
    expect(c2.status).toBe("settled");
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run --no-file-parallelism server/test/campaigns.test.ts -t "insufficient budget"`
Expected: PASS — the first settle errors with `insufficient_budget`, nothing is paid, and after top-up both winners are paid exactly once.

- [ ] **Step 3: Commit**

```bash
git add server/test/campaigns.test.ts
git commit -m "test(campaigns): integration — insufficient_budget full rollback + top-up re-settle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 16: Integration — constraints, mission removal, terminal approval, RLS; wire cleanup + `test:integration`

**Files:**
- Modify: `server/test/campaigns.test.ts` (append a suite)
- Modify: `server/test/helpers.ts` (extend `cleanup()`)
- Modify: `package.json` (add the file to `test:integration`)

- [ ] **Step 1: Confirm the JWT-scoped client helper name**

Run: `grep -n "userForJwt\|makeUserClient\|export function user" server/test/helpers.ts`
Expected: a JWT→client helper (e.g. `userForJwt(jwt)`) is exported; use its actual name in Step 2.

- [ ] **Step 2: Add the constraints/RLS suite**

Append to `server/test/campaigns.test.ts` (uses `userForJwt` — adjust to the name from Step 1):

```ts
import { userForJwt } from "./helpers.js";

suite("campaigns — constraints & RLS", () => {
  let koc: { userId: string; jwt: string };
  let other: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("camp-rls-a@test.local", 0);
    other = await makeCreator("camp-rls-b@test.local", 0);
  });
  afterAll(cleanup);

  it("rejects attaching a mission already active in another campaign (one-active index)", async () => {
    const m = await makeMission({ slug: "test-excl-m" });
    const c1 = await makeCampaign({ slug: "test-excl-1" });
    const c2 = await makeCampaign({ slug: "test-excl-2" });
    await attach(c1.id, m.id);
    const { error } = await svc().from("campaign_missions")
      .insert({ campaign_id: c2.id, mission_id: m.id, workspace_id: DEMO_WS });
    expect(error?.code).toBe("23505");                  // partial-unique on (mission_id) where removed_at is null
  });

  it("mission removed mid-campaign keeps approvals earned while attached (as-of-approval)", async () => {
    const m = await makeMission({ slug: "test-rm-m" });
    const camp = await makeCampaign({ slug: "test-rm", goal_target: 5 });
    await attach(camp.id, m.id);
    await seedApprovedSub({ creator: koc.userId, mission: m.id,
      submitted_at: "2026-06-05T00:00:00Z", reviewed_at: "2026-06-06T00:00:00Z" });
    // Remove the mission AFTER that approval.
    await svc().from("campaign_missions").update({ removed_at: "2026-06-10T00:00:00Z" })
      .eq("campaign_id", camp.id).eq("mission_id", m.id);
    const { data: ranked } = await svc().rpc("rank_campaign", { p_campaign: camp.id });
    const mine = (ranked ?? []).find((r: { creator_id: string }) => r.creator_id === koc.userId);
    expect(Number(mine?.approved)).toBe(1);             // not retroactively erased
  });

  it("reject_submission on an approved row raises wrong_state (monotonic invariant)", async () => {
    const m = await makeMission({ slug: "test-term-m" });
    const camp = await makeCampaign({ slug: "test-term", goal_target: 1 });
    await attach(camp.id, m.id);
    const id = await seedApprovedSub({ creator: koc.userId, mission: m.id, submitted_at: "2026-06-05T00:00:00Z" });
    const { error } = await svc().rpc("reject_submission", { p_submission: id, p_notes: "x" });
    expect(String(error?.message)).toContain("wrong_state");
  });

  it("creator may read only their own participant row; not another creator's", async () => {
    const m = await makeMission({ slug: "test-self-m" });
    const camp = await makeCampaign({ slug: "test-self", goal_target: 1 });
    await attach(camp.id, m.id);
    await seedApprovedSub({ creator: koc.userId, mission: m.id, submitted_at: "2026-06-05T00:00:00Z" });

    const mine = await userForJwt(koc.jwt).from("campaign_participants").select("creator_id").eq("campaign_id", camp.id);
    expect((mine.data ?? []).map((r) => r.creator_id)).toEqual([koc.userId]);

    const theirs = await userForJwt(other.jwt).from("campaign_participants").select("creator_id").eq("campaign_id", camp.id);
    expect(theirs.data ?? []).toEqual([]);              // RLS: only self-read
  });
});
```

- [ ] **Step 3: Extend `cleanup()` to remove campaign rows + test workspaces**

In `server/test/helpers.ts`, inside `cleanup()`, **before** the workspace/creator deletes (so FKs cascade cleanly), add:

```ts
// Campaigns G1: delete test campaigns (cascades campaign_missions + campaign_participants),
// then the extra test workspaces created by cross-workspace settlement tests.
await service().from("campaigns").delete().like("slug", "test-%");
await service().from("workspaces").delete().like("slug", "test-camp-%");
```

(Adjust to match `cleanup()`'s existing `service()` accessor name. The campaign→participants/missions FKs are `on delete cascade`; the workspace→budget FKs cascade too.)

- [ ] **Step 4: Add the new file to the `test:integration` script**

In `package.json`, append ` server/test/campaigns.test.ts` to the end of the `test:integration` command's file list (the space-separated list after `--no-file-parallelism`).

- [ ] **Step 5: Run the whole campaigns integration file**

Run: `npx vitest run --no-file-parallelism server/test/campaigns.test.ts`
Expected: all suites (bonus / settlement / insufficient budget / constraints & RLS) PASS.

- [ ] **Step 6: Commit**

```bash
git add server/test/campaigns.test.ts server/test/helpers.ts package.json
git commit -m "test(campaigns): integration — exclusivity, mission removal, terminal approval, RLS + cleanup/CI wiring

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase D — Server routes

### Task 17: Operator route `adminCampaigns.ts` + mount

**Files:**
- Create: `server/routes/adminCampaigns.ts`
- Modify: `server/routes/admin.ts` (mount)

`serviceClient()` everywhere; workspace comes from the campaign row (never a `?workspace=` filter for writes). Error mapping: `23505 → 422` (slug/attach collision), `insufficient_budget → 402`, `invalid_prize_tiers → 422`, `wrong_state / not_found → 409 / 404`.

- [ ] **Step 1: Write the route file**

Create `server/routes/adminCampaigns.ts`:

```ts
import { Hono } from "hono";
import { serviceClient } from "../lib/supabase.js";
import {
  type CampaignInput, type CampaignRecord, validateCampaign, validateEdit,
  validatePrizeTiers, canAttachMission, CAMPAIGN_EDITABLE_COLS,
} from "../lib/campaignAuthoring.js";
import { shapeLeaderboard } from "../lib/campaignLeaderboard.js";

export const adminCampaignRoutes = new Hono();

const CAMPAIGN_COLS =
  "id, workspace_id, slug, title, description, status, starts_at, ends_at, goal_metric, goal_target, " +
  "completion_bonus_points, completion_bonus_xp, prize_tiers, published_at, closed_at, settled_at, " +
  "created_by, created_at, updated_at";

function pickEditable(body: CampaignInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of CAMPAIGN_EDITABLE_COLS) if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
  return out;
}
async function participantCount(svc: ReturnType<typeof serviceClient>, campaignId: string) {
  const { count } = await svc.from("campaign_participants").select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId);
  return count ?? 0;
}

// List ------------------------------------------------------------------------------------------
adminCampaignRoutes.get("/campaigns", async (c) => {
  const workspace = c.req.query("workspace");
  const status = c.req.query("status");
  const svc = serviceClient();
  let q = svc.from("campaigns").select(CAMPAIGN_COLS).order("updated_at", { ascending: false });
  if (workspace) q = q.eq("workspace_id", workspace);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ campaigns: data ?? [] });
});

// Detail (campaign + attached missions + participant count) -------------------------------------
adminCampaignRoutes.get("/campaigns/:id", async (c) => {
  const svc = serviceClient();
  const { data: campaign, error } = await svc.from("campaigns").select(CAMPAIGN_COLS)
    .eq("id", c.req.param("id")).maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!campaign) return c.json({ error: "not_found", code: "not_found" }, 404);
  const { data: missions } = await svc.from("campaign_missions")
    .select("mission_id, added_at, removed_at, missions(title, slug, status)")
    .eq("campaign_id", campaign.id).is("removed_at", null);
  return c.json({ campaign, missions: missions ?? [], participants: await participantCount(svc, campaign.id) });
});

// Create draft ----------------------------------------------------------------------------------
adminCampaignRoutes.post("/campaigns", async (c) => {
  const body = await c.req.json<CampaignInput>().catch(() => ({}) as CampaignInput);
  const { ok, errors } = validateCampaign(body, "draft");
  if (!ok) return c.json({ error: "請修正欄位", code: "validation", fields: errors }, 422);
  const insert = { ...pickEditable(body), workspace_id: body.workspace_id, status: "draft" };
  const { data, error } = await serviceClient().from("campaigns").insert(insert).select(CAMPAIGN_COLS).single();
  if (error) {
    if (error.code === "23505") return c.json({ error: "Slug 已被使用", code: "validation", fields: { slug: "重複" } }, 422);
    return c.json({ error: error.message, code: "db_error" }, 500);
  }
  return c.json({ campaign: data }, 201);
});

// Edit ------------------------------------------------------------------------------------------
adminCampaignRoutes.patch("/campaigns/:id", async (c) => {
  const id = c.req.param("id");
  const patch = await c.req.json<CampaignInput>().catch(() => ({}) as CampaignInput);
  const svc = serviceClient();
  const { data: existing, error: exErr } = await svc.from("campaigns").select(CAMPAIGN_COLS).eq("id", id).maybeSingle();
  if (exErr) return c.json({ error: exErr.message, code: "db_error" }, 500);
  if (!existing) return c.json({ error: "not_found", code: "not_found" }, 404);
  const hasEngagement = (await participantCount(svc, id)) > 0;
  const { ok, errors } = validateEdit(existing as unknown as CampaignRecord, patch, hasEngagement);
  if (!ok) return c.json({ error: "請修正欄位", code: "validation", fields: errors }, 422);
  const updates = { ...pickEditable(patch), updated_at: new Date().toISOString() };
  const { data, error } = await svc.from("campaigns").update(updates).eq("id", id).select(CAMPAIGN_COLS).single();
  if (error) {
    if (error.code === "23505") return c.json({ error: "Slug 已被使用", code: "validation", fields: { slug: "重複" } }, 422);
    return c.json({ error: error.message, code: "db_error" }, 500);
  }
  return c.json({ campaign: data });
});

// Publish (draft -> active) ---------------------------------------------------------------------
adminCampaignRoutes.post("/campaigns/:id/publish", async (c) => {
  const id = c.req.param("id");
  const svc = serviceClient();
  const { data: existing } = await svc.from("campaigns").select(CAMPAIGN_COLS).eq("id", id).maybeSingle();
  if (!existing) return c.json({ error: "not_found", code: "not_found" }, 404);
  if (existing.status !== "draft") return c.json({ error: "wrong_state", code: "conflict" }, 409);
  const { ok, errors } = validateCampaign(existing as unknown as CampaignInput, "publish");
  if (!ok) return c.json({ error: "未符合發佈條件", code: "validation", fields: errors }, 422);
  const { data, error } = await svc.from("campaigns")
    .update({ status: "active", published_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id).select(CAMPAIGN_COLS).single();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ campaign: data });
});

// Attach / detach mission -----------------------------------------------------------------------
adminCampaignRoutes.post("/campaigns/:id/missions", async (c) => {
  const id = c.req.param("id");
  const { mission_id } = await c.req.json<{ mission_id: string }>().catch(() => ({ mission_id: "" }));
  const svc = serviceClient();
  const { data: campaign } = await svc.from("campaigns").select("id, workspace_id, status").eq("id", id).maybeSingle();
  if (!campaign) return c.json({ error: "not_found", code: "not_found" }, 404);
  if (campaign.status === "settled") return c.json({ error: "wrong_state", code: "conflict" }, 409);
  // Friendly pre-check (the partial-unique index is the real guard).
  const { data: active } = await svc.from("campaign_missions").select("mission_id").eq("mission_id", mission_id).is("removed_at", null);
  const guard = canAttachMission(new Set((active ?? []).map((r) => r.mission_id as string)), mission_id);
  if (!guard.ok) return c.json({ error: guard.error, code: "conflict" }, 409);
  const { error } = await svc.from("campaign_missions")
    .insert({ campaign_id: id, mission_id, workspace_id: campaign.workspace_id });
  if (error) {
    if (error.code === "23505") return c.json({ error: "此任務已連結到進行中的挑戰", code: "conflict" }, 409);
    return c.json({ error: error.message, code: "db_error" }, 500);
  }
  return c.json({ ok: true }, 201);
});

adminCampaignRoutes.delete("/campaigns/:id/missions/:missionId", async (c) => {
  const svc = serviceClient();
  const { data: campaign } = await svc.from("campaigns").select("status").eq("id", c.req.param("id")).maybeSingle();
  if (!campaign) return c.json({ error: "not_found", code: "not_found" }, 404);
  if (campaign.status === "closed" || campaign.status === "settled") {
    return c.json({ error: "結束後不可移除任務", code: "conflict" }, 409);
  }
  const { error } = await svc.from("campaign_missions").update({ removed_at: new Date().toISOString() })
    .eq("campaign_id", c.req.param("id")).eq("mission_id", c.req.param("missionId")).is("removed_at", null);
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ ok: true });
});

// Close / settle --------------------------------------------------------------------------------
function mapRpcError(c: Parameters<Parameters<typeof adminCampaignRoutes.post>[1]>[0], msg: string) {
  if (msg.includes("insufficient_budget")) return c.json({ error: "預算不足，請增值後再結算", code: "insufficient_budget" }, 402);
  if (msg.includes("invalid_prize_tiers")) return c.json({ error: "獎品階級無效", code: "validation" }, 422);
  if (msg.includes("wrong_state")) return c.json({ error: "狀態不符", code: "conflict" }, 409);
  if (msg.includes("not_found")) return c.json({ error: "not_found", code: "not_found" }, 404);
  return c.json({ error: msg, code: "db_error" }, 500);
}

adminCampaignRoutes.post("/campaigns/:id/close", async (c) => {
  const { data, error } = await serviceClient().rpc("close_campaign", { p_campaign: c.req.param("id") });
  if (error) return mapRpcError(c, String(error.message));
  return c.json({ campaign: data });
});

adminCampaignRoutes.post("/campaigns/:id/settle", async (c) => {
  const { data, error } = await serviceClient().rpc("settle_campaign", { p_campaign: c.req.param("id") });
  if (error) return mapRpcError(c, String(error.message));
  return c.json({ campaign: data });
});

// Leaderboard (operator view) -------------------------------------------------------------------
adminCampaignRoutes.get("/campaigns/:id/leaderboard", async (c) => {
  const svc = serviceClient();
  const { data: ranked, error } = await svc.rpc("rank_campaign", { p_campaign: c.req.param("id") });
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  const ids = (ranked ?? []).map((r: { creator_id: string }) => r.creator_id);
  const { data: profiles } = ids.length
    ? await svc.from("creators").select("id, display_name, avatar_url, level").in("id", ids)
    : { data: [] };
  return c.json({ leaderboard: shapeLeaderboard(ranked ?? [], profiles ?? []) });
});
```

> Confirm `creators` has the columns selected (`display_name, avatar_url, level`). Run `grep -n "avatar_url\|display_name\|level" supabase/migrations/0001_init.sql supabase/migrations/0008_leveling.sql`. If `level` is computed (not a stored column), select the stored XP/level field the passport uses and adapt `shapeLeaderboard`'s `level` source accordingly.

- [ ] **Step 2: Mount under `admin.ts`**

In `server/routes/admin.ts`, alongside the sibling mounts (lines ~56–61), add the import at the top and the mount:

```ts
import { adminCampaignRoutes } from "./adminCampaigns.js";
// …
adminRoutes.route("/", adminCampaignRoutes);
```

- [ ] **Step 3: Verify imports resolve + ESM extensions**

Run: `npm run check:esm && npm run type-check`
Expected: both pass (all relative imports end in `.js`; types compile).

- [ ] **Step 4: Add operator route smoke tests to the integration file**

Append to `server/test/campaigns.test.ts` a suite that drives the Hono app with the admin secret (mirror `server/test/admin.test.ts`'s app+`x-admin-secret` setup — copy its `app`/`req` helper import). Cover: create draft → 201; attach a mission already active elsewhere → 409; publish a draft missing a window → 422; `settle` on an enforced-but-unfunded campaign → 402; `close` twice → second is 409. Use the same fixtures already in the file.

```ts
// sketch — adapt the app/req harness from server/test/admin.test.ts:
//   const res = await app.request("/admin/campaigns", { method: "POST",
//     headers: { "x-admin-secret": SECRET, "content-type": "application/json" },
//     body: JSON.stringify({ workspace_id: DEMO_WS, slug: "test-r-1", title: "x" }) });
//   expect(res.status).toBe(201);
```

- [ ] **Step 5: Run + commit**

Run: `npx vitest run --no-file-parallelism server/test/campaigns.test.ts`
Expected: all suites PASS.

```bash
git add server/routes/adminCampaigns.ts server/routes/admin.ts server/test/campaigns.test.ts
git commit -m "feat(campaigns): operator adminCampaigns route (CRUD, publish, attach, close, settle, leaderboard)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 18: Creator read route `campaigns.ts` + mount

**Files:**
- Create: `server/routes/campaigns.ts`
- Modify: `server/app.ts` (mount under the guarded creator router)

Creators only see `status='active'` campaigns **in their own workspace** (`c.get("workspaceId")`). The cross-creator leaderboard is the isolation point: read via `serviceClient` hard-filtered to the campaign's workspace (proven == caller's workspace by the slug lookup), **never** `makeUserClient`/a request param. `rank_campaign` is SECURITY DEFINER and hard-filters internally.

- [ ] **Step 1: Write the route file**

Create `server/routes/campaigns.ts`:

```ts
import { Hono } from "hono";
import type { Env } from "../app.js";
import { serviceClient } from "../lib/supabase.js";
import { shapeLeaderboard, myStanding } from "../lib/campaignLeaderboard.js";

export const campaignRoutes = new Hono<Env>();

const PUBLIC_COLS =
  "id, workspace_id, slug, title, description, status, starts_at, ends_at, goal_target, " +
  "completion_bonus_points, completion_bonus_xp, prize_tiers, published_at, closed_at, settled_at";

// List: active campaigns in the caller's workspace (client splits active vs upcoming by starts_at).
campaignRoutes.get("/", async (c) => {
  const svc = serviceClient();
  const { data, error } = await svc.from("campaigns").select(PUBLIC_COLS)
    .eq("workspace_id", c.get("workspaceId")).eq("status", "active")
    .order("ends_at", { ascending: true });
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ campaigns: data ?? [] });
});

// Detail + the caller's own progress.
campaignRoutes.get("/:slug", async (c) => {
  const svc = serviceClient();
  const ws = c.get("workspaceId");
  const { data: campaign, error } = await svc.from("campaigns").select(PUBLIC_COLS)
    .eq("workspace_id", ws).eq("slug", c.req.param("slug")).maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!campaign || campaign.status === "draft") return c.json({ error: "not_found", code: "not_found" }, 404);

  const { data: missions } = await svc.from("campaign_missions")
    .select("mission_id, missions(title, slug, status, points_reward, cash_reward)")
    .eq("campaign_id", campaign.id).is("removed_at", null);

  const { data: me } = await svc.from("campaign_participants")
    .select("approved_count, goal_reached_at, bonus_granted_at, prize_rank")
    .eq("campaign_id", campaign.id).eq("creator_id", c.get("userId")).maybeSingle();

  const { data: ranked } = await svc.rpc("rank_campaign", { p_campaign: campaign.id });
  const mine = myStanding(ranked ?? [], c.get("userId"));

  return c.json({
    campaign, missions: missions ?? [],
    my_progress: {
      approved: me?.approved_count ?? 0,
      goal_reached: !!me?.goal_reached_at,
      bonus_granted: !!me?.bonus_granted_at,
      prize_rank: me?.prize_rank ?? null,
      rank: mine?.rank ?? null,
    },
  });
});

// Public leaderboard for one campaign in the caller's workspace.
campaignRoutes.get("/:slug/leaderboard", async (c) => {
  const svc = serviceClient();
  const { data: campaign } = await svc.from("campaigns").select("id")
    .eq("workspace_id", c.get("workspaceId")).eq("slug", c.req.param("slug")).maybeSingle();
  if (!campaign) return c.json({ error: "not_found", code: "not_found" }, 404);
  const { data: ranked, error } = await svc.rpc("rank_campaign", { p_campaign: campaign.id });
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  const ids = (ranked ?? []).map((r: { creator_id: string }) => r.creator_id);
  const { data: profiles } = ids.length
    ? await svc.from("creators").select("id, display_name, avatar_url, level").in("id", ids)
    : { data: [] };
  return c.json({ leaderboard: shapeLeaderboard(ranked ?? [], profiles ?? []) });
});
```

> If `Env` is not exported from `server/app.ts`, import it from wherever `missionRoutes` imports it (`grep -n "Hono<Env>" server/routes/missions.ts` and copy that import path).

- [ ] **Step 2: Mount under the guarded creator router**

In `server/app.ts`, add the import and mount it next to `guarded.route("/missions", missionRoutes)` (line ~44):

```ts
import { campaignRoutes } from "./routes/campaigns.js";
// …
guarded.route("/campaigns", campaignRoutes);
```

- [ ] **Step 3: Add a creator-read smoke test**

Append to `server/test/campaigns.test.ts` a creator-facing suite (mirror `server/test/missions.test.ts`'s app+JWT `req` helper): an active campaign in the creator's workspace appears in `GET /campaigns`; `GET /campaigns/:slug` returns `my_progress`; `GET /campaigns/:slug/leaderboard` returns ranked rows; a `draft` campaign 404s.

- [ ] **Step 4: Verify + run + commit**

Run: `npm run check:esm && npm run type-check && npx vitest run --no-file-parallelism server/test/campaigns.test.ts`
Expected: all green.

```bash
git add server/routes/campaigns.ts server/app.ts server/test/campaigns.test.ts
git commit -m "feat(campaigns): creator read route (list, detail+progress, leaderboard) + mount

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase E — Client

### Task 19: Notifications wiring + i18n + creator query hooks

**Files:**
- Modify: `src/lib/notifications.ts`
- Modify: `src/lib/notifications.test.ts`
- Modify: `src/lib/i18n.dict.ts`
- Modify: `src/lib/queries/kocmax.ts`

- [ ] **Step 1: Confirm the lucide icons are exported**

Run: `node -e "const I=require('lucide-react'); console.log('Trophy' in I, 'Award' in I)"`
Expected: `true true`. (Precedent: `Facebook` was **not** exported and needed an inline SVG. If either is `false`, pick an exported alternative — e.g. `Medal`, `Crown`, `Gift` — and use it in Step 3.)

- [ ] **Step 2: Write the failing notification render test**

In `src/lib/notifications.test.ts`, add cases asserting the two new types render (title/body interpolated, href deep-links the campaign):

```ts
it("renders campaign_goal_reached with points/xp and links to the campaign", () => {
  const v = renderNotification({ type: "campaign_goal_reached",
    data: { campaign_title: "六月挑戰", campaign_slug: "jun", points: 200, xp: 50 } } as never, dict);
  expect(v.title).toBeTruthy();
  expect(v.body).toContain("六月挑戰");
  expect(v.href).toBe("/campaigns/jun");
});
it("renders campaign_prize_awarded with rank/cash", () => {
  const v = renderNotification({ type: "campaign_prize_awarded",
    data: { campaign_title: "六月挑戰", campaign_slug: "jun", rank: 1, cash: 500, points: 0, xp: 0 } } as never, dict);
  expect(v.body).toContain("六月挑戰");
  expect(v.href).toBe("/campaigns/jun");
});
```

> Match the existing test's render entrypoint name/signature (`grep -n "renderNotification\|export function" src/lib/notifications.ts src/lib/notifications.test.ts`); adapt the call above to it.

Run: `npx vitest run src/lib/notifications.test.ts` → FAIL (types/cases not handled yet).

- [ ] **Step 3: Wire the two types in `src/lib/notifications.ts`**

```ts
// 1) NotificationType union — add:
  | "campaign_goal_reached" | "campaign_prize_awarded"

// 2) imports — add Trophy, Award (or the confirmed alternatives) to the lucide import line.

// 3) ICONS map — add:
  campaign_goal_reached: Trophy,
  campaign_prize_awarded: Award,

// 4) paramsFor() return object — add:
    campaign: s("campaign_title"),
    rank: n("rank"),
    cash: n("cash"),
    // (points/xp already present)

// 5) hrefFor() switch — add before `default`:
    case "campaign_goal_reached":
    case "campaign_prize_awarded": {
      const slug = row.data.campaign_slug;
      return typeof slug === "string" && slug ? `/campaigns/${slug}` : "/campaigns";
    }
```

Run: `npx vitest run src/lib/notifications.test.ts` → PASS.

- [ ] **Step 4: Add i18n keys (BOTH en and zh blocks, identical key sets)**

In `src/lib/i18n.dict.ts`, add to the **en** block (after the `app.notif.redemption_ready.*` entries):

```ts
"app.notif.campaign_goal_reached.title": "Challenge goal reached!",
"app.notif.campaign_goal_reached.body": "You hit the goal in \"{campaign}\" — +{points} pts · +{xp} XP",
"app.notif.campaign_prize_awarded.title": "You won a prize!",
"app.notif.campaign_prize_awarded.body": "Rank {rank} in \"{campaign}\" — HK${cash} · +{points} pts · +{xp} XP",
"app.nav.campaigns": "Challenges",
"app.admin.tabCampaigns": "Challenges",
"app.campaigns.title": "Challenges",
"app.campaigns.active": "Active",
"app.campaigns.upcoming": "Upcoming",
"app.campaigns.goalProgress": "Approved {x} / {y}",
"app.campaigns.leaderboard": "Leaderboard",
"app.campaigns.completionBonus": "Completion bonus",
"app.campaigns.prizes": "Prizes",
"app.campaigns.spotsToPrize": "{n} spots from a prize",
"app.campaigns.endsIn": "Ends in",
```

And the same keys in the **zh** block:

```ts
"app.notif.campaign_goal_reached.title": "達成挑戰目標！",
"app.notif.campaign_goal_reached.body": "你喺「{campaign}」達標，+{points} 分・+{xp} XP",
"app.notif.campaign_prize_awarded.title": "你贏得獎賞！",
"app.notif.campaign_prize_awarded.body": "「{campaign}」第 {rank} 名 — HK${cash}・+{points} 分・+{xp} XP",
"app.nav.campaigns": "挑戰",
"app.admin.tabCampaigns": "挑戰",
"app.campaigns.title": "挑戰",
"app.campaigns.active": "進行中",
"app.campaigns.upcoming": "即將開始",
"app.campaigns.goalProgress": "已批核 {x} / {y}",
"app.campaigns.leaderboard": "排行榜",
"app.campaigns.completionBonus": "完成獎勵",
"app.campaigns.prizes": "名次獎品",
"app.campaigns.spotsToPrize": "差 {n} 名入獎",
"app.campaigns.endsIn": "距離結束",
```

> The repo has an i18n key-parity guard (en ↔ zh). If a test asserts identical key sets, both blocks above must match exactly. Run the dict test after: `npx vitest run src/lib/i18n.dict.test.ts` (if present).

- [ ] **Step 5: Add creator query hooks in `src/lib/queries/kocmax.ts`**

```ts
export type Campaign = {
  id: string; slug: string; title: string; description: string | null; status: string;
  starts_at: string; ends_at: string; goal_target: number;
  completion_bonus_points: number; completion_bonus_xp: number;
  prize_tiers: { rank_from: number; rank_to: number; cash: number; points: number; xp: number }[];
};
export type CampaignDetail = {
  campaign: Campaign;
  missions: { mission_id: string; missions: { title: string; slug: string; status: string } }[];
  my_progress: { approved: number; goal_reached: boolean; bonus_granted: boolean; prize_rank: number | null; rank: number | null };
};
export type LeaderboardEntry = { creator_id: string; rank: number; approved: number; avg_quality: number; display_name: string; avatar_url: string | null; level: number };

export function useCampaigns() {
  return useQuery({
    queryKey: ["campaigns"],
    queryFn: async () => (await apiFetch<{ campaigns: Campaign[] }>("/campaigns")).campaigns,
  });
}
export function useCampaign(slug: string) {
  return useQuery({ queryKey: ["campaign", slug], queryFn: () => apiFetch<CampaignDetail>(`/campaigns/${slug}`) });
}
export function useCampaignLeaderboard(slug: string) {
  return useQuery({
    queryKey: ["campaign-leaderboard", slug],
    queryFn: async () => (await apiFetch<{ leaderboard: LeaderboardEntry[] }>(`/campaigns/${slug}/leaderboard`)).leaderboard,
  });
}
```

- [ ] **Step 6: Verify + commit**

Run: `npm run type-check && npx vitest run src/lib/notifications.test.ts`
Expected: green.

```bash
git add src/lib/notifications.ts src/lib/notifications.test.ts src/lib/i18n.dict.ts src/lib/queries/kocmax.ts
git commit -m "feat(campaigns): notification types + i18n (en/zh) + creator query hooks

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 20: Creator routes (`_app.campaigns` trio) + nav + route-stub test

**Files:**
- Create: `src/routes/_app.campaigns.tsx` (layout `<Outlet/>`)
- Create: `src/routes/_app.campaigns.index.tsx` (list)
- Create: `src/routes/_app.campaigns.$slug.tsx` (detail)
- Create: `src/routes/-_app.campaigns.test.tsx` (route-stub test)
- Modify: `src/components/navItems.ts` (nav entry)

> **First:** check the existing detail mockup intent in §10 of the spec, and copy the visual idiom (cards/progress bar/chips) from an existing creator page like `src/routes/_app.mission.$missionSlug.tsx` so styling matches.

- [ ] **Step 1: Layout parent**

Create `src/routes/_app.campaigns.tsx`:

```tsx
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/campaigns")({ component: () => <Outlet /> });
```

- [ ] **Step 2: List route**

Create `src/routes/_app.campaigns.index.tsx`:

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCampaigns } from "@/lib/queries/kocmax";
import { useT } from "@/lib/i18n";   // adapt to the repo's translation hook (grep _app.mission.index.tsx)

export const Route = createFileRoute("/_app/campaigns/")({ component: CampaignsList });

function CampaignsList() {
  const t = useT();
  const { data: campaigns = [], isLoading } = useCampaigns();
  const now = new Date().toISOString();
  const active = campaigns.filter((c) => c.starts_at <= now);
  const upcoming = campaigns.filter((c) => c.starts_at > now);

  if (isLoading) return <div className="p-4">…</div>;
  return (
    <div className="mx-auto max-w-3xl p-4 space-y-6">
      <h1 className="text-2xl font-bold">{t("app.campaigns.title")}</h1>
      <Section title={t("app.campaigns.active")} items={active} />
      <Section title={t("app.campaigns.upcoming")} items={upcoming} />
    </div>
  );
}

function Section({ title, items }: { title: string; items: { slug: string; title: string; ends_at: string; goal_target: number }[] }) {
  if (!items.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase text-muted-foreground">{title}</h2>
      {items.map((c) => (
        <Link key={c.slug} to="/campaigns/$slug" params={{ slug: c.slug }}
          className="block rounded-xl border p-4 hover:bg-muted/50">
          <div className="font-semibold">{c.title}</div>
          <div className="text-xs text-muted-foreground">{c.ends_at}</div>
        </Link>
      ))}
    </section>
  );
}
```

- [ ] **Step 3: Detail route**

Create `src/routes/_app.campaigns.$slug.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useCampaign, useCampaignLeaderboard } from "@/lib/queries/kocmax";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/_app/campaigns/$slug")({ component: CampaignDetail });

function CampaignDetail() {
  const { slug } = Route.useParams();
  const t = useT();
  const { data, isLoading } = useCampaign(slug);
  const { data: board = [] } = useCampaignLeaderboard(slug);

  if (isLoading || !data) return <div className="p-4">…</div>;
  const { campaign, missions, my_progress } = data;
  const pct = Math.min(100, Math.round((my_progress.approved / Math.max(1, campaign.goal_target)) * 100));

  return (
    <div className="mx-auto max-w-3xl p-4 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{campaign.title}</h1>
        <p className="text-sm text-muted-foreground">{campaign.description}</p>
        <p className="text-xs">{t("app.campaigns.endsIn")}: {campaign.ends_at}</p>
      </header>

      <section className="rounded-xl border p-4">
        <div className="mb-1 text-sm">{t("app.campaigns.goalProgress", { x: my_progress.approved, y: campaign.goal_target })}</div>
        <div className="h-2 rounded bg-muted"><div className="h-2 rounded bg-primary" style={{ width: `${pct}%` }} /></div>
        {my_progress.goal_reached && <div className="mt-2 text-xs text-green-600">✓ {t("app.campaigns.completionBonus")}</div>}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t("app.campaigns.completionBonus")} · {t("app.campaigns.prizes")}</h2>
        <div className="text-sm">+{campaign.completion_bonus_points} pts · +{campaign.completion_bonus_xp} XP</div>
        <ul className="text-sm">
          {campaign.prize_tiers.map((tr, i) => (
            <li key={i}>#{tr.rank_from}{tr.rank_to !== tr.rank_from ? `–${tr.rank_to}` : ""}: HK${tr.cash} · {tr.points} pts · {tr.xp} XP</li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t("app.campaigns.title")}</h2>
        {missions.map((m) => (<div key={m.mission_id} className="rounded border p-2 text-sm">{m.missions?.title}</div>))}
      </section>

      <section className="space-y-1">
        <h2 className="text-sm font-semibold">{t("app.campaigns.leaderboard")}</h2>
        {board.map((row) => (
          <div key={row.creator_id}
            className={`flex justify-between rounded p-2 text-sm ${row.rank === my_progress.rank ? "bg-primary/10 font-semibold" : ""}`}>
            <span>#{row.rank} {row.display_name || "—"}</span>
            <span>{row.approved}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
```

> Adapt `useT`/translation, `Link`, and class tokens to the repo's actual conventions (copy from `_app.mission.$missionSlug.tsx`). The route **paths** (`/_app/campaigns`, `/_app/campaigns/`, `/_app/campaigns/$slug`) must match the file names exactly so codegen wires them.

- [ ] **Step 4: Add the creator nav entry**

In `src/components/navItems.ts`, add to `NAV_ITEMS` (import a `Trophy`/`Medal` icon from lucide):

```ts
  { to: "/campaigns", labelKey: "app.nav.campaigns", icon: Trophy, exact: false },
```

- [ ] **Step 5: Route-stub test**

Create `src/routes/-_app.campaigns.test.tsx` (mirror `-admin.missions.index.test.tsx`):

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ useCampaigns: vi.fn(), useCampaign: vi.fn(), useCampaignLeaderboard: vi.fn() }));
vi.mock("@tanstack/react-router", async (i) => ({
  ...(await i<object>()),
  createFileRoute: () => (o: unknown) => o,
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => <a href={to}>{children}</a>,
}));
vi.mock("@/lib/queries/kocmax", () => ({
  useCampaigns: h.useCampaigns, useCampaign: h.useCampaign, useCampaignLeaderboard: h.useCampaignLeaderboard,
}));
vi.mock("@/lib/i18n", () => ({ useT: () => (k: string) => k }));

import { Route as ListRoute } from "./_app.campaigns.index";

function r(C: React.ComponentType) {
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("campaigns list", () => {
  beforeEach(() => vi.clearAllMocks());
  it("splits active vs upcoming and links to detail", () => {
    h.useCampaigns.mockReturnValue({ data: [
      { slug: "now", title: "進行中挑戰", starts_at: "2000-01-01T00:00:00Z", ends_at: "2099-01-01T00:00:00Z", goal_target: 3 },
    ], isLoading: false });
    r((ListRoute as unknown as { component: React.ComponentType }).component);
    expect(screen.getByText("進行中挑戰")).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Verify + commit**

Run: `npm run type-check && npx vitest run src/routes/-_app.campaigns.test.tsx`
Expected: type-check passes (route tree regenerates), test green.

```bash
git add src/routes/_app.campaigns.tsx src/routes/_app.campaigns.index.tsx src/routes/_app.campaigns.\$slug.tsx src/routes/-_app.campaigns.test.tsx src/components/navItems.ts
git commit -m "feat(campaigns): creator routes (list + detail + leaderboard) + nav + route-stub test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 21: Operator routes (`admin.campaigns` trio) + `adminKeys`/fetchers + nav + test

**Files:**
- Modify: `src/lib/admin.ts` (keys, fetchers, mutations, types)
- Create: `src/routes/admin.campaigns.index.tsx`
- Create: `src/routes/admin.campaigns.new.tsx`
- Create: `src/routes/admin.campaigns.$id.tsx`
- Create: `src/routes/-admin.campaigns.test.tsx`
- Modify: `src/components/admin/adminNavItems.ts` (nav entry)

- [ ] **Step 1: Add admin keys, types, fetchers, mutations in `src/lib/admin.ts`**

```ts
// types
export type AdminCampaign = {
  id: string; workspace_id: string; slug: string; title: string; description: string | null; status: string;
  starts_at: string; ends_at: string; goal_target: number;
  completion_bonus_points: number; completion_bonus_xp: number;
  prize_tiers: { rank_from: number; rank_to: number; cash: number; points: number; xp: number }[];
};
export type CampaignDraftInput = Omit<AdminCampaign, "id" | "status"> & { workspace_id: string };

// keys — add to the adminKeys object:
  campaigns: (workspace: string, status: string) => ["admin-campaigns", workspace, status] as const,
  campaignDetail: (id: string) => ["admin-campaign", id] as const,
  campaignLeaderboard: (id: string) => ["admin-campaign-board", id] as const,

// fetchers + mutations (mirror fetchApplications/acceptApplication; `adminFetch` adds the secret):
export function fetchCampaigns(workspace: string, status: string) {
  const qs = new URLSearchParams();
  if (workspace) qs.set("workspace", workspace);
  if (status) qs.set("status", status);
  return adminFetch<{ campaigns: AdminCampaign[] }>(`/admin/campaigns${qs.toString() ? `?${qs}` : ""}`);
}
export function fetchCampaign(id: string) {
  return adminFetch<{ campaign: AdminCampaign; missions: unknown[]; participants: number }>(`/admin/campaigns/${id}`);
}
export function createCampaign(body: Partial<CampaignDraftInput>) {
  return adminFetch<{ campaign: AdminCampaign }>("/admin/campaigns", { method: "POST", body: JSON.stringify(body) });
}
export function updateCampaign(id: string, patch: Partial<CampaignDraftInput>) {
  return adminFetch<{ campaign: AdminCampaign }>(`/admin/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}
export function publishCampaign(id: string) {
  return adminFetch(`/admin/campaigns/${id}/publish`, { method: "POST", body: JSON.stringify({}) });
}
export function attachCampaignMission(id: string, mission_id: string) {
  return adminFetch(`/admin/campaigns/${id}/missions`, { method: "POST", body: JSON.stringify({ mission_id }) });
}
export function detachCampaignMission(id: string, missionId: string) {
  return adminFetch(`/admin/campaigns/${id}/missions/${missionId}`, { method: "DELETE" });
}
export function closeCampaign(id: string) {
  return adminFetch(`/admin/campaigns/${id}/close`, { method: "POST", body: JSON.stringify({}) });
}
export function settleCampaign(id: string) {
  return adminFetch(`/admin/campaigns/${id}/settle`, { method: "POST", body: JSON.stringify({}) });
}
export function fetchCampaignLeaderboard(id: string) {
  return adminFetch<{ leaderboard: unknown[] }>(`/admin/campaigns/${id}/leaderboard`);
}
```

> `settleCampaign` may resolve to a 402 (`insufficient_budget`) — surface that distinctly in the `$id` UI ("top up the workspace budget, then settle again"). Confirm how `adminFetch` exposes the HTTP status / error code (it likely throws an `AdminRequestError` carrying `code`/`status`); branch on `insufficient_budget`.

- [ ] **Step 2: List route**

Create `src/routes/admin.campaigns.index.tsx` — mirror `admin.missions.index.tsx` exactly (auth + workspace contexts, `useQuery(adminKeys.campaigns(workspace, status), () => fetchCampaigns(...))`, a table with status chips, and Publish/Close/Settle buttons calling the mutations + invalidating `adminKeys.campaigns`). Wire a "New" link to `/admin/campaigns/new`.

- [ ] **Step 3: New + detail routes**

Create `src/routes/admin.campaigns.new.tsx` (a draft form: slug/title/description/window/goal/bonus points+xp/prize-tier editor → `createCampaign` → navigate to `/admin/campaigns/$id`) and `src/routes/admin.campaigns.$id.tsx` (edit form honoring the edit-lock matrix — disable locked fields once `status !== 'draft'`; an attach/detach mission picker; Publish/Close/Settle actions). Mirror the form scaffolding in `admin.missions.new.tsx` / `admin.missions.$missionId.tsx` for the auth context, mutation + `useNavigate`, and error-field rendering. The prize-tier editor is a small repeatable row group `[rank_from, rank_to, cash, points, xp]`; validate client-side with the same rules as `validatePrizeTiers` before submit (the server re-validates).

- [ ] **Step 4: Operator nav entry**

In `src/components/admin/adminNavItems.ts`, add to the **Library** group's `items`:

```ts
      { to: "/admin/campaigns", labelKey: "app.admin.tabCampaigns", icon: Trophy, exact: false },
```

- [ ] **Step 5: Route-stub test**

Create `src/routes/-admin.campaigns.test.tsx` mirroring `-admin.missions.index.test.tsx`: mock `@/lib/admin` (`fetchCampaigns`, `publishCampaign`, `closeCampaign`, `settleCampaign`, `adminKeys`), the admin auth/workspace contexts, render `Route.options.component`, assert a campaign row renders and Publish calls `publishCampaign(id)`.

- [ ] **Step 6: Verify + commit**

Run: `npm run type-check && npx vitest run src/routes/-admin.campaigns.test.tsx`
Expected: green.

```bash
git add src/lib/admin.ts src/routes/admin.campaigns.index.tsx src/routes/admin.campaigns.new.tsx src/routes/admin.campaigns.\$id.tsx src/routes/-admin.campaigns.test.tsx src/components/admin/adminNavItems.ts
git commit -m "feat(campaigns): operator console routes (list/new/manage) + admin keys/fetchers + nav

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase F — Verification & ship

### Task 22: Full gate, prod-apply runbook, PR

**Files:** none (verification + ops)

- [ ] **Step 1: Full local gate**

Run, in order:
```bash
npm run check:esm        # all server/** relative imports end in .js
npm run lint
npm run type-check       # regenerates the TanStack route tree
npx vitest run           # all unit + route-stub tests
set -a; source .env.test.local; set +a
npm run test:integration # includes server/test/campaigns.test.ts
npm run build
```
Expected: every command green. Fix any failure before proceeding.

- [ ] **Step 2: Open the PR (do NOT deploy from local)**

```bash
git push -u origin feat/campaigns-g1
gh pr create --title "Campaigns & Challenges (G1) Slice 1 — operator + creator" \
  --body "$(cat <<'EOF'
Implements the G1 Slice 1 design spec (operator authoring + creator loop): time-boxed
challenges over a mission set, points+XP completion bonus, live leaderboard, top-N cash
prizes at manual settlement. Exactly-once payout ledger; does not modify approve_submission.

Includes vendored prerequisite `0024_brand_budget.sql` (byte-identical from feat/brand-portal-slice3;
idempotent — no-op on prod which already has it via raw SQL).

Spec: docs/superpowers/specs/2026-06-28-campaigns-challenges-g1-design.md
Plan: docs/superpowers/plans/2026-06-28-campaigns-challenges-g1-slice1.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Prod migration runbook (AFTER PR is merged — performed deliberately, not in CI)**

The migration **tracker is out of sync** (records only through `0022`; `0018–0024` are live via raw SQL). A `db push` would replay `0018–0024` and conflict. Apply `0025` to prod (`mhkoayftiuojxlrkollf`) via **raw SQL** (Supabase MCP `execute_sql`/`apply_migration`):
  1. **`0024_brand_budget.sql` is already in prod** → do **not** re-run it.
  2. **Verify the live notifications constraint name first:**
     `select conname from pg_constraint where conrelid='public.notifications'::regclass and contype='c';`
     If it is not `notifications_type_check`, edit step 10's `drop constraint if exists <name>` to the live name before applying.
  3. Apply the `0025_campaigns.sql` body.
  4. **Reload PostgREST:** `notify pgrst, 'reload schema';` (or the project's reload action).
  5. Smoke-check in prod: the three `campaign*` tables, the four functions, and an `insert … 'campaign_goal_reached' …` into `notifications` (then delete it) succeed.
  6. Document in memory + a comment: "0024 + 0025 applied to prod via raw SQL — not in tracker, do not re-apply."

- [ ] **Step 4: Update project memory**

Update `adfocate-g1-campaigns-status.md`: mark Slice 1 implemented (PR #), and **correct the stale fact** — only PR #46 (brand-portal-slice1) is merged to `main`; the budget foundation `0024_brand_budget.sql` was **vendored** into this branch (slices #47/#48/#49 remain unmerged local branches). Update `MEMORY.md`'s line accordingly.

---

## Self-Review (run against the spec — completed during planning)

**Spec coverage:** §1 data model → Task 2; §2 window → Tasks 5/8 + Task 13 grace test; §3 bonus engine → Tasks 6/8 + Task 13; §4 settlement → Task 7 + Tasks 14/15; §5 ranker → Task 5; §6 mission-set → Tasks 5/8/16; §7 notifications → Tasks 9/19; §8 auth/RLS → Tasks 3/16/17/18; §9 migration order → Tasks 2–10; §10 surfaces → Tasks 17–21; §11 edge cases → Tasks 13–16 (each row maps to a test or a constraint); §12 testing → Tasks 11–16, 20, 21; §13 risks → Task 22 runbook. **Slice 1b is intentionally excluded** (separate plan).

**Known adaptation points the implementer MUST confirm (flagged inline, not placeholders):** the JWT-scoped test client helper name (Task 16 Step 1); `creators` having `display_name/avatar_url/level` as stored columns vs computed (Task 17 Step 1 note); the `renderNotification` entrypoint signature (Task 19); the i18n key-parity guard (Task 19); lucide `Trophy`/`Award` export (Task 19 Step 1); the notification trigger's actual name for sort-order (Task 8 Step 2); `Env` export location (Task 18). Each has a concrete `grep`/`node -e` check and a fallback.

**Type consistency:** `CampaignInput`/`CampaignRecord`/`PrizeTier` defined once in `campaignAuthoring.ts` and imported everywhere; `source_ref` always built via `campaignBonusRef`/`campaignPrizeRef`; `rank_campaign` returns `(creator_id, rank, approved, avg_quality)` consumed identically by `shapeLeaderboard`, `settle_campaign`, and both routes; ledger column names (`delta`/`amount`/`available`/`balance`) match the verified reference table.

**Scope:** single implementation plan, one feature, one migration (+ vendored prerequisite). Not decomposed further — Slice 1 is cohesive (engines + the two surfaces that exercise them).
