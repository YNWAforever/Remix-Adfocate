-- Publication proof evidence rollout: pending assets are staged before an attempt exists.

alter table public.mission_publication_proof_assets
  alter column mission_publication_proof_attempt_id drop not null,
  alter column content_checksum drop not null,
  add column if not exists mission_submission_id uuid,
  add column if not exists mission_workflow_id uuid,
  add column if not exists mission_work_item_id uuid,
  add column if not exists creator_id uuid,
  add column if not exists upload_state text not null default 'finalized',
  add column if not exists upload_grant_expires_at timestamptz,
  add column if not exists finalized_at timestamptz;

update public.mission_publication_proof_assets a
set mission_work_item_id = attempt.mission_work_item_id,
    mission_workflow_id = workflow.id,
    mission_submission_id = workflow.mission_submission_id,
    creator_id = submission.creator_id,
    upload_state = 'finalized',
    finalized_at = coalesce(a.created_at, now())
from public.mission_publication_proof_attempts attempt
join public.mission_work_items item on item.id = attempt.mission_work_item_id and item.workspace_id = attempt.workspace_id
join public.mission_workflows workflow on workflow.id = item.mission_workflow_id and workflow.workspace_id = item.workspace_id
join public.mission_submissions submission on submission.id = workflow.mission_submission_id and submission.workspace_id = workflow.workspace_id
where a.mission_publication_proof_attempt_id = attempt.id and a.workspace_id = attempt.workspace_id and a.mission_work_item_id is null;

alter table public.mission_publication_proof_assets
  drop constraint if exists mission_publication_proof_assets_attempt_workspace_fk;
alter table public.mission_publication_proof_assets
  add constraint mission_publication_proof_assets_attempt_workspace_fk foreign key (mission_publication_proof_attempt_id, workspace_id) references public.mission_publication_proof_attempts(id, workspace_id) on delete cascade,
  add constraint mission_publication_proof_assets_submission_workspace_fk foreign key (mission_submission_id, workspace_id) references public.mission_submissions(id, workspace_id) on delete cascade,
  add constraint mission_publication_proof_assets_workflow_workspace_fk foreign key (mission_workflow_id, workspace_id) references public.mission_workflows(id, workspace_id) on delete cascade,
  add constraint mission_publication_proof_assets_work_item_workspace_fk foreign key (mission_work_item_id, workspace_id) references public.mission_work_items(id, workspace_id) on delete cascade,
  add constraint mission_publication_proof_assets_creator_workspace_fk foreign key (creator_id, workspace_id) references public.creators(id, workspace_id) on delete cascade,
  add constraint mission_publication_proof_assets_upload_state_check check (upload_state in ('pending','finalized','abandoned')),
  add constraint mission_publication_proof_assets_pending_attempt_check check (upload_state = 'pending' or mission_publication_proof_attempt_id is not null);

create index if not exists mission_publication_proof_assets_owner_idx on public.mission_publication_proof_assets (workspace_id, creator_id, mission_work_item_id, upload_state);

drop policy if exists mission_publication_proof_assets_creator_read on public.mission_publication_proof_assets;
create policy mission_publication_proof_assets_creator_read on public.mission_publication_proof_assets for select to authenticated using (creator_id = (select auth.uid()) and creator_id is not null);
drop policy if exists mission_publication_proof_assets_storage_read on storage.objects;
create policy mission_publication_proof_assets_storage_read on storage.objects for select to authenticated using (bucket_id = 'mission-publication-proof-assets' and exists (select 1 from public.mission_publication_proof_assets pa where pa.storage_object_path = name and pa.creator_id = (select auth.uid()) and pa.upload_state = 'finalized'));
drop policy if exists mission_publication_proof_assets_storage_insert on storage.objects;
create policy mission_publication_proof_assets_storage_insert on storage.objects for insert to authenticated with check (bucket_id = 'mission-publication-proof-assets' and exists (select 1 from public.mission_publication_proof_assets pa where pa.storage_object_path = name and pa.creator_id = (select auth.uid()) and pa.upload_state = 'pending' and pa.upload_grant_expires_at > now()));

drop trigger if exists mission_publication_proof_assets_immutable on public.mission_publication_proof_assets;
create or replace function private.guard_publication_proof_asset_mutation() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'publication_proof_asset_immutable'; end if;
  if old.upload_state <> 'pending' then raise exception 'publication_proof_asset_immutable'; end if;
  if new.id <> old.id or new.workspace_id <> old.workspace_id or new.storage_object_path <> old.storage_object_path or new.original_filename <> old.original_filename or new.mime_type <> old.mime_type or new.byte_size <> old.byte_size or new.creator_id <> old.creator_id or new.mission_work_item_id <> old.mission_work_item_id or new.mission_workflow_id <> old.mission_workflow_id or new.mission_submission_id <> old.mission_submission_id then raise exception 'publication_proof_asset_immutable'; end if;
  if new.upload_state not in ('finalized','abandoned') then raise exception 'publication_proof_asset_wrong_state'; end if;
  return new;
end;
$$;
create trigger mission_publication_proof_assets_immutable before update or delete on public.mission_publication_proof_assets for each row execute function private.guard_publication_proof_asset_mutation();

