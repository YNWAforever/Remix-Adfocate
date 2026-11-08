-- Freeze active-workspace reward promises at join time and provide explicit,
-- audited service-only recovery for workflows that predate contract capture.

create or replace function public.join_active_mission(p_mission uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.mission_submissions;
  v_workflow public.mission_workflows;
  v_contract public.mission_reward_contracts;
begin
  v_submission := public.join_mission(p_mission);
  v_workflow := private.create_mission_workflow(v_submission.id);

  insert into public.mission_reward_contracts (
    workspace_id,
    mission_workflow_id,
    mission_submission_id,
    mission_id,
    points_amount,
    cash_amount,
    currency,
    xp_amount,
    source,
    source_mission_updated_at
  )
  select
    v_workflow.workspace_id,
    v_workflow.id,
    v_submission.id,
    mission.id,
    mission.points_reward,
    coalesce(mission.cash_reward, 0),
    'HKD',
    0,
    'join',
    mission.updated_at
  from public.missions mission
  where mission.id = v_submission.mission_id
    and mission.workspace_id = v_submission.workspace_id
  returning * into v_contract;

  if not found then
    raise exception 'reward_contract_source_missing';
  end if;

  return jsonb_build_object(
    'submission', to_jsonb(v_submission),
    'workflow', to_jsonb(v_workflow),
    'rewardContract', to_jsonb(v_contract)
  );
end;
$$;

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

  if nullif(btrim(p_confirmation_reason), '') is null then
    raise exception 'backfill_reason_required';
  end if;

  if p_workspace is null
    or p_workflow is null
    or p_operator is null
    or p_points_amount is null
    or p_points_amount < 0
    or p_cash_amount is null
    or p_cash_amount < 0
    or p_currency is null
    or p_currency !~ '^[A-Z]{3}$'
    or p_xp_amount is null
    or p_xp_amount < 0
    or p_confirmation_evidence_source is null
    or p_confirmation_evidence_source not in (
      'mission_brief',
      'signed_agreement',
      'operator_record',
      'other'
    )
    or p_idempotency_key is null
  then
    raise exception 'backfill_contract_invalid';
  end if;

  select workflow.* into v_workflow
  from public.mission_workflows workflow
  where workflow.id = p_workflow
    and workflow.workspace_id = p_workspace
  for update;
  if v_workflow.id is null then
    raise exception 'reward_workflow_not_found';
  end if;

  select submission.* into v_submission
  from public.mission_submissions submission
  where submission.id = v_workflow.mission_submission_id
    and submission.workspace_id = p_workspace;
  if v_submission.id is null then
    raise exception 'reward_contract_source_missing';
  end if;

  select mission.* into v_mission
  from public.missions mission
  where mission.id = v_submission.mission_id
    and mission.workspace_id = p_workspace;
  if v_mission.id is null then
    raise exception 'reward_contract_source_missing';
  end if;

  if exists (
    select 1
    from public.mission_reward_contracts contract
    where contract.mission_workflow_id = v_workflow.id
      and contract.workspace_id = p_workspace
  ) then
    raise exception 'reward_contract_exists';
  end if;

  insert into public.mission_reward_contracts (
    workspace_id,
    mission_workflow_id,
    mission_submission_id,
    mission_id,
    points_amount,
    cash_amount,
    currency,
    xp_amount,
    source,
    source_mission_updated_at,
    confirmed_by,
    confirmation_evidence_source,
    confirmation_reason
  ) values (
    p_workspace,
    v_workflow.id,
    v_submission.id,
    v_mission.id,
    p_points_amount,
    p_cash_amount,
    p_currency,
    p_xp_amount,
    'operator_backfill',
    p_source_mission_updated_at,
    p_operator,
    p_confirmation_evidence_source,
    btrim(p_confirmation_reason)
  )
  returning * into v_contract;

  return jsonb_build_object(
    'contract', to_jsonb(v_contract),
    'idempotent', false
  );
end;
$$;

create or replace function public.backfill_mission_reward_contract(
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
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then
    raise exception 'not_authorized';
  end if;
  perform private.assert_active_mission_operator(p_operator);
  return private.backfill_mission_reward_contract(
    p_workspace,
    p_workflow,
    p_operator,
    p_points_amount,
    p_cash_amount,
    p_currency,
    p_xp_amount,
    p_source_mission_updated_at,
    p_confirmation_evidence_source,
    p_confirmation_reason,
    p_idempotency_key
  );
end;
$$;

create or replace function private.set_reward_processing_window(
  p_workspace uuid,
  p_operator uuid,
  p_days smallint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  if p_days is not null and (p_days < 0 or p_days > 365) then
    raise exception 'reward_processing_window_invalid';
  end if;

  update public.workspaces
  set reward_processing_window_days = p_days
  where id = p_workspace;

  if not found then
    raise exception 'workspace_not_found';
  end if;

  return jsonb_build_object(
    'workspaceId', p_workspace,
    'rewardProcessingWindowDays', p_days
  );
end;
$$;

create or replace function public.set_reward_processing_window(
  p_workspace uuid,
  p_operator uuid,
  p_days smallint
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
  return private.set_reward_processing_window(p_workspace, p_operator, p_days);
end;
$$;

revoke all on function public.join_active_mission(uuid) from public, anon, authenticated, service_role;
grant execute on function public.join_active_mission(uuid) to authenticated;

revoke all on function private.backfill_mission_reward_contract(uuid, uuid, uuid, integer, numeric, text, integer, timestamptz, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.backfill_mission_reward_contract(uuid, uuid, uuid, integer, numeric, text, integer, timestamptz, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.backfill_mission_reward_contract(uuid, uuid, uuid, integer, numeric, text, integer, timestamptz, text, text, uuid) to service_role;

revoke all on function private.set_reward_processing_window(uuid, uuid, smallint) from public, anon, authenticated, service_role;
revoke all on function public.set_reward_processing_window(uuid, uuid, smallint) from public, anon, authenticated, service_role;
grant execute on function public.set_reward_processing_window(uuid, uuid, smallint) to service_role;

-- The workflow helper remains an internal transaction building block.
revoke all on function private.create_mission_workflow(uuid) from public, anon, authenticated, service_role;
