-- Reward handoff notifications observe append-only workflow decisions. Delivery is
-- best-effort: notification failures cannot roll back a valid workflow event.

alter table public.notifications drop constraint if exists notifications_type_check;
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
    'mission_reward_pending_cancelled'
  ));

alter table public.notifications drop constraint if exists notifications_workflow_payload_size_check;
alter table public.notifications add constraint notifications_workflow_payload_size_check
  check (
    type not in (
      'mission_product_shipped','mission_receipt_required',
      'mission_revision_requested','mission_draft_approved',
      'mission_approved_to_publish','mission_deadline_approaching',
      'mission_deadline_overdue',
      'mission_publication_correction_requested',
      'mission_publication_verified',
      'mission_reward_pending',
      'mission_reward_pending_cancelled'
    )
    or octet_length(data::text) <= 8192
  );

create or replace function private.notify_reward_handoff_outcome(
  p_recipient uuid,
  p_type text,
  p_pending_reward uuid,
  p_semantic_key text,
  p_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_claimed integer;
  v_data jsonb;
begin
  if p_recipient is null
     or p_pending_reward is null
     or nullif(btrim(p_semantic_key), '') is null
     or p_type not in (
       'mission_reward_pending',
       'mission_reward_pending_cancelled'
     )
     or jsonb_typeof(p_payload) <> 'object'
  then
    return false;
  end if;

  select pending.workspace_id
  into v_workspace
  from public.mission_pending_rewards pending
  where pending.id = p_pending_reward;

  if v_workspace is null then
    return false;
  end if;

  v_data := jsonb_strip_nulls(jsonb_build_object(
    'mission_title', p_payload->'mission_title',
    'mission_slug', p_payload->'mission_slug',
    'submission_id', p_payload->'submission_id',
    'target_at', p_payload->'target_at',
    'reward_components', p_payload->'reward_components',
    'reason_category', p_payload->'reason_category'
  ));

  begin
    insert into private.mission_workflow_notification_dedupe
      (recipient_id, notification_type, entity_type, entity_id, semantic_key)
    values
      (p_recipient, p_type, 'mission_pending_reward', p_pending_reward, p_semantic_key)
    on conflict do nothing;

    get diagnostics v_claimed = row_count;
    if v_claimed = 0 then
      return false;
    end if;

    insert into public.notifications
      (user_id, workspace_id, type, data, entity_type, entity_id)
    values
      (p_recipient, v_workspace, p_type, v_data, 'mission_pending_reward', p_pending_reward);

    return true;
  exception
    when others then
      return false;
  end;
exception
  when others then
    return false;
end;
$$;

create or replace function private.notify_reward_handoff_event()
returns trigger
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
  v_points_amount integer;
  v_cash_amount numeric;
  v_xp_amount integer;
  v_reason_category text;
  v_reward_components text[];
  v_type text;
  v_semantic_key text;
  v_payload jsonb;
begin
  v_type := case new.event_type
    when 'mission_completion_approved'
      then 'mission_reward_pending'
    when 'mission_reward_pending_cancelled'
      then 'mission_reward_pending_cancelled'
    else null
  end;

  if v_type is null
     or new.entity_type is distinct from 'mission_pending_reward'
     or new.entity_id is null
     or nullif(new.metadata->>'decision_id', '') is null
  then
    return new;
  end if;

  select
    pending.creator_id,
    mission.title,
    mission.slug,
    submission.id,
    pending.target_at,
    pending.points_amount,
    pending.cash_amount,
    pending.xp_amount,
    decision.reason_category
  into
    v_recipient,
    v_mission_title,
    v_mission_slug,
    v_submission,
    v_target_at,
    v_points_amount,
    v_cash_amount,
    v_xp_amount,
    v_reason_category
  from public.mission_pending_rewards pending
  join public.mission_workflows workflow
    on workflow.id = pending.mission_workflow_id
   and workflow.workspace_id = pending.workspace_id
  join public.mission_submissions submission
    on submission.id = pending.mission_submission_id
   and submission.workspace_id = pending.workspace_id
   and submission.creator_id = pending.creator_id
  join public.missions mission
    on mission.id = pending.mission_id
   and mission.workspace_id = pending.workspace_id
   and mission.id = submission.mission_id
  join public.mission_completion_decisions decision
    on decision.id::text = new.metadata->>'decision_id'
   and decision.workspace_id = pending.workspace_id
   and decision.mission_workflow_id = pending.mission_workflow_id
   and decision.reward_contract_id = pending.reward_contract_id
  where pending.id = new.entity_id
    and pending.workspace_id = new.workspace_id
    and pending.mission_workflow_id = new.mission_workflow_id
    and (
      (new.event_type = 'mission_completion_approved'
        and decision.decision_kind = 'approved'
        and decision.id = pending.completion_decision_id)
      or
      (new.event_type = 'mission_reward_pending_cancelled'
        and decision.decision_kind = 'cancelled'
        and decision.id = pending.cancellation_decision_id)
    );

  if v_recipient is null then
    return new;
  end if;

  v_reward_components := array_remove(array[
    case when v_points_amount > 0 then 'points' end,
    case when v_cash_amount > 0 then 'cash' end,
    case when v_xp_amount > 0 then 'xp' end
  ], null);
  v_semantic_key := concat('decision:', new.metadata->>'decision_id');
  v_payload := jsonb_build_object(
    'mission_title', v_mission_title,
    'mission_slug', v_mission_slug,
    'submission_id', v_submission,
    'target_at', v_target_at,
    'reward_components', to_jsonb(v_reward_components),
    'reason_category', case
      when v_type = 'mission_reward_pending_cancelled' then v_reason_category
      else null
    end
  );

  perform private.notify_reward_handoff_outcome(
    v_recipient,
    v_type,
    new.entity_id,
    v_semantic_key,
    v_payload
  );

  return new;
exception
  when others then
    return new;
end;
$$;

drop trigger if exists reward_handoff_workflow_event_notifications
  on public.mission_workflow_events;
create trigger reward_handoff_workflow_event_notifications
after insert on public.mission_workflow_events
for each row execute function private.notify_reward_handoff_event();

revoke all on function private.notify_reward_handoff_outcome(uuid, text, uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.notify_reward_handoff_event()
  from public, anon, authenticated, service_role;
