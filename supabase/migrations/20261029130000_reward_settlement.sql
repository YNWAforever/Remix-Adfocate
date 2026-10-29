begin;

-- F-007: active-workspace rewards stopped at mission_pending_rewards.status = 'pending'
-- ("finance review pending") and were never credited to any ledger. A workspace admin now
-- settles a hand-off: in one transaction the frozen points, cash and XP are credited (and an
-- enforced workspace budget debited, as legacy approval does), the row moves pending ->
-- settled, the creator is notified and the action is audited. Unique mission_reward:
-- ledger references make a double credit impossible even outside this command.

alter table public.mission_pending_rewards
  add column settled_at timestamptz,
  add column settled_by uuid references auth.users(id),
  add column settlement_idempotency_key uuid unique;
alter table public.mission_pending_rewards drop constraint mission_pending_rewards_status_check;
alter table public.mission_pending_rewards
  add constraint mission_pending_rewards_status_check check (status in ('pending','cancelled','settled')),
  add constraint mission_pending_rewards_settlement_check check (
    (status = 'settled') = (settled_at is not null and settled_by is not null and settlement_idempotency_key is not null));

create unique index point_transactions_mission_reward_uniq on public.point_transactions(source_ref)
  where source_ref like 'mission_reward:%';
create unique index earnings_transactions_mission_reward_uniq on public.earnings_transactions(source_ref)
  where source_ref like 'mission_reward:%';

create or replace function private.guard_pending_reward_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and old.status = 'pending'
     and old.cancellation_decision_id is null
     and old.cancelled_at is null
     and new.status = 'cancelled'
     and new.cancellation_decision_id is not null
     and new.cancelled_at is not null
     and (to_jsonb(new) - array['status', 'cancellation_decision_id', 'cancelled_at'])
       is not distinct from
       (to_jsonb(old) - array['status', 'cancellation_decision_id', 'cancelled_at'])
  then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.status = 'pending'
     and old.settled_at is null
     and new.status = 'settled'
     and new.settled_at is not null and new.settled_by is not null and new.settlement_idempotency_key is not null
     and (to_jsonb(new) - array['status', 'settled_at', 'settled_by', 'settlement_idempotency_key'])
       is not distinct from
       (to_jsonb(old) - array['status', 'settled_at', 'settled_by', 'settlement_idempotency_key'])
  then
    return new;
  end if;
  raise exception 'immutable_record';
end;
$$;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'submission_approved','submission_rejected','redemption_ready',
    'level_up','application_accepted','application_declined',
    'campaign_goal_reached','campaign_prize_awarded','campaign_started',
    'mission_product_shipped','mission_receipt_required',
    'mission_revision_requested','mission_draft_approved',
    'mission_approved_to_publish','mission_deadline_approaching',
    'mission_deadline_overdue',
    'mission_publication_correction_requested',
    'mission_publication_verified',
    'mission_reward_pending',
    'mission_reward_pending_cancelled',
    'mission_reward_settled'
  ));

