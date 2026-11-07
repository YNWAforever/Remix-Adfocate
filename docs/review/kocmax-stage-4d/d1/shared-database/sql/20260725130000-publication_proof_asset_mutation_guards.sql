-- Enforce publication-proof asset optimistic concurrency and idempotency.
alter table public.mission_publication_proof_assets
  add column if not exists upload_idempotency_key uuid,
  add column if not exists finalize_idempotency_key uuid;
create unique index if not exists mission_publication_proof_assets_upload_idempotency_idx
  on public.mission_publication_proof_assets(workspace_id, creator_id, mission_work_item_id, upload_idempotency_key)
  where upload_idempotency_key is not null;

drop function if exists public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer,text,integer,text);
create function public.create_publication_proof_asset(
  p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_filename text,p_mime_type text,p_byte_size bigint,
  p_storage_object_path text,p_grant_seconds integer default 600,p_expected_state text default null,
  p_expected_revision integer default null,p_idempotency_key text default null
) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.mission_publication_proof_assets;
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_instruction public.mission_publication_instructions;
  v_key uuid;
  v_extension text;
begin
  if coalesce((select auth.jwt()->>'role')='service_role',false) is not true then raise exception 'not_authorized'; end if;
  begin v_key := p_idempotency_key::uuid; exception when others then raise exception 'validation_failed'; end;
  if p_expected_state is null or p_expected_revision is null then raise exception 'validation_failed'; end if;
  select workflow.* into v_workflow from public.mission_workflows workflow
    join public.mission_submissions submission on submission.id=workflow.mission_submission_id and submission.workspace_id=workflow.workspace_id
    where workflow.mission_submission_id=p_submission and workflow.workspace_id=p_workspace and submission.creator_id=p_creator;
  if v_workflow.id is null then raise exception 'not_found'; end if;
  select * into v_item from public.mission_work_items where id=p_work_item and workspace_id=p_workspace and mission_workflow_id=v_workflow.id;
  if v_item.id is null then raise exception 'not_found'; end if;
  select * into v_instruction from public.mission_publication_instructions where workspace_id=p_workspace and mission_work_item_id=p_work_item;
  if v_instruction.id is null then raise exception 'not_found'; end if;
  select * into v_asset from public.mission_publication_proof_assets
    where workspace_id=p_workspace and creator_id=p_creator and mission_work_item_id=p_work_item and upload_idempotency_key=v_key;
  if v_asset.id is not null then
    if v_asset.original_filename<>btrim(p_filename) or v_asset.mime_type<>p_mime_type or v_asset.byte_size<>p_byte_size then raise exception 'validation_failed'; end if;
    return v_asset;
  end if;
  if v_item.state<>p_expected_state or v_instruction.revision<>p_expected_revision then raise exception 'workflow_stale'; end if;
  if p_mime_type not in ('image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm')
     or p_byte_size<1 or p_byte_size>20971520 or p_grant_seconds<1 or p_grant_seconds>600 then raise exception 'validation_failed'; end if;
  v_extension := case p_mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
    when 'image/gif' then 'gif' when 'video/mp4' then 'mp4' when 'video/quicktime' then 'mov' when 'video/webm' then 'webm' end;
  if p_storage_object_path !~ ('^'||p_creator::text||'/'||v_workflow.id::text||'/'||p_work_item::text||'/proof-evidence/'||v_key::text||'\\.'||v_extension||'$') then raise exception 'validation_failed'; end if;
  insert into public.mission_publication_proof_assets
    (workspace_id,mission_submission_id,mission_workflow_id,mission_work_item_id,creator_id,storage_object_path,original_filename,mime_type,byte_size,upload_state,upload_grant_expires_at,upload_idempotency_key)
  values (p_workspace,p_submission,v_workflow.id,p_work_item,p_creator,p_storage_object_path,btrim(p_filename),p_mime_type,p_byte_size,'pending',now()+make_interval(secs=>p_grant_seconds),v_key)
  returning * into v_asset;
  return v_asset;
end; $$;
revoke all on function public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer,text,integer,text) from public,anon,authenticated;
grant execute on function public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer,text,integer,text) to service_role;

drop function if exists public.finalize_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text,text,integer,text);
create function public.finalize_publication_proof_asset(
  p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_asset uuid,p_checksum text,
  p_expected_state text default null,p_expected_revision integer default null,p_idempotency_key text default null
) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.mission_publication_proof_assets;
  v_item public.mission_work_items;
  v_instruction public.mission_publication_instructions;
  v_object storage.objects;
  v_key uuid;
begin
  if coalesce((select auth.jwt()->>'role')='service_role',false) is not true then raise exception 'not_authorized'; end if;
  begin v_key := p_idempotency_key::uuid; exception when others then raise exception 'validation_failed'; end;
  if p_expected_state is null or p_expected_revision is null or nullif(btrim(p_checksum),'') is null then raise exception 'validation_failed'; end if;
  select * into v_item from public.mission_work_items where id=p_work_item and workspace_id=p_workspace;
  select * into v_instruction from public.mission_publication_instructions where workspace_id=p_workspace and mission_work_item_id=p_work_item;
  if v_item.id is null or v_instruction.id is null then raise exception 'not_found'; end if;
  select * into v_asset from public.mission_publication_proof_assets where id=p_asset and workspace_id=p_workspace
    and mission_submission_id=p_submission and creator_id=p_creator and mission_work_item_id=p_work_item for update;
  if v_asset.id is null then raise exception 'not_found'; end if;
  if v_asset.mission_publication_proof_attempt_id is not null then raise exception 'already_assigned'; end if;
  if v_asset.upload_state='finalized' and v_asset.finalize_idempotency_key=v_key and v_asset.content_checksum=btrim(p_checksum) then return v_asset; end if;
  if v_item.state<>p_expected_state or v_instruction.revision<>p_expected_revision then raise exception 'workflow_stale'; end if;
  if v_asset.upload_state<>'pending' then raise exception 'already_finalized'; end if;
  if v_asset.upload_grant_expires_at<now() then raise exception 'upload_grant_expired'; end if;
  select * into v_object from storage.objects where bucket_id='mission-publication-proof-assets' and name=v_asset.storage_object_path;
  if v_object.id is null then raise exception 'asset_not_uploaded'; end if;
  if not (v_object.metadata ? 'size') or not (v_object.metadata ? 'mimetype') then raise exception 'invalid_upload_metadata'; end if;
  if (v_object.metadata->>'size')::bigint<>v_asset.byte_size or v_object.metadata->>'mimetype'<>v_asset.mime_type then raise exception 'invalid_upload_metadata'; end if;
  update public.mission_publication_proof_assets set upload_state='finalized',content_checksum=btrim(p_checksum),finalized_at=now(),finalize_idempotency_key=v_key
    where id=v_asset.id returning * into v_asset;
  return v_asset;
end; $$;
revoke all on function public.finalize_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.finalize_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text,text,integer,text) to service_role;
