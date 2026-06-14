-- Slice 4: mission submissions (the KOC earn loop) + state-machine RPCs.

-- 1. Table ------------------------------------------------------------------
create table public.mission_submissions (
  id uuid primary key default gen_random_uuid(),
  mission_id   uuid not null references public.missions(id)   on delete cascade,
  creator_id   uuid not null references public.creators(id)   on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  status text not null default 'joined'
    check (status in ('joined','submitted','under_review','approved','rejected','expired')),
  content_urls    text[] not null default '{}',
  submission_data jsonb  not null default '{}',
  reviewer_notes  text,
  xp_awarded      integer not null default 0,
  points_awarded  integer not null default 0,
  submitted_at    timestamptz,
  reviewed_at     timestamptz,
  review_deadline timestamptz,
  created_at      timestamptz not null default now(),
  unique (mission_id, creator_id)
);

create index mission_submissions_creator_idx on public.mission_submissions (creator_id);
create index mission_submissions_mission_idx on public.mission_submissions (mission_id);
create index mission_submissions_status_idx  on public.mission_submissions (workspace_id, status);

-- 2. RLS: a creator sees only their own submissions. All WRITES go through the
--    SECURITY DEFINER RPCs below (quota + awards atomic; xp/points service-only).
alter table public.mission_submissions enable row level security;
create policy submissions_self on public.mission_submissions
  for select using (creator_id = auth.uid());

-- 3. Grants (auto_expose_new_tables=false → a fresh table gets none; Slice 3 lesson)
grant select on public.mission_submissions to authenticated;
grant all    on public.mission_submissions to service_role;

-- 4. Level ordinal helper (no level recompute this slice; every creator is L0,
--    so only required_level='L0' missions are joinable in practice — honest gate).
create or replace function public.level_ordinal(p_level text) returns int
language sql immutable set search_path = public as $$
  select coalesce(array_position(array['L0','L1','L2','L3','L4','L5','L6'], p_level), 0)
$$;

-- 5. join_mission: atomic quota + level gate + dedupe, +10 XP -----------------
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
  if public.level_ordinal(v_level) < public.level_ordinal(m.required_level)
    then raise exception 'level_locked'; end if;
  if exists (select 1 from public.mission_submissions
             where mission_id = p_mission and creator_id = v_creator)
    then raise exception 'already_joined'; end if;

  update public.missions set filled = filled + 1
    where id = p_mission and filled < quota;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'mission_full'; end if;

  -- The exists() check above is a snapshot read; under a race (e.g. a double-click
  -- firing two joins) both can pass it. The unique(mission_id,creator_id) constraint
  -- is the real guard — translate its violation into the friendly 'already_joined'.
  -- Re-raising rolls back the whole tx, including the filled++ above (no orphan fill).
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

-- 6. submit_mission: joined → submitted, +25 XP ------------------------------
create or replace function public.submit_mission(p_mission uuid, p_urls text[], p_data jsonb)
returns public.mission_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_creator uuid := auth.uid();
  v_sub public.mission_submissions;
begin
  if v_creator is null then raise exception 'not_authenticated'; end if;
  if p_urls is null or array_length(p_urls, 1) is null then raise exception 'empty_urls'; end if;

  select * into v_sub from public.mission_submissions
    where mission_id = p_mission and creator_id = v_creator for update;
  if v_sub.id is null then raise exception 'wrong_state'; end if;
  if v_sub.status <> 'joined' then raise exception 'wrong_state'; end if;

  update public.mission_submissions set
    status = 'submitted',
    content_urls = p_urls,
    submission_data = coalesce(p_data, '{}'::jsonb),
    submitted_at = now(),
    review_deadline = now() + interval '48 hours',   -- fixed SLA; per-mission column lands with the S9 cron
    xp_awarded = xp_awarded + 25
    where id = v_sub.id
    returning * into v_sub;
  update public.creators set xp = xp + 25 where id = v_creator;
  return v_sub;
end;
$$;

-- 7. approve_submission: award points_reward + 100 XP, idempotent (service-only)
create or replace function public.approve_submission(p_submission uuid, p_notes text)
returns public.mission_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_sub public.mission_submissions;
  v_points int;
  v_title text;
  v_bal int;
begin
  select * into v_sub from public.mission_submissions where id = p_submission for update;
  if v_sub.id is null then raise exception 'not_found'; end if;
  if v_sub.status = 'approved' then return v_sub; end if;                         -- idempotent
  if v_sub.status not in ('submitted','under_review') then raise exception 'wrong_state'; end if;

  select points_reward, title into v_points, v_title
    from public.missions where id = v_sub.mission_id;

  update public.point_balances set balance = balance + v_points, updated_at = now()
    where creator_id = v_sub.creator_id and workspace_id = v_sub.workspace_id
    returning balance into v_bal;
  if v_bal is null then
    raise exception 'point_balances row missing for creator %', v_sub.creator_id;
  end if;

  insert into public.point_transactions
    (creator_id, workspace_id, type, delta, balance_after, source_ref, description)
    values (v_sub.creator_id, v_sub.workspace_id, 'earn', v_points, v_bal,
            'mission_submission:' || p_submission, v_title);

  update public.mission_submissions set
    status = 'approved', reviewed_at = now(), reviewer_notes = p_notes,
    points_awarded = v_points, xp_awarded = xp_awarded + 100
    where id = p_submission
    returning * into v_sub;
  update public.creators set xp = xp + 100 where id = v_sub.creator_id;
  return v_sub;
end;
$$;

-- 8. reject_submission: → rejected, no award, idempotent (service-only) -------
create or replace function public.reject_submission(p_submission uuid, p_notes text)
returns public.mission_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_sub public.mission_submissions;
begin
  select * into v_sub from public.mission_submissions where id = p_submission for update;
  if v_sub.id is null then raise exception 'not_found'; end if;
  if v_sub.status = 'rejected' then return v_sub; end if;                         -- idempotent
  if v_sub.status not in ('submitted','under_review') then raise exception 'wrong_state'; end if;

  update public.mission_submissions set
    status = 'rejected', reviewed_at = now(), reviewer_notes = p_notes
    where id = p_submission
    returning * into v_sub;
  return v_sub;
end;
$$;

-- 9. Execute grants: KOCs may join/submit (auth.uid); only the service role
--    (operator) may approve/reject.
revoke all on function public.join_mission(uuid)                  from public, anon;
revoke all on function public.submit_mission(uuid, text[], jsonb) from public, anon;
revoke all on function public.approve_submission(uuid, text)      from public, anon, authenticated;
revoke all on function public.reject_submission(uuid, text)       from public, anon, authenticated;
grant execute on function public.join_mission(uuid)                  to authenticated, service_role;
grant execute on function public.submit_mission(uuid, text[], jsonb) to authenticated, service_role;
grant execute on function public.approve_submission(uuid, text)      to service_role;
grant execute on function public.reject_submission(uuid, text)       to service_role;
