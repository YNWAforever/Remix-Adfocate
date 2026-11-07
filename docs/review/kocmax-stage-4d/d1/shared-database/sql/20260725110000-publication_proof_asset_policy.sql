-- Final publication-proof asset policy: exact Phase 2 MIME set and workflow namespace.
create or replace function private.create_publication_proof_asset(
  p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_filename text,
  p_mime_type text,p_byte_size bigint,p_storage_object_path text,p_grant_seconds integer default 600
) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$
declare v_asset public.mission_publication_proof_assets; v_workflow public.mission_workflows; v_item public.mission_work_items; v_extension text;
begin
  if p_creator is null or p_workspace is null or p_submission is null or p_work_item is null
     or p_mime_type not in ('image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm')
     or p_byte_size < 1 or p_byte_size > 20971520 or p_grant_seconds < 1 or p_grant_seconds > 600 then raise exception 'validation_failed'; end if;
  select workflow.* into v_workflow from public.mission_workflows workflow
    join public.mission_submissions submission on submission.id=workflow.mission_submission_id and submission.workspace_id=workflow.workspace_id
    where workflow.mission_submission_id=p_submission and workflow.workspace_id=p_workspace and submission.creator_id=p_creator;
  if v_workflow.id is null then raise exception 'not_found'; end if;
  select item.* into v_item from public.mission_work_items item where item.id=p_work_item and item.mission_workflow_id=v_workflow.id and item.workspace_id=p_workspace;
  if v_item.id is null then raise exception 'not_found'; end if;
  v_extension := case p_mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'image/gif' then 'gif' when 'video/mp4' then 'mp4' when 'video/quicktime' then 'mov' else 'webm' end;
  if p_storage_object_path !~ ('^'||p_creator::text||'/'||v_workflow.id::text||'/'||p_work_item::text||'/proof-evidence/[0-9a-f-]+\\.'||v_extension||'$') then raise exception 'validation_failed'; end if;
  select * into v_asset from public.mission_publication_proof_assets where storage_object_path=p_storage_object_path and workspace_id=p_workspace and creator_id=p_creator;
  if v_asset.id is not null then return v_asset; end if;
  insert into public.mission_publication_proof_assets (workspace_id,mission_submission_id,mission_workflow_id,mission_work_item_id,creator_id,storage_object_path,original_filename,mime_type,byte_size,upload_state,upload_grant_expires_at)
  values (p_workspace,p_submission,v_workflow.id,p_work_item,p_creator,p_storage_object_path,btrim(p_filename),p_mime_type,p_byte_size,'pending',now()+make_interval(secs=>p_grant_seconds)) returning * into v_asset;
  return v_asset;
end; $$;

create or replace function public.create_publication_proof_asset(
  p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_filename text,p_mime_type text,p_byte_size bigint,p_storage_object_path text,p_grant_seconds integer default 600,p_expected_state text default null,p_expected_revision integer default null,p_idempotency_key text default null
) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$ begin
  if coalesce((select auth.jwt()->>'role')='service_role',false) is not true then raise exception 'not_authorized'; end if;
  return private.create_publication_proof_asset(p_submission,p_creator,p_workspace,p_work_item,p_filename,p_mime_type,p_byte_size,p_storage_object_path,p_grant_seconds);
end; $$;
