-- Explicit rollout-only conversion for pristine legacy assignment anchors.
-- Existing workflow history and the legacy reward anchor remain immutable.
create or replace function public.migrate_pristine_joined_active_mission(p_submission uuid)
returns public.mission_workflows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.mission_submissions;
  v_workflow public.mission_workflows;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'not_authorized';
  end if;

  -- Match private.create_mission_workflow's first lock so concurrent rollout,
  -- join, and workflow creation attempts serialize on the same anchor row.
  select * into v_submission
  from public.mission_submissions
  where id = p_submission
  for update;

  if v_submission.id is null then
    raise exception 'not_found';
  end if;

  if v_submission.status <> 'joined'
    or coalesce(cardinality(v_submission.content_urls), 0) <> 0
    or v_submission.submission_data <> '{}'::jsonb
    or v_submission.reviewer_notes is not null
    or v_submission.submitted_at is not null
    or v_submission.reviewed_at is not null
    or v_submission.review_deadline is not null
    or v_submission.points_awarded <> 0
    or v_submission.xp_awarded <> 0
  then
    raise exception 'wrong_state';
  end if;

  -- This administrative migration is intentionally not idempotent: an
  -- existing workflow proves that the legacy record is no longer pristine.
  if exists (
    select 1
    from public.mission_workflows
    where mission_submission_id = v_submission.id
  ) then
    raise exception 'wrong_state';
  end if;

  v_workflow := private.create_mission_workflow(p_submission);

  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, actor_type, actor_id, event_type,
    entity_type, entity_id, metadata
  ) values (
    v_submission.workspace_id, v_workflow.id, 'system', null,
    'legacy_submission_migrated', 'mission_submission', v_submission.id,
    jsonb_build_object('source_status', v_submission.status)
  );

  return v_workflow;
end;
$$;

comment on function public.migrate_pristine_joined_active_mission(uuid) is
  'Service-only rollout conversion for a locked, pristine joined legacy submission.';

revoke all on function public.migrate_pristine_joined_active_mission(uuid) from public, anon, authenticated, service_role;
grant execute on function public.migrate_pristine_joined_active_mission(uuid) to service_role;
