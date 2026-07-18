-- Correct the operator lifecycle without rewriting the already-applied Task 7 migration.
-- Define dependencies before callers because every function has an empty search_path.

create or replace function private.v_item_round_limit(p_workflow uuid, p_workspace uuid)
returns integer
language sql
security definer
set search_path = ''
stable
as $$
  select w.revision_limit::integer
  from public.mission_workflows w
  where w.id = p_workflow and w.workspace_id = p_workspace
$$;

create or replace function private.start_mission_review(
  p_workflow uuid,
  p_work_item uuid,
  p_operator uuid,
  p_workspace uuid,
  p_expected_state text
)
returns public.mission_work_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.mission_work_items;
  v_version public.mission_draft_versions;
  v_round public.mission_review_rounds;
  v_completed integer;
  v_transitioned boolean;
begin
  perform private.assert_active_mission_operator(p_operator);

  select i.* into v_item
  from public.mission_work_items i
  join public.mission_workflows w
    on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
  where i.id = p_work_item
    and i.mission_workflow_id = p_workflow
    and i.workspace_id = p_workspace
    and w.workspace_id = p_workspace
  for update of i, w;

  if v_item.id is null then raise exception 'not_found'; end if;
  if v_item.state <> p_expected_state then raise exception 'stale'; end if;
  if v_item.state not in ('submitted', 'under_review')
     or v_item.current_submitted_version_id is null then
    raise exception 'wrong_state';
  end if;
  v_transitioned := v_item.state = 'submitted';

  select v.* into v_version
  from public.mission_draft_versions v
  where v.id = v_item.current_submitted_version_id
    and v.mission_work_item_id = p_work_item
    and v.workspace_id = p_workspace
  for update;
  if v_version.id is null then raise exception 'stale'; end if;
  if exists (
    select 1 from public.mission_draft_versions newer
    where newer.mission_work_item_id = p_work_item
      and newer.workspace_id = p_workspace
      and newer.version_number > v_version.version_number
  ) then raise exception 'stale'; end if;

  select r.* into v_round
  from public.mission_review_rounds r
  where r.mission_work_item_id = p_work_item
    and r.mission_draft_version_id = v_item.current_submitted_version_id
    and r.workspace_id = p_workspace
    and r.state = 'open'
  for update;

  if v_round.id is null then
    if exists (
      select 1 from public.mission_review_rounds r
      where r.mission_work_item_id = p_work_item
        and r.workspace_id = p_workspace
        and r.state = 'open'
    ) then raise exception 'stale'; end if;
    if exists (
      select 1 from public.mission_review_rounds r
      where r.mission_work_item_id = p_work_item
        and r.mission_draft_version_id = v_item.current_submitted_version_id
        and r.workspace_id = p_workspace
        and r.state <> 'open'
    ) then raise exception 'wrong_state'; end if;

    select count(*) into v_completed
    from public.mission_review_rounds r
    where r.mission_work_item_id = p_work_item
      and r.workspace_id = p_workspace
      and r.state = 'revision_requested';

    insert into public.mission_review_rounds (
      workspace_id, mission_work_item_id, mission_draft_version_id,
      round_number, state, reviewer_id, review_started_at
    ) values (
      p_workspace, p_work_item, v_item.current_submitted_version_id,
      v_completed + 1, 'open', p_operator, now()
    ) returning * into v_round;
  else
    update public.mission_review_rounds
    set reviewer_id = p_operator,
        review_started_at = coalesce(review_started_at, now())
    where id = v_round.id and workspace_id = p_workspace;
  end if;

  update public.mission_work_items
  set state = 'under_review',
      current_reviewer_id = p_operator,
      review_started_at = coalesce(review_started_at, now()),
      updated_at = now()
  where id = p_work_item
    and mission_workflow_id = p_workflow
    and workspace_id = p_workspace
  returning * into v_item;

  if v_transitioned then
    insert into public.mission_workflow_events (
      workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id,
      event_type, entity_type, entity_id, metadata
    ) values (
      p_workspace, p_workflow, p_work_item, 'operator', p_operator,
      'mission_review_started', 'mission_draft_version', v_item.current_submitted_version_id,
      jsonb_build_object('round_number', v_round.round_number)
    );
  end if;

  perform private.refresh_mission_workflow_state(p_workflow);
  return v_item;
end;
$$;

create or replace function private.request_mission_revision(
  p_workflow uuid,
  p_work_item uuid,
  p_version uuid,
  p_operator uuid,
  p_workspace uuid,
  p_expected_state text,
  p_deadline timestamptz,
  p_items jsonb
)
returns public.mission_work_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.mission_work_items;
  v_version public.mission_draft_versions;
  v_round public.mission_review_rounds;
  v_completed integer;
  v_granted integer;
