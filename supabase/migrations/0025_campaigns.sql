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

-- 6. Idempotency backbone: per-(campaign,creator) source_ref uniqueness on the existing ledgers.
create unique index if not exists pt_campaign_bonus_uniq  on public.point_transactions
  (source_ref) where left(source_ref, 15) = 'campaign_bonus:';
create unique index if not exists pt_campaign_prize_uniq  on public.point_transactions
  (source_ref) where left(source_ref, 15) = 'campaign_prize:';
create unique index if not exists et_campaign_prize_uniq  on public.earnings_transactions
  (source_ref) where left(source_ref, 15) = 'campaign_prize:';
create unique index if not exists wbt_campaign_prize_uniq on public.workspace_budget_transactions
  (source_ref) where left(source_ref, 15) = 'campaign_prize:';

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