create function public.settle_mission_reward_handoff(
  p_workspace uuid, p_pending_reward uuid, p_operator uuid, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor text; v_row public.mission_pending_rewards%rowtype;
  v_title text; v_slug text; v_bal integer; v_earn numeric;
  v_bgt_bal numeric; v_bgt_enforced boolean; v_ref text;
begin
  if p_idempotency_key is null then
    raise exception using errcode='22023',message='invalid_command';
  end if;
  select s.email into v_actor from public.staff_users s
    join public.brand_users b on b.user_id=s.user_id
    join public.staff_workspace_roles r on r.user_id=s.user_id and r.workspace_id=b.workspace_id
    where s.user_id=p_operator and s.active and b.workspace_id=p_workspace and b.active
      and r.active and r.role = 'workspace_admin' for share of s,b,r;
  if not found then raise exception using errcode='42501',message='FORBIDDEN'; end if;

  select * into v_row from public.mission_pending_rewards
    where id = p_pending_reward and workspace_id = p_workspace for update;
  if not found then raise exception 'not_found'; end if;
  if v_row.status = 'settled' then
    if v_row.settlement_idempotency_key = p_idempotency_key then return to_jsonb(v_row); end if;
    raise exception 'wrong_state';
  end if;
  if v_row.status <> 'pending' then raise exception 'wrong_state'; end if;

  select title, slug into v_title, v_slug from public.missions where id = v_row.mission_id;
  v_ref := 'mission_reward:' || v_row.id;

  if v_row.cash_amount > 0 then
    select balance, enforced into v_bgt_bal, v_bgt_enforced
      from public.workspace_budgets where workspace_id = p_workspace for update;
    if v_bgt_enforced is true then
      if v_bgt_bal < v_row.cash_amount then raise exception 'insufficient_budget'; end if;
      update public.workspace_budgets set balance = balance - v_row.cash_amount, updated_at = now()
        where workspace_id = p_workspace;
      insert into public.workspace_budget_transactions (workspace_id, type, delta, balance_after, source_ref, description)
        values (p_workspace, 'debit', -v_row.cash_amount, v_bgt_bal - v_row.cash_amount, v_ref, v_title);
    end if;
  end if;

  if v_row.points_amount > 0 then
    update public.point_balances set balance = balance + v_row.points_amount, updated_at = now()
      where creator_id = v_row.creator_id and workspace_id = p_workspace returning balance into v_bal;
    if v_bal is null then raise exception 'point_balances_missing'; end if;
    insert into public.point_transactions (creator_id, workspace_id, type, delta, balance_after, source_ref, description)
      values (v_row.creator_id, p_workspace, 'earn', v_row.points_amount, v_bal, v_ref, v_title);
  end if;

  if v_row.cash_amount > 0 then
    update public.earnings_balances set available = available + v_row.cash_amount, updated_at = now()
      where creator_id = v_row.creator_id and workspace_id = p_workspace returning available into v_earn;
    if v_earn is null then raise exception 'earnings_balances_missing'; end if;
    insert into public.earnings_transactions (creator_id, workspace_id, type, amount, balance_after, source_ref, description)
      values (v_row.creator_id, p_workspace, 'earn', v_row.cash_amount, v_earn, v_ref, v_title);
  end if;

  if v_row.xp_amount > 0 then
    update public.creators set xp = xp + v_row.xp_amount where id = v_row.creator_id;
  end if;

  update public.mission_pending_rewards
    set status = 'settled', settled_at = clock_timestamp(), settled_by = p_operator,
        settlement_idempotency_key = p_idempotency_key
    where id = v_row.id returning * into v_row;

  insert into public.notifications (user_id, workspace_id, type, entity_type, entity_id, data)
    values (v_row.creator_id, p_workspace, 'mission_reward_settled', 'mission_pending_reward', v_row.id,
      jsonb_build_object('mission_title', v_title, 'mission_slug', v_slug,
        'submission_id', v_row.mission_submission_id, 'points', v_row.points_amount,
        'cash', v_row.cash_amount, 'xp', v_row.xp_amount, 'currency', v_row.currency));

  insert into public.operator_audit_events(workspace_id,operator_id,actor_label,event_type,target_type,target_id,creator_id,mission_id,metadata)
    values (p_workspace, p_operator::text, v_actor, 'reward.settled', 'mission_pending_reward', v_row.id::text,
      v_row.creator_id, v_row.mission_id,
      jsonb_build_object('points', v_row.points_amount, 'cash', v_row.cash_amount, 'xp', v_row.xp_amount,
        'idempotency_key', p_idempotency_key));
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.settle_mission_reward_handoff(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.settle_mission_reward_handoff(uuid,uuid,uuid,uuid) to service_role;

-- The creator's hand-off read now also returns settled rows (with settledAt); otherwise
-- unchanged from its current definition.
CREATE OR REPLACE FUNCTION public.get_my_mission_reward_handoff(p_submission uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      or (
        pending.status = 'settled'
        and pending.cancellation_decision_id is null
        and cancellation.id is null
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
    'settledAt', v_pending.settled_at,
    'decisionState', jsonb_build_object(
      'kind', v_decision_kind,
      'decidedAt', v_decided_at
    )
  );
end;
$function$;

commit;