begin
  perform private.assert_active_mission_operator(p_operator);
  if p_deadline is null or p_deadline <= now() then raise exception 'validation_failed'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'validation_failed';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) x
    where coalesce(btrim(x ->> 'text'), '') = ''
       or coalesce((x ->> 'required')::boolean, true) is not true
       or coalesce(x ->> 'category', '') not in ('format', 'key_message', 'compliance', 'quality', 'other')
  ) then raise exception 'validation_failed'; end if;

  select i.* into v_item
  from public.mission_work_items i
  join public.mission_workflows w
    on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
  where i.id = p_work_item
    and i.mission_workflow_id = p_workflow
    and i.workspace_id = p_workspace
    and w.workspace_id = p_workspace
  for update of i, w;

  if v_item.id is null then raise exception 'not_found'; end if;
  if v_item.state <> p_expected_state or v_item.current_submitted_version_id <> p_version then
    raise exception 'stale';
  end if;
  if v_item.state not in ('submitted', 'under_review') then raise exception 'wrong_state'; end if;

  select v.* into v_version
  from public.mission_draft_versions v
  where v.id = p_version
    and v.mission_work_item_id = p_work_item
    and v.workspace_id = p_workspace
  for update;
  if v_version.id is null then raise exception 'stale'; end if;

  select r.* into v_round
  from public.mission_review_rounds r
  where r.mission_work_item_id = p_work_item
    and r.mission_draft_version_id = p_version
    and r.workspace_id = p_workspace
    and r.state = 'open'
  for update;
  if v_round.id is null then raise exception 'wrong_state'; end if;

  select count(*) into v_completed
  from public.mission_review_rounds r
  where r.mission_work_item_id = p_work_item
    and r.workspace_id = p_workspace
    and r.state = 'revision_requested';
  select coalesce(sum(g.granted_count), 0) into v_granted
  from public.mission_revision_grants g
  where g.mission_work_item_id = p_work_item and g.workspace_id = p_workspace;
  if v_completed >= private.v_item_round_limit(p_workflow, p_workspace) + v_granted then
    raise exception 'revision_limit_reached';
  end if;
  if v_round.round_number <> v_completed + 1 then raise exception 'stale'; end if;

  insert into public.mission_review_items (
    workspace_id, mission_review_round_id, requirement_id, category,
    required_change_text, required, position
  )
  select p_workspace, v_round.id,
    nullif(x.value ->> 'requirementId', '')::uuid,
    x.value ->> 'category', btrim(x.value ->> 'text'), true, (x.ordinality - 1)::integer
  from jsonb_array_elements(p_items) with ordinality as x(value, ordinality);

  update public.mission_review_rounds
  set state = 'revision_requested', reviewer_id = p_operator,
      review_started_at = coalesce(review_started_at, now()), decision_at = now(),
      creator_response_deadline = p_deadline
  where id = v_round.id and workspace_id = p_workspace;

  update public.mission_working_drafts
  set caption_text = v_version.caption_snapshot,
      external_draft_url = v_version.external_draft_url_snapshot,
      checklist_answers = v_version.checklist_snapshot,
      revision = revision + 1,
      last_saved_at = now()
  where mission_work_item_id = p_work_item
    and workspace_id = p_workspace
    and archived_at is null;

  update public.mission_work_items
  set state = 'revision_requested', current_reviewer_id = p_operator, updated_at = now()
  where id = p_work_item and mission_workflow_id = p_workflow and workspace_id = p_workspace
  returning * into v_item;

  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id,
    event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, p_workflow, p_work_item, 'operator', p_operator,
    'mission_revision_requested', 'mission_review_round', v_round.id,
    jsonb_build_object('round_number', v_round.round_number, 'deadline', p_deadline)
  );
  perform private.refresh_mission_workflow_state(p_workflow);
  return v_item;
end;
$$;

create or replace function private.grant_mission_revision(
  p_workflow uuid,
  p_work_item uuid,
  p_operator uuid,
  p_workspace uuid,
  p_reason text,
  p_granted_count smallint
)
returns public.mission_work_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.mission_work_items;
  v_limit integer;
  v_completed integer;
  v_granted integer;
begin
  perform private.assert_active_mission_operator(p_operator);
  if coalesce(btrim(p_reason), '') = '' or p_granted_count is null or p_granted_count <= 0 then
    raise exception 'validation_failed';
  end if;
  select i.* into v_item
  from public.mission_work_items i
  join public.mission_workflows w
    on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
  where i.id = p_work_item and i.mission_workflow_id = p_workflow
    and i.workspace_id = p_workspace and w.workspace_id = p_workspace
  for update of i, w;
  if v_item.id is null then raise exception 'not_found'; end if;
  if v_item.state not in ('submitted', 'under_review') then raise exception 'wrong_state'; end if;
  v_limit := private.v_item_round_limit(p_workflow, p_workspace);

  select count(*) into v_completed from public.mission_review_rounds r
  where r.mission_work_item_id = p_work_item and r.workspace_id = p_workspace and r.state = 'revision_requested';
  select coalesce(sum(g.granted_count), 0) into v_granted from public.mission_revision_grants g
  where g.mission_work_item_id = p_work_item and g.workspace_id = p_workspace;
  if v_completed < v_limit + v_granted then raise exception 'wrong_state'; end if;

  insert into public.mission_revision_grants (
    workspace_id, mission_work_item_id, granted_by, reason, granted_count
  ) values (p_workspace, p_work_item, p_operator, btrim(p_reason), p_granted_count);
  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id,
    event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, p_workflow, p_work_item, 'operator', p_operator,
    'mission_revision_granted', 'mission_work_item', p_work_item,
    jsonb_build_object('granted_count', p_granted_count)
  );
  perform private.refresh_mission_workflow_state(p_workflow);
  return v_item;
end;
$$;

revoke all on function private.v_item_round_limit(uuid, uuid) from public, anon, authenticated, service_role;
