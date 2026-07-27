-- Explicit, reward-neutral publication policy setup for already-approved legacy work items.

create or replace function private.setup_existing_publication_instructions(
  p_workspace uuid, p_workflow uuid, p_work_item uuid, p_operator uuid,
  p_expected_state text, p_expected_revision integer,
  p_idempotency_key uuid, p_instructions jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_instruction public.mission_publication_instructions;
  v_window_hours integer;
  v_expected_account text;
begin
  perform private.assert_active_mission_operator(p_operator);

  if not exists (
    select 1
    from public.brand_users membership
    where membership.user_id = p_operator
      and membership.workspace_id = p_workspace
      and membership.active
  ) then
    raise exception 'not_authorized';
  end if;

  if p_workspace is null or p_workflow is null or p_work_item is null
    or p_operator is null or p_expected_state <> 'approved_to_publish'
    or p_expected_revision is null or p_expected_revision < 0
    or p_idempotency_key is null
    or p_instructions is null or jsonb_typeof(p_instructions) <> 'object'
    or not (p_instructions ? 'publication_instructions')
    or not (p_instructions ? 'publication_window_hours')
    or not (p_instructions ? 'required_disclosures')
    or not (p_instructions ? 'expected_account')
    or not (p_instructions ? 'proof_evidence_policy')
    or nullif(btrim(p_instructions->>'publication_instructions'), '') is null
    or (p_instructions->>'publication_window_hours') !~ '^[1-9][0-9]*$'
    or case when jsonb_typeof(p_instructions->'required_disclosures') = 'array' then exists (
        select 1
        from jsonb_array_elements(p_instructions->'required_disclosures') disclosure
        where jsonb_typeof(disclosure) <> 'string'
          or nullif(btrim(disclosure #>> '{}'), '') is null
      )
      else true
    end
    or jsonb_typeof(p_instructions->'expected_account') not in ('null', 'string')
    or (
      jsonb_typeof(p_instructions->'expected_account') = 'string'
      and nullif(btrim(p_instructions->>'expected_account'), '') is null
    )
    or jsonb_typeof(p_instructions->'proof_evidence_policy') <> 'object'
  then
    return jsonb_build_object('code', 'VALIDATION_FAILED');
  end if;

  v_window_hours := (p_instructions->>'publication_window_hours')::integer;
  v_expected_account := case
    when jsonb_typeof(p_instructions->'expected_account') = 'null' then null
    else btrim(p_instructions->>'expected_account')
  end;

  select workflow.* into v_workflow
  from public.mission_workflows workflow
  where workflow.id = p_workflow
    and workflow.workspace_id = p_workspace
  for update;
  if v_workflow.id is null then
    return jsonb_build_object('code', 'WORKFLOW_NOT_FOUND');
  end if;

  select item.* into v_item
  from public.mission_work_items item
  where item.id = p_work_item
    and item.mission_workflow_id = p_workflow
    and item.workspace_id = p_workspace
  for update;
  if v_item.id is null then
    return jsonb_build_object('code', 'WORKFLOW_NOT_FOUND');
  end if;

  select instruction.* into v_instruction
  from public.mission_publication_instructions instruction
  where instruction.mission_work_item_id = p_work_item
    and instruction.workspace_id = p_workspace
  for update;

  perform attempt.id
  from public.mission_publication_proof_attempts attempt
  where attempt.mission_work_item_id = p_work_item
    and attempt.workspace_id = p_workspace
  for update;

  if v_instruction.id is not null then
    if p_idempotency_key = any(v_instruction.idempotency_keys) then
      if p_expected_state <> v_item.state
        or p_expected_revision <> v_instruction.revision
        or v_instruction.publication_instructions is distinct from btrim(p_instructions->>'publication_instructions')
        or v_instruction.publication_window_hours is distinct from v_window_hours
        or v_instruction.required_disclosures is distinct from p_instructions->'required_disclosures'
        or v_instruction.expected_account is distinct from v_expected_account
        or v_instruction.proof_evidence_policy is distinct from p_instructions->'proof_evidence_policy'
      then
        raise exception 'idempotency_conflict';
      end if;
      return jsonb_build_object(
        'instruction', to_jsonb(v_instruction),
        'idempotent', true
      );
    end if;
    return jsonb_build_object('code', 'WRONG_STATE');
  end if;

  if v_item.state <> p_expected_state then
    return jsonb_build_object('code', 'WORKFLOW_STALE');
  end if;
  if v_item.state <> 'approved_to_publish' then
    return jsonb_build_object('code', 'WRONG_STATE');
  end if;
  if p_expected_revision <> 0 then
    return jsonb_build_object('code', 'WORKFLOW_STALE');
  end if;
  if exists (
    select 1
    from public.mission_publication_proof_attempts attempt
    where attempt.mission_work_item_id = p_work_item
      and attempt.workspace_id = p_workspace
  ) then
    return jsonb_build_object('code', 'WRONG_STATE');
  end if;
  if exists (
    select 1
    from public.mission_workflow_events event
    where event.workspace_id = p_workspace
      and event.mission_workflow_id = p_workflow
      and event.mission_work_item_id = p_work_item
      and event.event_type = 'mission_publication_existing_instructions_setup'
  ) then
    return jsonb_build_object('code', 'WRONG_STATE');
  end if;

  begin
    insert into public.mission_publication_instructions (
      workspace_id,
      mission_work_item_id,
      platform,
      source_template_id,
      publication_instructions,
      publication_window_hours,
      required_disclosures,
      expected_account,
      proof_evidence_policy,
      publication_due_at,
      created_at,
      frozen_at,
      revision,
      idempotency_keys
    ) values (
      p_workspace,
      p_work_item,
      v_item.platform,
      null,
      btrim(p_instructions->>'publication_instructions'),
      v_window_hours,
      p_instructions->'required_disclosures',
      v_expected_account,
      p_instructions->'proof_evidence_policy',
      v_now + make_interval(hours => v_window_hours),
      v_now,
      v_now,
      0,
      array[p_idempotency_key]
    )
    returning * into v_instruction;
  exception
    when unique_violation then
      select instruction.* into v_instruction
      from public.mission_publication_instructions instruction
      where instruction.mission_work_item_id = p_work_item
        and instruction.workspace_id = p_workspace
      for update;
      if v_instruction.id is not null
        and p_idempotency_key = any(v_instruction.idempotency_keys)
        and v_instruction.publication_instructions is not distinct from btrim(p_instructions->>'publication_instructions')
        and v_instruction.publication_window_hours is not distinct from v_window_hours
        and v_instruction.required_disclosures is not distinct from p_instructions->'required_disclosures'
        and v_instruction.expected_account is not distinct from v_expected_account
        and v_instruction.proof_evidence_policy is not distinct from p_instructions->'proof_evidence_policy'
      then
        return jsonb_build_object(
          'instruction', to_jsonb(v_instruction),
          'idempotent', true
        );
      end if;
      raise exception 'idempotency_conflict';
  end;

  insert into public.mission_workflow_events (
    workspace_id,
    mission_workflow_id,
    mission_work_item_id,
    actor_type,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_workspace,
    p_workflow,
    p_work_item,
    'operator',
    p_operator,
    'mission_publication_existing_instructions_setup',
    'mission_publication_instruction',
    v_instruction.id,
    jsonb_build_object(
      'revision', v_instruction.revision,
      'idempotency_key', p_idempotency_key
    )
  );

  return jsonb_build_object(
    'instruction', to_jsonb(v_instruction),
    'idempotent', false
  );
end;
$$;

create or replace function public.setup_existing_publication_instructions(
  p_workspace uuid, p_workflow uuid, p_work_item uuid, p_operator uuid,
  p_expected_state text, p_expected_revision integer,
  p_idempotency_key uuid, p_instructions jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then
    raise exception 'not_authorized';
  end if;
  perform private.assert_active_mission_operator(p_operator);
  return private.setup_existing_publication_instructions(
    p_workspace,
    p_workflow,
    p_work_item,
    p_operator,
    p_expected_state,
    p_expected_revision,
    p_idempotency_key,
    p_instructions
  );
end;
$$;

revoke all on function private.setup_existing_publication_instructions(uuid, uuid, uuid, uuid, text, integer, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.setup_existing_publication_instructions(uuid, uuid, uuid, uuid, text, integer, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.setup_existing_publication_instructions(uuid, uuid, uuid, uuid, text, integer, uuid, jsonb) to service_role;
