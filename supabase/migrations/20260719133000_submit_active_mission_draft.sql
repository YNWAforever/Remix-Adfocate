-- Creator upload/finalize/submit transitions for the active mission workspace.
-- Supabase signed-upload tokens have a provider-managed lifetime in this client version;
-- the authoritative application grant is therefore expired after exactly 600 seconds here.

alter table public.mission_draft_assets
  add column if not exists upload_grant_expires_at timestamptz;

alter table public.mission_draft_versions
  add column if not exists submission_idempotency_key text;

create unique index if not exists mission_submission_idempotency_key
  on public.mission_draft_versions (mission_work_item_id, submission_idempotency_key)
  where submission_idempotency_key is not null;

create or replace function private.create_active_mission_asset(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_filename text,
  p_mime_type text,
  p_byte_size bigint,
  p_extension text,
  p_grant_seconds integer
)
returns public.mission_draft_assets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.mission_work_items;
  v_workflow public.mission_workflows;
  v_asset public.mission_draft_assets;
  v_asset_id uuid := gen_random_uuid();
begin
  if p_grant_seconds <> 600 then raise exception 'invalid_grant_lifetime'; end if;
  if p_mime_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm') then
    raise exception 'invalid_mime_type';
  end if;
  if p_byte_size < 1 or p_byte_size > 20971520 then raise exception 'invalid_byte_size'; end if;

  select i, w into v_item, v_workflow
  from public.mission_work_items i
  join public.mission_workflows w
    on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
  join public.mission_submissions s
    on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
  where s.id = p_submission
    and s.creator_id = p_creator
    and s.workspace_id = p_workspace
    and i.id = p_work_item
    and i.workspace_id = p_workspace
  for update of i;
  if v_item.id is null then raise exception 'not_found'; end if;
  if v_item.state not in ('drafting', 'revision_requested') then raise exception 'wrong_state'; end if;

  if (select count(*) from public.mission_draft_assets a
      where a.mission_work_item_id = v_item.id
        and a.workspace_id = p_workspace
        and a.deleted_at is null
        and a.upload_state <> 'deleted') >= 5 then
    raise exception 'asset_limit';
  end if;

  insert into public.mission_draft_assets (
    id, workspace_id, mission_work_item_id, mission_workflow_id, creator_id,
    storage_object_path, original_filename, mime_type, byte_size, file_extension,
    upload_state, upload_grant_expires_at
  ) values (
    v_asset_id, p_workspace, v_item.id, v_item.mission_workflow_id, p_creator,
    p_creator::text || '/' || v_item.mission_workflow_id::text || '/' || v_item.id::text || '/' || v_asset_id::text || '.' || p_extension,
    p_filename, p_mime_type, p_byte_size, p_extension,
    'pending', now() + interval '600 seconds'
  ) returning * into v_asset;
  return v_asset;
end;
$$;

create or replace function public.create_active_mission_asset(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_filename text,
  p_mime_type text,
  p_byte_size bigint,
  p_extension text,
  p_grant_seconds integer
)
returns public.mission_draft_assets
language sql
security definer
set search_path = ''
as $$
  select private.create_active_mission_asset(
    p_submission, p_creator, p_workspace, p_work_item, p_filename,
    p_mime_type, p_byte_size, p_extension, p_grant_seconds
  );
$$;

create or replace function private.finalize_active_mission_asset(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_asset uuid,
  p_checksum text
)
returns public.mission_draft_assets
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
    on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
  join public.mission_submissions s
    on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
  where a.id = p_asset
    and a.mission_work_item_id = p_work_item
    and a.creator_id = p_creator
    and a.workspace_id = p_workspace
    and s.id = p_submission
    and s.creator_id = p_creator
    and a.storage_object_path = p_creator::text || '/' || a.mission_workflow_id::text || '/' || p_work_item::text || '/' || a.id::text || '.' || a.file_extension
  for update of a;
  if v_asset.id is null then raise exception 'not_found'; end if;
  if v_asset.upload_state <> 'pending' or v_asset.deleted_at is not null then raise exception 'wrong_state'; end if;
  if v_asset.upload_grant_expires_at is null or v_asset.upload_grant_expires_at < now() then raise exception 'upload_grant_expired'; end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'mission-draft-assets'
      and o.name = v_asset.storage_object_path
      and o.metadata ->> 'mimetype' = v_asset.mime_type
      and (o.metadata ->> 'size')::bigint = v_asset.byte_size
  ) then raise exception 'upload_metadata_mismatch'; end if;

  update public.mission_draft_assets
  set upload_state = 'ready', checksum = btrim(p_checksum)
  where id = v_asset.id and workspace_id = v_asset.workspace_id
  returning * into v_asset;
  return v_asset;
end;
$$;

create or replace function public.finalize_active_mission_asset(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_asset uuid,
  p_checksum text
)
returns public.mission_draft_assets
language sql
security definer
set search_path = ''
as $$
  select private.finalize_active_mission_asset(
    p_submission, p_creator, p_workspace, p_work_item, p_asset, p_checksum
  );
$$;

