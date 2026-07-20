-- Final whole-branch review corrections for creator draft, submission, and review contracts.
-- This migration is intentionally forward-only: earlier deployed definitions remain immutable history.

create extension if not exists pgcrypto with schema extensions;

create table if not exists private.mission_draft_submission_idempotency (
  mission_work_item_id uuid not null references public.mission_work_items(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  content_checksum text not null check (btrim(content_checksum) <> ''),
  mission_draft_version_id uuid not null references public.mission_draft_versions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (mission_work_item_id, idempotency_key)
);

revoke all on table private.mission_draft_submission_idempotency
  from public, anon, authenticated, service_role;

create or replace function private.submit_active_mission_draft(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_expected_revision integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_draft public.mission_working_drafts;
  v_prior_round public.mission_review_rounds;
  v_version public.mission_draft_versions;
  v_round integer;
  v_version_number integer;
  v_ready_count integer;
  v_completed integer;
  v_granted integer;
  v_asset_checksums jsonb;
  v_canonical jsonb;
  v_content_checksum text;
begin
  if btrim(coalesce(p_idempotency_key, '')) = '' or length(p_idempotency_key) > 200 then
    raise exception 'idempotency_key_required';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'validation_failed';
  end if;

  -- One lock order is shared with autosave and operator review: workflow, item, draft.
  select w.* into v_workflow
  from public.mission_workflows w
  join public.mission_submissions s
    on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
  where w.mission_submission_id = p_submission
    and w.workspace_id = p_workspace
    and s.creator_id = p_creator
    and s.workspace_id = p_workspace
  for update of w;
  if v_workflow.id is null then raise exception 'not_found'; end if;

  select i.* into v_item
  from public.mission_work_items i
  where i.id = p_work_item
    and i.mission_workflow_id = v_workflow.id
    and i.workspace_id = p_workspace
  for update of i;
  if v_item.id is null then raise exception 'not_found'; end if;

  -- The same key always resolves to its original immutable response, regardless of later state.
  select v.* into v_version
  from private.mission_draft_submission_idempotency a
  join public.mission_draft_versions v
    on v.id = a.mission_draft_version_id
    and v.mission_work_item_id = a.mission_work_item_id
    and v.workspace_id = a.workspace_id
  where a.mission_work_item_id = v_item.id
    and a.workspace_id = p_workspace
    and a.idempotency_key = p_idempotency_key
  for update of a, v;
  if v_version.id is not null then
    return jsonb_build_object('version', to_jsonb(v_version), 'work_item', to_jsonb(v_item));
  end if;

  -- Backfill compatibility for attempts created by the superseded migration.
  select v.* into v_version
  from public.mission_draft_versions v
  where v.mission_work_item_id = v_item.id
    and v.workspace_id = p_workspace
    and v.submission_idempotency_key = p_idempotency_key
  for update of v;
  if v_version.id is not null then
    insert into private.mission_draft_submission_idempotency (
      mission_work_item_id, workspace_id, idempotency_key, content_checksum, mission_draft_version_id
    ) values (
      v_item.id, p_workspace, p_idempotency_key, v_version.content_checksum, v_version.id
    ) on conflict (mission_work_item_id, idempotency_key) do nothing;
    return jsonb_build_object('version', to_jsonb(v_version), 'work_item', to_jsonb(v_item));
  end if;

  select d.* into v_draft
  from public.mission_working_drafts d
  where d.mission_work_item_id = v_item.id
    and d.workspace_id = p_workspace
    and d.archived_at is null
  for update of d;
  if v_draft.id is null then raise exception 'not_found'; end if;
  if v_draft.revision <> p_expected_revision then raise exception 'stale_revision'; end if;

  if (v_item.deadline is not null and v_item.deadline <= v_now)
     or (v_workflow.deadline is not null and v_workflow.deadline <= v_now) then
    raise exception 'deadline_passed';
  end if;

  if v_item.state = 'revision_requested' then
    select r.* into v_prior_round
    from public.mission_review_rounds r
    where r.mission_work_item_id = v_item.id
      and r.workspace_id = p_workspace
      and r.state = 'revision_requested'
    order by r.round_number desc
    limit 1
    for update of r;
    if v_prior_round.id is null then raise exception 'wrong_state'; end if;
    if v_prior_round.creator_response_deadline is null
       or v_prior_round.creator_response_deadline <= v_now then
      raise exception 'deadline_passed';
    end if;
    select count(*) into v_completed
    from public.mission_review_rounds r
    where r.mission_work_item_id = v_item.id
      and r.workspace_id = p_workspace
      and r.state = 'revision_requested';
    select coalesce(sum(g.granted_count), 0) into v_granted
    from public.mission_revision_grants g
    where g.mission_work_item_id = v_item.id and g.workspace_id = p_workspace;
    if v_completed > v_workflow.revision_limit + v_granted then
      raise exception 'revision_limit_reached';
    end if;
  elsif v_item.state <> 'drafting' and v_item.state not in ('submitted', 'under_review') then
    raise exception 'wrong_state';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_item.requirements_snapshot) requirement
    where coalesce((requirement ->> 'required')::boolean, true)
      and coalesce(v_draft.checklist_answers -> (requirement ->> 'id'), 'false'::jsonb) <> 'true'::jsonb
  ) then raise exception 'checklist_incomplete'; end if;

  if exists (
    select 1 from public.mission_draft_assets a
    where a.mission_work_item_id = v_item.id
      and a.workspace_id = p_workspace
      and a.mission_draft_version_id is null
      and a.deleted_at is null
      and a.upload_state <> 'deleted'
      and (a.upload_state <> 'ready' or coalesce(btrim(a.checksum), '') = '')
  ) then raise exception 'assets_not_ready'; end if;

  select count(*),
         coalesce(
           jsonb_agg(lower(btrim(a.checksum)) order by lower(btrim(a.checksum)), a.id),
           '[]'::jsonb
         )
    into v_ready_count, v_asset_checksums
  from public.mission_draft_assets a
  where a.mission_work_item_id = v_item.id
    and a.workspace_id = p_workspace
    and a.mission_draft_version_id is null
    and a.deleted_at is null
    and a.upload_state = 'ready';

  if btrim(coalesce(v_draft.caption_text, '')) = ''
     and btrim(coalesce(v_draft.external_draft_url, '')) = ''
     and v_ready_count = 0 then
    raise exception 'submission_content_required';
  end if;

  v_canonical := jsonb_build_object(
    'caption', regexp_replace(btrim(coalesce(v_draft.caption_text, '')), E'\\r\\n?', E'\\n', 'g'),
    'external_url', btrim(coalesce(v_draft.external_draft_url, '')),
    'checklist', v_draft.checklist_answers,
    'asset_checksums', v_asset_checksums
  );
  v_content_checksum := encode(
    extensions.digest(convert_to(v_canonical::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select v.* into v_version
  from public.mission_draft_versions v
  where v.mission_work_item_id = v_item.id
    and v.workspace_id = p_workspace
    and v.content_checksum = v_content_checksum
  for update of v;
  if v_version.id is not null then
    if v_item.current_submitted_version_id = v_version.id
       and v_item.state in ('submitted', 'under_review') then
      insert into private.mission_draft_submission_idempotency (
        mission_work_item_id, workspace_id, idempotency_key, content_checksum, mission_draft_version_id
      ) values (
        v_item.id, p_workspace, p_idempotency_key, v_content_checksum, v_version.id
      ) on conflict (mission_work_item_id, idempotency_key) do nothing;
      return jsonb_build_object('version', to_jsonb(v_version), 'work_item', to_jsonb(v_item));
    end if;
    raise exception 'duplicate_content';
  end if;

  if v_item.state not in ('drafting', 'revision_requested') then raise exception 'wrong_state'; end if;

  select coalesce(max(v.version_number), 0) + 1 into v_version_number
  from public.mission_draft_versions v
  where v.mission_work_item_id = v_item.id and v.workspace_id = p_workspace;

  insert into public.mission_draft_versions (
    workspace_id, mission_work_item_id, version_number, caption_snapshot,
    external_draft_url_snapshot, checklist_snapshot, submitted_by,
    content_checksum, submission_idempotency_key
  ) values (
    p_workspace, v_item.id, v_version_number, v_draft.caption_text,
    v_draft.external_draft_url, v_draft.checklist_answers, p_creator,
    v_content_checksum, p_idempotency_key
  ) returning * into v_version;

  update public.mission_draft_assets
  set mission_draft_version_id = v_version.id, retained_at = v_now
  where mission_work_item_id = v_item.id
    and workspace_id = p_workspace
    and upload_state = 'ready'
    and deleted_at is null
    and mission_draft_version_id is null;

  select coalesce(max(r.round_number), 0) + 1 into v_round
  from public.mission_review_rounds r
  where r.mission_work_item_id = v_item.id and r.workspace_id = p_workspace;

  insert into public.mission_review_rounds (
    workspace_id, mission_work_item_id, mission_draft_version_id, round_number, state,
    reviewer_id, review_started_at, decision_at, creator_response_deadline
  ) values (
    p_workspace, v_item.id, v_version.id, v_round, 'open', null, null, null, null
  );

  update public.mission_work_items
  set state = 'submitted',
      current_submitted_version_id = v_version.id,
      current_reviewer_id = null,
      review_started_at = null,
      review_due_at = null,
      updated_at = v_now
  where id = v_item.id and mission_workflow_id = v_workflow.id and workspace_id = p_workspace
  returning * into v_item;

  insert into private.mission_draft_submission_idempotency (
    mission_work_item_id, workspace_id, idempotency_key, content_checksum, mission_draft_version_id
  ) values (
    v_item.id, p_workspace, p_idempotency_key, v_content_checksum, v_version.id
  );

  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id,
    actor_type, actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, v_workflow.id, v_item.id,
    'creator', p_creator, 'draft_submitted', 'mission_draft_version', v_version.id,
    jsonb_build_object('version_number', v_version.version_number, 'review_round', v_round)
  );

  perform private.refresh_mission_workflow_state(v_workflow.id);
  return jsonb_build_object('version', to_jsonb(v_version), 'work_item', to_jsonb(v_item));
end;
$$;

create or replace function public.submit_active_mission_draft(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_expected_revision integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then
    raise exception 'not_authorized';
  end if;
  return private.submit_active_mission_draft(
    p_submission, p_creator, p_workspace, p_work_item, p_expected_revision, p_idempotency_key
  );
end;
$$;

create or replace function private.save_active_mission_draft(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_expected_revision integer,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_draft public.mission_working_drafts;
begin
  if p_expected_revision is null or p_expected_revision < 0
     or p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'validation_failed';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_patch) key
    where key not in ('caption', 'externalUrl', 'checklist')
  ) then raise exception 'validation_failed'; end if;
  if p_patch ? 'caption'
     and (jsonb_typeof(p_patch -> 'caption') <> 'string' or length(p_patch ->> 'caption') > 10000) then
    raise exception 'validation_failed';
  end if;
  if p_patch ? 'externalUrl'
     and jsonb_typeof(p_patch -> 'externalUrl') not in ('string', 'null') then
    raise exception 'validation_failed';
  end if;
  if p_patch ? 'externalUrl'
     and jsonb_typeof(p_patch -> 'externalUrl') = 'string'
     and (length(p_patch ->> 'externalUrl') > 2048 or (p_patch ->> 'externalUrl') !~* '^https?://') then
    raise exception 'validation_failed';
  end if;
  if p_patch ? 'checklist'
     and jsonb_typeof(p_patch -> 'checklist') <> 'object' then
    raise exception 'validation_failed';
  end if;

  select w.* into v_workflow
  from public.mission_workflows w
  join public.mission_submissions s
    on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
  where w.mission_submission_id = p_submission
    and w.workspace_id = p_workspace
    and s.creator_id = p_creator
    and s.workspace_id = p_workspace
  for update of w;
  if v_workflow.id is null then raise exception 'not_found'; end if;

  select i.* into v_item
  from public.mission_work_items i
  where i.id = p_work_item
    and i.mission_workflow_id = v_workflow.id
    and i.workspace_id = p_workspace
  for update of i;
  if v_item.id is null then raise exception 'not_found'; end if;

  select d.* into v_draft
  from public.mission_working_drafts d
  where d.mission_work_item_id = v_item.id
    and d.workspace_id = p_workspace
    and d.archived_at is null
  for update of d;
  if v_draft.id is null then raise exception 'not_found'; end if;

  if v_item.state not in ('drafting', 'revision_requested') then
    return jsonb_build_object('code', 'WRONG_STATE', 'current_draft', to_jsonb(v_draft));
  end if;
  if v_draft.revision <> p_expected_revision then
    return jsonb_build_object('code', 'WORKFLOW_STALE', 'current_draft', to_jsonb(v_draft));
  end if;

  if p_patch ? 'checklist' and exists (
    select 1 from jsonb_each(p_patch -> 'checklist') answer
    where jsonb_typeof(answer.value) <> 'boolean'
       or not exists (
         select 1 from jsonb_array_elements(v_item.requirements_snapshot) requirement
         where requirement ->> 'id' = answer.key
       )
  ) then raise exception 'validation_failed'; end if;

  update public.mission_working_drafts
  set caption_text = case when p_patch ? 'caption' then p_patch ->> 'caption' else caption_text end,
      external_draft_url = case
        when not (p_patch ? 'externalUrl') then external_draft_url
        when jsonb_typeof(p_patch -> 'externalUrl') = 'null' then null
        else p_patch ->> 'externalUrl'
      end,
      checklist_answers = case when p_patch ? 'checklist' then p_patch -> 'checklist' else checklist_answers end,
      revision = revision + 1,
      last_saved_at = now()
  where id = v_draft.id and workspace_id = p_workspace
  returning * into v_draft;

  return jsonb_build_object('draft', to_jsonb(v_draft));
end;
$$;

create or replace function public.save_active_mission_draft(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_expected_revision integer,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then
    raise exception 'not_authorized';
  end if;
  return private.save_active_mission_draft(
    p_submission, p_creator, p_workspace, p_work_item, p_expected_revision, p_patch
  );
end;
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
  v_now timestamptz := now();
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_version public.mission_draft_versions;
  v_round public.mission_review_rounds;
  v_review_due timestamptz;
begin
  perform private.assert_active_mission_operator(p_operator);

  select w.* into v_workflow
  from public.mission_workflows w
  where w.id = p_workflow and w.workspace_id = p_workspace
  for update of w;
  if v_workflow.id is null then raise exception 'not_found'; end if;

  select i.* into v_item
  from public.mission_work_items i
  where i.id = p_work_item
    and i.mission_workflow_id = p_workflow
    and i.workspace_id = p_workspace
  for update of i;
  if v_item.id is null then raise exception 'not_found'; end if;
  if v_item.state <> p_expected_state then raise exception 'stale'; end if;
  if v_item.current_submitted_version_id is null
     or v_item.state not in ('submitted', 'under_review') then
    raise exception 'wrong_state';
  end if;

  select v.* into v_version
  from public.mission_draft_versions v
  where v.id = v_item.current_submitted_version_id
    and v.mission_work_item_id = v_item.id
    and v.workspace_id = p_workspace
  for update of v;
  if v_version.id is null then raise exception 'stale'; end if;
  if exists (
    select 1 from public.mission_draft_versions newer
    where newer.mission_work_item_id = v_item.id
      and newer.workspace_id = p_workspace
      and newer.version_number > v_version.version_number
  ) then raise exception 'stale'; end if;

  select r.* into v_round
  from public.mission_review_rounds r
  where r.mission_work_item_id = v_item.id
    and r.mission_draft_version_id = v_version.id
    and r.workspace_id = p_workspace
    and r.state = 'open'
  for update of r;
  if v_round.id is null then raise exception 'wrong_state'; end if;

  if v_item.state = 'under_review' then
    if v_item.current_reviewer_id <> p_operator
       or v_round.reviewer_id <> p_operator
       or v_round.review_started_at is null then
      raise exception 'stale';
    end if;
    return v_item;
  end if;
  if v_round.reviewer_id is not null or v_round.review_started_at is not null then
    raise exception 'stale';
  end if;

  v_review_due := v_now + make_interval(hours => v_workflow.review_sla_hours);
  if v_item.deadline is not null then v_review_due := least(v_review_due, v_item.deadline); end if;
  if v_workflow.deadline is not null then v_review_due := least(v_review_due, v_workflow.deadline); end if;

  update public.mission_review_rounds
  set reviewer_id = p_operator, review_started_at = v_now
  where id = v_round.id and workspace_id = p_workspace
  returning * into v_round;

  update public.mission_work_items
  set state = 'under_review',
      current_reviewer_id = p_operator,
      review_started_at = v_now,
      review_due_at = v_review_due,
      updated_at = v_now
  where id = v_item.id and mission_workflow_id = p_workflow and workspace_id = p_workspace
  returning * into v_item;

  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id,
    event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, p_workflow, p_work_item, 'operator', p_operator,
    'mission_review_started', 'mission_draft_version', v_version.id,
    jsonb_build_object('round_number', v_round.round_number)
  );

  perform private.refresh_mission_workflow_state(p_workflow);
  return v_item;
end;
$$;

create or replace function public.start_mission_review(
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
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then
    raise exception 'not_authorized';
  end if;
  perform private.assert_active_mission_operator(p_operator);
  return private.start_mission_review(
    p_workflow, p_work_item, p_operator, p_workspace, p_expected_state
  );
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
  v_now timestamptz := now();
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_version public.mission_draft_versions;
  v_round public.mission_review_rounds;
  v_completed integer;
  v_granted integer;
  v_allowed_deadline timestamptz;
  v_effective_deadline timestamptz;
begin
  perform private.assert_active_mission_operator(p_operator);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'validation_failed';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) x
    where coalesce(btrim(x ->> 'text'), '') = ''
       or coalesce((x ->> 'required')::boolean, true) is not true
       or coalesce(x ->> 'category', '') not in ('format', 'key_message', 'compliance', 'quality', 'other')
  ) then raise exception 'validation_failed'; end if;

  select w.* into v_workflow
  from public.mission_workflows w
  where w.id = p_workflow and w.workspace_id = p_workspace
  for update of w;
  if v_workflow.id is null then raise exception 'not_found'; end if;

  select i.* into v_item
  from public.mission_work_items i
  where i.id = p_work_item
    and i.mission_workflow_id = p_workflow
    and i.workspace_id = p_workspace
  for update of i;
  if v_item.id is null then raise exception 'not_found'; end if;
  if v_item.state <> p_expected_state or v_item.current_submitted_version_id <> p_version then
    raise exception 'stale';
  end if;
  if v_item.state <> 'under_review' or v_item.current_reviewer_id <> p_operator then
    raise exception 'wrong_state';
  end if;

  v_allowed_deadline := v_now + make_interval(hours => v_workflow.revision_response_hours);
  if v_item.deadline is not null then
    v_allowed_deadline := least(v_allowed_deadline, v_item.deadline);
  end if;
  if v_workflow.deadline is not null then
    v_allowed_deadline := least(v_allowed_deadline, v_workflow.deadline);
  end if;
  if v_allowed_deadline <= v_now then raise exception 'deadline_passed'; end if;
  v_effective_deadline := coalesce(p_deadline, v_allowed_deadline);
  if v_effective_deadline <= v_now or p_deadline > v_allowed_deadline then
    raise exception 'validation_failed';
  end if;

  select v.* into v_version
  from public.mission_draft_versions v
  where v.id = p_version
    and v.mission_work_item_id = p_work_item
    and v.workspace_id = p_workspace
  for update of v;
  if v_version.id is null then raise exception 'stale'; end if;

  select r.* into v_round
  from public.mission_review_rounds r
  where r.mission_work_item_id = p_work_item
    and r.mission_draft_version_id = p_version
    and r.workspace_id = p_workspace
    and r.state = 'open'
  for update of r;
  if v_round.id is null or v_round.reviewer_id <> p_operator
     or v_round.review_started_at is null then
    raise exception 'wrong_state';
  end if;

  select count(*) into v_completed
  from public.mission_review_rounds r
  where r.mission_work_item_id = p_work_item
    and r.workspace_id = p_workspace
    and r.state = 'revision_requested';
  select coalesce(sum(g.granted_count), 0) into v_granted
  from public.mission_revision_grants g
  where g.mission_work_item_id = p_work_item and g.workspace_id = p_workspace;
  if v_completed >= v_workflow.revision_limit + v_granted then
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
  set state = 'revision_requested',
      reviewer_id = p_operator,
      decision_at = v_now,
      creator_response_deadline = v_effective_deadline
  where id = v_round.id and workspace_id = p_workspace;

  update public.mission_working_drafts
  set caption_text = v_version.caption_snapshot,
      external_draft_url = v_version.external_draft_url_snapshot,
      checklist_answers = v_version.checklist_snapshot,
      revision = revision + 1,
      last_saved_at = v_now
  where mission_work_item_id = p_work_item
    and workspace_id = p_workspace
    and archived_at is null;

  update public.mission_work_items
  set state = 'revision_requested', current_reviewer_id = p_operator, updated_at = v_now
  where id = p_work_item and mission_workflow_id = p_workflow and workspace_id = p_workspace
  returning * into v_item;

  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id,
    event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, p_workflow, p_work_item, 'operator', p_operator,
    'mission_revision_requested', 'mission_review_round', v_round.id,
    jsonb_build_object('round_number', v_round.round_number, 'deadline', v_effective_deadline)
  );
  perform private.refresh_mission_workflow_state(p_workflow);
  return v_item;
