-- Atomically acknowledge creator receipt, unblock drafting, append the audit event,
-- and refresh the workflow state. The server calls only the public service-role wrapper.

create or replace function private.receive_mission_fulfillment(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid
)
returns public.mission_workflows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workflow public.mission_workflows;
  v_fulfillment public.mission_fulfillments;
begin
  select w.* into v_workflow
  from public.mission_workflows w
  join public.mission_submissions s
    on s.id = w.mission_submission_id
   and s.workspace_id = w.workspace_id
  where s.id = p_submission
    and s.creator_id = p_creator
    and s.workspace_id = p_workspace
    and w.workspace_id = p_workspace
  for update of w;

  if v_workflow.id is null then
    raise exception 'not_found';
  end if;

  select f.* into v_fulfillment
  from public.mission_fulfillments f
  where f.mission_workflow_id = v_workflow.id
    and f.workspace_id = p_workspace
  for update;

  if v_fulfillment.id is null or v_fulfillment.status <> 'shipped' then
    raise exception 'wrong_state';
  end if;

  update public.mission_fulfillments
  set status = 'received',
      received_by = p_creator,
      received_at = now(),
      updated_at = now()
  where id = v_fulfillment.id
    and mission_workflow_id = v_workflow.id
    and workspace_id = p_workspace;

  update public.mission_work_items
  set state = 'drafting',
      updated_at = now()
  where mission_workflow_id = v_workflow.id
    and workspace_id = p_workspace
    and state = 'blocked_by_fulfillment';

  insert into public.mission_workflow_events (
    workspace_id,
    mission_workflow_id,
    actor_type,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_workspace,
    v_workflow.id,
    'creator',
    p_creator,
    'fulfillment_received',
    'mission_fulfillment',
    v_fulfillment.id,
    '{}'::jsonb
  );

  return private.refresh_mission_workflow_state(v_workflow.id);
end;
$$;

create or replace function public.receive_mission_fulfillment(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid
)
returns public.mission_workflows
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then
    raise exception 'not_found';
  end if;

  if not exists (
    select 1
    from public.mission_submissions s
    where s.id = p_submission
      and s.creator_id = p_creator
      and s.workspace_id = p_workspace
  ) then
    raise exception 'not_found';
  end if;

  return private.receive_mission_fulfillment(p_submission, p_creator, p_workspace);
end;
$$;

revoke all on function private.receive_mission_fulfillment(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.receive_mission_fulfillment(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.receive_mission_fulfillment(uuid, uuid, uuid) to service_role;
