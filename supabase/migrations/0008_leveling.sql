-- Slice 6A: leveling engine. Keep creators.level a pure function of creators.xp,
-- and track the highest level the creator has been *shown* a celebration for.

-- 1. Threshold function: highest level whose XP requirement is <= p_xp ----------
create or replace function public.level_for_xp(p_xp int) returns text
language sql immutable set search_path = public as $$
  select case
    when coalesce(p_xp, 0) >= 100000 then 'L6'
    when coalesce(p_xp, 0) >=  40000 then 'L5'
    when coalesce(p_xp, 0) >=  15000 then 'L4'
    when coalesce(p_xp, 0) >=   6000 then 'L3'
    when coalesce(p_xp, 0) >=   2000 then 'L2'
    when coalesce(p_xp, 0) >=    500 then 'L1'
    else 'L0'
  end
$$;

-- 2. Column: highest level the creator has been shown a celebration for ---------
alter table public.creators
  add column level_seen text not null default 'L0';

-- 3. Trigger: any write that changes xp recomputes level (never touches level_seen).
create or replace function public.set_level_from_xp() returns trigger
language plpgsql set search_path = public as $$
begin
  new.level := public.level_for_xp(new.xp);
  return new;
end;
$$;

create trigger creators_set_level
  before insert or update of xp on public.creators
  for each row execute function public.set_level_from_xp();

-- 4. Backfill: recompute level for existing rows, then mark it already-seen so the
--    rollout does NOT retro-celebrate creators already past a threshold.
update public.creators set level = public.level_for_xp(xp);
update public.creators set level_seen = level;

-- 5. Grant: the user client may acknowledge its own celebration (RLS-scoped by the
--    creators_self_update policy from 0003). level/xp remain NOT self-updatable.
grant update (level_seen) on public.creators to authenticated;
