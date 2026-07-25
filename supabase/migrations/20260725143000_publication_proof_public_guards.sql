-- Active PUBLIC RPC guards. These wrappers are the callable Supabase surface.
create or replace function public.create_publication_proof_asset(
  p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_filename text,p_mime_type text,p_byte_size bigint,p_storage_object_path text,p_grant_seconds integer default 600,p_expected_state text default null,p_expected_revision integer default null,p_idempotency_key text default null
) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt()->>'role')='service_role',false) is not true then raise exception 'not_authorized'; end if;
  if p_expected_state not in ('approved_to_publish','proof_correction_required') or p_expected_revision is null or p_expected_revision < 0 or p_idempotency_key is null or btrim(p_idempotency_key) = '' then raise exception 'workflow_stale'; end if;
  return private.create_publication_proof_asset(p_submission,p_creator,p_workspace,p_work_item,p_filename,p_mime_type,p_byte_size,p_storage_object_path,p_grant_seconds);
end; $$;

create or replace function public.finalize_publication_proof_asset(
  p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_asset uuid,p_checksum text,p_expected_state text default null,p_expected_revision integer default null,p_idempotency_key text default null
) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt()->>'role')='service_role',false) is not true then raise exception 'not_authorized'; end if;
  if p_expected_state not in ('approved_to_publish','proof_correction_required') or p_expected_revision is null or p_expected_revision < 0 or p_idempotency_key is null or btrim(p_idempotency_key) = '' then raise exception 'workflow_stale'; end if;
  return private.finalize_publication_proof_asset(p_submission,p_creator,p_workspace,p_work_item,p_asset,p_checksum);
end; $$;
