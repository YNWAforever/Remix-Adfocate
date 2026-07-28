-- Publication-proof outcome notifications are observed from the append-only
-- workflow event boundary. Delivery stays best-effort and reward-neutral.

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
    'mission_publication_verified'
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
      'mission_publication_verified'
    )
    or octet_length(data::text) <= 8192
  );

create or replace function private.notify_publication_proof_outcome(
  p_recipient uuid,
  p_type text,
  p_work_item uuid,
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
     or p_work_item is null
     or nullif(btrim(p_semantic_key), '') is null
     or p_type not in (
       'mission_publication_correction_requested',
       'mission_publication_verified'
     )
     or jsonb_typeof(p_payload) <> 'object'
  then
    return false;
  end if;

  select item.workspace_id
  into v_workspace
  from public.mission_work_items item
  where item.id = p_work_item;

  if v_workspace is null then
    return false;
  end if;

  v_data := jsonb_strip_nulls(jsonb_build_object(
    'mission_title', p_payload->'mission_title',
    'mission_slug', p_payload->'mission_slug',
    'submission_id', p_payload->'submission_id',
    'deliverable_title', p_payload->'deliverable_title',
    'deadline', p_payload->'deadline',
    'attempt_number', p_payload->'attempt_number',
    'reason_categories', p_payload->'reason_categories'
  ));

  begin
    insert into private.mission_workflow_notification_dedupe
      (recipient_id, notification_type, entity_type, entity_id, semantic_key)
    values
      (p_recipient, p_type, 'mission_work_item', p_work_item, p_semantic_key)
    on conflict do nothing;

    get diagnostics v_claimed = row_count;
    if v_claimed = 0 then
      return false;
    end if;

    insert into public.notifications
      (user_id, workspace_id, type, data, entity_type, entity_id)
    values
      (p_recipient, v_workspace, p_type, v_data, 'mission_work_item', p_work_item);

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

create or replace function private.notify_publication_proof_event()
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
  v_deliverable_title text;
  v_deadline timestamptz;
  v_attempt_number integer;
  v_reason_categories text[];
  v_type text;
  v_semantic_key text;
  v_payload jsonb;
begin
  v_type := case new.event_type
    when 'mission_publication_proof_correction_requested'
      then 'mission_publication_correction_requested'
    when 'mission_publication_proof_verified'
      then 'mission_publication_verified'
    else null
  end;

  if v_type is null
     or new.mission_work_item_id is null
     or new.entity_type is distinct from 'mission_publication_proof_review'
     or new.entity_id is null
  then
    return new;
  end if;

  select
    submission.creator_id,
    mission.title,
    mission.slug,
    submission.id,
    item.title,
    case
      when new.event_type = 'mission_publication_proof_correction_requested'
        then coalesce(review.creator_response_deadline, instruction.publication_due_at, item.deadline)
      else coalesce(instruction.publication_due_at, item.deadline)
    end,
    attempt.attempt_number,
    coalesce(
      array_agg(distinct review_item.category order by review_item.category)
        filter (where review_item.category is not null),
      array[]::text[]
    )
  into
    v_recipient,
    v_mission_title,
    v_mission_slug,
    v_submission,
    v_deliverable_title,
    v_deadline,
    v_attempt_number,
    v_reason_categories
  from public.mission_work_items item
  join public.mission_workflows workflow
    on workflow.id = item.mission_workflow_id
   and workflow.workspace_id = item.workspace_id
  join public.mission_submissions submission
    on submission.id = workflow.mission_submission_id
   and submission.workspace_id = workflow.workspace_id
  join public.missions mission
    on mission.id = submission.mission_id
   and mission.workspace_id = submission.workspace_id
  join public.mission_publication_proof_reviews review
    on review.id = new.entity_id
   and review.workspace_id = item.workspace_id
  join public.mission_publication_proof_attempts attempt
    on attempt.id = review.mission_publication_proof_attempt_id
   and attempt.mission_work_item_id = item.id
   and attempt.workspace_id = item.workspace_id
  left join public.mission_publication_instructions instruction
    on instruction.mission_work_item_id = item.id
   and instruction.workspace_id = item.workspace_id
  left join public.mission_publication_proof_review_items review_item
    on review_item.mission_publication_proof_review_id = review.id
   and review_item.workspace_id = review.workspace_id
  where item.id = new.mission_work_item_id
    and item.mission_workflow_id = new.mission_workflow_id
    and item.workspace_id = new.workspace_id
  group by
    submission.creator_id,
    mission.title,
    mission.slug,
    submission.id,
    item.title,
    item.deadline,
    instruction.publication_due_at,
    review.creator_response_deadline,
    attempt.attempt_number;

  if v_recipient is null or v_attempt_number is null then
    return new;
  end if;

  v_semantic_key := case
    when v_type = 'mission_publication_correction_requested'
      then concat(
        'attempt:', v_attempt_number::text,
        '|reasons:', array_to_string(v_reason_categories, ',')
      )
    else concat('attempt:', v_attempt_number::text)
  end;

  v_payload := jsonb_build_object(
    'mission_title', v_mission_title,
    'mission_slug', v_mission_slug,
    'submission_id', v_submission,
    'deliverable_title', v_deliverable_title,
    'deadline', v_deadline,
    'attempt_number', v_attempt_number,
    'reason_categories', case
      when v_type = 'mission_publication_correction_requested'
        then to_jsonb(v_reason_categories)
      else null
    end
  );

  perform private.notify_publication_proof_outcome(
    v_recipient,
    v_type,
    new.mission_work_item_id,
    v_semantic_key,
    v_payload
  );

  return new;
exception
  when others then
    return new;
end;
$$;

drop trigger if exists publication_proof_workflow_event_notifications
  on public.mission_workflow_events;
create trigger publication_proof_workflow_event_notifications
after insert on public.mission_workflow_events
for each row execute function private.notify_publication_proof_event();

revoke all on function private.notify_publication_proof_outcome(uuid, text, uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.notify_publication_proof_event()
  from public, anon, authenticated, service_role;