end;
$$;

create or replace function public.request_mission_revision(
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
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then
    raise exception 'not_authorized';
  end if;
  perform private.assert_active_mission_operator(p_operator);
  return private.request_mission_revision(
    p_workflow, p_work_item, p_version, p_operator, p_workspace,
    p_expected_state, p_deadline, p_items
  );
end;
$$;

revoke all on function private.submit_active_mission_draft(uuid, uuid, uuid, uuid, integer, text)
  from public, anon, authenticated, service_role;
revoke all on function public.submit_active_mission_draft(uuid, uuid, uuid, uuid, integer, text)
  from public, anon, authenticated, service_role;
revoke all on function private.save_active_mission_draft(uuid, uuid, uuid, uuid, integer, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.save_active_mission_draft(uuid, uuid, uuid, uuid, integer, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.start_mission_review(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.start_mission_review(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.request_mission_revision(uuid, uuid, uuid, uuid, uuid, text, timestamptz, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.request_mission_revision(uuid, uuid, uuid, uuid, uuid, text, timestamptz, jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.submit_active_mission_draft(uuid, uuid, uuid, uuid, integer, text)
  to service_role;
grant execute on function public.save_active_mission_draft(uuid, uuid, uuid, uuid, integer, jsonb)
  to service_role;
grant execute on function public.start_mission_review(uuid, uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.request_mission_revision(uuid, uuid, uuid, uuid, uuid, text, timestamptz, jsonb)
  to service_role;
