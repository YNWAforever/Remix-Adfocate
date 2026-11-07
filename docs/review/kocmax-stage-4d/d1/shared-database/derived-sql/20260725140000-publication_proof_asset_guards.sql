-- Final lifecycle guards: only publication-stage items may stage evidence and
-- concurrent retries converge on the idempotency-derived storage path.
create or replace function private.create_publication_proof_asset(
  p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_filename text,
  p_mime_type text,p_byte_size bigint,p_storage_object_path text,p_grant_seconds integer default 600
) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$
declare v_asset public.mission_publication_proof_assets; v_workflow public.mission_workflows; v_item public.mission_work_items; v_extension text;
begin
  if p_creator is null or p_workspace is null or p_submission is null or p_work_item is null
     or p_mime_type not in ('image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm')
     or p_byte_size < 1 or p_byte_size > 20971520 or p_grant_seconds < 1 or p_grant_seconds > 600 then raise exception 'validation_failed'; end if;
  select workflow.* into v_workflow from public.mission_workflows workflow join public.mission_submissions submission on submission.id=workflow.mission_submission_id and submission.workspace_id=workflow.workspace_id where workflow.mission_submission_id=p_submission and workflow.workspace_id=p_workspace and submission.creator_id=p_creator;
  if v_workflow.id is null then raise exception 'not_found'; end if;
  select item.* into v_item from public.mission_work_items item where item.id=p_work_item and item.mission_workflow_id=v_workflow.id and item.workspace_id=p_workspace;
  if v_item.id is null then raise exception 'not_found'; end if;
  if v_item.state not in ('approved_to_publish','proof_correction_requested') then raise exception 'wrong_state'; end if;
  v_extension := case p_mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'image/gif' then 'gif' when 'video/mp4' then 'mp4' when 'video/quicktime' then 'mov' else 'webm' end;
  if p_storage_object_path !~ ('^'||p_creator::text||'/'||v_workflow.id::text||'/'||p_work_item::text||'/proof-evidence/[0-9a-f-]+\\.'||v_extension||'$') then raise exception 'validation_failed'; end if;
  insert into public.mission_publication_proof_assets (workspace_id,mission_submission_id,mission_workflow_id,mission_work_item_id,creator_id,storage_object_path,original_filename,mime_type,byte_size,upload_state,upload_grant_expires_at)
  values (p_workspace,p_submission,v_workflow.id,p_work_item,p_creator,p_storage_object_path,btrim(p_filename),p_mime_type,p_byte_size,'pending',now()+make_interval(secs=>p_grant_seconds))
  on conflict (storage_object_path) do nothing returning * into v_asset;
  if v_asset.id is null then
    select * into v_asset from public.mission_publication_proof_assets where storage_object_path=p_storage_object_path and workspace_id=p_workspace;
    if v_asset.id is null or v_asset.creator_id<>p_creator or v_asset.mission_work_item_id<>p_work_item or v_asset.mime_type<>p_mime_type or v_asset.byte_size<>p_byte_size then raise exception 'idempotency_conflict'; end if;
  end if;
  return v_asset;
end; $$;
