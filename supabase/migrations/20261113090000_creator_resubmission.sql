-- Creator resubmission after rejection, bounded by missions.revision_limit.
-- Additive only: mission_submissions stays the assignment/reward anchor, a
-- resubmission preserves the prior rejection in an immutable event row, and no
-- points, XP, earnings or budget values are written here.
begin;

alter table public.mission_submissions
  add column resubmit_count smallint not null default 0
  check (resubmit_count >= 0);

create table public.mission_submission_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  mission_submission_id uuid not null references public.mission_submissions(id) on delete cascade,
  creator_id uuid not null references public.creators(id) on delete cascade,
  event text not null check (event in ('resubmitted')),
  previous_status text not null,
  reviewer_notes_snapshot text,
  points_snapshot integer not null default 0,
  xp_snapshot integer not null default 0,
  evidence_revision_snapshot bigint not null default 0,
  payload_hash text not null,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (mission_submission_id, request_id)
);

create index mission_submission_events_submission_idx
  on public.mission_submission_events (mission_submission_id, created_at desc);
create index mission_submission_events_workspace_idx
  on public.mission_submission_events (workspace_id, created_at desc);

alter table public.mission_submission_events enable row level security;
create policy mission_submission_events_creator_read on public.mission_submission_events
  for select to authenticated using (creator_id = auth.uid());

revoke all on public.mission_submission_events from public, anon, authenticated;
grant select on public.mission_submission_events to authenticated;
grant all on public.mission_submission_events to service_role;

create or replace function public.resubmit_mission(
  p_mission uuid,
  p_urls text[],
  p_data jsonb,
  p_request uuid
)
returns public.mission_submissions
language plpgsql security definer set search_path = ''
as $$
declare
  v_creator uuid := auth.uid();
  v_mode text;
  v_mission_status text;
  v_limit smallint;
  v_sla integer;
  v_deadline timestamptz;
  v_sub public.mission_submissions;
  v_existing public.mission_submission_events;
  v_hash text;
begin
  if v_creator is null then raise exception 'not_authenticated'; end if;
  if p_request is null then raise exception 'invalid_request'; end if;
  if p_urls is null or array_length(p_urls, 1) is null then raise exception 'empty_urls'; end if;
  if not private.valid_legacy_evidence(p_urls) then raise exception 'invalid_evidence'; end if;

  select creator_workflow_mode, status, revision_limit, review_sla_hours, deadline
    into v_mode, v_mission_status, v_limit, v_sla, v_deadline
    from public.missions where id = p_mission;
  if v_mode is null then raise exception 'wrong_state'; end if;
  if v_mode = 'active_workspace' then raise exception 'workflow_mode_mismatch'; end if;
  if v_mission_status <> 'active' then raise exception 'not_open'; end if;

  select * into v_sub from public.mission_submissions
    where mission_id = p_mission and creator_id = v_creator
    for update;
  if v_sub.id is null then raise exception 'wrong_state'; end if;

  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'mission', p_mission,
    'urls', to_jsonb(p_urls),
    'data', coalesce(p_data, '{}'::jsonb)
  )::text, 'UTF8')), 'hex');

  select * into v_existing from public.mission_submission_events
    where mission_submission_id = v_sub.id and request_id = p_request;
  if v_existing.id is not null then
    if v_existing.payload_hash <> v_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
    end if;
    return v_sub;
  end if;

  if v_sub.status <> 'rejected' then raise exception 'wrong_state'; end if;
  if v_sub.resubmit_count >= coalesce(v_limit, 0) then raise exception 'revision_limit_reached'; end if;
  if v_deadline is not null and v_deadline < now() then raise exception 'deadline_passed'; end if;

  insert into public.mission_submission_events(
    workspace_id, mission_submission_id, creator_id, event, previous_status,
    reviewer_notes_snapshot, points_snapshot, xp_snapshot,
    evidence_revision_snapshot, payload_hash, request_id
  ) values (
    v_sub.workspace_id, v_sub.id, v_sub.creator_id, 'resubmitted', v_sub.status,
    v_sub.reviewer_notes, v_sub.points_awarded, v_sub.xp_awarded,
    v_sub.evidence_revision, v_hash, p_request
  );

  update public.mission_submissions set
    status = 'submitted',
    content_urls = p_urls,
    submission_data = coalesce(p_data, '{}'::jsonb),
    submitted_at = now(),
    review_deadline = now() + make_interval(hours => coalesce(v_sla, 48)),
    reviewed_at = null,
    reviewer_notes = null,
    resubmit_count = resubmit_count + 1
    where id = v_sub.id
    returning * into v_sub;

  return v_sub;
end;
$$;

revoke all on function public.resubmit_mission(uuid, text[], jsonb, uuid) from public, anon;
grant execute on function public.resubmit_mission(uuid, text[], jsonb, uuid) to authenticated, service_role;

commit;
