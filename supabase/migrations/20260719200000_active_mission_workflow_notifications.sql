-- Phase 2 workflow notifications are added in a forward migration because the
-- foundational workspace migration has already been followed by transition overrides.
-- Triggers preserve those atomic transition functions and make delivery best-effort.

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'submission_approved','submission_rejected','redemption_ready',
    'level_up','application_accepted','application_declined',
    'campaign_goal_reached','campaign_prize_awarded','campaign_started',
    'mission_product_shipped','mission_receipt_required',
    'mission_revision_requested','mission_draft_approved',
    'mission_approved_to_publish','mission_deadline_approaching',
    'mission_deadline_overdue'
  ));

create or replace function private.notify_mission_workflow(
  p_type text,
  p_workflow uuid,
  p_work_item uuid default null,
  p_deadline timestamptz default null,
  p_version_number integer default null,
  p_reason_category text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_workspace uuid;
  v_submission uuid;
  v_mission_title text;
  v_mission_slug text;
  v_deliverable_title text;
  v_deadline timestamptz;
  v_version_number integer;
  v_entity_type text;
  v_entity_id uuid;
  v_data jsonb;
begin
  if p_type not in (
    'mission_product_shipped','mission_receipt_required',
    'mission_revision_requested','mission_draft_approved',
    'mission_approved_to_publish','mission_deadline_approaching',
    'mission_deadline_overdue'
  ) then
    return;
  end if;

  select
    s.creator_id,
    w.workspace_id,
    w.mission_submission_id,
    m.title,
    m.slug,
    i.title,
    coalesce(p_deadline, i.deadline),
    coalesce(p_version_number, v.version_number)
  into
    v_user,
    v_workspace,
    v_submission,
    v_mission_title,
    v_mission_slug,
    v_deliverable_title,
    v_deadline,
    v_version_number
  from public.mission_workflows w
  join public.mission_submissions s
    on s.id = w.mission_submission_id
   and s.workspace_id = w.workspace_id
  join public.missions m
    on m.id = s.mission_id
   and m.workspace_id = s.workspace_id
  left join public.mission_work_items i
    on i.id = p_work_item
   and i.mission_workflow_id = w.id
   and i.workspace_id = w.workspace_id
  left join public.mission_draft_versions v
    on v.id = coalesce(i.approved_version_id, i.current_submitted_version_id)
   and v.mission_work_item_id = i.id
   and v.workspace_id = i.workspace_id
  where w.id = p_workflow;

  if v_user is null then
    return;
  end if;

  v_entity_type := case when p_work_item is null then 'mission_workflow' else 'mission_work_item' end;
  v_entity_id := coalesce(p_work_item, p_workflow);
  v_data := jsonb_strip_nulls(jsonb_build_object(
    'mission_title', v_mission_title,
    'mission_slug', v_mission_slug,
    'submission_id', v_submission,
    'deliverable_title', v_deliverable_title,
    'deadline', v_deadline,
    'version_number', v_version_number,
    'reason_category', p_reason_category
  ));

  begin
    insert into public.notifications (
      user_id, workspace_id, type, entity_type, entity_id, data
    )
    select
      v_user, v_workspace, p_type, v_entity_type, v_entity_id, v_data
    where not exists (
      select 1
      from public.notifications n
      where n.user_id = v_user
        and n.workspace_id = v_workspace
        and n.type = p_type
        and n.entity_type = v_entity_type
        and n.entity_id = v_entity_id
        and coalesce(n.data ->> 'deadline', '') = coalesce(v_data ->> 'deadline', '')
        and coalesce(n.data ->> 'version_number', '') = coalesce(v_data ->> 'version_number', '')
        and coalesce(n.data ->> 'reason_category', '') = coalesce(v_data ->> 'reason_category', '')
    );
  exception
    when others then
      null;
  end;
end;
$$;

create or replace function private.notify_mission_fulfillment_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status and new.status = 'shipped' then
    perform private.notify_mission_workflow('mission_product_shipped', new.mission_workflow_id);
    perform private.notify_mission_workflow('mission_receipt_required', new.mission_workflow_id);
  end if;
  return new;
end;
$$;

drop trigger if exists mission_fulfillment_workflow_notifications on public.mission_fulfillments;
create trigger mission_fulfillment_workflow_notifications
after update of status on public.mission_fulfillments
for each row execute function private.notify_mission_fulfillment_transition();

create or replace function private.notify_mission_work_item_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deadline timestamptz;
  v_reason_category text;
  v_version_number integer;
begin
  if old.state is not distinct from new.state then
    return new;
  end if;

  if new.state = 'revision_requested' then
    select
      r.creator_response_deadline,
      (
        select ri.category
        from public.mission_review_items ri
        where ri.mission_review_round_id = r.id
          and ri.workspace_id = r.workspace_id
        order by ri.position
        limit 1
      )
    into v_deadline, v_reason_category
    from public.mission_review_rounds r
    where r.mission_work_item_id = new.id
      and r.workspace_id = new.workspace_id
      and r.state = 'revision_requested'
    order by r.decision_at desc nulls last
    limit 1;

    perform private.notify_mission_workflow(
      'mission_revision_requested',
      new.mission_workflow_id,
      new.id,
      v_deadline,
      null,
      v_reason_category
    );
  elsif new.state = 'approved_to_publish' then
    select v.version_number into v_version_number
    from public.mission_draft_versions v
    where v.id = new.approved_version_id
      and v.mission_work_item_id = new.id
      and v.workspace_id = new.workspace_id;

    perform private.notify_mission_workflow(
      'mission_draft_approved',
      new.mission_workflow_id,
      new.id,
      new.deadline,
      v_version_number,
      null
    );
  end if;

  return new;
end;
$$;

drop trigger if exists mission_work_item_workflow_notifications on public.mission_work_items;
create trigger mission_work_item_workflow_notifications
after update of state on public.mission_work_items
for each row execute function private.notify_mission_work_item_transition();

create or replace function private.notify_mission_workflow_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state is distinct from new.state and new.state = 'approved_to_publish' then
    perform private.notify_mission_workflow('mission_approved_to_publish', new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists mission_workflow_state_notifications on public.mission_workflows;
create trigger mission_workflow_state_notifications
after update of state on public.mission_workflows
for each row execute function private.notify_mission_workflow_transition();

create or replace function public.emit_active_mission_deadline_notifications(
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_count integer := 0;
  v_type text;
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then
    raise exception 'not_authorized';
  end if;

  for v_item in
    select i.id, i.mission_workflow_id, i.deadline
    from public.mission_work_items i
    join public.mission_workflows w
      on w.id = i.mission_workflow_id
     and w.workspace_id = i.workspace_id
    where i.required
      and i.deadline is not null
      and i.state in ('drafting', 'revision_requested')
      and w.state not in ('approved_to_publish', 'cancelled', 'expired')
      and i.deadline <= p_now + interval '24 hours'
  loop
    v_type := case
      when v_item.deadline < p_now then 'mission_deadline_overdue'
      else 'mission_deadline_approaching'
    end;
    perform private.notify_mission_workflow(
      v_type,
      v_item.mission_workflow_id,
      v_item.id,
      v_item.deadline
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function private.notify_mission_workflow(text, uuid, uuid, timestamptz, integer, text) from public, anon, authenticated, service_role;
revoke all on function private.notify_mission_fulfillment_transition()
  from public, anon, authenticated, service_role;
revoke all on function private.notify_mission_work_item_transition()
  from public, anon, authenticated, service_role;
revoke all on function private.notify_mission_workflow_transition()
  from public, anon, authenticated, service_role;
revoke all on function public.emit_active_mission_deadline_notifications(timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.emit_active_mission_deadline_notifications(timestamptz)
  to service_role;
