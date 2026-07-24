-- Compatibility overrides for the pending publication-proof asset lifecycle.

alter table public.mission_publication_proof_assets
  drop constraint if exists mission_publication_proof_assets_pending_attempt_check;
alter table public.mission_publication_proof_assets
  add constraint mission_publication_proof_assets_pending_attempt_check
  check (upload_state in ('pending','finalized','abandoned'));

create or replace function private.guard_publication_proof_asset_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.upload_state <> 'pending' then raise exception 'publication_proof_asset_immutable'; end if;
    return old;
  end if;
  if old.upload_state <> 'pending' then raise exception 'publication_proof_asset_immutable'; end if;
  if new.id <> old.id or new.workspace_id <> old.workspace_id or new.storage_object_path <> old.storage_object_path
     or new.original_filename <> old.original_filename or new.mime_type <> old.mime_type or new.byte_size <> old.byte_size
     or new.creator_id <> old.creator_id or new.mission_work_item_id <> old.mission_work_item_id
     or new.mission_workflow_id <> old.mission_workflow_id or new.mission_submission_id <> old.mission_submission_id
  then raise exception 'publication_proof_asset_immutable'; end if;
  if new.upload_state not in ('finalized','abandoned') then raise exception 'publication_proof_asset_wrong_state'; end if;
  return new;
end; $$;

drop function if exists public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer);
create or replace function public.create_publication_proof_asset(
  p_submission uuid, p_creator uuid, p_workspace uuid, p_work_item uuid, p_filename text,
  p_mime_type text, p_byte_size bigint, p_storage_object_path text, p_grant_seconds integer default 600,
  p_expected_state text default null, p_expected_revision integer default null, p_idempotency_key text default null
) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt()->>'role')='service_role',false) is not true then raise exception 'not_authorized'; end if;
  return private.create_publication_proof_asset(p_submission,p_creator,p_workspace,p_work_item,p_filename,p_mime_type,p_byte_size,p_storage_object_path,p_grant_seconds);
end; $$;
revoke all on function public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer,text,integer,text) from public,anon,authenticated;
grant execute on function public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer,text,integer,text) to service_role;

drop function if exists public.finalize_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text);
create or replace function public.finalize_publication_proof_asset(
  p_submission uuid, p_creator uuid, p_workspace uuid, p_work_item uuid, p_asset uuid, p_checksum text,
  p_expected_state text default null, p_expected_revision integer default null, p_idempotency_key text default null
) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt()->>'role')='service_role',false) is not true then raise exception 'not_authorized'; end if;
  return private.finalize_publication_proof_asset(p_submission,p_creator,p_workspace,p_work_item,p_asset,p_checksum);
end; $$;
revoke all on function public.finalize_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.finalize_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text,text,integer,text) to service_role;
