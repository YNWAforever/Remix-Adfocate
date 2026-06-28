-- 0026_campaigns_s2.sql
-- Campaigns G1 Slice 2: daily auto-close, campaign_started matched broadcast, and
-- leaderboard rank-movement snapshots. Additive — does NOT touch the payout core
-- (approve_submission, campaign_progress_on_approval, grant_campaign_completion_bonus,
-- settle_campaign). See docs/superpowers/specs/2026-06-28-campaigns-challenges-g1-slice2-design.md.

-- 1. Rank snapshots — append-only daily captures, read by the leaderboard route (serviceClient).
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
grant all on public.campaign_rank_snapshots to service_role;

-- 2. close_due_campaigns — active -> closed for past-deadline campaigns. Idempotent. Never settles.
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
revoke all on function public.close_due_campaigns() from public;
revoke all on function public.close_due_campaigns() from anon;
revoke all on function public.close_due_campaigns() from authenticated;
grant execute on function public.close_due_campaigns() to service_role;

-- 3. snapshot_campaign_leaderboards — one timestamped batch of rank_campaign() rows per active campaign.
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
revoke all on function public.snapshot_campaign_leaderboards() from public;
revoke all on function public.snapshot_campaign_leaderboards() from anon;
revoke all on function public.snapshot_campaign_leaderboards() from authenticated;
grant execute on function public.snapshot_campaign_leaderboards() to service_role;

-- 4. broadcast_campaign_started — idempotent fan-out insert (matching is decided in TS).
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
revoke all on function public.broadcast_campaign_started(uuid, uuid[]) from public;
revoke all on function public.broadcast_campaign_started(uuid, uuid[]) from anon;
revoke all on function public.broadcast_campaign_started(uuid, uuid[]) from authenticated;
grant execute on function public.broadcast_campaign_started(uuid, uuid[]) to service_role;

-- 5. Extend notifications.type CHECK to admit 'campaign_started'.
--    NOTE (prod): verify the live constraint name first.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'submission_approved','submission_rejected','redemption_ready',
    'level_up','application_accepted','application_declined',
    'campaign_goal_reached','campaign_prize_awarded','campaign_started'));
