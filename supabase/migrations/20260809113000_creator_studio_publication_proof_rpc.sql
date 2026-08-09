-- Creator Studio publication-proof commands are RPC-only.
-- Each function locks the exact submission lineage, records an idempotent
-- command, appends workflow/proof events, and returns the committed row.

-- The base proof trigger protects URL/platform transitions, while this
-- column-specific trigger closes the remaining metadata mutation gap after
-- submission.
create or replace function public.guard_creator_studio_publication_proof_metadata_immutability()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.state <> 'draft'
     and (new.metadata is distinct from old.metadata
       or new.metadata_state is distinct from old.metadata_state)
  then
    raise exception 'publication_proof_attempt_immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists mission_publication_proof_attempts_metadata_immutability
  on public.mission_publication_proof_attempts;
create trigger mission_publication_proof_attempts_metadata_immutability
  before update on public.mission_publication_proof_attempts
  for each row execute function public.guard_creator_studio_publication_proof_metadata_immutability();

-- The legacy submit-work-item RPC predates publication proof.  Keep the
-- creator boundary safe even when that RPC is used directly.
create or replace function public.guard_creator_studio_publication_proof_submission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.state in ('submitted', 'resubmitted')
     and jsonb_typeof(new.proof_requirement) = 'object'
     and new.proof_requirement->>'kind' = 'publication_url'
     and not exists (
       select 1
       from public.mission_publication_proof_attempts attempt
       where attempt.mission_work_item_id = new.id
         and attempt.mission_workflow_id = new.mission_workflow_id
         and attempt.mission_submission_id = new.mission_submission_id
         and attempt.creator_id = new.creator_id
         and attempt.workspace_id = new.workspace_id
         and attempt.sequence = (
           select max(latest.sequence)
           from public.mission_publication_proof_attempts latest
           where latest.mission_work_item_id = new.id
             and latest.mission_workflow_id = new.mission_workflow_id
             and latest.mission_submission_id = new.mission_submission_id
             and latest.creator_id = new.creator_id
             and latest.workspace_id = new.workspace_id
         )
         and attempt.state in ('submitted', 'verified')
     )
  then
    raise exception 'proof_attempt_transition_invalid' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists mission_work_items_publication_proof_submission
  on public.mission_work_items;
create trigger mission_work_items_publication_proof_submission
  before update of state on public.mission_work_items
  for each row execute function public.guard_creator_studio_publication_proof_submission();

