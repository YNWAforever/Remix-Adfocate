-- Creator Case publication-proof review is one operator command.
-- It owns the proof decision, workflow transition, audit trail, and receipt
-- in one transaction. Creator review, rewards, and payout state are separate.

alter table public.creator_case_command_receipts
  drop constraint if exists creator_case_command_receipts_command_type_check;
alter table public.creator_case_command_receipts
  add constraint creator_case_command_receipts_command_type_check
  check (command_type in ('apply_review', 'append_note', 'review_publication_proof'));

-- The original proof schema used a UUID actor because creator-side decisions
-- were the only planned writer. Operator identity is text in the admin CRM,
-- including break-glass attribution, so preserve it without casting loss.
alter table public.mission_publication_proof_decisions
  alter column actor_id type text using actor_id::text;

create or replace function private.creator_case_publication_proofs_snapshot(
  p_workspace_id uuid,
  p_creator_id uuid
)
returns jsonb
language sql
security invoker
set search_path = public, pg_temp
as $$
  with current_attempts as (
    select distinct on (
      attempt.mission_submission_id,
      attempt.mission_workflow_id,
      attempt.mission_work_item_id
    ) attempt.*
    from public.mission_publication_proof_attempts attempt
    where attempt.creator_id = p_creator_id
      and attempt.workspace_id = p_workspace_id
    order by
      attempt.mission_submission_id,
      attempt.mission_workflow_id,
      attempt.mission_work_item_id,
      attempt.sequence desc,
      attempt.id desc
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'submissionId', current_attempt.mission_submission_id,
      'workflowId', current_attempt.mission_workflow_id,
      'workItemId', current_attempt.mission_work_item_id,
      'creatorId', current_attempt.creator_id,
      'workspaceId', current_attempt.workspace_id,
      'currentAttempt', jsonb_build_object(
        'id', current_attempt.id,
        'submissionId', current_attempt.mission_submission_id,
        'workflowId', current_attempt.mission_workflow_id,
        'workItemId', current_attempt.mission_work_item_id,
        'creatorId', current_attempt.creator_id,
        'workspaceId', current_attempt.workspace_id,
        'parentAttemptId', current_attempt.parent_attempt_id,
        'sequence', current_attempt.sequence,
        'publishedUrl', current_attempt.published_url,
        'platform', current_attempt.platform,
        'state', current_attempt.state,
        'operatorMessage', current_attempt.operator_message,
        'submittedAt', current_attempt.submitted_at,
        'decidedAt', current_attempt.decided_at
      ),
      'history', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', history.id,
          'submissionId', history.mission_submission_id,
          'workflowId', history.mission_workflow_id,
          'workItemId', history.mission_work_item_id,
          'creatorId', history.creator_id,
          'workspaceId', history.workspace_id,
          'parentAttemptId', history.parent_attempt_id,
          'sequence', history.sequence,
          'publishedUrl', history.published_url,
          'platform', history.platform,
          'state', history.state,
          'operatorMessage', history.operator_message,
          'submittedAt', history.submitted_at,
          'decidedAt', history.decided_at
        ) order by history.sequence desc, history.id desc)
        from public.mission_publication_proof_attempts history
        where history.mission_submission_id = current_attempt.mission_submission_id
          and history.mission_workflow_id = current_attempt.mission_workflow_id
          and history.mission_work_item_id = current_attempt.mission_work_item_id
          and history.creator_id = current_attempt.creator_id
          and history.workspace_id = current_attempt.workspace_id
          and history.id <> current_attempt.id
      ), '[]'::jsonb)
    ) order by current_attempt.mission_submission_id, current_attempt.mission_work_item_id
  ), '[]'::jsonb)
  from current_attempts current_attempt;
$$;

