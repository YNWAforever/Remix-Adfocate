-- Slice 9: application-gated missions. Reuses mission_submissions with two new
-- states (applied, declined). Accepted applicant becomes 'joined' → flows into the
-- existing submit_mission unchanged. apply = creator (0 XP, no quota); accept/decline
-- = service-only (accept mirrors join_mission: filled++ under quota + 10 XP).

-- 1. Status check: add 'applied' and 'declined' ------------------------------
alter table public.mission_submissions drop constraint mission_submissions_status_check;
alter table public.mission_submissions add constraint mission_submissions_status_check
  check (status in ('applied','joined','submitted','under_review','approved','rejected','expired','declined'));

-- 2. apply_mission: → 'applied' for an application mission, 0 XP, no filled++ --
create or replace function public.apply_mission(p_mission uuid)
returns public.mission_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_creator uuid := auth.uid();
  v_ws uuid;
  m record;
  v_sub public.mission_submissions;
begin
  if v_creator is null then raise exception 'not_authenticated'; end if;

  select workspace_id into v_ws from public.creators where id = v_creator;
  if v_ws is null then raise exception 'not_found'; end if;

  select id, workspace_id, status, access_type, deadline
    into m from public.missions where id = p_mission;
  if m.id is null or m.workspace_id <> v_ws then raise exception 'not_found'; end if;
  if m.status <> 'active' then raise exception 'closed'; end if;
  if m.access_type <> 'application' then raise exception 'not_application'; end if;
  if m.deadline is not null and m.deadline < current_date then raise exception 'closed'; end if;

  -- unique(mission_id, creator_id) is the real dedupe guard (handles a double-tap race).
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

-- 3. accept_application: 'applied' → 'joined', filled++ under quota, +10 XP ----
create or replace function public.accept_application(p_submission uuid)
returns public.mission_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_sub public.mission_submissions;
  v_rows int;
begin
  select * into v_sub from public.mission_submissions where id = p_submission for update;
  if v_sub.id is null then raise exception 'not_found'; end if;
  if v_sub.status = 'joined' then return v_sub; end if;                       -- idempotent
  if v_sub.status <> 'applied' then raise exception 'wrong_state'; end if;

  update public.missions set filled = filled + 1
    where id = v_sub.mission_id and filled < quota;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'mission_full'; end if;

  update public.mission_submissions set
    status = 'joined', xp_awarded = xp_awarded + 10
    where id = p_submission
    returning * into v_sub;
  update public.creators set xp = xp + 10 where id = v_sub.creator_id;
  return v_sub;
end;
$$;

-- 4. decline_application: 'applied' → 'declined', no XP, no quota -------------
create or replace function public.decline_application(p_submission uuid, p_notes text)
returns public.mission_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_sub public.mission_submissions;
begin
  select * into v_sub from public.mission_submissions where id = p_submission for update;
  if v_sub.id is null then raise exception 'not_found'; end if;
  if v_sub.status = 'declined' then return v_sub; end if;                     -- idempotent
  if v_sub.status <> 'applied' then raise exception 'wrong_state'; end if;

  update public.mission_submissions set
    status = 'declined', reviewer_notes = p_notes, reviewed_at = now()
    where id = p_submission
    returning * into v_sub;
  return v_sub;
end;
$$;

-- 5. Grants: apply = creator; accept/decline = service-only ------------------
revoke all on function public.apply_mission(uuid)             from public, anon;
revoke all on function public.accept_application(uuid)        from public, anon, authenticated;
revoke all on function public.decline_application(uuid, text) from public, anon, authenticated;
grant execute on function public.apply_mission(uuid)             to authenticated, service_role;
grant execute on function public.accept_application(uuid)        to service_role;
grant execute on function public.decline_application(uuid, text) to service_role;
