-- Serialize creator workflow snapshots with mission-template authoring.
-- A snapshot transaction takes a key-share lock on its parent mission before
-- validating the source template. The authoring RPC takes FOR UPDATE on that
-- same mission, so either the snapshot commits first and blocks deletion, or
-- authoring commits first and the trigger rejects the now-missing template.

create or replace function private.guard_mission_work_item_source_template()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission_id uuid;
begin
  if new.source_template_id is null then
    return new;
  end if;

  select mission.id
  into v_mission_id
  from public.mission_workflows workflow
  join public.mission_submissions submission
    on submission.id = workflow.mission_submission_id
   and submission.workspace_id = workflow.workspace_id
  join public.missions mission
    on mission.id = submission.mission_id
   and mission.workspace_id = submission.workspace_id
  join public.mission_deliverable_templates template
    on template.id = new.source_template_id
   and template.mission_id = mission.id
   and template.workspace_id = new.workspace_id
  where workflow.id = new.mission_workflow_id
    and workflow.workspace_id = new.workspace_id
    and submission.workspace_id = new.workspace_id
    and mission.workspace_id = new.workspace_id
  for key share of mission;

  if not found then
    raise exception 'mission_work_item_source_template_mismatch'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_mission_work_item_source_template()
  from public, anon, authenticated, service_role;

drop trigger if exists mission_work_items_source_template_guard
  on public.mission_work_items;
create trigger mission_work_items_source_template_guard
before insert or update of source_template_id
on public.mission_work_items
for each row
execute function private.guard_mission_work_item_source_template();