create or replace function private.creator_case_command_snapshot(
  p_workspace_id uuid,
  p_creator_id uuid
)
returns jsonb
language sql
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'creator', (
      select jsonb_build_object(
        'id', creator.id,
        'workspaceId', creator.workspace_id,
        'displayName', creator.display_name,
        'avatarUrl', creator.avatar_url,
        'level', creator.level,
        'categories', coalesce(to_jsonb(creator.categories), '[]'::jsonb),
        'scores', coalesce(creator.scores, '{}'::jsonb),
        'socialHandles', creator.social_handles,
        'createdAt', creator.created_at
      )
      from public.creators creator
      where creator.id = p_creator_id
        and creator.workspace_id = p_workspace_id
    ),
    'review', coalesce((
      select jsonb_build_object(
        'status', review.status,
        'riskLevel', review.risk_level,
        'summary', review.summary,
        'reviewedBy', review.reviewed_by,
        'lastReviewedAt', review.last_reviewed_at,
        'updatedAt', review.updated_at
      )
      from public.creator_review_statuses review
      where review.creator_id = p_creator_id
        and review.workspace_id = p_workspace_id
    ), jsonb_build_object(
      'status', 'needs_review',
      'riskLevel', 'unknown',
      'summary', null,
      'reviewedBy', null,
      'lastReviewedAt', null,
      'updatedAt', null
    )),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', note.id,
        'creatorId', note.creator_id,
        'workspaceId', note.workspace_id,
        'operatorId', note.operator_id,
        'category', note.category,
        'body', note.body,
        'createdAt', note.created_at
      ) order by note.created_at, note.id)
      from public.creator_review_notes note
      where note.creator_id = p_creator_id
        and note.workspace_id = p_workspace_id
    ), '[]'::jsonb),
    'audit', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', audit.id,
        'workspaceId', audit.workspace_id,
        'operatorId', audit.operator_id,
        'actorLabel', audit.actor_label,
        'eventType', audit.event_type,
        'targetType', audit.target_type,
        'targetId', audit.target_id,
        'creatorId', audit.creator_id,
        'missionId', audit.mission_id,
        'metadata', audit.metadata,
        'createdAt', audit.created_at
      ) order by audit.created_at, audit.id)
      from public.operator_audit_events audit
      where audit.creator_id = p_creator_id
        and audit.workspace_id = p_workspace_id
    ), '[]'::jsonb),
    'social', jsonb_build_object('status', 'unavailable', 'reason', 'not_configured'),
    'profile', jsonb_build_object('status', 'unavailable', 'reason', 'not_configured'),
    'missionHistory', jsonb_build_object('status', 'unavailable', 'reason', 'not_configured'),
    'publicationProofs', private.creator_case_publication_proofs_snapshot(p_workspace_id, p_creator_id)
  );
$$;