create or replace function private.create_publication_proof_asset(p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_filename text,p_mime_type text,p_byte_size bigint,p_storage_object_path text,p_grant_seconds integer default 600) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$
declare v_asset public.mission_publication_proof_assets; v_workflow public.mission_workflows; v_item public.mission_work_items; v_extension text;
begin
  if p_creator is null or p_workspace is null or p_submission is null or p_work_item is null or p_mime_type not in ('image/jpeg','image/png','image/webp','application/pdf') or p_byte_size < 1 or p_byte_size > 20971520 or p_grant_seconds < 1 or p_grant_seconds > 600 then raise exception 'validation_failed'; end if;
  select workflow.* into v_workflow from public.mission_workflows workflow join public.mission_submissions submission on submission.id = workflow.mission_submission_id and submission.workspace_id = workflow.workspace_id where workflow.mission_submission_id = p_submission and workflow.workspace_id = p_workspace and submission.creator_id = p_creator;
  if v_workflow.id is null then raise exception 'not_found'; end if;
  select item.* into v_item from public.mission_work_items item where item.id = p_work_item and item.mission_workflow_id = v_workflow.id and item.workspace_id = p_workspace;
  if v_item.id is null then raise exception 'not_found'; end if;
  v_extension := case p_mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' else 'pdf' end;
  if p_storage_object_path !~ ('^' || p_creator::text || '/' || v_workflow.id::text || '/' || p_work_item::text || '/proof-evidence/[0-9a-f-]+\\.' || v_extension || '$') then raise exception 'validation_failed'; end if;
  select * into v_asset from public.mission_publication_proof_assets where storage_object_path = p_storage_object_path and workspace_id = p_workspace and creator_id = p_creator;
  if v_asset.id is not null then return v_asset; end if;
  insert into public.mission_publication_proof_assets (workspace_id,mission_submission_id,mission_workflow_id,mission_work_item_id,creator_id,storage_object_path,original_filename,mime_type,byte_size,upload_state,upload_grant_expires_at) values (p_workspace,p_submission,v_workflow.id,p_work_item,p_creator,p_storage_object_path,btrim(p_filename),p_mime_type,p_byte_size,'pending',now()+make_interval(secs=>p_grant_seconds)) returning * into v_asset;
  return v_asset;
end;
$$;
create or replace function public.create_publication_proof_asset(p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_filename text,p_mime_type text,p_byte_size bigint,p_storage_object_path text,p_grant_seconds integer default 600) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$ begin if coalesce((select auth.jwt()->>'role')='service_role',false) is not true then raise exception 'not_authorized'; end if; return private.create_publication_proof_asset(p_submission,p_creator,p_workspace,p_work_item,p_filename,p_mime_type,p_byte_size,p_storage_object_path,p_grant_seconds); end; $$;
revoke all on function public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer) from public,anon,authenticated;
grant execute on function public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer) to service_role;

create or replace function private.finalize_publication_proof_asset(p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_asset uuid,p_checksum text) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$
declare v_asset public.mission_publication_proof_assets; v_object storage.objects;
begin
  select * into v_asset from public.mission_publication_proof_assets a where a.id=p_asset and a.workspace_id=p_workspace and a.mission_submission_id=p_submission and a.creator_id=p_creator and a.mission_work_item_id=p_work_item for update;
  if v_asset.id is null then raise exception 'not_found'; end if;
  if v_asset.upload_state='finalized' and v_asset.content_checksum=btrim(p_checksum) then return v_asset; end if;
  if v_asset.upload_state<>'pending' then raise exception 'already_finalized'; end if;
  if v_asset.upload_grant_expires_at < now() then raise exception 'upload_grant_expired'; end if;
  select * into v_object from storage.objects where bucket_id='mission-publication-proof-assets' and name=v_asset.storage_object_path;
  if v_object.id is null then raise exception 'asset_not_uploaded'; end if;
  if v_object.metadata ? 'size' and (v_object.metadata->>'size')::bigint <> v_asset.byte_size then raise exception 'invalid_byte_size'; end if;
  update public.mission_publication_proof_assets set upload_state='finalized',content_checksum=btrim(p_checksum),finalized_at=now() where id=v_asset.id returning * into v_asset;
  return v_asset;
end;
$$;
create or replace function public.finalize_publication_proof_asset(p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_asset uuid,p_checksum text) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$ begin if coalesce((select auth.jwt()->>'role')='service_role',false) is not true then raise exception 'not_authorized'; end if; return private.finalize_publication_proof_asset(p_submission,p_creator,p_workspace,p_work_item,p_asset,p_checksum); end; $$;
revoke all on function public.finalize_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finalize_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text) to service_role;

create or replace function private.abandon_publication_proof_asset(p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_asset uuid,p_storage_object_path text) returns void language plpgsql security definer set search_path = '' as $$ begin delete from public.mission_publication_proof_assets where id=p_asset and workspace_id=p_workspace and mission_submission_id=p_submission and creator_id=p_creator and mission_work_item_id=p_work_item and storage_object_path=p_storage_object_path and upload_state='pending'; end; $$;
create or replace function public.abandon_publication_proof_asset(p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_asset uuid,p_storage_object_path text) returns void language plpgsql security definer set search_path = '' as $$ begin if coalesce((select auth.jwt()->>'role')='service_role',false) is not true then raise exception 'not_authorized'; end if; perform private.abandon_publication_proof_asset(p_submission,p_creator,p_workspace,p_work_item,p_asset,p_storage_object_path); end; $$;
revoke all on function public.abandon_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.abandon_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text) to service_role;
