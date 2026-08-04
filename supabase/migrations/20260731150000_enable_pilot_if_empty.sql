-- Atomically enable one pilot mission without racing a creator submission.
-- The service role is the only caller; browser roles must never mutate mode.
create or replace function public.enable_pilot_if_empty(
  p_workspace_id uuid,
  p_mission_id uuid,
  p_expected_workflow_mode text default 'legacy',
  p_next_workflow_mode text default 'active_workspace',
  p_expected_status text default 'draft',
  p_reject_if_submission_exists boolean default true
)
returns setof public.missions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission public.missions;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required';
  end if;

  -- Lock the exact mission row before evaluating the submission guard.
  select * into v_mission
    from public.missions
   where id = p_mission_id
     and workspace_id = p_workspace_id
   for update;

  if not found then
    return;
  end if;

  update public.missions as mission
     set creator_workflow_mode = p_next_workflow_mode
   where mission.id = p_mission_id
     and mission.workspace_id = p_workspace_id
     and mission.creator_workflow_mode = p_expected_workflow_mode
     and mission.status = p_expected_status
     and (
       not p_reject_if_submission_exists
       or not exists (
         select 1
           from public.mission_submissions submission
          where submission.mission_id = mission.id
       )
     )
  returning mission.* into v_mission;

  if found then
    return next v_mission;
  end if;
end;
$$;

revoke all on function public.enable_pilot_if_empty(uuid, uuid, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.enable_pilot_if_empty(uuid, uuid, text, text, text, boolean)
  to service_role;
