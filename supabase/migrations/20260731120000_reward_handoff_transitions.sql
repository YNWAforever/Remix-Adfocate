-- Atomic completion approval, pending-reward cancellation, and bounded creator reads.
-- These transitions are deliberately neutral to reward ledgers, balances, and budgets.

create or replace function private.approve_mission_completion(
  p_workspace uuid,
  p_workflow uuid,
  p_operator uuid,
  p_expected_state text,
  p_expected_revision integer,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_expected_state text;
  v_request jsonb;
  v_request_hash text;
  v_workflow public.mission_workflows;
  v_contract public.mission_reward_contracts;
  v_submission public.mission_submissions;
  v_decision public.mission_completion_decisions;
  v_pending public.mission_pending_rewards;
  v_replay record;
  v_required_item_count integer;
  v_verified_required_item_count integer;
  v_evidence_snapshot jsonb;
  v_processing_days smallint;
  v_target_at timestamptz;
  v_constraint_name text;
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

  v_expected_state := lower(btrim(coalesce(p_expected_state, '')));
  if p_workspace is null
    or p_workflow is null
    or p_operator is null
    or v_expected_state <> 'proof_verified'
    or p_expected_revision is null
    or p_expected_revision < 0
    or p_idempotency_key is null
  then
    raise exception 'validation_failed';
  end if;

  v_request := jsonb_build_object(
    'action', 'approve_mission_completion',
    'workspaceId', p_workspace::text,
    'workflowId', p_workflow::text,
    'operatorId', p_operator::text,
    'expectedState', v_expected_state,
    'expectedRevision', p_expected_revision
  );
  v_request_hash := encode(
    extensions.digest(convert_to(v_request::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select workflow.* into v_workflow
  from public.mission_workflows workflow
  where workflow.id = p_workflow
    and workflow.workspace_id = p_workspace
  for update;
  if v_workflow.id is null then
    raise exception 'not_found';
  end if;

  -- A replay is resolved only after locking its requested canonical workflow.
  -- The pending row must belong to the same tenant/workflow/contract and have
  -- the relationship required by the immutable decision kind.
  select decision as decision_row, pending as pending_row
  into v_replay
  from public.mission_completion_decisions decision
  left join public.mission_pending_rewards pending
    on pending.workspace_id = decision.workspace_id
   and pending.mission_workflow_id = decision.mission_workflow_id
   and pending.reward_contract_id = decision.reward_contract_id
   and (
     (
       decision.decision_kind = 'approved'
       and decision.pending_reward_id is null
       and pending.completion_decision_id = decision.id
     )
     or (
       decision.decision_kind = 'cancelled'
       and pending.id = decision.pending_reward_id
       and pending.cancellation_decision_id = decision.id
     )
   )
  where decision.workspace_id = p_workspace
    and decision.mission_workflow_id = p_workflow
    and decision.idempotency_key = p_idempotency_key;
  if found then
    v_decision := v_replay.decision_row;
    v_pending := v_replay.pending_row;
  end if;
  if v_decision.id is not null then
    if v_decision.request_hash <> v_request_hash or v_pending.id is null then
      raise exception 'idempotency_conflict';
    end if;
    if v_decision.decision_kind <> 'approved' then
      raise exception 'idempotency_conflict';
    end if;
    return jsonb_build_object(
      'workflow', jsonb_build_object(
        'id', v_decision.mission_workflow_id,
        'state', 'reward_pending',
        'revision', v_decision.workflow_revision + 1,
        'updated_at', v_decision.decided_at
      ),
      'decision', to_jsonb(v_decision),
      'pendingReward', to_jsonb(v_pending) || jsonb_build_object(
        'status', 'pending',
        'cancellation_decision_id', null,
        'cancelled_at', null
      ),
      'idempotent', true
    );
  end if;

  if v_workflow.state <> v_expected_state then
    raise exception 'wrong_state';
  end if;
  if v_workflow.revision <> p_expected_revision then
    raise exception 'workflow_stale';
  end if;

  select contract.* into v_contract
  from public.mission_reward_contracts contract
  where contract.workspace_id = p_workspace
    and contract.mission_workflow_id = v_workflow.id;
  if v_contract.id is null then
    raise exception 'reward_contract_required';
  end if;

  select submission.* into v_submission
  from public.mission_submissions submission
  where submission.id = v_workflow.mission_submission_id
    and submission.id = v_contract.mission_submission_id
    and submission.workspace_id = p_workspace
    and submission.mission_id = v_contract.mission_id;
  if v_submission.id is null then
    raise exception 'completion_not_eligible';
  end if;

  select count(*) into v_required_item_count
  from public.mission_work_items item
  where item.mission_workflow_id = v_workflow.id
    and item.workspace_id = p_workspace
    and item.required;

  select count(*) into v_verified_required_item_count
  from public.mission_work_items item
  where item.mission_workflow_id = v_workflow.id
    and item.workspace_id = p_workspace
    and item.required
    and item.state = 'proof_verified'
    and item.verified_proof_attempt_id is not null
    and item.current_proof_attempt_id = item.verified_proof_attempt_id
    and exists (
      select 1
      from public.mission_publication_proof_attempts attempt
      join public.mission_publication_proof_reviews review
        on review.workspace_id = attempt.workspace_id
       and review.mission_publication_proof_attempt_id = attempt.id
       and review.state = 'verified'
       and review.decision = 'verified'
      where attempt.id = item.verified_proof_attempt_id
        and attempt.mission_work_item_id = item.id
        and attempt.workspace_id = item.workspace_id
    );
  if v_required_item_count = 0
    or v_verified_required_item_count <> v_required_item_count
  then
    raise exception 'completion_not_eligible';
  end if;

  select jsonb_build_object(
    'requiredItems',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'workItemId', item.id,
          'proofAttemptId', attempt.id,
          'proofReviewId', review.id,
          'attemptNumber', attempt.attempt_number,
          'submittedAt', attempt.submitted_at,
          'contentChecksum', attempt.content_checksum,
          'metadataStatus', attempt.metadata_status,
          'reviewNumber', review.review_number,
          'reviewedAt', review.reviewed_at,
          'reviewDecision', review.decision
        )
        order by item.position, item.id
      ),
      '[]'::jsonb
    )
  )
  into v_evidence_snapshot
  from public.mission_work_items item
  join public.mission_publication_proof_attempts attempt
    on attempt.id = item.verified_proof_attempt_id
   and attempt.mission_work_item_id = item.id
   and attempt.workspace_id = item.workspace_id
  join public.mission_publication_proof_reviews review
    on review.workspace_id = item.workspace_id
   and review.mission_publication_proof_attempt_id = attempt.id
   and review.state = 'verified'
   and review.decision = 'verified'
  where item.mission_workflow_id = v_workflow.id
    and item.workspace_id = p_workspace
    and item.required
    and item.state = 'proof_verified'
    and item.current_proof_attempt_id = item.verified_proof_attempt_id;

  select workspace.reward_processing_window_days
  into v_processing_days
  from public.workspaces workspace
  where workspace.id = p_workspace;
  v_target_at := case
    when v_processing_days is null then null
    else v_now + make_interval(days => v_processing_days)
  end;

  begin
    insert into public.mission_completion_decisions (
      workspace_id,
      mission_workflow_id,
      decision_kind,
      reward_contract_id,
      pending_reward_id,
      supersedes_decision_id,
      workflow_revision,
      required_item_count,
      verified_required_item_count,
      evidence_snapshot,
      reason_category,
      reason_note,
      decided_by,
      decided_at,
      idempotency_key,
      request_hash
    ) values (
      p_workspace,
      v_workflow.id,
      'approved',
      v_contract.id,
      null,
      null,
      v_workflow.revision,
      v_required_item_count,
      v_verified_required_item_count,
      v_evidence_snapshot,
      null,
      null,
      p_operator,
      v_now,
      p_idempotency_key,
      v_request_hash
    )
    returning * into v_decision;

    insert into public.mission_pending_rewards (
      workspace_id,
      mission_workflow_id,
      mission_submission_id,
      creator_id,
      mission_id,
      reward_contract_id,
      completion_decision_id,
      points_amount,
      cash_amount,
      currency,
      xp_amount,
      status,
      processing_window_days,
      target_at,
      created_at
    ) values (
      p_workspace,
      v_workflow.id,
      v_submission.id,
      v_submission.creator_id,
      v_contract.mission_id,
      v_contract.id,
      v_decision.id,
      v_contract.points_amount,
      v_contract.cash_amount,
      v_contract.currency,
      v_contract.xp_amount,
      'pending',
      v_processing_days,
      v_target_at,
      v_now
    )
    returning * into v_pending;
  exception when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name = 'mission_pending_rewards_one_pending_idx' then
      raise exception 'pending_reward_exists';
    end if;
    raise exception 'idempotency_conflict';
  end;

  update public.mission_workflows
  set state = 'reward_pending',
      revision = revision + 1,
      updated_at = v_now
  where id = v_workflow.id
    and workspace_id = p_workspace
    and state = v_expected_state
    and revision = p_expected_revision
  returning * into v_workflow;
  if v_workflow.id is null then
    raise exception 'workflow_stale';
  end if;

  insert into public.mission_workflow_events (
    workspace_id,
    mission_workflow_id,
    actor_type,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata,
    created_at
  ) values (
    p_workspace,
    v_workflow.id,
    'operator',
    p_operator,
    'mission_completion_approved',
    'mission_pending_reward',
    v_pending.id,
    jsonb_build_object(
      'decision_id', v_decision.id,
      'pending_reward_id', v_pending.id,
      'workflow_revision', v_workflow.revision
    ),
    v_now
  );

  return jsonb_build_object(
    'workflow', jsonb_build_object(
      'id', v_decision.mission_workflow_id,
      'state', 'reward_pending',
      'revision', v_decision.workflow_revision + 1,
      'updated_at', v_decision.decided_at
    ),
    'decision', to_jsonb(v_decision),
    'pendingReward', to_jsonb(v_pending) || jsonb_build_object(
      'status', 'pending',
      'cancellation_decision_id', null,
      'cancelled_at', null
    ),
    'idempotent', false
  );
end;
$$;

create or replace function public.approve_mission_completion(
  p_workspace uuid,
  p_workflow uuid,
  p_operator uuid,
  p_expected_state text,
  p_expected_revision integer,
  p_idempotency_key uuid
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
  perform private.assert_active_mission_operator(p_operator);
  return private.approve_mission_completion(
    p_workspace,
    p_workflow,
    p_operator,
    p_expected_state,
    p_expected_revision,
    p_idempotency_key
  );
end;
$$;

create or replace function private.cancel_mission_reward_handoff(
  p_workspace uuid,
  p_workflow uuid,
  p_operator uuid,
  p_expected_state text,
  p_expected_revision integer,
  p_idempotency_key uuid,
  p_reason_category text,
  p_reason_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_expected_state text;
  v_reason_category text;
  v_reason_note text;
  v_request jsonb;
  v_request_hash text;
  v_workflow public.mission_workflows;
  v_approval public.mission_completion_decisions;
  v_decision public.mission_completion_decisions;
  v_pending public.mission_pending_rewards;
  v_replay record;
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

  v_expected_state := lower(btrim(coalesce(p_expected_state, '')));
  v_reason_category := lower(btrim(p_reason_category));
  v_reason_note := btrim(p_reason_note);
  if p_workspace is null
    or p_workflow is null
    or p_operator is null
    or v_expected_state <> 'reward_pending'
    or p_expected_revision is null
    or p_expected_revision < 0
    or p_idempotency_key is null
    or v_reason_category is null
    or v_reason_category not in ('contract_error','eligibility_error','duplicate','other')
    or nullif(v_reason_note, '') is null
  then
    raise exception 'validation_failed';
  end if;

  v_request := jsonb_build_object(
    'action', 'cancel_mission_reward_handoff',
    'workspaceId', p_workspace::text,
    'workflowId', p_workflow::text,
    'operatorId', p_operator::text,
    'expectedState', v_expected_state,
    'expectedRevision', p_expected_revision,
    'reasonCategory', v_reason_category,
    'reasonNote', v_reason_note
  );
  v_request_hash := encode(
    extensions.digest(convert_to(v_request::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select workflow.* into v_workflow
  from public.mission_workflows workflow
  where workflow.id = p_workflow
    and workflow.workspace_id = p_workspace
  for update;
  if v_workflow.id is null then
    raise exception 'not_found';
  end if;

  -- Reconstruct a replay only from the requested locked workflow and the
  -- tenant-bound immutable decision/pending relationship.
  select decision as decision_row, pending as pending_row
  into v_replay
  from public.mission_completion_decisions decision
  left join public.mission_pending_rewards pending
    on pending.workspace_id = decision.workspace_id
   and pending.mission_workflow_id = decision.mission_workflow_id
   and pending.reward_contract_id = decision.reward_contract_id
   and (
     (
       decision.decision_kind = 'approved'
       and decision.pending_reward_id is null
       and pending.completion_decision_id = decision.id
     )
     or (
       decision.decision_kind = 'cancelled'
       and pending.id = decision.pending_reward_id
       and pending.cancellation_decision_id = decision.id
     )
   )
  where decision.workspace_id = p_workspace
    and decision.mission_workflow_id = p_workflow
    and decision.idempotency_key = p_idempotency_key;
  if found then
    v_decision := v_replay.decision_row;
    v_pending := v_replay.pending_row;
  end if;
  if v_decision.id is not null then
    if v_decision.request_hash <> v_request_hash then
      raise exception 'idempotency_conflict';
    end if;
    if v_decision.decision_kind <> 'cancelled' or v_pending.id is null then
      raise exception 'idempotency_conflict';
    end if;
    return jsonb_build_object(
      'workflow', jsonb_build_object(
        'id', v_decision.mission_workflow_id,
        'state', 'proof_verified',
        'revision', v_decision.workflow_revision + 1,
        'updated_at', v_decision.decided_at
      ),
      'decision', to_jsonb(v_decision),
      'pendingReward', to_jsonb(v_pending) || jsonb_build_object(
        'status', 'cancelled',
        'cancellation_decision_id', v_decision.id,
        'cancelled_at', v_decision.decided_at
      ),
      'idempotent', true
    );
  end if;

  if v_workflow.state <> v_expected_state then
    raise exception 'wrong_state';
  end if;
  if v_workflow.revision <> p_expected_revision then
    raise exception 'workflow_stale';
  end if;

  select pending.* into v_pending
  from public.mission_pending_rewards pending
  join public.mission_reward_contracts contract
    on contract.id = pending.reward_contract_id
   and contract.workspace_id = pending.workspace_id
   and contract.mission_workflow_id = pending.mission_workflow_id
   and contract.mission_submission_id = pending.mission_submission_id
   and contract.mission_id = pending.mission_id
  where pending.workspace_id = p_workspace
    and pending.mission_workflow_id = v_workflow.id
    and pending.mission_submission_id = v_workflow.mission_submission_id
    and pending.status = 'pending'
    and pending.cancellation_decision_id is null
    and pending.cancelled_at is null
  for update of pending;
  if v_pending.id is null then
    raise exception 'pending_reward_not_found';
  end if;

  select decision.* into v_approval
  from public.mission_completion_decisions decision
  where decision.id = v_pending.completion_decision_id
    and decision.workspace_id = p_workspace
    and decision.mission_workflow_id = v_workflow.id
    and decision.reward_contract_id = v_pending.reward_contract_id
    and decision.pending_reward_id is null
    and decision.decision_kind = 'approved';
  if v_approval.id is null then
    raise exception 'cancellation_not_allowed';
  end if;

  begin
    insert into public.mission_completion_decisions (
      workspace_id,
      mission_workflow_id,
      decision_kind,
      reward_contract_id,
      pending_reward_id,
      supersedes_decision_id,
      workflow_revision,
      required_item_count,
      verified_required_item_count,
      evidence_snapshot,
      reason_category,
      reason_note,
      decided_by,
      decided_at,
      idempotency_key,
      request_hash
    ) values (
      p_workspace,
      v_workflow.id,
      'cancelled',
      v_pending.reward_contract_id,
      v_pending.id,
      v_approval.id,
      v_workflow.revision,
      v_approval.required_item_count,
      v_approval.verified_required_item_count,
      v_approval.evidence_snapshot,
      v_reason_category,
      v_reason_note,
      p_operator,
      v_now,
      p_idempotency_key,
      v_request_hash
    )
    returning * into v_decision;
  exception when unique_violation then
    raise exception 'idempotency_conflict';
  end;

  update public.mission_pending_rewards
  set status = 'cancelled',
      cancellation_decision_id = v_decision.id,
      cancelled_at = v_now
  where id = v_pending.id
    and workspace_id = p_workspace
    and mission_workflow_id = v_workflow.id
    and reward_contract_id = v_pending.reward_contract_id
    and completion_decision_id = v_approval.id
    and status = 'pending'
    and cancellation_decision_id is null
  returning * into v_pending;
  if v_pending.id is null then
    raise exception 'cancellation_not_allowed';
  end if;

  update public.mission_workflows
  set state = 'proof_verified',
      revision = revision + 1,
      updated_at = v_now
  where id = v_workflow.id
    and workspace_id = p_workspace
    and state = v_expected_state
    and revision = p_expected_revision
  returning * into v_workflow;
  if v_workflow.id is null then
    raise exception 'workflow_stale';
  end if;

  insert into public.mission_workflow_events (
    workspace_id,
    mission_workflow_id,
    actor_type,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata,
    created_at
  ) values (
    p_workspace,
    v_workflow.id,
    'operator',
    p_operator,
    'mission_reward_pending_cancelled',
    'mission_pending_reward',
    v_pending.id,
    jsonb_build_object(
      'decision_id', v_decision.id,
      'pending_reward_id', v_pending.id,
      'workflow_revision', v_workflow.revision,
      'reason_category', v_reason_category
    ),
    v_now
  );

  return jsonb_build_object(
    'workflow', jsonb_build_object(
      'id', v_decision.mission_workflow_id,
      'state', 'proof_verified',
      'revision', v_decision.workflow_revision + 1,
      'updated_at', v_decision.decided_at
    ),
    'decision', to_jsonb(v_decision),
    'pendingReward', to_jsonb(v_pending) || jsonb_build_object(
      'status', 'cancelled',
      'cancellation_decision_id', v_decision.id,
      'cancelled_at', v_decision.decided_at
    ),
    'idempotent', false
  );
end;
$$;

create or replace function public.cancel_mission_reward_handoff(
  p_workspace uuid,
  p_workflow uuid,
  p_operator uuid,
  p_expected_state text,
  p_expected_revision integer,
  p_idempotency_key uuid,
  p_reason_category text,
  p_reason_note text
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
  perform private.assert_active_mission_operator(p_operator);
  return private.cancel_mission_reward_handoff(
    p_workspace,
    p_workflow,
    p_operator,
    p_expected_state,
    p_expected_revision,
    p_idempotency_key,
    p_reason_category,
    p_reason_note
  );
end;
$$;

create or replace function public.get_my_mission_reward_handoff(
  p_submission uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator uuid := (select auth.uid());
  v_workspace uuid;
  v_workflow uuid;
  v_mission uuid;
  v_contract uuid;
  v_pending public.mission_pending_rewards;
  v_decision_kind text;
  v_decided_at timestamptz;
  v_read record;
begin
  if v_creator is null then
    raise exception 'not_found';
  end if;

  select workflow.id, submission.workspace_id, submission.mission_id
  into v_workflow, v_workspace, v_mission
  from public.mission_submissions submission
  join public.mission_workflows workflow
    on workflow.mission_submission_id = submission.id
   and workflow.workspace_id = submission.workspace_id
  where submission.id = p_submission
    and submission.creator_id = v_creator;
  if v_workflow is null then
    raise exception 'not_found';
  end if;

  select contract.id into v_contract
  from public.mission_reward_contracts contract
  where contract.workspace_id = v_workspace
    and contract.mission_workflow_id = v_workflow
    and contract.mission_submission_id = p_submission
    and contract.mission_id = v_mission;
  if v_contract is null then
    return null;
  end if;

  select pending as pending_row,
    case
      when pending.status = 'cancelled' then cancellation.decision_kind
      else approval.decision_kind
    end as decision_kind,
    case
      when pending.status = 'cancelled' then cancellation.decided_at
      else approval.decided_at
    end as decided_at
  into v_read
  from public.mission_pending_rewards pending
  join public.mission_completion_decisions approval
    on approval.workspace_id = pending.workspace_id
   and approval.mission_workflow_id = pending.mission_workflow_id
   and approval.reward_contract_id = pending.reward_contract_id
   and approval.id = pending.completion_decision_id
   and approval.decision_kind = 'approved'
   and approval.pending_reward_id is null
  left join public.mission_completion_decisions cancellation
    on cancellation.workspace_id = pending.workspace_id
   and cancellation.mission_workflow_id = pending.mission_workflow_id
   and cancellation.reward_contract_id = pending.reward_contract_id
   and cancellation.id = pending.cancellation_decision_id
   and cancellation.pending_reward_id = pending.id
   and cancellation.supersedes_decision_id = approval.id
   and cancellation.decision_kind = 'cancelled'
  where pending.workspace_id = v_workspace
    and pending.mission_workflow_id = v_workflow
    and pending.mission_submission_id = p_submission
    and pending.creator_id = v_creator
    and pending.mission_id = v_mission
    and pending.reward_contract_id = v_contract
    and (
      (
        pending.status = 'pending'
        and pending.cancellation_decision_id is null
        and cancellation.id is null
      )
      or (
        pending.status = 'cancelled'
        and pending.cancellation_decision_id is not null
        and cancellation.id is not null
      )
    )
  order by pending.created_at desc, pending.id desc
  limit 1;
  if not found then
    return null;
  end if;
  v_pending := v_read.pending_row;
  v_decision_kind := v_read.decision_kind;
  v_decided_at := v_read.decided_at;

  return jsonb_build_object(
    'reward', jsonb_build_object(
      'pointsAmount', v_pending.points_amount,
      'cashAmount', v_pending.cash_amount,
      'currency', v_pending.currency,
      'xpAmount', v_pending.xp_amount
    ),
    'status', v_pending.status,
    'processingWindowDays', v_pending.processing_window_days,
    'targetAt', v_pending.target_at,
    'createdAt', v_pending.created_at,
    'cancelledAt', v_pending.cancelled_at,
    'decisionState', jsonb_build_object(
      'kind', v_decision_kind,
      'decidedAt', v_decided_at
    )
  );
end;
$$;

revoke all on function private.approve_mission_completion(uuid, uuid, uuid, text, integer, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.approve_mission_completion(uuid, uuid, uuid, text, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.approve_mission_completion(uuid, uuid, uuid, text, integer, uuid)
  to service_role;

revoke all on function private.cancel_mission_reward_handoff(uuid, uuid, uuid, text, integer, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.cancel_mission_reward_handoff(uuid, uuid, uuid, text, integer, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_mission_reward_handoff(uuid, uuid, uuid, text, integer, uuid, text, text)
  to service_role;

revoke all on function public.get_my_mission_reward_handoff(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_mission_reward_handoff(uuid)
  to authenticated;
