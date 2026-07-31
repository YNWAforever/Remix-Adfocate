-- Release hardening: durable backfill replay and an authorized, idempotent
-- retry path for failure-isolated in-app reward-handoff notifications.

alter table public.mission_reward_contracts
  add column backfill_idempotency_key uuid,
  add column backfill_request_hash text;

alter table public.mission_reward_contracts
  add constraint mission_reward_contracts_backfill_replay_check check (
    (source = 'join' and backfill_idempotency_key is null and backfill_request_hash is null)
    or
    (source = 'operator_backfill' and (
      (backfill_idempotency_key is null and backfill_request_hash is null)
      or
      (backfill_idempotency_key is not null
        and nullif(btrim(backfill_request_hash), '') is not null)
    ))
  ),
  add constraint mission_reward_contracts_workspace_backfill_key_unique
    unique (workspace_id, backfill_idempotency_key);

create or replace function private.backfill_mission_reward_contract(
  p_workspace uuid,
  p_workflow uuid,
  p_operator uuid,
  p_points_amount integer,
  p_cash_amount numeric,
  p_currency text,
  p_xp_amount integer,
  p_source_mission_updated_at timestamptz,
  p_confirmation_evidence_source text,
  p_confirmation_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workflow public.mission_workflows;
  v_submission public.mission_submissions;
  v_mission public.missions;
  v_contract public.mission_reward_contracts;
  v_request_hash text;
begin
  perform private.assert_active_mission_operator(p_operator);
  if not exists (
    select 1 from public.brand_users membership
    where membership.user_id = p_operator
      and membership.workspace_id = p_workspace
      and membership.active
  ) then raise exception 'not_authorized'; end if;

  if nullif(btrim(p_confirmation_reason), '') is null then
    raise exception 'backfill_reason_required';
  end if;
  if p_workspace is null or p_workflow is null or p_operator is null
    or p_points_amount is null or p_points_amount < 0
    or p_cash_amount is null or p_cash_amount < 0
    or p_currency is null or p_currency !~ '^[A-Z]{3}$'
    or p_xp_amount is null or p_xp_amount <> 0
    or p_confirmation_evidence_source not in ('mission_brief','signed_agreement','operator_record','other')
    or p_idempotency_key is null
  then raise exception 'backfill_contract_invalid'; end if;

  v_request_hash := encode(
    extensions.digest(
      convert_to(jsonb_build_array(
        'reward_contract_backfill', p_workflow, p_points_amount, p_cash_amount,
        p_currency, p_xp_amount, p_source_mission_updated_at,
        p_confirmation_evidence_source, btrim(p_confirmation_reason)
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select workflow.* into v_workflow
  from public.mission_workflows workflow
  where workflow.id = p_workflow and workflow.workspace_id = p_workspace
  for update;
  if v_workflow.id is null then raise exception 'reward_workflow_not_found'; end if;

  select contract.* into v_contract
  from public.mission_reward_contracts contract
  where contract.workspace_id = p_workspace
    and contract.backfill_idempotency_key = p_idempotency_key
  for update;
  if v_contract.id is not null then
    if v_contract.mission_workflow_id = p_workflow
      and v_contract.backfill_request_hash = v_request_hash
    then
      return jsonb_build_object('contract', to_jsonb(v_contract), 'idempotent', true);
    end if;
    raise exception 'idempotency_conflict';
  end if;

  select contract.* into v_contract
  from public.mission_reward_contracts contract
  where contract.mission_workflow_id = p_workflow
    and contract.workspace_id = p_workspace
  for update;
  if v_contract.id is not null then raise exception 'reward_contract_exists'; end if;

  select submission.* into v_submission
  from public.mission_submissions submission
  where submission.id = v_workflow.mission_submission_id
    and submission.workspace_id = p_workspace;
  if v_submission.id is null then raise exception 'reward_contract_source_missing'; end if;

  select mission.* into v_mission
  from public.missions mission
  where mission.id = v_submission.mission_id
    and mission.workspace_id = p_workspace;
  if v_mission.id is null then raise exception 'reward_contract_source_missing'; end if;

  insert into public.mission_reward_contracts (
    workspace_id, mission_workflow_id, mission_submission_id, mission_id,
    points_amount, cash_amount, currency, xp_amount, source,
    source_mission_updated_at, confirmed_by, confirmation_evidence_source,
    confirmation_reason, backfill_idempotency_key, backfill_request_hash
  ) values (
    p_workspace, v_workflow.id, v_submission.id, v_mission.id,
    p_points_amount, p_cash_amount, p_currency, p_xp_amount, 'operator_backfill',
    p_source_mission_updated_at, p_operator, p_confirmation_evidence_source,
    btrim(p_confirmation_reason), p_idempotency_key, v_request_hash
  ) returning * into v_contract;

  return jsonb_build_object('contract', to_jsonb(v_contract), 'idempotent', false);
exception
  when unique_violation then
    select contract.* into v_contract
    from public.mission_reward_contracts contract
    where contract.workspace_id = p_workspace
      and contract.backfill_idempotency_key = p_idempotency_key;
    if v_contract.id is not null
      and v_contract.mission_workflow_id = p_workflow
      and v_contract.backfill_request_hash = v_request_hash
    then
      return jsonb_build_object('contract', to_jsonb(v_contract), 'idempotent', true);
    end if;
    raise exception 'idempotency_conflict';
end;
$$;

create or replace function public.retry_reward_handoff_notification(
  p_workspace uuid,
  p_operator uuid,
  p_pending_reward uuid,
  p_notification_type text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient uuid;
  v_mission_title text;
  v_mission_slug text;
  v_submission uuid;
  v_target_at timestamptz;
  v_points integer;
  v_cash numeric;
  v_xp integer;
  v_reason text;
  v_decision uuid;
  v_components text[];
  v_semantic_key text;
  v_delivered boolean;
  v_exists boolean;
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then
    raise exception 'not_authorized';
  end if;
  perform private.assert_active_mission_operator(p_operator);
  if not exists (
    select 1 from public.brand_users membership
    where membership.user_id = p_operator
      and membership.workspace_id = p_workspace
      and membership.active
  ) then raise exception 'not_authorized'; end if;
  if p_notification_type not in ('mission_reward_pending','mission_reward_pending_cancelled') then
    raise exception 'validation_failed';
  end if;

  select pending.creator_id, mission.title, mission.slug, submission.id,
    pending.target_at, pending.points_amount, pending.cash_amount, pending.xp_amount,
    case when p_notification_type = 'mission_reward_pending_cancelled'
      then cancellation.reason_category else null end,
    case when p_notification_type = 'mission_reward_pending_cancelled'
      then cancellation.id else approval.id end
  into v_recipient, v_mission_title, v_mission_slug, v_submission,
    v_target_at, v_points, v_cash, v_xp, v_reason, v_decision
  from public.mission_pending_rewards pending
  join public.mission_workflows workflow
    on workflow.id = pending.mission_workflow_id
   and workflow.workspace_id = pending.workspace_id
  join public.mission_submissions submission
    on submission.id = workflow.mission_submission_id
   and submission.id = pending.mission_submission_id
   and submission.workspace_id = pending.workspace_id
   and submission.creator_id = pending.creator_id
   and submission.mission_id = pending.mission_id
  join public.missions mission
    on mission.id = submission.mission_id
   and mission.id = pending.mission_id
   and mission.workspace_id = pending.workspace_id
  join public.mission_reward_contracts contract
    on contract.id = pending.reward_contract_id
   and contract.workspace_id = pending.workspace_id
   and contract.mission_workflow_id = pending.mission_workflow_id
   and contract.mission_submission_id = pending.mission_submission_id
   and contract.mission_id = pending.mission_id
  join public.mission_completion_decisions approval
    on approval.id = pending.completion_decision_id
   and approval.workspace_id = pending.workspace_id
   and approval.mission_workflow_id = pending.mission_workflow_id
   and approval.reward_contract_id = contract.id
   and approval.decision_kind = 'approved'
  left join public.mission_completion_decisions cancellation
    on cancellation.id = pending.cancellation_decision_id
   and cancellation.workspace_id = pending.workspace_id
   and cancellation.mission_workflow_id = pending.mission_workflow_id
   and cancellation.reward_contract_id = contract.id
   and cancellation.pending_reward_id = pending.id
   and cancellation.supersedes_decision_id = approval.id
   and cancellation.decision_kind = 'cancelled'
  where pending.id = p_pending_reward
    and pending.workspace_id = p_workspace
    and (p_notification_type = 'mission_reward_pending'
      or cancellation.id is not null);
  if v_recipient is null or v_decision is null then raise exception 'not_found'; end if;

  v_components := array_remove(array[
    case when v_points > 0 then 'points' end,
    case when v_cash > 0 then 'cash' end,
    case when v_xp > 0 then 'xp' end
  ], null);
  v_semantic_key := concat('decision:', v_decision);
  v_delivered := private.notify_reward_handoff_outcome(
    v_recipient, p_notification_type, p_pending_reward, v_semantic_key,
    jsonb_build_object(
      'mission_title', v_mission_title,
      'mission_slug', v_mission_slug,
      'submission_id', v_submission,
      'target_at', v_target_at,
      'reward_components', to_jsonb(v_components),
      'reason_category', case when p_notification_type = 'mission_reward_pending_cancelled' then v_reason else null end
    )
  );
  select exists (
    select 1 from public.notifications notification
    where notification.user_id = v_recipient
      and notification.workspace_id = p_workspace
      and notification.type = p_notification_type
      and notification.entity_type = 'mission_pending_reward'
      and notification.entity_id = p_pending_reward
  ) into v_exists;
  if not v_exists then raise exception 'notification_retry_failed'; end if;
  return jsonb_build_object('delivered', true, 'idempotent', not v_delivered);
end;
$$;

revoke all on function public.retry_reward_handoff_notification(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.retry_reward_handoff_notification(uuid, uuid, uuid, text)
  to service_role;