create or replace function private.submit_active_mission_draft(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_expected_revision integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.mission_work_items;
  v_workflow public.mission_workflows;
  v_draft public.mission_working_drafts;
  v_version public.mission_draft_versions;
  v_round integer;
  v_version_number integer;
begin
  if btrim(coalesce(p_idempotency_key, '')) = '' then raise exception 'idempotency_key_required'; end if;

  select i, w into v_item, v_workflow
  from public.mission_work_items i
  join public.mission_workflows w
    on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
  join public.mission_submissions s
    on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
  where s.id = p_submission
    and s.creator_id = p_creator
    and s.workspace_id = p_workspace
    and i.id = p_work_item
    and i.workspace_id = p_workspace
  for update of i, w;
  if v_item.id is null then raise exception 'not_found'; end if;

  select v.* into v_version
  from public.mission_draft_versions v
  where v.mission_work_item_id = v_item.id
    and v.workspace_id = p_workspace
    and v.submission_idempotency_key = p_idempotency_key;
  if v_version.id is not null then
    return jsonb_build_object('version', to_jsonb(v_version), 'work_item', to_jsonb(v_item));
  end if;

  if v_item.state not in ('drafting', 'revision_requested') then raise exception 'wrong_state'; end if;
  select d.* into v_draft
  from public.mission_working_drafts d
  where d.mission_work_item_id = v_item.id
    and d.workspace_id = p_workspace
    and d.archived_at is null
  for update;
  if v_draft.id is null then raise exception 'not_found'; end if;
  if v_draft.revision <> p_expected_revision then raise exception 'stale_revision'; end if;

  if exists (
    select 1 from public.mission_draft_assets a
    where a.mission_work_item_id = v_item.id
      and a.workspace_id = p_workspace
      and a.deleted_at is null
      and a.upload_state <> 'deleted'
      and a.upload_state <> 'ready'
  ) then raise exception 'assets_not_ready'; end if;

  select coalesce(max(v.version_number), 0) + 1 into v_version_number
  from public.mission_draft_versions v
  where v.mission_work_item_id = v_item.id and v.workspace_id = p_workspace;

  insert into public.mission_draft_versions (
    workspace_id, mission_work_item_id, version_number, caption_snapshot,
    external_draft_url_snapshot, checklist_snapshot, submitted_by,
    content_checksum, submission_idempotency_key
  ) values (
    p_workspace, v_item.id, v_version_number, v_draft.caption_text,
    v_draft.external_draft_url, v_draft.checklist_answers, p_creator,
    md5(v_draft.id::text || ':' || v_draft.revision::text || ':' || p_idempotency_key),
    p_idempotency_key
  ) returning * into v_version;

  update public.mission_draft_assets
  set mission_draft_version_id = v_version.id, retained_at = now()
  where mission_work_item_id = v_item.id
    and workspace_id = p_workspace
    and upload_state = 'ready'
    and deleted_at is null
    and mission_draft_version_id is null;

  select coalesce(max(r.round_number), 0) + 1 into v_round
  from public.mission_review_rounds r
  where r.mission_work_item_id = v_item.id and r.workspace_id = p_workspace;

  insert into public.mission_review_rounds (
    workspace_id, mission_work_item_id, mission_draft_version_id,
    round_number, state, review_started_at
  ) values (
    p_workspace, v_item.id, v_version.id, v_round, 'open', now()
  );

  update public.mission_work_items
  set state = 'under_review',
      current_submitted_version_id = v_version.id,
      review_started_at = now(),
      review_due_at = least(now() + make_interval(hours => v_workflow.review_sla_hours), v_item.deadline),
      updated_at = now()
  where id = v_item.id and workspace_id = p_workspace
  returning * into v_item;

  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id,
    actor_type, actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, v_item.mission_workflow_id, v_item.id,
    'creator', p_creator, 'draft_submitted', 'mission_draft_version', v_version.id,
    jsonb_build_object('version_number', v_version.version_number, 'review_round', v_round)
  );

  perform private.refresh_mission_workflow_state(v_item.mission_workflow_id);
  return jsonb_build_object('version', to_jsonb(v_version), 'work_item', to_jsonb(v_item));
end;
$$;

create or replace function public.submit_active_mission_draft(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_expected_revision integer,
  p_idempotency_key text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.submit_active_mission_draft(
    p_submission, p_creator, p_workspace, p_work_item,
    p_expected_revision, p_idempotency_key
  );
$$;

revoke all on function private.create_active_mission_asset(uuid, uuid, uuid, uuid, text, text, bigint, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.create_active_mission_asset(uuid, uuid, uuid, uuid, text, text, bigint, text, integer) from public, anon, authenticated, service_role;
revoke all on function private.finalize_active_mission_asset(uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.finalize_active_mission_asset(uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.submit_active_mission_draft(uuid, uuid, uuid, uuid, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.submit_active_mission_draft(uuid, uuid, uuid, uuid, integer, text) from public, anon, authenticated, service_role;

grant execute on function public.create_active_mission_asset(uuid, uuid, uuid, uuid, text, text, bigint, text, integer) to service_role;
grant execute on function public.finalize_active_mission_asset(uuid, uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.submit_active_mission_draft(uuid, uuid, uuid, uuid, integer, text) to service_role;
