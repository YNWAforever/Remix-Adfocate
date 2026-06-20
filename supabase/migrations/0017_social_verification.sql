-- Slice 1: bio-code social-ownership verification + the L1->L2 trust gate.

-- 1. Verification columns on the existing social-accounts table.
alter table public.creator_social_accounts
  add column verification_code text,
  add column verification_code_expires_at timestamptz,
  add column verified_at timestamptz;

-- One verified owner per (platform, handle): cross-creator anti-abuse.
create unique index creator_social_accounts_verified_handle_uniq
  on public.creator_social_accounts (platform, handle_normalized)
  where owner_verified;

-- 2. is_trusted source of truth: XP >= 2000 AND >= 1 verified handle.
create or replace function private.creator_is_trusted(p_creator uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select xp from public.creators where id = p_creator), 0) >= 2000
     and exists (
       select 1 from public.creator_social_accounts
       where creator_id = p_creator and owner_verified
     );
$$;

-- 3. join_mission: gate on effective level (cap at L1 until verified).
create or replace function public.join_mission(p_mission uuid)
returns public.mission_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_creator uuid := auth.uid();
  v_ws uuid;
  v_level text;
  m record;
  v_rows int;
  v_sub public.mission_submissions;
begin
  if v_creator is null then raise exception 'not_authenticated'; end if;

  select workspace_id, level into v_ws, v_level
    from public.creators where id = v_creator;
  if v_ws is null then raise exception 'not_found'; end if;

  select id, workspace_id, status, access_type, deadline, required_level, quota, filled
    into m from public.missions where id = p_mission;
  if m.id is null or m.workspace_id <> v_ws then raise exception 'not_found'; end if;
  if m.status <> 'active' then raise exception 'closed'; end if;
  if m.access_type <> 'open' then raise exception 'not_open'; end if;
  if m.deadline is not null and m.deadline < current_date then raise exception 'closed'; end if;

  -- Effective-level gate. L2+ missions need both XP and a verified handle;
  -- the codes are decomposed so the message is honest (earn XP vs verify).
  if public.level_ordinal(m.required_level) >= 2 then
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

  if exists (select 1 from public.mission_submissions
             where mission_id = p_mission and creator_id = v_creator)
    then raise exception 'already_joined'; end if;

  update public.missions set filled = filled + 1
    where id = p_mission and filled < quota;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'mission_full'; end if;

  begin
    insert into public.mission_submissions
      (mission_id, creator_id, workspace_id, status, xp_awarded)
      values (p_mission, v_creator, v_ws, 'joined', 10)
      returning * into v_sub;
  exception when unique_violation then
    raise exception 'already_joined';
  end;
  update public.creators set xp = xp + 10 where id = v_creator;
  return v_sub;
end;
$$;

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

  if public.level_ordinal(m.required_level) >= 2 then
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
