-- 0019_mission_brief_rich.sql
-- Slice B2: richer mission brief. Additive, nullable-or-defaulted.
-- Existing table-level grants (0004) + RLS policy (0002, missions_workspace) cover new columns,
-- so no grant/RLS change is needed for creators (role `authenticated`) to read these.
alter table public.missions
  add column target_audience text,
  add column dos             text[] not null default '{}',
  add column donts           text[] not null default '{}',
  add column key_messages    text[] not null default '{}',
  add column reference_links text[] not null default '{}';