create or replace function public.creator_case_review_publication_proof(
  p_command_id uuid,
  p_workspace_id uuid,
  p_creator_id uuid,
  p_operator_id text,
  p_actor_label text,
  p_submission_id uuid,
  p_work_item_id uuid,
  p_attempt_id uuid,
  p_decision text,
  p_message text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_receipt public.creator_case_command_receipts%rowtype;
  v_creator_workspace_id uuid;
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_attempt public.mission_publication_proof_attempts;
  v_correction public.mission_publication_proof_attempts;
  v_result jsonb;
  v_payload jsonb;
  v_message text;
  v_next_sequence integer;
begin
  if p_command_id is null then
    raise exception 'command_required';
  end if;
  v_message := nullif(btrim(p_message), '');
  if p_decision is null or p_decision not in ('verified', 'changes_requested') then
    raise exception 'proof_decision_invalid';
  end if;
  if p_decision = 'changes_requested' and v_message is null then
    raise exception 'proof_message_required';
  end if;

  v_payload := jsonb_build_object(
    'workspace_id', p_workspace_id,
    'creator_id', p_creator_id,
    'operator_id', p_operator_id,
    'actor_label', p_actor_label,
    'submission_id', p_submission_id,
    'work_item_id', p_work_item_id,
    'attempt_id', p_attempt_id,
    'decision', p_decision,
    'message', v_message
  );

  perform pg_advisory_xact_lock(hashtextextended(p_command_id::text, 0));
  select * into v_receipt
  from public.creator_case_command_receipts
  where command_id = p_command_id
  for update;
  if found then
    if v_receipt.workspace_id = p_workspace_id
      and v_receipt.creator_id = p_creator_id
      and v_receipt.command_type = 'review_publication_proof'
      and v_receipt.payload = v_payload
    then
      return v_receipt.result;
    end if;
    raise exception 'command_conflict';
  end if;

  select creator.workspace_id into v_creator_workspace_id
  from public.creators creator
  where creator.id = p_creator_id;
  if not found then raise exception 'creator_not_found'; end if;
  if v_creator_workspace_id <> p_workspace_id then
    raise exception 'workspace_mismatch';
  end if;

  select workflow.* into v_workflow
  from public.mission_workflows workflow
  where workflow.mission_submission_id = p_submission_id
    and workflow.creator_id = p_creator_id
    and workflow.workspace_id = p_workspace_id
  for update;
  if v_workflow.id is null then raise exception 'proof_lineage_mismatch'; end if;

  select item.* into v_item
  from public.mission_work_items item
  where item.id = p_work_item_id
    and item.mission_workflow_id = v_workflow.id
    and item.mission_submission_id = p_submission_id
    and item.creator_id = p_creator_id
    and item.workspace_id = p_workspace_id
  for update;
  if v_item.id is null then raise exception 'proof_lineage_mismatch'; end if;

  select attempt.* into v_attempt
  from public.mission_publication_proof_attempts attempt
  where attempt.id = p_attempt_id
    and attempt.mission_work_item_id = v_item.id
    and attempt.mission_workflow_id = v_item.mission_workflow_id
    and attempt.mission_submission_id = v_item.mission_submission_id
    and attempt.creator_id = v_item.creator_id
    and attempt.workspace_id = v_item.workspace_id
  for update;
  if v_attempt.id is null then raise exception 'proof_attempt_not_found'; end if;
  if v_attempt.state <> 'submitted' then
    raise exception 'proof_attempt_not_submitted';
  end if;

  if p_decision = 'verified' then
    update public.mission_publication_proof_attempts
    set state = 'verified',
        operator_message = v_message,
        decided_at = now(),
        updated_at = now()
    where id = v_attempt.id;

    update public.mission_work_items
    set state = 'approved',
        revision = revision + 1,
        updated_at = now()
    where id = v_item.id;
  else
    update public.mission_publication_proof_attempts
    set state = 'changes_requested',
        operator_message = v_message,
        decided_at = now(),
        updated_at = now()
    where id = v_attempt.id;

    select coalesce(max(attempt.sequence), 0) + 1 into v_next_sequence
    from public.mission_publication_proof_attempts attempt
    where attempt.mission_work_item_id = v_item.id
      and attempt.mission_workflow_id = v_item.mission_workflow_id
      and attempt.mission_submission_id = v_item.mission_submission_id
      and attempt.creator_id = v_item.creator_id
      and attempt.workspace_id = v_item.workspace_id;

    insert into public.mission_publication_proof_attempts (
      mission_work_item_id,
      mission_workflow_id,
      mission_submission_id,
      creator_id,
      workspace_id,
      parent_attempt_id,
      sequence,
      published_url,
      platform,
      state,
      metadata_state
    )
    values (
      v_item.id,
      v_item.mission_workflow_id,
      v_item.mission_submission_id,
      v_item.creator_id,
      v_item.workspace_id,
      v_attempt.id,
      v_next_sequence,
      v_attempt.published_url,
      v_attempt.platform,
      'draft',
      'pending'
    )
    returning * into v_correction;

    update public.mission_work_items
    set state = 'changes_requested',
        revision = revision + 1,
        updated_at = now()
    where id = v_item.id;
  end if;

  perform public.refresh_creator_studio_state(v_workflow.id);

  insert into public.mission_publication_proof_decisions (
    mission_publication_proof_attempt_id,
    mission_work_item_id,
    mission_workflow_id,
    mission_submission_id,
    creator_id,
    workspace_id,
    actor_id,
    decision,
    message
  )
  values (
    v_attempt.id,
    v_item.id,
    v_item.mission_workflow_id,
    v_item.mission_submission_id,
    v_item.creator_id,
    v_item.workspace_id,
    p_operator_id,
    p_decision,
    v_message
  );

  insert into public.mission_publication_proof_events (
    mission_publication_proof_attempt_id,
    mission_work_item_id,
    mission_workflow_id,
    mission_submission_id,
    creator_id,
    workspace_id,
    event_type,
    metadata
  )
  values (
    v_attempt.id,
    v_item.id,
    v_item.mission_workflow_id,
    v_item.mission_submission_id,
    v_item.creator_id,
    v_item.workspace_id,
    'operator_decision_recorded',
    jsonb_build_object('decision', p_decision, 'message', v_message, 'operator_id', p_operator_id)
  );

  insert into public.mission_workflow_events (
    mission_workflow_id,
    mission_work_item_id,
    mission_submission_id,
    creator_id,
    workspace_id,
    event_type,
    command_id,
    metadata
  )
  values (
    v_item.mission_workflow_id,
    v_item.id,
    v_item.mission_submission_id,
    v_item.creator_id,
    v_item.workspace_id,
    case when p_decision = 'verified' then 'proof_verified' else 'proof_changes_requested' end,
    p_command_id,
    jsonb_build_object(
      'attempt_id', v_attempt.id,
      'correction_attempt_id', v_correction.id,
      'decision', p_decision,
      'message', v_message
    )
  );

  insert into public.operator_audit_events (
    workspace_id,
    operator_id,
    actor_label,
    event_type,
    target_type,
    target_id,
    creator_id,
    metadata
  )
  values (
    p_workspace_id,
    p_operator_id,
    p_actor_label,
    case when p_decision = 'verified'
      then 'creator_publication_proof.verified'
      else 'creator_publication_proof.changes_requested'
    end,
    'publication_proof_attempt',
    v_attempt.id::text,
    p_creator_id,
    jsonb_build_object(
      'command_id', p_command_id,
      'submission_id', p_submission_id,
      'work_item_id', p_work_item_id,
      'attempt_id', v_attempt.id,
      'correction_attempt_id', v_correction.id,
      'decision', p_decision,
      'message', v_message
    )
  );

  v_result := private.creator_case_command_snapshot(p_workspace_id, p_creator_id);
  insert into public.creator_case_command_receipts (
    command_id,
    workspace_id,
    creator_id,
    command_type,
    payload,
    result
  )
  values (
    p_command_id,
    p_workspace_id,
    p_creator_id,
    'review_publication_proof',
    v_payload,
    v_result
  );
  return v_result;
end;
$$;

revoke all on function public.creator_case_review_publication_proof(uuid, uuid, uuid, text, text, uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.creator_case_review_publication_proof(uuid, uuid, uuid, text, text, uuid, uuid, uuid, text, text)
  to service_role;

revoke execute on function private.creator_case_publication_proofs_snapshot(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.creator_case_publication_proofs_snapshot(uuid, uuid)
  to service_role;
revoke execute on function private.creator_case_command_snapshot(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.creator_case_command_snapshot(uuid, uuid)
  to service_role;
