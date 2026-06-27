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
