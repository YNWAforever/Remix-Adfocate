-- Allow a creator to abandon a pending publication-proof evidence reservation
-- after a failed upload or finalize attempt. The reservation remains in the
-- audit trail but is excluded from the creator workspace projection.

create or replace function public.creator_studio_cancel_proof_evidence(
  p_submission_id uuid,
  p_workspace_id uuid,
  p_work_item_id uuid,
  p_attempt_id uuid,
  p_evidence_id uuid,
  p_command_id text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_attempt public.mission_publication_proof_attempts;
  v_latest public.mission_publication_proof_attempts;
  v_asset public.mission_publication_proof_assets;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_response jsonb;
begin
  if auth.uid() is null
     or coalesce(length(btrim(p_command_id)), 0) = 0
     or length(p_command_id) > 128
  then
    raise exception 'command_required' using errcode = '22023';
  end if;

  v_request_hash := md5(jsonb_build_object(
    'action', 'cancel_proof_evidence',
    'actor_id', auth.uid(),
    'workspace_id', p_workspace_id,
    'submission_id', p_submission_id,
    'work_item_id', p_work_item_id,
    'attempt_id', p_attempt_id,
    'evidence_id', p_evidence_id,
    'command_id', p_command_id
  )::text);

  select workflow.* into v_workflow
  from public.mission_workflows workflow
  where workflow.mission_submission_id = p_submission_id
    and workflow.creator_id = auth.uid()
    and workflow.workspace_id = p_workspace_id
  for update;
  if v_workflow.id is null then raise exception 'submission_not_found'; end if;

  select command.request_hash, command.response
    into v_existing_hash, v_existing_response
  from public.mission_workflow_commands command
  where command.mission_submission_id = p_submission_id
    and command.actor_id = auth.uid()
    and command.workspace_id = p_workspace_id
    and command.command_id = p_command_id
  for update;
  if found then
    if v_existing_hash <> v_request_hash then
      raise exception 'command_conflict' using errcode = '23505';
    end if;
    return v_existing_response || jsonb_build_object('replayed', true);
  end if;

  select * into v_item
  from public.mission_work_items item
  where item.id = p_work_item_id
    and item.mission_workflow_id = v_workflow.id
    and item.mission_submission_id = p_submission_id
    and item.creator_id = auth.uid()
    and item.workspace_id = p_workspace_id
  for update;
  if v_item.id is null then raise exception 'work_item_not_found'; end if;
  if v_item.state not in ('not_started', 'drafting', 'ready_to_submit', 'changes_requested') then
    raise exception 'invalid_transition' using errcode = '55000';
  end if;

  select * into v_attempt
  from public.mission_publication_proof_attempts attempt
  where attempt.id = p_attempt_id
    and attempt.mission_work_item_id = v_item.id
    and attempt.mission_workflow_id = v_item.mission_workflow_id
    and attempt.mission_submission_id = v_item.mission_submission_id
    and attempt.creator_id = v_item.creator_id
    and attempt.workspace_id = v_item.workspace_id
  for update;
  if v_attempt.id is null then raise exception 'proof_attempt_immutable' using errcode = '55000'; end if;

  select * into v_latest
  from public.mission_publication_proof_attempts attempt
  where attempt.mission_work_item_id = v_item.id
    and attempt.mission_workflow_id = v_item.mission_workflow_id
    and attempt.mission_submission_id = v_item.mission_submission_id
    and attempt.creator_id = v_item.creator_id
    and attempt.workspace_id = v_item.workspace_id
  order by attempt.sequence desc, attempt.id desc
  limit 1;
  if v_latest.id <> v_attempt.id or v_attempt.state <> 'draft' then
    raise exception 'proof_attempt_immutable' using errcode = '55000';
  end if;

  select * into v_asset
  from public.mission_publication_proof_assets asset
  where asset.id = p_evidence_id
    and asset.mission_publication_proof_attempt_id = v_attempt.id
    and asset.mission_work_item_id = v_item.id
    and asset.mission_workflow_id = v_item.mission_workflow_id
    and asset.mission_submission_id = v_item.mission_submission_id
    and asset.creator_id = v_item.creator_id
    and asset.workspace_id = v_item.workspace_id
  for update;
  if v_asset.id is null or v_asset.upload_state <> 'pending' then
    raise exception 'proof_evidence_invalid' using errcode = '55000';
  end if;

  update public.mission_publication_proof_assets
  set upload_state = 'abandoned'
  where id = v_asset.id;

  v_response := jsonb_build_object('replayed', false, 'evidence_id', v_asset.id);
  insert into public.mission_publication_proof_events
    (mission_publication_proof_attempt_id, mission_work_item_id, mission_workflow_id,
     mission_submission_id, creator_id, workspace_id, event_type, metadata)
  values
    (v_attempt.id, v_item.id, v_item.mission_workflow_id, v_item.mission_submission_id,
     v_item.creator_id, v_item.workspace_id, 'evidence_cancelled',
     jsonb_build_object('evidence_id', v_asset.id));
  insert into public.mission_workflow_events
    (mission_workflow_id, mission_work_item_id, mission_submission_id, creator_id,
     workspace_id, event_type, command_id, metadata)
  values
    (v_item.mission_workflow_id, v_item.id, v_item.mission_submission_id, v_item.creator_id,
     v_item.workspace_id, 'proof_evidence_cancelled', p_command_id,
     jsonb_build_object('attempt_id', v_attempt.id, 'evidence_id', v_asset.id));
  insert into public.mission_workflow_commands
    (mission_submission_id, actor_id, creator_id, workspace_id, command_id, action, request_hash, response)
  values
    (p_submission_id, auth.uid(), v_item.creator_id, p_workspace_id, p_command_id,
     'cancel_proof_evidence', v_request_hash, v_response);
  return v_response;
end;
$$;

revoke all on function public.creator_studio_cancel_proof_evidence(uuid, uuid, uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.creator_studio_cancel_proof_evidence(uuid, uuid, uuid, uuid, uuid, text, text)
  to authenticated, service_role;
