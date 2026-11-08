-- Best-effort rollback for an asset row whose signed upload grant could not be created.
-- The private implementation and public wrapper remain service-role only.

create or replace function private.abandon_active_mission_asset(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_asset uuid,
  p_storage_object_path text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.mission_draft_assets;
begin
  select a.* into v_asset
  from public.mission_draft_assets a
  join public.mission_work_items i
    on i.id = a.mission_work_item_id
    and i.mission_workflow_id = a.mission_workflow_id
    and i.workspace_id = a.workspace_id
  join public.mission_workflows w
    on w.id = i.mission_workflow_id
    and w.workspace_id = i.workspace_id
  join public.mission_submissions s
    on s.id = w.mission_submission_id
    and s.workspace_id = w.workspace_id
  where s.id = p_submission
    and s.creator_id = p_creator
    and s.workspace_id = p_workspace
    and a.workspace_id = p_workspace
    and a.mission_work_item_id = p_work_item
    and a.creator_id = p_creator
    and a.id = p_asset
    and a.storage_object_path = p_storage_object_path
    and a.upload_state = 'pending'
    and a.mission_draft_version_id is null
    and a.deleted_at is null
  for update of a;

  if v_asset.id is null then
    return false;
  end if;

  update public.mission_draft_assets
  set upload_state = 'deleted', deleted_at = now()
  where id = v_asset.id
    and workspace_id = p_workspace
    and mission_work_item_id = p_work_item
    and creator_id = p_creator
    and storage_object_path = p_storage_object_path
    and upload_state = 'pending'
    and mission_draft_version_id is null
    and deleted_at is null;

  return found;
end;
$$;

create or replace function public.abandon_active_mission_asset(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_asset uuid,
  p_storage_object_path text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select private.abandon_active_mission_asset(
    p_submission,
    p_creator,
    p_workspace,
    p_work_item,
    p_asset,
    p_storage_object_path
  );
$$;

revoke all on function private.abandon_active_mission_asset(uuid, uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.abandon_active_mission_asset(uuid, uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.abandon_active_mission_asset(uuid, uuid, uuid, uuid, uuid, text)
  to service_role;
