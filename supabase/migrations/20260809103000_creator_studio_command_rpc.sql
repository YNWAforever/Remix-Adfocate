-- Creator Studio command mutations are deliberately RPC-only.  The functions
-- below keep workflow, draft, asset, event, and command-ledger writes atomic.

alter table public.mission_workflow_commands
  add column action text not null default 'unknown';
alter table public.mission_workflow_events
  add column command_id text;

create or replace function public.creator_studio_save_draft(
  p_submission_id uuid,
  p_workspace_id uuid,
  p_work_item_id uuid,
  p_command_id text,
  p_request_hash text,
  p_expected_version integer,
  p_patch jsonb
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_draft public.mission_working_drafts;
  v_existing_hash text;
  v_existing_response jsonb;
  v_response jsonb;
  v_assets jsonb;
  v_requirement_list jsonb;
  v_checklist_key text;
  v_requires_caption boolean;
  v_requires_external_url boolean;
  v_ready boolean;
  v_url text;
  v_url_port text;
begin
  if auth.uid() is null or coalesce(length(btrim(p_command_id)), 0) = 0 or length(p_command_id) > 128
    or coalesce(length(btrim(p_request_hash)), 0) = 0 or p_expected_version is null or p_expected_version < 0 then
    raise exception 'command_required' using errcode = '22023';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
    or (p_patch ? 'caption' and jsonb_typeof(p_patch->'caption') not in ('string', 'null'))
    or (p_patch ? 'external_url' and jsonb_typeof(p_patch->'external_url') not in ('string', 'null'))
    or (p_patch ? 'checklist' and (
      jsonb_typeof(p_patch->'checklist') <> 'object'
      or exists (select 1 from jsonb_each(p_patch->'checklist') as entry where jsonb_typeof(entry.value) <> 'boolean')
    )) then
    raise exception 'draft_invalid' using errcode = '22023';
  end if;
  if p_patch ? 'external_url' and p_patch->>'external_url' is not null then
    v_url := p_patch->>'external_url';
    if btrim(v_url) = ''
      or v_url !~* '^https?://(?:[[:alnum:]](?:[[:alnum:]-]{0,61}[[:alnum:]])?(?:\.[[:alnum:]](?:[[:alnum:]-]{0,61}[[:alnum:]])?)*|\[[0-9a-f:.]+\])(?::([0-9]{1,5}))?(?:[/?#][^[:space:]]*)?$' then
      raise exception 'draft_invalid' using errcode = '22023';
    end if;
    v_url_port := (regexp_match(v_url, '^https?://(?:[[:alnum:]](?:[[:alnum:]-]{0,61}[[:alnum:]])?(?:\.[[:alnum:]](?:[[:alnum:]-]{0,61}[[:alnum:]])?)*|\[[0-9a-f:.]+\])(?::([0-9]{1,5}))?(?:[/?#][^[:space:]]*)?$', 'i'))[1];
    if v_url_port is not null and v_url_port::integer not between 1 and 65535 then
      raise exception 'draft_invalid' using errcode = '22023';
    end if;
  end if;

  select workflow.* into v_workflow
  from public.mission_workflows workflow
  where workflow.mission_submission_id = p_submission_id
    and workflow.creator_id = auth.uid()
    and workflow.workspace_id = p_workspace_id
  for update;
  if v_workflow.id is null then raise exception 'submission_not_found'; end if;

  select command.request_hash, command.response into v_existing_hash, v_existing_response
  from public.mission_workflow_commands command
  where command.mission_submission_id = p_submission_id
    and command.actor_id = auth.uid()
    and command.workspace_id = p_workspace_id
    and command.command_id = p_command_id
  for update;
  if found then
    if v_existing_hash <> p_request_hash then raise exception 'command_conflict' using errcode = '23505'; end if;
    return v_existing_response || jsonb_build_object('replayed', true);
  end if;

  select * into v_item
  from public.mission_work_items
  where id = p_work_item_id
    and mission_workflow_id = v_workflow.id
    and mission_submission_id = p_submission_id
    and creator_id = auth.uid()
    and workspace_id = p_workspace_id
  for update;
  if v_item.id is null then raise exception 'work_item_not_found'; end if;
  if v_item.state not in ('not_started', 'drafting', 'ready_to_submit', 'changes_requested') then
    raise exception 'invalid_transition' using errcode = '55000';
  end if;

  select * into v_draft
  from public.mission_working_drafts
  where mission_work_item_id = v_item.id and workspace_id = p_workspace_id
  for update;
  if found then
    if v_draft.version <> p_expected_version then raise exception 'version_conflict' using errcode = '40001'; end if;
    update public.mission_working_drafts
    set caption = case when p_patch ? 'caption' then coalesce(p_patch->>'caption', '') else caption end,
        external_url = case when p_patch ? 'external_url' then p_patch->>'external_url' else external_url end,
        checklist = case when p_patch ? 'checklist' then p_patch->'checklist' else checklist end,
        version = version + 1,
        updated_at = now()
    where id = v_draft.id
    returning * into v_draft;
  else
    if p_expected_version <> 0 then raise exception 'version_conflict' using errcode = '40001'; end if;
    insert into public.mission_working_drafts
      (mission_work_item_id, mission_workflow_id, mission_submission_id, creator_id, workspace_id, caption, external_url, checklist, version)
    values
      (v_item.id, v_item.mission_workflow_id, v_item.mission_submission_id, v_item.creator_id, v_item.workspace_id,
       coalesce(p_patch->>'caption', ''), p_patch->>'external_url', coalesce(p_patch->'checklist', '{}'::jsonb), 1)
    returning * into v_draft;
  end if;

  v_requirement_list := case when jsonb_typeof(v_item.requirements->'requirements') = 'array'
    then v_item.requirements->'requirements' else '[]'::jsonb end;
  v_requires_caption := coalesce((v_item.requirements->>'caption')::boolean, false)
    or exists (select 1 from jsonb_array_elements_text(v_requirement_list) requirement
      where lower(regexp_replace(requirement, '[[:space:]_-]+', '', 'g')) = 'caption');
  v_requires_external_url := coalesce((v_item.requirements->>'external_url')::boolean, false)
    or coalesce((v_item.requirements->>'externalUrl')::boolean, false)
    or exists (select 1 from jsonb_array_elements_text(v_requirement_list) requirement
      where lower(regexp_replace(requirement, '[[:space:]_-]+', '', 'g')) = 'externalurl');
  v_url := v_draft.external_url;
  v_url_port := (regexp_match(v_url, '^https?://(?:[[:alnum:]](?:[[:alnum:]-]{0,61}[[:alnum:]])?(?:\.[[:alnum:]](?:[[:alnum:]-]{0,61}[[:alnum:]])?)*|\[[0-9a-f:.]+\])(?::([0-9]{1,5}))?(?:[/?#][^[:space:]]*)?$', 'i'))[1];
  v_ready := (not v_requires_caption or coalesce(btrim(v_draft.caption), '') <> '')
    and (not v_requires_external_url or (
      v_url is not null and btrim(v_url) <> ''
      and v_url ~* '^https?://(?:[[:alnum:]](?:[[:alnum:]-]{0,61}[[:alnum:]])?(?:\.[[:alnum:]](?:[[:alnum:]-]{0,61}[[:alnum:]])?)*|\[[0-9a-f:.]+\])(?::([0-9]{1,5}))?(?:[/?#][^[:space:]]*)?$'
      and (v_url_port is null or v_url_port::integer between 1 and 65535)
    ));
  for v_checklist_key in
    select distinct requirement from (
      select requirement from jsonb_array_elements_text(v_requirement_list) requirement
      where lower(regexp_replace(requirement, '[[:space:]_-]+', '', 'g')) not in ('caption', 'externalurl')
      union all
      select requirement from jsonb_array_elements_text(case when jsonb_typeof(v_item.requirements->'checklist') = 'array'
        then v_item.requirements->'checklist' else '[]'::jsonb end) requirement
    ) checklist_requirements
  loop
    if coalesce((v_draft.checklist->>v_checklist_key)::boolean, false) is not true then v_ready := false; end if;
  end loop;
  if v_item.requires_asset and not exists (
    select 1 from public.mission_draft_assets asset
    where asset.mission_work_item_id = v_item.id and asset.upload_state = 'finalized'
  ) then v_ready := false; end if;
  if v_item.state <> 'changes_requested' then
    update public.mission_work_items
    set state = case when v_ready then 'ready_to_submit' else 'drafting' end,
        revision = revision + 1,
        updated_at = now()
    where id = v_item.id
    returning * into v_item;
  end if;

  insert into public.mission_draft_versions
    (mission_work_item_id, mission_workflow_id, mission_submission_id, creator_id, workspace_id, version, caption, external_url, checklist)
  values
    (v_item.id, v_item.mission_workflow_id, v_item.mission_submission_id, v_item.creator_id, v_item.workspace_id,
     v_draft.version, v_draft.caption, v_draft.external_url, v_draft.checklist);
  select public.refresh_creator_studio_state(v_workflow.id) into v_workflow;
  select coalesce(jsonb_agg(to_jsonb(asset) order by asset.created_at, asset.id), '[]'::jsonb) into v_assets
  from public.mission_draft_assets asset where asset.mission_work_item_id = v_item.id;
  v_response := jsonb_build_object(
    'replayed', false, 'draft', to_jsonb(v_draft),
    'work_item', to_jsonb(v_item) || jsonb_build_object('draft', to_jsonb(v_draft), 'assets', v_assets),
    'workflow', to_jsonb(v_workflow)
  );
  insert into public.mission_workflow_events
    (mission_workflow_id, mission_work_item_id, mission_submission_id, creator_id, workspace_id, event_type, command_id, metadata)
  values
    (v_item.mission_workflow_id, v_item.id, v_item.mission_submission_id, v_item.creator_id, v_item.workspace_id,
     'draft_saved', p_command_id, jsonb_build_object('version', v_draft.version));
  insert into public.mission_workflow_commands
    (mission_submission_id, actor_id, creator_id, workspace_id, command_id, action, request_hash, response)
  values
    (p_submission_id, auth.uid(), v_item.creator_id, p_workspace_id, p_command_id, 'save_draft', p_request_hash, v_response);
  return v_response;
end;
$$;

create or replace function public.creator_studio_create_upload_grant(
  p_submission_id uuid,
  p_workspace_id uuid,
  p_work_item_id uuid,
  p_command_id text,
  p_request_hash text,
  p_file_name text,
  p_mime_type text,
  p_byte_size bigint
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_asset public.mission_draft_assets;
  v_existing_hash text;
  v_existing_response jsonb;
  v_response jsonb;
  v_asset_id uuid;
  v_extension text;
begin
  if auth.uid() is null or coalesce(length(btrim(p_command_id)), 0) = 0 or length(p_command_id) > 128
    or coalesce(length(btrim(p_request_hash)), 0) = 0 then raise exception 'command_required' using errcode = '22023'; end if;
  select workflow.* into v_workflow from public.mission_workflows workflow
  where workflow.mission_submission_id = p_submission_id and workflow.creator_id = auth.uid() and workflow.workspace_id = p_workspace_id
  for update;
  if v_workflow.id is null then raise exception 'submission_not_found'; end if;
  select command.request_hash, command.response into v_existing_hash, v_existing_response
  from public.mission_workflow_commands command
  where command.mission_submission_id = p_submission_id and command.actor_id = auth.uid()
    and command.workspace_id = p_workspace_id and command.command_id = p_command_id
  for update;
  if found then
    if v_existing_hash <> p_request_hash then raise exception 'command_conflict' using errcode = '23505'; end if;
    return v_existing_response || jsonb_build_object('replayed', true);
  end if;

  if coalesce(length(btrim(p_file_name)), 0) = 0 or length(p_file_name) > 255 then raise exception 'file_not_allowed' using errcode = '22023'; end if;
  v_extension := case p_mime_type
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
    when 'video/mp4' then 'mp4' when 'application/pdf' then 'pdf' else null end;
  if v_extension is null then raise exception 'file_not_allowed' using errcode = '22023'; end if;
  if p_byte_size is null or p_byte_size < 1 or p_byte_size > 52428800 then raise exception 'file_too_large' using errcode = '22023'; end if;

  select * into v_item from public.mission_work_items
  where id = p_work_item_id and mission_workflow_id = v_workflow.id and mission_submission_id = p_submission_id
    and creator_id = auth.uid() and workspace_id = p_workspace_id
  for update;
  if v_item.id is null then raise exception 'work_item_not_found'; end if;
  if v_item.state not in ('not_started', 'drafting', 'ready_to_submit', 'changes_requested') then
    raise exception 'invalid_transition' using errcode = '55000';
  end if;

  v_asset_id := gen_random_uuid();
  insert into public.mission_draft_assets
    (id, mission_work_item_id, mission_workflow_id, mission_submission_id, creator_id, workspace_id,
     storage_object_path, original_filename, mime_type, byte_size, upload_state, upload_grant_expires_at)
  values
    (v_asset_id, v_item.id, v_item.mission_workflow_id, v_item.mission_submission_id, v_item.creator_id, v_item.workspace_id,
     auth.uid()::text || '/' || v_item.mission_workflow_id::text || '/' || v_item.id::text || '/' || v_asset_id::text || '.' || v_extension,
     btrim(p_file_name), p_mime_type, p_byte_size, 'pending', now() + interval '15 minutes')
  returning * into v_asset;
  select public.refresh_creator_studio_state(v_workflow.id) into v_workflow;
  v_response := jsonb_build_object('replayed', false, 'grant', jsonb_build_object(
    'bucket', 'creator-studio-assets', 'path', v_asset.storage_object_path, 'asset_id', v_asset.id,
    'expires_at', v_asset.upload_grant_expires_at
  ));
  insert into public.mission_workflow_events
    (mission_workflow_id, mission_work_item_id, mission_submission_id, creator_id, workspace_id, event_type, command_id, metadata)
  values
    (v_item.mission_workflow_id, v_item.id, v_item.mission_submission_id, v_item.creator_id, v_item.workspace_id,
     'asset_reserved', p_command_id, jsonb_build_object('asset_id', v_asset.id));
  insert into public.mission_workflow_commands
    (mission_submission_id, actor_id, creator_id, workspace_id, command_id, action, request_hash, response)
  values
    (p_submission_id, auth.uid(), v_item.creator_id, p_workspace_id, p_command_id, 'create_upload_grant', p_request_hash, v_response);
  return v_response;
end;
$$;

create or replace function public.creator_studio_finalize_asset(
  p_submission_id uuid,
  p_workspace_id uuid,
  p_work_item_id uuid,
  p_asset_id uuid,
  p_command_id text,
  p_request_hash text,
  p_byte_size bigint,
  p_mime_type text,
  p_checksum_sha256 text
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_asset public.mission_draft_assets;
  v_existing_hash text;
  v_existing_response jsonb;
  v_response jsonb;
  v_assets jsonb;
  v_draft public.mission_working_drafts;
  v_requirement_list jsonb;
  v_checklist_key text;
  v_requires_caption boolean;
  v_requires_external_url boolean;
  v_ready boolean;
  v_url text;
  v_url_port text;
begin
  if auth.uid() is null or coalesce(length(btrim(p_command_id)), 0) = 0 or length(p_command_id) > 128
    or coalesce(length(btrim(p_request_hash)), 0) = 0 then raise exception 'command_required' using errcode = '22023'; end if;
  if p_checksum_sha256 is not null and p_checksum_sha256 !~* '^[a-f0-9]{64}$' then raise exception 'asset_not_uploaded' using errcode = '22023'; end if;

  select workflow.* into v_workflow from public.mission_workflows workflow
  where workflow.mission_submission_id = p_submission_id and workflow.creator_id = auth.uid() and workflow.workspace_id = p_workspace_id
  for update;
  if v_workflow.id is null then raise exception 'submission_not_found'; end if;
  select command.request_hash, command.response into v_existing_hash, v_existing_response
  from public.mission_workflow_commands command
  where command.mission_submission_id = p_submission_id and command.actor_id = auth.uid()
    and command.workspace_id = p_workspace_id and command.command_id = p_command_id
  for update;
  if found then
    if v_existing_hash <> p_request_hash then raise exception 'command_conflict' using errcode = '23505'; end if;
    return v_existing_response || jsonb_build_object('replayed', true);
  end if;

  select * into v_item from public.mission_work_items
  where id = p_work_item_id and mission_workflow_id = v_workflow.id and mission_submission_id = p_submission_id
    and creator_id = auth.uid() and workspace_id = p_workspace_id
  for update;
  if v_item.id is null then raise exception 'work_item_not_found'; end if;
  if v_item.state not in ('not_started', 'drafting', 'ready_to_submit', 'changes_requested') then
    raise exception 'invalid_transition' using errcode = '55000';
  end if;
  select * into v_asset from public.mission_draft_assets
  where id = p_asset_id and mission_work_item_id = v_item.id and mission_workflow_id = v_workflow.id
    and mission_submission_id = p_submission_id and creator_id = auth.uid() and workspace_id = p_workspace_id
  for update;
  if v_asset.id is null then raise exception 'asset_not_found'; end if;
  if v_asset.upload_state = 'finalized' then raise exception 'asset_finalized' using errcode = '55000'; end if;
  if v_asset.upload_state <> 'pending' or v_asset.upload_grant_expires_at is null or v_asset.upload_grant_expires_at <= now()
    or v_asset.byte_size <> p_byte_size or v_asset.mime_type <> p_mime_type then
    raise exception 'asset_not_uploaded' using errcode = '55000';
  end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'creator-studio-assets'
      and object.name = v_asset.storage_object_path
  ) then
    raise exception 'asset_not_uploaded' using errcode = '55000';
  end if;
  update public.mission_draft_assets
  set upload_state = 'finalized', checksum_sha256 = p_checksum_sha256, finalized_at = now()
  where id = v_asset.id
  returning * into v_asset;

  select * into v_draft from public.mission_working_drafts where mission_work_item_id = v_item.id and workspace_id = p_workspace_id for update;
  v_requirement_list := case when jsonb_typeof(v_item.requirements->'requirements') = 'array'
    then v_item.requirements->'requirements' else '[]'::jsonb end;
  v_requires_caption := coalesce((v_item.requirements->>'caption')::boolean, false)
    or exists (select 1 from jsonb_array_elements_text(v_requirement_list) requirement where lower(regexp_replace(requirement, '[[:space:]_-]+', '', 'g')) = 'caption');
  v_requires_external_url := coalesce((v_item.requirements->>'external_url')::boolean, false)
    or coalesce((v_item.requirements->>'externalUrl')::boolean, false)
    or exists (select 1 from jsonb_array_elements_text(v_requirement_list) requirement where lower(regexp_replace(requirement, '[[:space:]_-]+', '', 'g')) = 'externalurl');
  v_url := v_draft.external_url;
  v_url_port := (regexp_match(v_url, '^https?://(?:[[:alnum:]](?:[[:alnum:]-]{0,61}[[:alnum:]])?(?:\.[[:alnum:]](?:[[:alnum:]-]{0,61}[[:alnum:]])?)*|\[[0-9a-f:.]+\])(?::([0-9]{1,5}))?(?:[/?#][^[:space:]]*)?$', 'i'))[1];
  v_ready := (not v_requires_caption or coalesce(btrim(v_draft.caption), '') <> '')
    and (not v_requires_external_url or (
      v_url is not null and btrim(v_url) <> ''
      and v_url ~* '^https?://(?:[[:alnum:]](?:[[:alnum:]-]{0,61}[[:alnum:]])?(?:\.[[:alnum:]](?:[[:alnum:]-]{0,61}[[:alnum:]])?)*|\[[0-9a-f:.]+\])(?::([0-9]{1,5}))?(?:[/?#][^[:space:]]*)?$'
      and (v_url_port is null or v_url_port::integer between 1 and 65535)
    ));
  for v_checklist_key in
    select distinct requirement from (
      select requirement from jsonb_array_elements_text(v_requirement_list) requirement
      where lower(regexp_replace(requirement, '[[:space:]_-]+', '', 'g')) not in ('caption', 'externalurl')
      union all select requirement from jsonb_array_elements_text(case when jsonb_typeof(v_item.requirements->'checklist') = 'array'
        then v_item.requirements->'checklist' else '[]'::jsonb end) requirement
    ) checklist_requirements
  loop
    if coalesce((v_draft.checklist->>v_checklist_key)::boolean, false) is not true then v_ready := false; end if;
  end loop;
  if v_item.requires_asset and not exists (select 1 from public.mission_draft_assets asset
    where asset.mission_work_item_id = v_item.id and asset.upload_state = 'finalized') then v_ready := false; end if;
  if v_item.state <> 'changes_requested' then
    update public.mission_work_items set state = case when v_ready then 'ready_to_submit' else 'drafting' end,
      revision = revision + 1, updated_at = now() where id = v_item.id returning * into v_item;
  end if;
  select public.refresh_creator_studio_state(v_workflow.id) into v_workflow;
  select coalesce(jsonb_agg(to_jsonb(asset) order by asset.created_at, asset.id), '[]'::jsonb) into v_assets
  from public.mission_draft_assets asset where asset.mission_work_item_id = v_item.id;
  v_response := jsonb_build_object('replayed', false, 'asset', to_jsonb(v_asset),
    'work_item', to_jsonb(v_item) || jsonb_build_object('draft', to_jsonb(v_draft), 'assets', v_assets),
    'workflow', to_jsonb(v_workflow));
  insert into public.mission_workflow_events
    (mission_workflow_id, mission_work_item_id, mission_submission_id, creator_id, workspace_id, event_type, command_id, metadata)
  values
    (v_item.mission_workflow_id, v_item.id, v_item.mission_submission_id, v_item.creator_id, v_item.workspace_id,
     'asset_finalized', p_command_id, jsonb_build_object('asset_id', v_asset.id));
  insert into public.mission_workflow_commands
    (mission_submission_id, actor_id, creator_id, workspace_id, command_id, action, request_hash, response)
  values
    (p_submission_id, auth.uid(), v_item.creator_id, p_workspace_id, p_command_id, 'finalize_asset', p_request_hash, v_response);
  return v_response;
end;
$$;

create or replace function public.creator_studio_submit_work_item(
  p_submission_id uuid,
  p_workspace_id uuid,
  p_work_item_id uuid,
  p_command_id text,
  p_request_hash text,
  p_expected_version integer
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_draft public.mission_working_drafts;
  v_existing_hash text;
  v_existing_response jsonb;
  v_response jsonb;
  v_assets jsonb;
  v_requirement_list jsonb;
  v_checklist_key text;
  v_requires_caption boolean;
  v_requires_external_url boolean;
  v_url text;
  v_url_port text;
begin
  if auth.uid() is null or coalesce(length(btrim(p_command_id)), 0) = 0 or length(p_command_id) > 128
    or coalesce(length(btrim(p_request_hash)), 0) = 0 or p_expected_version is null or p_expected_version < 0 then raise exception 'command_required' using errcode = '22023'; end if;
  select workflow.* into v_workflow from public.mission_workflows workflow
  where workflow.mission_submission_id = p_submission_id and workflow.creator_id = auth.uid() and workflow.workspace_id = p_workspace_id
  for update;
  if v_workflow.id is null then raise exception 'submission_not_found'; end if;
  select command.request_hash, command.response into v_existing_hash, v_existing_response
  from public.mission_workflow_commands command
  where command.mission_submission_id = p_submission_id and command.actor_id = auth.uid()
    and command.workspace_id = p_workspace_id and command.command_id = p_command_id
  for update;
  if found then
    if v_existing_hash <> p_request_hash then raise exception 'command_conflict' using errcode = '23505'; end if;
    return v_existing_response || jsonb_build_object('replayed', true);
  end if;
  select * into v_item from public.mission_work_items
  where id = p_work_item_id and mission_workflow_id = v_workflow.id and mission_submission_id = p_submission_id
    and creator_id = auth.uid() and workspace_id = p_workspace_id
  for update;
  if v_item.id is null then raise exception 'work_item_not_found'; end if;
  select * into v_draft from public.mission_working_drafts
  where mission_work_item_id = v_item.id and workspace_id = p_workspace_id
  for update;
  if v_draft.id is null or v_draft.version <> p_expected_version then
    if v_draft.id is not null then raise exception 'version_conflict' using errcode = '40001'; end if;
    raise exception 'invalid_transition' using errcode = '55000';
  end if;
  v_requirement_list := case when jsonb_typeof(v_item.requirements->'requirements') = 'array'
    then v_item.requirements->'requirements' else '[]'::jsonb end;
  v_requires_caption := coalesce((v_item.requirements->>'caption')::boolean, false)
    or exists (select 1 from jsonb_array_elements_text(v_requirement_list) requirement where lower(regexp_replace(requirement, '[[:space:]_-]+', '', 'g')) = 'caption');
  v_requires_external_url := coalesce((v_item.requirements->>'external_url')::boolean, false)
    or coalesce((v_item.requirements->>'externalUrl')::boolean, false)
    or exists (select 1 from jsonb_array_elements_text(v_requirement_list) requirement where lower(regexp_replace(requirement, '[[:space:]_-]+', '', 'g')) = 'externalurl');
  if v_requires_caption and coalesce(btrim(v_draft.caption), '') = '' then
    raise exception 'invalid_transition' using errcode = '55000';
  end if;
  if v_requires_external_url then
    v_url := v_draft.external_url;
    if v_url is null or btrim(v_url) = ''
      or v_url !~* '^https?://(?:[[:alnum:]](?:[[:alnum:]-]{0,61}[[:alnum:]])?(?:\.[[:alnum:]](?:[[:alnum:]-]{0,61}[[:alnum:]])?)*|\[[0-9a-f:.]+\])(?::([0-9]{1,5}))?(?:[/?#][^[:space:]]*)?$' then
      raise exception 'invalid_transition' using errcode = '55000';
    end if;
    v_url_port := (regexp_match(v_url, '^https?://(?:[[:alnum:]](?:[[:alnum:]-]{0,61}[[:alnum:]])?(?:\.[[:alnum:]](?:[[:alnum:]-]{0,61}[[:alnum:]])?)*|\[[0-9a-f:.]+\])(?::([0-9]{1,5}))?(?:[/?#][^[:space:]]*)?$', 'i'))[1];
    if v_url_port is not null and v_url_port::integer not between 1 and 65535 then
      raise exception 'invalid_transition' using errcode = '55000';
    end if;
  end if;
  for v_checklist_key in
    select distinct requirement from (
      select requirement from jsonb_array_elements_text(v_requirement_list) requirement
      where lower(regexp_replace(requirement, '[[:space:]_-]+', '', 'g')) not in ('caption', 'externalurl')
      union all select requirement from jsonb_array_elements_text(case when jsonb_typeof(v_item.requirements->'checklist') = 'array'
        then v_item.requirements->'checklist' else '[]'::jsonb end) requirement
    ) checklist_requirements
  loop
    if coalesce((v_draft.checklist->>v_checklist_key)::boolean, false) is not true then raise exception 'invalid_transition' using errcode = '55000'; end if;
  end loop;
  if v_item.requires_asset and not exists (select 1 from public.mission_draft_assets asset
    where asset.mission_work_item_id = v_item.id and asset.upload_state = 'finalized') then raise exception 'invalid_transition' using errcode = '55000'; end if;
  if v_item.state = 'ready_to_submit' then
    update public.mission_work_items set state = 'submitted', revision = revision + 1, updated_at = now()
      where id = v_item.id returning * into v_item;
  elsif v_item.state = 'changes_requested' then
    update public.mission_work_items set state = 'resubmitted', revision = revision + 1, updated_at = now()
      where id = v_item.id returning * into v_item;
  else
    raise exception 'invalid_transition' using errcode = '55000';
  end if;
  select public.refresh_creator_studio_state(v_workflow.id) into v_workflow;
  select coalesce(jsonb_agg(to_jsonb(asset) order by asset.created_at, asset.id), '[]'::jsonb) into v_assets
  from public.mission_draft_assets asset where asset.mission_work_item_id = v_item.id;
  v_response := jsonb_build_object('replayed', false,
    'work_item', to_jsonb(v_item) || jsonb_build_object('draft', to_jsonb(v_draft), 'assets', v_assets),
    'workflow', to_jsonb(v_workflow));
  insert into public.mission_workflow_events
    (mission_workflow_id, mission_work_item_id, mission_submission_id, creator_id, workspace_id, event_type, command_id, metadata)
  values
    (v_item.mission_workflow_id, v_item.id, v_item.mission_submission_id, v_item.creator_id, v_item.workspace_id,
     'work_item_submitted', p_command_id, jsonb_build_object('state', v_item.state));
  insert into public.mission_workflow_commands
    (mission_submission_id, actor_id, creator_id, workspace_id, command_id, action, request_hash, response)
  values
    (p_submission_id, auth.uid(), v_item.creator_id, p_workspace_id, p_command_id, 'submit_work_item', p_request_hash, v_response);
  return v_response;
end;
$$;

revoke all on function public.creator_studio_save_draft(uuid, uuid, uuid, text, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.creator_studio_create_upload_grant(uuid, uuid, uuid, text, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.creator_studio_finalize_asset(uuid, uuid, uuid, uuid, text, text, bigint, text, text) from public, anon, authenticated;
revoke all on function public.creator_studio_submit_work_item(uuid, uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.creator_studio_save_draft(uuid, uuid, uuid, text, text, integer, jsonb) to authenticated, service_role;
grant execute on function public.creator_studio_create_upload_grant(uuid, uuid, uuid, text, text, text, text, bigint) to authenticated, service_role;
grant execute on function public.creator_studio_finalize_asset(uuid, uuid, uuid, uuid, text, text, bigint, text, text) to authenticated, service_role;
grant execute on function public.creator_studio_submit_work_item(uuid, uuid, uuid, text, text, integer) to authenticated, service_role;
