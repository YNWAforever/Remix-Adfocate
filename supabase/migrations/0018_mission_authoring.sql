-- 0018_mission_authoring.sql
-- Slice B1 (mission authoring): constrain the lifecycle to a known set and add
-- authoring/audit columns. Additive + a CHECK over already-'active' rows.
-- (Most status cols use a CHECK; creators.status / redemption_gifts.status do not —
--  the CHECK is still desirable here.)

alter table public.missions
  add constraint missions_status_chk check (status in ('draft','active','closed'));

alter table public.missions
  add column if not exists updated_at   timestamptz not null default now(),
  add column if not exists published_at timestamptz,
  add column if not exists closed_at    timestamptz,
  add column if not exists created_by   uuid references auth.users(id) on delete set null;

-- created_by stays NULL for every B1-authored mission (the secret-gated operator has no
-- auth.uid). It is a forward hook for self-serve (B3); not live attribution.
