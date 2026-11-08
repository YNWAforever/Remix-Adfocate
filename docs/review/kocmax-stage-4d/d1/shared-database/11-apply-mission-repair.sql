-- Only the reviewed final baseline routine. Existing signature/ACL/owner retained by CREATE OR REPLACE.
-- 4. apply_mission: add the same effective-level gate (it had none before).
create or replace function public.apply_mission(p_mission uuid)
returns public.mission_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_creator uuid := auth.uid();
  v_ws uuid;
  v_level text;
  m record;
  v_sub public.mission_submissions;
begin
  if v_creator is null then raise exception 'not_authenticated'; end if;

  select workspace_id, level into v_ws, v_level
    from public.creators where id = v_creator;
  if v_ws is null then raise exception 'not_found'; end if;

  select id, workspace_id, status, access_type, deadline, required_level
    into m from public.missions where id = p_mission;
  if m.id is null or m.workspace_id <> v_ws then raise exception 'not_found'; end if;
  if m.status <> 'active' then raise exception 'closed'; end if;
  if m.access_type <> 'application' then raise exception 'not_application'; end if;
  if m.deadline is not null and m.deadline < current_date then raise exception 'closed'; end if;

  -- level_ordinal is 1-indexed (L0=1, L1=2, L2=3...) — compare against
  -- level_ordinal('L2'), NOT a bare 2, so the verification gate applies to L2+
  -- only and L0/L1 missions stay XP-only.
  if public.level_ordinal(m.required_level) >= public.level_ordinal('L2') then
    if public.level_ordinal(v_level) < public.level_ordinal(m.required_level) then
      raise exception 'level_locked';
    elsif not exists (
      select 1 from public.creator_social_accounts
      where creator_id = v_creator and owner_verified
    ) then
      raise exception 'verification_required';
    end if;
  elsif public.level_ordinal(v_level) < public.level_ordinal(m.required_level) then
    raise exception 'level_locked';
  end if;

  begin
    insert into public.mission_submissions
      (mission_id, creator_id, workspace_id, status, xp_awarded)
      values (p_mission, v_creator, v_ws, 'applied', 0)
      returning * into v_sub;
  exception when unique_violation then
    raise exception 'already_applied';
  end;
  return v_sub;
end;
$$;