create or replace function public.creator_studio_create_publication_proof_attempt(
  p_submission_id uuid,
  p_workspace_id uuid,
  p_work_item_id uuid,
  p_command_id text,
  p_request_hash text,
  p_published_url text,
  p_platform text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_current public.mission_publication_proof_attempts;
  v_attempt public.mission_publication_proof_attempts;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_response jsonb;
  v_published_url text;
  v_platform text;
  v_url_port text;
begin
  if auth.uid() is null
     or coalesce(length(btrim(p_command_id)), 0) = 0
     or length(p_command_id) > 128
  then
    raise exception 'command_required' using errcode = '22023';
  end if;

  v_published_url := btrim(p_published_url);
  v_platform := btrim(p_platform);
  v_request_hash := md5(jsonb_build_object(
    'action', 'create_publication_proof_attempt',
    'actor_id', auth.uid(),
    'workspace_id', p_workspace_id,
    'submission_id', p_submission_id,
    'work_item_id', p_work_item_id,
    'command_id', p_command_id,
    'published_url', v_published_url,
    'platform', lower(v_platform)
  )::text);

  select workflow.* into v_workflow
  from public.mission_workflows workflow
  where workflow.mission_submission_id = p_submission_id
    and workflow.creator_id = auth.uid()
    and workflow.workspace_id = p_workspace_id
  for update;
  if v_workflow.id is null then raise exception 'submission_not_found'; end if;

  select command.request_hash, command.response
    into v_existing_hash, v_existing_response
  from public.mission_workflow_commands command
  where command.mission_submission_id = p_submission_id
    and command.actor_id = auth.uid()
    and command.workspace_id = p_workspace_id
    and command.command_id = p_command_id
  for update;
  if found then
    if v_existing_hash <> v_request_hash then
      raise exception 'command_conflict' using errcode = '23505';
    end if;
    return v_existing_response || jsonb_build_object('replayed', true);
  end if;

  select * into v_item
  from public.mission_work_items item
  where item.id = p_work_item_id
    and item.mission_workflow_id = v_workflow.id
    and item.mission_submission_id = p_submission_id
    and item.creator_id = auth.uid()
    and item.workspace_id = p_workspace_id
  for update;
  if v_item.id is null then raise exception 'work_item_not_found'; end if;
  if v_item.state not in ('not_started', 'drafting', 'ready_to_submit', 'changes_requested') then
    raise exception 'invalid_transition' using errcode = '55000';
  end if;
  if jsonb_typeof(v_item.proof_requirement) <> 'object'
     or v_item.proof_requirement->>'kind' <> 'publication_url'
     or v_item.proof_requirement->>'evidence' <> 'optional'
     or jsonb_typeof(v_item.proof_requirement->'allowedPlatforms') <> 'array'
  then
    raise exception 'proof_attempt_transition_invalid' using errcode = '22023';
  end if;
  if coalesce(length(v_published_url), 0) = 0
     or v_published_url ~ '[[:space:]]'
     or v_published_url !~* '^https://[[:alnum:]](?:[[:alnum:]-]{0,61}[[:alnum:]])?(?:\.[[:alnum:]](?:[[:alnum:]-]{0,61}[[:alnum:]])?)*(?::([0-9]{1,5}))?(?:[/?#][^[:space:]]*)?$'
  then
    raise exception 'proof_url_invalid' using errcode = '22023';
  end if;
  v_url_port := (regexp_match(v_published_url, '^https://[[:alnum:]](?:[[:alnum:]-]{0,61}[[:alnum:]])?(?:\.[[:alnum:]](?:[[:alnum:]-]{0,61}[[:alnum:]])?)*(?::([0-9]{1,5}))?(?:[/?#][^[:space:]]*)?$', 'i'))[1];
  if v_url_port is not null and v_url_port::integer not between 1 and 65535 then
    raise exception 'proof_url_invalid' using errcode = '22023';
  end if;
  if coalesce(length(v_platform), 0) = 0
     or not exists (
       select 1
       from jsonb_array_elements_text(v_item.proof_requirement->'allowedPlatforms') allowed_platform
       where lower(btrim(allowed_platform)) = lower(v_platform)
     )
  then
    raise exception 'proof_platform_invalid' using errcode = '22023';
  end if;

  select * into v_current
  from public.mission_publication_proof_attempts attempt
  where attempt.mission_work_item_id = v_item.id
    and attempt.mission_workflow_id = v_item.mission_workflow_id
    and attempt.mission_submission_id = v_item.mission_submission_id
    and attempt.creator_id = v_item.creator_id
    and attempt.workspace_id = v_item.workspace_id
  order by attempt.sequence desc, attempt.id desc
  limit 1;

  if v_current.id is not null and v_current.state = 'draft' then
    update public.mission_publication_proof_attempts
    set published_url = v_published_url,
        platform = v_platform,
        metadata_state = 'pending',
        metadata = null,
        updated_at = now()
    where id = v_current.id
    returning * into v_attempt;
  else
    if v_current.id is not null and v_current.state <> 'changes_requested' then
      raise exception 'proof_attempt_immutable' using errcode = '55000';
    end if;
    insert into public.mission_publication_proof_attempts
      (mission_work_item_id, mission_workflow_id, mission_submission_id, creator_id, workspace_id,
       parent_attempt_id, sequence, published_url, platform, state, metadata_state, metadata)
    values
      (v_item.id, v_item.mission_workflow_id, v_item.mission_submission_id, v_item.creator_id, v_item.workspace_id,
       v_current.id, coalesce(v_current.sequence, 0) + 1, v_published_url, v_platform, 'draft', 'pending', null)
    returning * into v_attempt;
  end if;

  select public.refresh_creator_studio_state(v_workflow.id) into v_workflow;
  v_response := jsonb_build_object(
    'replayed', false,
    'attempt', to_jsonb(v_attempt) || jsonb_build_object(
      'evidence', coalesce((
        select jsonb_agg(to_jsonb(asset) order by asset.created_at, asset.id)
        from public.mission_publication_proof_assets asset
        where asset.mission_publication_proof_attempt_id = v_attempt.id
          and asset.upload_state in ('pending', 'finalized')
      ), '[]'::jsonb)
    )
  );
  insert into public.mission_publication_proof_events
    (mission_publication_proof_attempt_id, mission_work_item_id, mission_workflow_id,
     mission_submission_id, creator_id, workspace_id, event_type, metadata)
  values
    (v_attempt.id, v_attempt.mission_work_item_id, v_attempt.mission_workflow_id,
     v_attempt.mission_submission_id, v_attempt.creator_id, v_attempt.workspace_id,
     'attempt_created', jsonb_build_object('sequence', v_attempt.sequence));
  insert into public.mission_workflow_events
    (mission_workflow_id, mission_work_item_id, mission_submission_id, creator_id,
     workspace_id, event_type, command_id, metadata)
  values
    (v_attempt.mission_workflow_id, v_attempt.mission_work_item_id, v_attempt.mission_submission_id,
     v_attempt.creator_id, v_attempt.workspace_id, 'proof_attempt_created', p_command_id,
     jsonb_build_object('attempt_id', v_attempt.id, 'sequence', v_attempt.sequence));
  insert into public.mission_workflow_commands
    (mission_submission_id, actor_id, creator_id, workspace_id, command_id, action, request_hash, response)
  values
    (p_submission_id, auth.uid(), v_attempt.creator_id, p_workspace_id, p_command_id,
     'create_publication_proof_attempt', v_request_hash, v_response);
  return v_response;
end;
$$;

create or replace function public.creator_studio_create_proof_evidence_grant(
  p_submission_id uuid,
  p_workspace_id uuid,
  p_work_item_id uuid,
  p_attempt_id uuid,
  p_command_id text,
  p_request_hash text,
  p_file_name text,
  p_mime_type text,
  p_byte_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_attempt public.mission_publication_proof_attempts;
  v_latest public.mission_publication_proof_attempts;
  v_asset public.mission_publication_proof_assets;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_response jsonb;
  v_file_name text;
  v_extension text;
  v_asset_id uuid;
begin
  if auth.uid() is null
     or coalesce(length(btrim(p_command_id)), 0) = 0
     or length(p_command_id) > 128
  then
    raise exception 'command_required' using errcode = '22023';
  end if;
  v_file_name := btrim(p_file_name);
  v_request_hash := md5(jsonb_build_object(
    'action', 'create_proof_evidence_grant',
    'actor_id', auth.uid(),
    'workspace_id', p_workspace_id,
    'submission_id', p_submission_id,
    'work_item_id', p_work_item_id,
    'attempt_id', p_attempt_id,
    'command_id', p_command_id,
    'file_name', v_file_name,
    'mime_type', p_mime_type,
    'byte_size', p_byte_size
  )::text);

  select workflow.* into v_workflow
  from public.mission_workflows workflow
  where workflow.mission_submission_id = p_submission_id
    and workflow.creator_id = auth.uid()
    and workflow.workspace_id = p_workspace_id
  for update;
  if v_workflow.id is null then raise exception 'submission_not_found'; end if;

  select command.request_hash, command.response
    into v_existing_hash, v_existing_response
  from public.mission_workflow_commands command
  where command.mission_submission_id = p_submission_id
    and command.actor_id = auth.uid()
    and command.workspace_id = p_workspace_id
    and command.command_id = p_command_id
  for update;
  if found then
    if v_existing_hash <> v_request_hash then
      raise exception 'command_conflict' using errcode = '23505';
    end if;
    return v_existing_response || jsonb_build_object('replayed', true);
  end if;

  select * into v_item
  from public.mission_work_items item
  where item.id = p_work_item_id
    and item.mission_workflow_id = v_workflow.id
    and item.mission_submission_id = p_submission_id
    and item.creator_id = auth.uid()
    and item.workspace_id = p_workspace_id
  for update;
  if v_item.id is null then raise exception 'work_item_not_found'; end if;
  if v_item.state not in ('not_started', 'drafting', 'ready_to_submit', 'changes_requested') then
    raise exception 'invalid_transition' using errcode = '55000';
  end if;

  select * into v_attempt
  from public.mission_publication_proof_attempts attempt
  where attempt.id = p_attempt_id
    and attempt.mission_work_item_id = v_item.id
    and attempt.mission_workflow_id = v_item.mission_workflow_id
    and attempt.mission_submission_id = v_item.mission_submission_id
    and attempt.creator_id = v_item.creator_id
    and attempt.workspace_id = v_item.workspace_id
  for update;
  if v_attempt.id is null then raise exception 'proof_attempt_immutable' using errcode = '55000'; end if;
  select * into v_latest
  from public.mission_publication_proof_attempts attempt
  where attempt.mission_work_item_id = v_item.id
    and attempt.mission_workflow_id = v_item.mission_workflow_id
    and attempt.mission_submission_id = v_item.mission_submission_id
    and attempt.creator_id = v_item.creator_id
    and attempt.workspace_id = v_item.workspace_id
  order by attempt.sequence desc, attempt.id desc
  limit 1;
  if v_latest.id <> v_attempt.id or v_attempt.state <> 'draft' then
    raise exception 'proof_attempt_immutable' using errcode = '55000';
  end if;
  if coalesce(length(v_file_name), 0) = 0
     or length(v_file_name) > 255
     or v_file_name ~ '[[:cntrl:]]'
     or position('/' in v_file_name) > 0
     or position('\' in v_file_name) > 0
     or position('..' in v_file_name) > 0
  then
    raise exception 'proof_evidence_invalid' using errcode = '22023';
  end if;
  v_extension := case p_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    when 'application/pdf' then 'pdf'
    else null
  end;
  if v_extension is null then
    raise exception 'proof_evidence_invalid' using errcode = '22023';
  end if;
  if p_byte_size is null or p_byte_size < 1 or p_byte_size > 52428800 then
    raise exception 'proof_evidence_invalid' using errcode = '22023';
  end if;

  v_asset_id := gen_random_uuid();
  insert into public.mission_publication_proof_assets
    (id, mission_publication_proof_attempt_id, mission_submission_id, mission_workflow_id,
     mission_work_item_id, creator_id, workspace_id, storage_object_path, original_filename,
     mime_type, byte_size, upload_state, upload_grant_expires_at)
  values
    (v_asset_id, v_attempt.id, v_item.mission_submission_id, v_item.mission_workflow_id, v_item.id,
     v_item.creator_id, v_item.workspace_id,
     auth.uid()::text || '/' || v_item.mission_workflow_id::text || '/' || v_item.id::text
       || '/proof-evidence/' || v_asset_id::text || '.' || v_extension,
     v_file_name, p_mime_type, p_byte_size, 'pending', now() + interval '15 minutes')
  returning * into v_asset;

  v_response := jsonb_build_object(
    'replayed', false,
    'grant', jsonb_build_object(
      'bucket', 'mission-publication-proof-assets',
      'path', v_asset.storage_object_path,
      'asset_id', v_asset.id,
      'expires_at', v_asset.upload_grant_expires_at
    )
  );
  insert into public.mission_publication_proof_events
    (mission_publication_proof_attempt_id, mission_work_item_id, mission_workflow_id,
     mission_submission_id, creator_id, workspace_id, event_type, metadata)
  values
    (v_attempt.id, v_item.id, v_item.mission_workflow_id, v_item.mission_submission_id,
     v_item.creator_id, v_item.workspace_id, 'evidence_reserved',
     jsonb_build_object('evidence_id', v_asset.id, 'storage_path', v_asset.storage_object_path));
  insert into public.mission_workflow_events
    (mission_workflow_id, mission_work_item_id, mission_submission_id, creator_id,
     workspace_id, event_type, command_id, metadata)
  values
    (v_item.mission_workflow_id, v_item.id, v_item.mission_submission_id, v_item.creator_id,
     v_item.workspace_id, 'proof_evidence_reserved', p_command_id,
     jsonb_build_object('attempt_id', v_attempt.id, 'evidence_id', v_asset.id));
  insert into public.mission_workflow_commands
    (mission_submission_id, actor_id, creator_id, workspace_id, command_id, action, request_hash, response)
  values
    (p_submission_id, auth.uid(), v_item.creator_id, p_workspace_id, p_command_id,
     'create_proof_evidence_grant', v_request_hash, v_response);
  return v_response;
end;
$$;

create or replace function public.creator_studio_finalize_proof_evidence(
  p_submission_id uuid,
  p_workspace_id uuid,
  p_work_item_id uuid,
  p_attempt_id uuid,
  p_evidence_id uuid,
  p_command_id text,
  p_request_hash text,
  p_byte_size bigint,
  p_mime_type text,
  p_checksum_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_attempt public.mission_publication_proof_attempts;
  v_latest public.mission_publication_proof_attempts;
  v_asset public.mission_publication_proof_assets;
  v_object storage.objects;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_response jsonb;
begin
  if auth.uid() is null
     or coalesce(length(btrim(p_command_id)), 0) = 0
     or length(p_command_id) > 128
  then
    raise exception 'command_required' using errcode = '22023';
  end if;
  if p_checksum_sha256 is not null and p_checksum_sha256 !~* '^[a-f0-9]{64}$' then
    raise exception 'proof_evidence_invalid' using errcode = '22023';
  end if;
  v_request_hash := md5(jsonb_build_object(
    'action', 'finalize_proof_evidence',
    'actor_id', auth.uid(),
    'workspace_id', p_workspace_id,
    'submission_id', p_submission_id,
    'work_item_id', p_work_item_id,
    'attempt_id', p_attempt_id,
    'evidence_id', p_evidence_id,
    'command_id', p_command_id,
    'byte_size', p_byte_size,
    'mime_type', p_mime_type,
    'checksum_sha256', p_checksum_sha256
  )::text);

  select workflow.* into v_workflow
  from public.mission_workflows workflow
  where workflow.mission_submission_id = p_submission_id
    and workflow.creator_id = auth.uid()
    and workflow.workspace_id = p_workspace_id
  for update;
  if v_workflow.id is null then raise exception 'submission_not_found'; end if;

  select command.request_hash, command.response
    into v_existing_hash, v_existing_response
  from public.mission_workflow_commands command
  where command.mission_submission_id = p_submission_id
    and command.actor_id = auth.uid()
    and command.workspace_id = p_workspace_id
    and command.command_id = p_command_id
  for update;
  if found then
    if v_existing_hash <> v_request_hash then
      raise exception 'command_conflict' using errcode = '23505';
    end if;
    return v_existing_response || jsonb_build_object('replayed', true);
  end if;

  select * into v_item
  from public.mission_work_items item
  where item.id = p_work_item_id
    and item.mission_workflow_id = v_workflow.id
    and item.mission_submission_id = p_submission_id
    and item.creator_id = auth.uid()
    and item.workspace_id = p_workspace_id
  for update;
  if v_item.id is null then raise exception 'work_item_not_found'; end if;
  if v_item.state not in ('not_started', 'drafting', 'ready_to_submit', 'changes_requested') then
    raise exception 'invalid_transition' using errcode = '55000';
  end if;

  select * into v_attempt
  from public.mission_publication_proof_attempts attempt
  where attempt.id = p_attempt_id
    and attempt.mission_work_item_id = v_item.id
    and attempt.mission_workflow_id = v_item.mission_workflow_id
    and attempt.mission_submission_id = v_item.mission_submission_id
    and attempt.creator_id = v_item.creator_id
    and attempt.workspace_id = v_item.workspace_id
  for update;
  if v_attempt.id is null then raise exception 'proof_attempt_immutable' using errcode = '55000'; end if;
  select * into v_latest
  from public.mission_publication_proof_attempts attempt
  where attempt.mission_work_item_id = v_item.id
    and attempt.mission_workflow_id = v_item.mission_workflow_id
    and attempt.mission_submission_id = v_item.mission_submission_id
    and attempt.creator_id = v_item.creator_id
    and attempt.workspace_id = v_item.workspace_id
  order by attempt.sequence desc, attempt.id desc
  limit 1;
  if v_latest.id <> v_attempt.id or v_attempt.state <> 'draft' then
    raise exception 'proof_attempt_immutable' using errcode = '55000';
  end if;

  select * into v_asset
  from public.mission_publication_proof_assets asset
  where asset.id = p_evidence_id
    and asset.mission_publication_proof_attempt_id = v_attempt.id
    and asset.mission_work_item_id = v_item.id
    and asset.mission_workflow_id = v_item.mission_workflow_id
    and asset.mission_submission_id = v_item.mission_submission_id
    and asset.creator_id = v_item.creator_id
    and asset.workspace_id = v_item.workspace_id
  for update;
  if v_asset.id is null then raise exception 'proof_evidence_invalid'; end if;
  if v_asset.upload_state <> 'pending'
     or v_asset.upload_grant_expires_at is null
     or v_asset.upload_grant_expires_at <= now()
     or v_asset.byte_size <> p_byte_size
     or v_asset.mime_type <> p_mime_type
  then
    raise exception 'proof_evidence_invalid' using errcode = '55000';
  end if;

  select * into v_object
  from storage.objects object
  where object.bucket_id = 'mission-publication-proof-assets'
    and object.name = v_asset.storage_object_path;
  if v_object.id is null
     or v_object.metadata is null
     or v_object.metadata->>'size' is null
     or v_object.metadata->>'size' !~ '^[0-9]+$'
     or (case
       when v_object.metadata->>'size' ~ '^[0-9]+$'
       then (v_object.metadata->>'size')::bigint
       else null
     end) <> v_asset.byte_size
     or v_object.metadata->>'mimetype' is null
     or v_object.metadata->>'mimetype' <> v_asset.mime_type
  then
    raise exception 'proof_evidence_invalid' using errcode = '55000';
  end if;

  update public.mission_publication_proof_assets
  set upload_state = 'finalized',
      content_checksum = p_checksum_sha256,
      finalized_at = now()
  where id = v_asset.id
  returning * into v_asset;

  v_response := jsonb_build_object('replayed', false, 'evidence', to_jsonb(v_asset));
  insert into public.mission_publication_proof_events
    (mission_publication_proof_attempt_id, mission_work_item_id, mission_workflow_id,
     mission_submission_id, creator_id, workspace_id, event_type, metadata)
  values
    (v_attempt.id, v_item.id, v_item.mission_workflow_id, v_item.mission_submission_id,
     v_item.creator_id, v_item.workspace_id, 'evidence_finalized',
     jsonb_build_object('evidence_id', v_asset.id));
  insert into public.mission_workflow_events
    (mission_workflow_id, mission_work_item_id, mission_submission_id, creator_id,
     workspace_id, event_type, command_id, metadata)
  values
    (v_item.mission_workflow_id, v_item.id, v_item.mission_submission_id, v_item.creator_id,
     v_item.workspace_id, 'proof_evidence_finalized', p_command_id,
     jsonb_build_object('attempt_id', v_attempt.id, 'evidence_id', v_asset.id));
  insert into public.mission_workflow_commands
    (mission_submission_id, actor_id, creator_id, workspace_id, command_id, action, request_hash, response)
  values
    (p_submission_id, auth.uid(), v_item.creator_id, p_workspace_id, p_command_id,
     'finalize_proof_evidence', v_request_hash, v_response);
  return v_response;
end;
$$;

create or replace function public.creator_studio_submit_publication_proof(
  p_submission_id uuid,
  p_workspace_id uuid,
  p_work_item_id uuid,
  p_attempt_id uuid,
  p_command_id text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_attempt public.mission_publication_proof_attempts;
  v_latest public.mission_publication_proof_attempts;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_response jsonb;
begin
  if auth.uid() is null
     or coalesce(length(btrim(p_command_id)), 0) = 0
     or length(p_command_id) > 128
  then
    raise exception 'command_required' using errcode = '22023';
  end if;
  v_request_hash := md5(jsonb_build_object(
    'action', 'submit_publication_proof',
    'actor_id', auth.uid(),
    'workspace_id', p_workspace_id,
    'submission_id', p_submission_id,
    'work_item_id', p_work_item_id,
    'attempt_id', p_attempt_id,
    'command_id', p_command_id
  )::text);

  select workflow.* into v_workflow
  from public.mission_workflows workflow
  where workflow.mission_submission_id = p_submission_id
    and workflow.creator_id = auth.uid()
    and workflow.workspace_id = p_workspace_id
  for update;
  if v_workflow.id is null then raise exception 'submission_not_found'; end if;

  select command.request_hash, command.response
    into v_existing_hash, v_existing_response
  from public.mission_workflow_commands command
  where command.mission_submission_id = p_submission_id
    and command.actor_id = auth.uid()
    and command.workspace_id = p_workspace_id
    and command.command_id = p_command_id
  for update;
  if found then
    if v_existing_hash <> v_request_hash then
      raise exception 'command_conflict' using errcode = '23505';
    end if;
    return v_existing_response || jsonb_build_object('replayed', true);
  end if;

  select * into v_item
  from public.mission_work_items item
  where item.id = p_work_item_id
    and item.mission_workflow_id = v_workflow.id
    and item.mission_submission_id = p_submission_id
    and item.creator_id = auth.uid()
    and item.workspace_id = p_workspace_id
  for update;
  if v_item.id is null then raise exception 'work_item_not_found'; end if;
  if v_item.state not in ('not_started', 'drafting', 'ready_to_submit', 'changes_requested') then
    raise exception 'invalid_transition' using errcode = '55000';
  end if;
  if jsonb_typeof(v_item.proof_requirement) <> 'object'
     or v_item.proof_requirement->>'kind' <> 'publication_url'
  then
    raise exception 'proof_attempt_transition_invalid' using errcode = '22023';
  end if;

  select * into v_attempt
  from public.mission_publication_proof_attempts attempt
  where attempt.id = p_attempt_id
    and attempt.mission_work_item_id = v_item.id
    and attempt.mission_workflow_id = v_item.mission_workflow_id
    and attempt.mission_submission_id = v_item.mission_submission_id
    and attempt.creator_id = v_item.creator_id
    and attempt.workspace_id = v_item.workspace_id
  for update;
  if v_attempt.id is null then raise exception 'proof_attempt_immutable' using errcode = '55000'; end if;
  select * into v_latest
  from public.mission_publication_proof_attempts attempt
  where attempt.mission_work_item_id = v_item.id
    and attempt.mission_workflow_id = v_item.mission_workflow_id
    and attempt.mission_submission_id = v_item.mission_submission_id
    and attempt.creator_id = v_item.creator_id
    and attempt.workspace_id = v_item.workspace_id
  order by attempt.sequence desc, attempt.id desc
  limit 1;
  if v_latest.id <> v_attempt.id or v_attempt.state <> 'draft' then
    raise exception 'proof_attempt_immutable' using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.mission_publication_proof_assets asset
    where asset.mission_publication_proof_attempt_id = v_attempt.id
      and asset.upload_state = 'pending'
  ) then
    raise exception 'proof_evidence_invalid' using errcode = '55000';
  end if;

  update public.mission_publication_proof_attempts
  set state = 'submitted',
      submitted_at = now(),
      updated_at = now()
  where id = v_attempt.id
  returning * into v_attempt;

  v_response := jsonb_build_object(
    'replayed', false,
    'attempt', to_jsonb(v_attempt) || jsonb_build_object(
      'evidence', coalesce((
        select jsonb_agg(to_jsonb(asset) order by asset.created_at, asset.id)
        from public.mission_publication_proof_assets asset
        where asset.mission_publication_proof_attempt_id = v_attempt.id
          and asset.upload_state in ('pending', 'finalized')
      ), '[]'::jsonb)
    )
  );
  insert into public.mission_publication_proof_events
    (mission_publication_proof_attempt_id, mission_work_item_id, mission_workflow_id,
     mission_submission_id, creator_id, workspace_id, event_type, metadata)
  values
    (v_attempt.id, v_item.id, v_item.mission_workflow_id, v_item.mission_submission_id,
     v_item.creator_id, v_item.workspace_id, 'submitted',
     jsonb_build_object('submitted_at', v_attempt.submitted_at));
  insert into public.mission_workflow_events
    (mission_workflow_id, mission_work_item_id, mission_submission_id, creator_id,
     workspace_id, event_type, command_id, metadata)
  values
    (v_item.mission_workflow_id, v_item.id, v_item.mission_submission_id, v_item.creator_id,
     v_item.workspace_id, 'proof_submitted', p_command_id,
     jsonb_build_object('attempt_id', v_attempt.id));
  insert into public.mission_workflow_commands
    (mission_submission_id, actor_id, creator_id, workspace_id, command_id, action, request_hash, response)
  values
    (p_submission_id, auth.uid(), v_item.creator_id, p_workspace_id, p_command_id,
     'submit_publication_proof', v_request_hash, v_response);
  return v_response;
end;
$$;

create or replace function public.creator_studio_refresh_proof_metadata(
  p_submission_id uuid,
  p_workspace_id uuid,
  p_work_item_id uuid,
  p_attempt_id uuid,
  p_command_id text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_attempt public.mission_publication_proof_attempts;
  v_latest public.mission_publication_proof_attempts;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_response jsonb;
begin
  if auth.uid() is null
     or coalesce(length(btrim(p_command_id)), 0) = 0
     or length(p_command_id) > 128
  then
    raise exception 'command_required' using errcode = '22023';
  end if;
  v_request_hash := md5(jsonb_build_object(
    'action', 'refresh_proof_metadata',
    'actor_id', auth.uid(),
    'workspace_id', p_workspace_id,
    'submission_id', p_submission_id,
    'work_item_id', p_work_item_id,
    'attempt_id', p_attempt_id,
    'command_id', p_command_id
  )::text);

  select workflow.* into v_workflow
  from public.mission_workflows workflow
  where workflow.mission_submission_id = p_submission_id
    and workflow.creator_id = auth.uid()
    and workflow.workspace_id = p_workspace_id
  for update;
  if v_workflow.id is null then raise exception 'submission_not_found'; end if;

  select command.request_hash, command.response
    into v_existing_hash, v_existing_response
  from public.mission_workflow_commands command
  where command.mission_submission_id = p_submission_id
    and command.actor_id = auth.uid()
    and command.workspace_id = p_workspace_id
    and command.command_id = p_command_id
  for update;
  if found then
    if v_existing_hash <> v_request_hash then
      raise exception 'command_conflict' using errcode = '23505';
    end if;
    return v_existing_response || jsonb_build_object('replayed', true);
  end if;

  select * into v_item
  from public.mission_work_items item
  where item.id = p_work_item_id
    and item.mission_workflow_id = v_workflow.id
    and item.mission_submission_id = p_submission_id
    and item.creator_id = auth.uid()
    and item.workspace_id = p_workspace_id
  for update;
  if v_item.id is null then raise exception 'work_item_not_found'; end if;
  if v_item.state not in ('not_started', 'drafting', 'ready_to_submit', 'changes_requested') then
    raise exception 'invalid_transition' using errcode = '55000';
  end if;

  select * into v_attempt
  from public.mission_publication_proof_attempts attempt
  where attempt.id = p_attempt_id
    and attempt.mission_work_item_id = v_item.id
    and attempt.mission_workflow_id = v_item.mission_workflow_id
    and attempt.mission_submission_id = v_item.mission_submission_id
    and attempt.creator_id = v_item.creator_id
    and attempt.workspace_id = v_item.workspace_id
  for update;
  if v_attempt.id is null then raise exception 'proof_attempt_immutable' using errcode = '55000'; end if;
  select * into v_latest
  from public.mission_publication_proof_attempts attempt
  where attempt.mission_work_item_id = v_item.id
    and attempt.mission_workflow_id = v_item.mission_workflow_id
    and attempt.mission_submission_id = v_item.mission_submission_id
    and attempt.creator_id = v_item.creator_id
    and attempt.workspace_id = v_item.workspace_id
  order by attempt.sequence desc, attempt.id desc
  limit 1;
  if v_latest.id <> v_attempt.id or v_attempt.state <> 'draft' then
    -- Metadata refresh never sets verified; submitted attempts are immutable.
    raise exception 'proof_attempt_immutable' using errcode = '55000';
  end if;

  -- The database RPC has no network/provider dependency.  It records a safe
  -- unavailable result; a provider-aware application resolver may later
  -- replace this command with the same draft-scoped mutation.
  update public.mission_publication_proof_attempts
  set metadata_state = 'unavailable',
      metadata = null,
      updated_at = now()
  where id = v_attempt.id
  returning * into v_attempt;

  v_response := jsonb_build_object(
    'replayed', false,
    'attempt', to_jsonb(v_attempt) || jsonb_build_object(
      'evidence', coalesce((
        select jsonb_agg(to_jsonb(asset) order by asset.created_at, asset.id)
        from public.mission_publication_proof_assets asset
        where asset.mission_publication_proof_attempt_id = v_attempt.id
          and asset.upload_state in ('pending', 'finalized')
      ), '[]'::jsonb)
    )
  );
  insert into public.mission_publication_proof_events
    (mission_publication_proof_attempt_id, mission_work_item_id, mission_workflow_id,
     mission_submission_id, creator_id, workspace_id, event_type, metadata)
  values
    (v_attempt.id, v_item.id, v_item.mission_workflow_id, v_item.mission_submission_id,
     v_item.creator_id, v_item.workspace_id, 'metadata_refreshed',
     jsonb_build_object('metadata_state', v_attempt.metadata_state));
  insert into public.mission_workflow_events
    (mission_workflow_id, mission_work_item_id, mission_submission_id, creator_id,
     workspace_id, event_type, command_id, metadata)
  values
    (v_item.mission_workflow_id, v_item.id, v_item.mission_submission_id, v_item.creator_id,
     v_item.workspace_id, 'proof_metadata_refreshed', p_command_id,
     jsonb_build_object('attempt_id', v_attempt.id, 'metadata_state', v_attempt.metadata_state));
  insert into public.mission_workflow_commands
    (mission_submission_id, actor_id, creator_id, workspace_id, command_id, action, request_hash, response)
  values
    (p_submission_id, auth.uid(), v_item.creator_id, p_workspace_id, p_command_id,
     'refresh_proof_metadata', v_request_hash, v_response);
  return v_response;
end;
$$;

revoke all on function public.creator_studio_create_publication_proof_attempt(uuid, uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.creator_studio_create_proof_evidence_grant(uuid, uuid, uuid, uuid, text, text, text, text, bigint)
  from public, anon, authenticated;
revoke all on function public.creator_studio_finalize_proof_evidence(uuid, uuid, uuid, uuid, uuid, text, text, bigint, text, text)
  from public, anon, authenticated;
revoke all on function public.creator_studio_submit_publication_proof(uuid, uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.creator_studio_refresh_proof_metadata(uuid, uuid, uuid, uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.creator_studio_create_publication_proof_attempt(uuid, uuid, uuid, text, text, text, text)
  to authenticated, service_role;
grant execute on function public.creator_studio_create_proof_evidence_grant(uuid, uuid, uuid, uuid, text, text, text, text, bigint)
  to authenticated, service_role;
grant execute on function public.creator_studio_finalize_proof_evidence(uuid, uuid, uuid, uuid, uuid, text, text, bigint, text, text)
  to authenticated, service_role;
grant execute on function public.creator_studio_submit_publication_proof(uuid, uuid, uuid, uuid, text, text)
  to authenticated, service_role;
grant execute on function public.creator_studio_refresh_proof_metadata(uuid, uuid, uuid, uuid, text, text)
  to authenticated, service_role;
