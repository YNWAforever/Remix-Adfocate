begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('creator-growth-private','creator-growth-private',false,8388608,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
do $$ begin
  if not exists(
    select 1 from storage.buckets
    where id='creator-growth-private' and public=false
      and file_size_limit=8388608
      and allowed_mime_types=array['image/jpeg','image/png','image/webp']
  ) then raise exception 'CREATOR_GROWTH_BUCKET_CONFLICT'; end if;
end $$;

create table private.creator_growth_assets (
  id uuid primary key,
  workspace_id uuid not null,
  creator_id uuid not null,
  thread_id uuid not null,
  storage_path text not null unique check(storage_path !~ '\.\.' and storage_path ~ '^[0-9a-f-]+/[0-9a-f-]+/[0-9a-f-]+/[0-9a-f-]+\.(jpg|png|webp)$'),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  mime text not null check(mime in ('image/jpeg','image/png','image/webp')),
  byte_size integer not null check(byte_size between 0 and 8388608),
  width integer not null check(width between 1 and 4096),
  height integer not null check(height between 1 and 4096),
  pixel_count integer generated always as (width*height) stored check(pixel_count between 1 and 16000000),
  rights_confirmed boolean not null check(rights_confirmed),
  source_kind text not null check(source_kind in ('creator-upload','synthetic-fixture')),
  sample_only boolean not null default false,
  fixture_id text check(fixture_id is null or length(fixture_id) between 1 and 128),
  upload_state text not null default 'pending' check(upload_state in ('pending','uploaded')),
  created_at timestamptz not null default clock_timestamp(),
  uploaded_at timestamptz,
  expires_at timestamptz not null,
  unique(id,workspace_id,creator_id),
  unique(id,thread_id,workspace_id,creator_id),
  foreign key(creator_id,workspace_id) references public.creators(id,workspace_id) on delete cascade,
  foreign key(thread_id,workspace_id,creator_id) references public.studio_threads(id,workspace_id,creator_id) on delete cascade,
  check((source_kind='creator-upload' and fixture_id is null and sample_only=false) or (source_kind='synthetic-fixture' and fixture_id is not null and sample_only=true))
);
create index creator_growth_assets_owner_thread on private.creator_growth_assets(workspace_id,creator_id,thread_id,created_at desc);
create index creator_growth_assets_creator_fk on private.creator_growth_assets(creator_id,workspace_id);
create index creator_growth_assets_expiry on private.creator_growth_assets(workspace_id,creator_id,expires_at);
create index creator_growth_assets_thread_fk on private.creator_growth_assets(thread_id,workspace_id,creator_id);

create table private.creator_growth_media_sources (
  id uuid primary key,
  workspace_id uuid not null,
  creator_id uuid not null,
  thread_id uuid not null,
  asset_id uuid,
  connection_id uuid,
  generation integer,
  source_kind text not null check(source_kind in ('official_instagram','public_image_mock','creator_upload')),
  source_ref text not null check(length(source_ref) between 1 and 256 and source_ref !~ '://'),
  subject text check(subject is null or length(subject) between 1 and 500),
  media_id text check(media_id is null or media_id ~ '^[1-9][0-9]*$'),
  permalink text check(permalink is null or (length(permalink)<=2000 and permalink ~ '^https://(www\.)?instagram\.com/(p|reel)/[A-Za-z0-9_-]+/?$')),
  rights text not null check(rights in ('allowed','unknown','denied')),
  visibility text not null check(visibility in ('public','private','unknown')),
  match_status text not null check(match_status in ('matched','unverified','rejected')),
  sample_only boolean not null,
  observed_at timestamptz not null,
  fetched_at timestamptz not null,
  invalidated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique(id,workspace_id,creator_id),
  unique(id,thread_id,workspace_id,creator_id),
  foreign key(creator_id,workspace_id) references public.creators(id,workspace_id) on delete cascade,
  foreign key(thread_id,workspace_id,creator_id) references public.studio_threads(id,workspace_id,creator_id) on delete cascade,
  foreign key(asset_id,thread_id,workspace_id,creator_id) references private.creator_growth_assets(id,thread_id,workspace_id,creator_id) on delete cascade,
  foreign key(connection_id,workspace_id,creator_id) references public.integration_connections(id,workspace_id,creator_id) on delete cascade,
  check((connection_id is null and generation is null) or (connection_id is not null and generation is not null and generation>0)),
  check(source_kind<>'official_instagram' or connection_id is not null),
  check(source_kind<>'creator_upload' or asset_id is not null)
);
create index creator_growth_media_owner on private.creator_growth_media_sources(workspace_id,creator_id,created_at desc);
create index creator_growth_media_creator_fk on private.creator_growth_media_sources(creator_id,workspace_id);
create index creator_growth_media_asset_fk on private.creator_growth_media_sources(asset_id,thread_id,workspace_id,creator_id);
create index creator_growth_media_connection_fk on private.creator_growth_media_sources(connection_id,workspace_id,creator_id,generation);
create index creator_growth_media_thread_fk on private.creator_growth_media_sources(thread_id,workspace_id,creator_id);

create table private.creator_growth_consents (
  id uuid primary key,
  workspace_id uuid not null,
  creator_id uuid not null,
  processor text not null check(length(processor) between 1 and 120),
  consent_version text not null check(length(consent_version) between 1 and 64),
  granted_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  connection_id uuid,
  generation integer,
  created_at timestamptz not null default clock_timestamp(),
  unique(id,workspace_id,creator_id),
  foreign key(creator_id,workspace_id) references public.creators(id,workspace_id) on delete cascade,
  foreign key(connection_id,workspace_id,creator_id) references public.integration_connections(id,workspace_id,creator_id) on delete cascade,
  check(expires_at>granted_at),
  check((connection_id is null and generation is null) or (connection_id is not null and generation is not null and generation>0))
);
create index creator_growth_consents_expiry on private.creator_growth_consents(workspace_id,creator_id,expires_at);
create index creator_growth_consents_creator_fk on private.creator_growth_consents(creator_id,workspace_id);
create index creator_growth_consents_connection_fk on private.creator_growth_consents(connection_id,workspace_id,creator_id,generation);

create table private.creator_growth_analyses (
  id uuid primary key,
  workspace_id uuid not null,
  creator_id uuid not null,
  thread_id uuid not null,
  media_source_id uuid,
  asset_id uuid not null,
  consent_id uuid,
  connection_id uuid,
  generation integer,
  source_asset_ref text not null check(length(source_asset_ref) between 1 and 128),
  asset_sha256 text not null check(asset_sha256 ~ '^[a-f0-9]{64}$'),
  asset_source_kind text not null check(asset_source_kind in ('creator-upload','synthetic-fixture')),
  fixture_id text,
  processor text not null check(length(processor) between 1 and 120),
  processor_version text not null check(length(processor_version) between 1 and 120),
  observation jsonb not null check(jsonb_typeof(observation)='object'),
  binding jsonb not null check(jsonb_typeof(binding)='object'),
  invalidated_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique(id,workspace_id,creator_id),
  unique(id,thread_id,workspace_id,creator_id),
  unique(id,asset_id,thread_id,workspace_id,creator_id),
  foreign key(creator_id,workspace_id) references public.creators(id,workspace_id) on delete cascade,
  foreign key(thread_id,workspace_id,creator_id) references public.studio_threads(id,workspace_id,creator_id) on delete cascade,
  foreign key(media_source_id,thread_id,workspace_id,creator_id) references private.creator_growth_media_sources(id,thread_id,workspace_id,creator_id) on delete cascade,
  foreign key(asset_id,thread_id,workspace_id,creator_id) references private.creator_growth_assets(id,thread_id,workspace_id,creator_id) on delete cascade,
  foreign key(consent_id,workspace_id,creator_id) references private.creator_growth_consents(id,workspace_id,creator_id) on delete set null (consent_id),
  foreign key(connection_id,workspace_id,creator_id) references public.integration_connections(id,workspace_id,creator_id) on delete set null (connection_id),
  check(connection_id is null or (generation is not null and generation>0))
);
create index creator_growth_analyses_owner on private.creator_growth_analyses(workspace_id,creator_id,created_at desc);
create index creator_growth_analyses_creator_fk on private.creator_growth_analyses(creator_id,workspace_id);
create index creator_growth_analyses_media_fk on private.creator_growth_analyses(media_source_id,thread_id,workspace_id,creator_id);
create index creator_growth_analyses_asset_fk on private.creator_growth_analyses(asset_id,thread_id,workspace_id,creator_id);
create index creator_growth_analyses_consent_fk on private.creator_growth_analyses(consent_id,workspace_id,creator_id);
create index creator_growth_analyses_connection_fk on private.creator_growth_analyses(connection_id,workspace_id,creator_id,generation);
create index creator_growth_analyses_thread_fk on private.creator_growth_analyses(thread_id,workspace_id,creator_id);

create table private.creator_growth_skill_invocations (
  id uuid primary key,
  workspace_id uuid not null,
  creator_id uuid not null,
  thread_id uuid not null,
  analysis_id uuid not null,
  skill_id text not null check(skill_id in ('image_diagnosis','post_review','next_caption','next_growth_step')),
  report jsonb not null check(jsonb_typeof(report)='object'),
  proposal text not null check(length(proposal) between 1 and 6000),
  source_refs jsonb not null check(jsonb_typeof(source_refs)='array' and jsonb_array_length(source_refs)<=12),
  limitations jsonb not null check(jsonb_typeof(limitations)='array' and jsonb_array_length(limitations)<=12),
  sample_only boolean not null,
  invalidated_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique(id,workspace_id,creator_id),
  unique(id,thread_id,workspace_id,creator_id),
  unique(id,analysis_id,thread_id,workspace_id,creator_id),
  foreign key(creator_id,workspace_id) references public.creators(id,workspace_id) on delete cascade,
  foreign key(thread_id,workspace_id,creator_id) references public.studio_threads(id,workspace_id,creator_id) on delete cascade,
  foreign key(analysis_id,thread_id,workspace_id,creator_id) references private.creator_growth_analyses(id,thread_id,workspace_id,creator_id) on delete cascade
);
create index creator_growth_skills_owner on private.creator_growth_skill_invocations(workspace_id,creator_id,created_at desc);
create index creator_growth_skills_creator_fk on private.creator_growth_skill_invocations(creator_id,workspace_id);
create index creator_growth_skills_analysis_fk on private.creator_growth_skill_invocations(analysis_id,thread_id,workspace_id,creator_id);
create index creator_growth_skills_thread_fk on private.creator_growth_skill_invocations(thread_id,workspace_id,creator_id);

create table private.creator_growth_skill_sources (
  skill_id uuid not null,
  media_source_id uuid not null,
  workspace_id uuid not null,
  creator_id uuid not null,
  thread_id uuid not null,
  primary key(skill_id,media_source_id),
  foreign key(skill_id,thread_id,workspace_id,creator_id)
    references private.creator_growth_skill_invocations(id,thread_id,workspace_id,creator_id)
    on delete cascade,
  foreign key(media_source_id,thread_id,workspace_id,creator_id)
    references private.creator_growth_media_sources(id,thread_id,workspace_id,creator_id)
    on delete cascade
);
create index creator_growth_skill_sources_skill_fk
  on private.creator_growth_skill_sources(skill_id,thread_id,workspace_id,creator_id);
create index creator_growth_skill_sources_media_fk
  on private.creator_growth_skill_sources(media_source_id,thread_id,workspace_id,creator_id);
create index creator_growth_skill_sources_owner_media
  on private.creator_growth_skill_sources(workspace_id,creator_id,media_source_id,skill_id);

create table private.creator_growth_drafts (
  id uuid primary key,
  workspace_id uuid not null,
  creator_id uuid not null,
  thread_id uuid not null,
  asset_id uuid,
  analysis_id uuid,
  skill_invocation_id uuid,
  revision integer not null check(revision>0),
  caption text not null check(length(caption)<=4000),
  manual_description text not null check(length(manual_description)<=2000),
  status text not null check(status in ('private','completed','cancelled','invalidated')),
  terminal_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(id,workspace_id,creator_id),
  unique(id,thread_id,workspace_id,creator_id),
  foreign key(creator_id,workspace_id) references public.creators(id,workspace_id) on delete cascade,
  foreign key(thread_id,workspace_id,creator_id) references public.studio_threads(id,workspace_id,creator_id) on delete cascade,
  foreign key(asset_id,thread_id,workspace_id,creator_id) references private.creator_growth_assets(id,thread_id,workspace_id,creator_id) on delete cascade,
  foreign key(analysis_id,asset_id,thread_id,workspace_id,creator_id) references private.creator_growth_analyses(id,asset_id,thread_id,workspace_id,creator_id) on delete cascade,
  foreign key(skill_invocation_id,analysis_id,thread_id,workspace_id,creator_id) references private.creator_growth_skill_invocations(id,analysis_id,thread_id,workspace_id,creator_id) on delete cascade,
  check(analysis_id is null or asset_id is not null),
  check(skill_invocation_id is null or analysis_id is not null),
  check((status in ('completed','cancelled','invalidated') and terminal_at is not null) or (status='private' and terminal_at is null)),
  check((status='invalidated' and invalidated_at is not null and caption='' and manual_description='') or status<>'invalidated')
);
create index creator_growth_drafts_owner_revision on private.creator_growth_drafts(workspace_id,creator_id,id,revision);
create index creator_growth_drafts_creator_fk on private.creator_growth_drafts(creator_id,workspace_id);
create index creator_growth_drafts_retention on private.creator_growth_drafts(workspace_id,creator_id,status,terminal_at);
create index creator_growth_drafts_asset_fk on private.creator_growth_drafts(asset_id,thread_id,workspace_id,creator_id);
create index creator_growth_drafts_analysis_fk on private.creator_growth_drafts(analysis_id,asset_id,thread_id,workspace_id,creator_id);
create index creator_growth_drafts_skill_fk on private.creator_growth_drafts(skill_invocation_id,analysis_id,thread_id,workspace_id,creator_id);
create index creator_growth_drafts_thread_fk on private.creator_growth_drafts(thread_id,workspace_id,creator_id);

create table private.creator_growth_events (
  id uuid primary key,
  workspace_id uuid not null,
  creator_id uuid not null,
  event_code text not null check(event_code in ('asset_created','asset_confirmed','analysis_saved','skill_saved','draft_saved','draft_completed','draft_cancelled','generation_revoked','retention','owner_purge','storage_cleanup_completed','storage_cleanup_failed')),
  entity_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  foreign key(creator_id,workspace_id) references public.creators(id,workspace_id) on delete cascade
);
create index creator_growth_events_expiry on private.creator_growth_events(workspace_id,creator_id,created_at);
create index creator_growth_events_creator_fk on private.creator_growth_events(creator_id,workspace_id);

create table private.creator_growth_storage_cleanup (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null default 'creator-growth-private' check(bucket_id='creator-growth-private'),
  object_path text not null check(
    object_path !~ '\.\.'
    and object_path ~ ('^'||workspace_id::text||'/'||creator_id::text||'/[0-9a-f-]+/[0-9a-f-]+\.(jpg|png|webp)$')
  ),
  workspace_id uuid not null,
  creator_id uuid not null,
  asset_id uuid,
  reason text not null check(reason in ('retention','owner_purge','upload_abandoned')),
  state text not null default 'queued' check(state in ('queued','processing','completed','exhausted')),
  available_at timestamptz not null default clock_timestamp(),
  attempts smallint not null default 0 check(attempts>=0),
  max_attempts smallint not null default 5 check(max_attempts between 1 and 10),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique(bucket_id,object_path)
);
create index creator_growth_cleanup_owner on private.creator_growth_storage_cleanup(workspace_id,creator_id,state,available_at,id);

create table private.creator_growth_commands (
  workspace_id uuid not null,
  creator_id uuid not null,
  request_id uuid not null,
  action text not null,
  payload_hash text not null check(payload_hash ~ '^[a-f0-9]{32}$'),
  entity_id uuid,
  result_hint jsonb not null default '{}'::jsonb check(jsonb_typeof(result_hint)='object' and octet_length(result_hint::text)<=512),
  expires_at timestamptz not null default clock_timestamp()+interval '90 days',
  created_at timestamptz not null default clock_timestamp(),
  primary key(workspace_id,creator_id,request_id),
  foreign key(creator_id,workspace_id) references public.creators(id,workspace_id) on delete cascade
);
create index creator_growth_commands_creator_fk on private.creator_growth_commands(creator_id,workspace_id);
create index creator_growth_commands_expiry on private.creator_growth_commands(workspace_id,creator_id,expires_at);

-- Private preparation for the complete HTTP command. The existing mutation
-- ledger stays content-free; prepared state is never included in owner DTOs.
create table private.creator_growth_route_commands (
  workspace_id uuid not null,
  creator_id uuid not null,
  request_id uuid not null,
  thread_id uuid not null,
  operation text not null check(operation in ('analyse','skills','media/select')),
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  binding jsonb not null check(jsonb_typeof(binding)='object' and octet_length(binding::text)<=4096),
  plan jsonb check(plan is null or (jsonb_typeof(plan)='object' and octet_length(plan::text)<=262144)),
  started_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '90 days',
  invalidated_at timestamptz,
  primary key(workspace_id,creator_id,request_id),
  foreign key(thread_id,workspace_id,creator_id) references public.studio_threads(id,workspace_id,creator_id) on delete cascade
);
create index creator_growth_route_commands_thread on private.creator_growth_route_commands(thread_id,workspace_id,creator_id);
create index creator_growth_route_commands_expiry on private.creator_growth_route_commands(workspace_id,creator_id,expires_at);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'creator_growth_assets','creator_growth_media_sources','creator_growth_consents',
    'creator_growth_analyses','creator_growth_skill_invocations','creator_growth_skill_sources',
    'creator_growth_drafts',
    'creator_growth_events','creator_growth_storage_cleanup','creator_growth_commands','creator_growth_route_commands'
  ] loop
    execute format('alter table private.%I enable row level security',table_name);
    execute format('revoke all on table private.%I from public,anon,authenticated,service_role',table_name);
  end loop;
end $$;

create function private.creator_growth_asset_json(a private.creator_growth_assets)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'id',a.id,'threadId',a.thread_id,'storagePath',a.storage_path,'sha256',a.sha256,
    'mime',a.mime,'byteSize',a.byte_size,'width',a.width,'height',a.height,
    'rightsConfirmed',a.rights_confirmed,'sourceKind',a.source_kind,'sampleOnly',a.sample_only,
    'fixtureId',a.fixture_id,'uploadState',a.upload_state,'createdAt',a.created_at,'expiresAt',a.expires_at
  )
$$;
create function private.creator_growth_source_json(s private.creator_growth_media_sources)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'id',s.id,'threadId',s.thread_id,'assetId',s.asset_id,'connectionId',s.connection_id,
    'generation',s.generation,'sourceKind',s.source_kind,'sourceRef',s.source_ref,
    'subject',s.subject,'mediaId',s.media_id,'permalink',s.permalink,'rights',s.rights,
    'visibility',s.visibility,'matchStatus',s.match_status,'sampleOnly',s.sample_only,
    'observedAt',s.observed_at,'fetchedAt',s.fetched_at,'createdAt',s.created_at,
    'invalidatedAt',s.invalidated_at,'revokedAt',s.revoked_at
  )
$$;
create function private.creator_growth_consent_json(c private.creator_growth_consents)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'id',c.id,'processor',c.processor,'consentVersion',c.consent_version,
    'grantedAt',c.granted_at,'expiresAt',c.expires_at,'connectionId',c.connection_id,
    'generation',c.generation,'revokedAt',c.revoked_at
  )
$$;
create function private.creator_growth_analysis_json(a private.creator_growth_analyses)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'id',a.id,'threadId',a.thread_id,'mediaSourceId',a.media_source_id,'assetId',a.asset_id,
    'consentId',a.consent_id,'connectionId',a.connection_id,'generation',a.generation,
    'processor',a.processor,'processorVersion',a.processor_version,
    'result',jsonb_build_object('observation',a.observation,'binding',a.binding),
    'createdAt',a.created_at,'invalidatedAt',a.invalidated_at
  )
$$;
create function private.creator_growth_skill_json(s private.creator_growth_skill_invocations)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object(
    'id',s.id,'threadId',s.thread_id,'analysisId',s.analysis_id,
    'mediaSourceIds',coalesce((
      select jsonb_agg(ss.media_source_id order by ss.media_source_id)
      from private.creator_growth_skill_sources ss
      where ss.skill_id=s.id and ss.workspace_id=s.workspace_id and ss.creator_id=s.creator_id
    ),'[]'),'skillId',s.skill_id,
    'report',s.report,'result',jsonb_build_object(
      'proposal',s.proposal,'sourceRefs',s.source_refs,'limitations',s.limitations,
      'sampleOnly',s.sample_only
    ),'createdAt',s.created_at,'invalidatedAt',s.invalidated_at
  )
$$;
create function private.creator_growth_draft_json(d private.creator_growth_drafts)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'id',d.id,'threadId',d.thread_id,'assetId',d.asset_id,'analysisId',d.analysis_id,
    'skillInvocationId',d.skill_invocation_id,'revision',d.revision,'caption',d.caption,
    'manualDescription',d.manual_description,'status',d.status,'terminalAt',d.terminal_at,
    'invalidatedAt',d.invalidated_at,'createdAt',d.created_at,'updatedAt',d.updated_at
  )
$$;
create function private.creator_growth_event_json(e private.creator_growth_events)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'id',e.id,'workspaceId',e.workspace_id,'creatorId',e.creator_id,
    'code',e.event_code,'entityId',e.entity_id,'createdAt',e.created_at
  )
$$;
create function private.creator_growth_cleanup_json(c private.creator_growth_storage_cleanup)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'id',c.id,'bucket',c.bucket_id,'objectPath',c.object_path,'reason',c.reason,
    'state',c.state,'availableAt',c.available_at,'completedAt',c.completed_at,
    'attempts',c.attempts,'leaseToken',c.lease_token,'leaseExpiresAt',c.lease_expires_at,
    'lastError',c.last_error
  )
$$;

create function private.creator_growth_assert_owner(p_workspace uuid,p_creator uuid)
returns void language plpgsql set search_path='' as $$
begin
  if p_workspace is null or p_creator is null then raise exception 'INVALID_OWNER'; end if;
  perform 1 from public.workspaces where id=p_workspace for key share;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform 1 from public.creators
    where id=p_creator and workspace_id=p_workspace and status='active'
    for update;
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

create function private.creator_growth_assert_non_deleted(p_workspace uuid,p_creator uuid)
returns void language plpgsql set search_path='' as $$
begin
  if p_workspace is null or p_creator is null then raise exception 'INVALID_OWNER'; end if;
  perform 1 from public.workspaces where id=p_workspace for key share;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform 1 from public.creators
    where id=p_creator and workspace_id=p_workspace and status in ('active','suspended')
    for update;
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

create function private.creator_growth_queue_cleanup(
  p_workspace uuid,
  p_creator uuid,
  p_asset private.creator_growth_assets,
  p_reason text,
  p_available_at timestamptz
) returns boolean language plpgsql set search_path='' as $$
declare inserted boolean:=false;
begin
  insert into private.creator_growth_storage_cleanup(
    bucket_id,object_path,workspace_id,creator_id,asset_id,reason,state,available_at
  ) values(
    'creator-growth-private',p_asset.storage_path,p_workspace,p_creator,p_asset.id,p_reason,'queued',p_available_at
  ) on conflict(bucket_id,object_path) do nothing returning true into inserted;
  return coalesce(inserted,false);
end $$;

create function private.creator_growth_queue_deleted_asset()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform private.creator_growth_queue_cleanup(
    old.workspace_id,
    old.creator_id,
    old,
    'owner_purge',
    case when old.upload_state='pending'
      then greatest(clock_timestamp(),old.expires_at)
      else clock_timestamp()
    end
  );
  return old;
end $$;
create trigger creator_growth_asset_delete_cleanup
before delete on private.creator_growth_assets
for each row execute function private.creator_growth_queue_deleted_asset();

create function private.creator_growth_purge_private(p_workspace uuid,p_creator uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  owner_row public.creators;
  asset private.creator_growth_assets;
  inserted boolean;
  count_value integer;
  cleanup_queued integer:=0;
  metadata_deleted integer:=0;
  now_value timestamptz:=clock_timestamp();
begin
  select * into owner_row from public.creators
    where id=p_creator and workspace_id=p_workspace for update;
  if not found or owner_row.status='deleted' then raise exception 'NOT_FOUND'; end if;
  for asset in select * from private.creator_growth_assets
    where workspace_id=p_workspace and creator_id=p_creator for update
  loop
    inserted:=private.creator_growth_queue_cleanup(
      p_workspace,p_creator,asset,'owner_purge',
      case when asset.upload_state='pending' then greatest(now_value,asset.expires_at) else now_value end
    );
    if inserted then cleanup_queued:=cleanup_queued+1; end if;
  end loop;

  delete from private.creator_growth_route_commands where workspace_id=p_workspace and creator_id=p_creator;
  get diagnostics count_value=row_count; metadata_deleted:=metadata_deleted+count_value;
  delete from private.creator_growth_drafts where workspace_id=p_workspace and creator_id=p_creator;
  get diagnostics count_value=row_count; metadata_deleted:=metadata_deleted+count_value;
  delete from private.creator_growth_skill_invocations where workspace_id=p_workspace and creator_id=p_creator;
  get diagnostics count_value=row_count; metadata_deleted:=metadata_deleted+count_value;
  delete from private.creator_growth_analyses where workspace_id=p_workspace and creator_id=p_creator;
  get diagnostics count_value=row_count; metadata_deleted:=metadata_deleted+count_value;
  delete from private.creator_growth_media_sources where workspace_id=p_workspace and creator_id=p_creator;
  get diagnostics count_value=row_count; metadata_deleted:=metadata_deleted+count_value;
  delete from private.creator_growth_consents where workspace_id=p_workspace and creator_id=p_creator;
  get diagnostics count_value=row_count; metadata_deleted:=metadata_deleted+count_value;
  delete from private.creator_growth_assets where workspace_id=p_workspace and creator_id=p_creator;
  get diagnostics count_value=row_count; metadata_deleted:=metadata_deleted+count_value;
  delete from private.creator_growth_events where workspace_id=p_workspace and creator_id=p_creator;
  get diagnostics count_value=row_count; metadata_deleted:=metadata_deleted+count_value;
  delete from private.creator_growth_commands where workspace_id=p_workspace and creator_id=p_creator;
  get diagnostics count_value=row_count; metadata_deleted:=metadata_deleted+count_value;

  return jsonb_build_object(
    'state','pending_physical_cleanup',
    'cleanupQueued',cleanup_queued,
    'metadataRowsDeleted',metadata_deleted
  );
end $$;

create function private.creator_growth_invalidate_generation(
  p_workspace uuid,
  p_creator uuid,
  p_connection uuid,
  p_generation integer,
  p_revoked_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  changed_at timestamptz:=coalesce(p_revoked_at,clock_timestamp());
  media_ids uuid[]:='{}';
  consent_ids uuid[]:='{}';
  analysis_ids uuid[]:='{}';
  skill_ids uuid[]:='{}';
  draft_ids uuid[]:='{}';
  affected_ids uuid[]:='{}';
  source_count integer:=0;
  consent_count integer:=0;
  analysis_count integer:=0;
  skill_count integer:=0;
  draft_count integer:=0;
begin
  perform 1 from public.creators
    where id=p_creator and workspace_id=p_workspace for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  select coalesce(array_agg(id),'{}'),count(*)::integer into media_ids,source_count
  from private.creator_growth_media_sources
  where workspace_id=p_workspace and creator_id=p_creator
    and connection_id=p_connection and generation=p_generation
    and invalidated_at is null;
  update private.creator_growth_media_sources
    set invalidated_at=changed_at,revoked_at=coalesce(revoked_at,changed_at)
    where id=any(media_ids);

  select coalesce(array_agg(id),'{}'),count(*)::integer into consent_ids,consent_count
  from private.creator_growth_consents
  where workspace_id=p_workspace and creator_id=p_creator
    and connection_id=p_connection and generation=p_generation
    and revoked_at is null;
  update private.creator_growth_consents set revoked_at=changed_at where id=any(consent_ids);

  select coalesce(array_agg(id),'{}'),count(*)::integer into analysis_ids,analysis_count
  from private.creator_growth_analyses
  where workspace_id=p_workspace and creator_id=p_creator
    and invalidated_at is null
    and (
      (connection_id=p_connection and generation=p_generation)
      or media_source_id=any(media_ids)
      or consent_id=any(consent_ids)
    );
  update private.creator_growth_analyses set invalidated_at=changed_at where id=any(analysis_ids);

  select coalesce(array_agg(id),'{}'),count(*)::integer into skill_ids,skill_count
  from private.creator_growth_skill_invocations s
  where s.workspace_id=p_workspace and s.creator_id=p_creator
    and s.invalidated_at is null
    and (
      s.analysis_id=any(analysis_ids)
      or exists(
        select 1 from private.creator_growth_skill_sources ss
        where ss.skill_id=s.id
          and ss.workspace_id=p_workspace and ss.creator_id=p_creator
          and ss.media_source_id=any(media_ids)
      )
    );
  update private.creator_growth_skill_invocations set invalidated_at=changed_at where id=any(skill_ids);

  select coalesce(array_agg(id),'{}'),count(*)::integer into draft_ids,draft_count
  from private.creator_growth_drafts
  where workspace_id=p_workspace and creator_id=p_creator
    and invalidated_at is null
    and (analysis_id=any(analysis_ids) or skill_invocation_id=any(skill_ids));
  update private.creator_growth_drafts set
    caption='',manual_description='',status='invalidated',terminal_at=changed_at,
    invalidated_at=changed_at,revision=revision+1,updated_at=changed_at
    where id=any(draft_ids);

  affected_ids:=media_ids||consent_ids||analysis_ids||skill_ids||draft_ids;
  update private.creator_growth_route_commands command set plan=null,invalidated_at=changed_at
    where command.workspace_id=p_workspace and command.creator_id=p_creator and (
      (command.binding->>'connectionId'=p_connection::text and (command.binding->>'generation')::integer=p_generation)
      or exists(select 1 from unnest(media_ids) source_id where command.binding->'mediaSourceIds' ? source_id::text)
      or command.binding->>'analysisId'=any(select id::text from unnest(analysis_ids) id)
    );
  delete from private.creator_growth_commands
    where workspace_id=p_workspace and creator_id=p_creator and entity_id=any(affected_ids);
  insert into private.creator_growth_events(id,workspace_id,creator_id,event_code,entity_id,created_at)
    values(gen_random_uuid(),p_workspace,p_creator,'generation_revoked',p_connection,changed_at);

  return jsonb_build_object(
    'mediaSources',source_count,'consents',consent_count,
    'analyses',analysis_count,'skillInvocations',skill_count,'drafts',draft_count
  );
end $$;

create function private.creator_growth_integration_revocation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='revoked' and old.status<>'revoked' and new.generation=old.generation+1 then
    perform private.creator_growth_invalidate_generation(
      new.workspace_id,
      new.creator_id,
      new.id,
      old.generation,
      coalesce(new.revoked_at,clock_timestamp())
    );
  end if;
  return new;
end $$;
create trigger creator_growth_integration_revocation
after update of generation,status on public.integration_connections
for each row execute function private.creator_growth_integration_revocation();

create function private.creator_growth_account_cleanup()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='deleted' and old.status<>'deleted' then
    perform private.creator_growth_purge_private(new.workspace_id,new.id);
  end if;
  return new;
end $$;
create trigger creator_growth_account_cleanup
before update of status on public.creators
for each row execute function private.creator_growth_account_cleanup();

create function private.creator_growth_replay(
  p_workspace uuid,
  p_creator uuid,
  p_action text,
  p_entity uuid,
  p_result_hint jsonb
) returns jsonb language plpgsql set search_path='' as $$
declare
  asset private.creator_growth_assets;
  source private.creator_growth_media_sources;
  consent private.creator_growth_consents;
  analysis private.creator_growth_analyses;
  skill private.creator_growth_skill_invocations;
  draft private.creator_growth_drafts;
  growth_event private.creator_growth_events;
begin
  if p_action in ('reserve_asset','confirm_asset') then
    select * into asset from private.creator_growth_assets
      where id=p_entity and workspace_id=p_workspace and creator_id=p_creator;
    if not found then raise exception 'NOT_FOUND'; end if;
    return jsonb_build_object('asset',private.creator_growth_asset_json(asset));
  elsif p_action='abandon_asset' then
    return '{"state":"queued"}';
  elsif p_action='save_media_source' then
    select * into source from private.creator_growth_media_sources
      where id=p_entity and workspace_id=p_workspace and creator_id=p_creator;
    if not found then raise exception 'NOT_FOUND'; end if;
    if source.invalidated_at is not null or source.revoked_at is not null then raise exception 'SOURCE_INVALIDATED'; end if;
    return private.creator_growth_source_json(source);
  elsif p_action='save_consent' then
    select * into consent from private.creator_growth_consents
      where id=p_entity and workspace_id=p_workspace and creator_id=p_creator;
    if not found or consent.revoked_at is not null or consent.expires_at<=clock_timestamp() then raise exception 'SOURCE_INVALIDATED'; end if;
    return private.creator_growth_consent_json(consent);
  elsif p_action='save_analysis' then
    select * into analysis from private.creator_growth_analyses
      where id=p_entity and workspace_id=p_workspace and creator_id=p_creator;
    if not found or analysis.invalidated_at is not null then raise exception 'SOURCE_INVALIDATED'; end if;
    return private.creator_growth_analysis_json(analysis);
  elsif p_action='save_skill_invocation' then
    select * into skill from private.creator_growth_skill_invocations
      where id=p_entity and workspace_id=p_workspace and creator_id=p_creator;
    if not found or skill.invalidated_at is not null then raise exception 'SOURCE_INVALIDATED'; end if;
    return private.creator_growth_skill_json(skill);
  elsif p_action in ('save_draft','set_draft_status') then
    select * into draft from private.creator_growth_drafts
      where id=p_entity and workspace_id=p_workspace and creator_id=p_creator;
    if not found or draft.status='invalidated' or draft.invalidated_at is not null then raise exception 'SOURCE_INVALIDATED'; end if;
    return private.creator_growth_draft_json(draft);
  elsif p_action='record_event' then
    select * into growth_event from private.creator_growth_events
      where id=p_entity and workspace_id=p_workspace and creator_id=p_creator;
    if not found then raise exception 'NOT_FOUND'; end if;
    return private.creator_growth_event_json(growth_event);
  elsif p_action in ('apply_retention','purge_owner','process_storage_cleanup') then
    return p_result_hint;
  end if;
  raise exception 'INVALID_INPUT';
end $$;

create function private.creator_growth_report_has_citation(
  p_report jsonb,
  p_source_kind text,
  p_source_ref text
) returns boolean language sql immutable set search_path='' as $$
  select exists(
    select 1 from jsonb_array_elements(p_report->'citations') citation_item
    where citation_item->>'sourceKind'=p_source_kind
      and citation_item->>'sourceRef'=p_source_ref
  )
$$;

create function private.creator_growth_validate_skill_report(
  p_workspace uuid,
  p_creator uuid,
  p_thread uuid,
  p_analysis uuid,
  p_asset uuid,
  p_invocation jsonb
) returns uuid[] language plpgsql set search_path='' as $$
declare
  report jsonb:=p_invocation->'report';
  skill_result jsonb:=p_invocation->'result';
  source_ids uuid[]:='{}';
  asset_row private.creator_growth_assets;
  analysis_row private.creator_growth_analyses;
  skill_source private.creator_growth_media_sources;
  source_item jsonb;
  citation jsonb;
  provenance jsonb;
  public_provenance jsonb;
  self_provenance jsonb;
  claim_ref text;
  claim_kind text;
  self_ref text;
  claimed_id uuid;
  claim_source private.creator_growth_media_sources;
  claimed_source_ids uuid[]:='{}';
  canonical_sample boolean;
  expected_observation jsonb;
begin
  if jsonb_typeof(report) is distinct from 'object'
    or jsonb_typeof(skill_result) is distinct from 'object'
    or jsonb_typeof(p_invocation->'mediaSourceIds') is distinct from 'array'
    or jsonb_array_length(p_invocation->'mediaSourceIds')>12
    or jsonb_typeof(report->'citations') is distinct from 'array'
    or jsonb_array_length(report->'citations')>12
    or jsonb_typeof(report->'provenance'->'officialMetrics') is distinct from 'array'
    or jsonb_array_length(report->'provenance'->'officialMetrics')>12
    or jsonb_typeof(report->'metrics') is distinct from 'array'
    or jsonb_typeof(report->'period'->'metrics') is distinct from 'array'
    or jsonb_typeof(skill_result->'sourceRefs') is distinct from 'array'
    or jsonb_array_length(skill_result->'sourceRefs')>12 then
      raise exception 'INVALID_INPUT';
  end if;
  if jsonb_typeof(report->'observation') is distinct from 'object'
    or jsonb_typeof(report->'sampleOnly') is distinct from 'boolean'
    or jsonb_typeof(skill_result->'sampleOnly') is distinct from 'boolean'
    or jsonb_typeof(report->'observation'->'assetId') is distinct from 'string'
    or jsonb_typeof(report->'observation'->'sha256') is distinct from 'string'
    or jsonb_typeof(report->'observation'->'sourceKind') is distinct from 'string'
    or jsonb_typeof(report->'observation'->'sampleOnly') is distinct from 'boolean'
    or jsonb_typeof(report->'observation'->'availability') is distinct from 'string'
    or jsonb_typeof(report->'observation'->'captionAlignment') is distinct from 'string'
    or jsonb_typeof(report->'observation'->'objects') is distinct from 'array'
    or jsonb_typeof(report->'observation'->'visibleText') is distinct from 'array'
    or jsonb_typeof(report->'observation'->'composition') is distinct from 'array'
    or jsonb_typeof(report->'observation'->'uncertainties') is distinct from 'array'
    or (
      jsonb_typeof(report->'observation'->'reason') is distinct from 'null'
      and jsonb_typeof(report->'observation'->'reason') is distinct from 'string'
    ) then
      raise exception 'INVALID_INPUT';
  end if;
  provenance:=report->'provenance';
  if exists(
    select 1 from jsonb_array_elements(p_invocation->'mediaSourceIds') value
    where jsonb_typeof(value)<>'string'
      or (value#>>'{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then raise exception 'INVALID_INPUT'; end if;
  select coalesce(array_agg((value#>>'{}')::uuid),'{}')
    into source_ids
  from jsonb_array_elements(p_invocation->'mediaSourceIds') value;
  if cardinality(source_ids)<>
    (select count(distinct value)::integer from unnest(source_ids) value) then
      raise exception 'SOURCE_INVALIDATED';
  end if;

  select * into analysis_row from private.creator_growth_analyses
    where id=p_analysis and workspace_id=p_workspace and creator_id=p_creator;
  select * into asset_row from private.creator_growth_assets
    where id=p_asset and thread_id=p_thread
      and workspace_id=p_workspace and creator_id=p_creator;
  if not found or analysis_row.id is null or analysis_row.asset_id<>p_asset
    or analysis_row.thread_id<>p_thread or analysis_row.invalidated_at is not null then
      raise exception 'SOURCE_INVALIDATED';
  end if;
  expected_observation:=analysis_row.observation||jsonb_build_object(
    'reason',coalesce(analysis_row.observation->'reason','null'::jsonb),
    'sourceKind',asset_row.source_kind,
    'assetId',p_asset,
    'sha256',asset_row.sha256
  );
  if report->'observation' is distinct from expected_observation then
    raise exception 'SOURCE_INVALIDATED';
  end if;
  if report->'observation'->>'assetId' is distinct from p_asset::text
    or report->'observation'->>'sha256' is distinct from asset_row.sha256
    or report->'observation'->>'sourceKind' is distinct from asset_row.source_kind
    or (report->'observation'->>'sampleOnly')::boolean is distinct from asset_row.sample_only then
      raise exception 'SOURCE_INVALIDATED';
  end if;

  for skill_source in
    select * from private.creator_growth_media_sources source
    where source.id=any(source_ids)
      and source.workspace_id=p_workspace and source.creator_id=p_creator
    loop
    if skill_source.thread_id<>p_thread
      or skill_source.invalidated_at is not null
      or skill_source.revoked_at is not null
      or skill_source.rights<>'allowed' then
        raise exception 'SOURCE_INVALIDATED';
    end if;
    if skill_source.asset_id is not null and skill_source.asset_id<>p_asset then
      raise exception 'SOURCE_INVALIDATED';
    end if;
    if skill_source.source_kind in ('official_instagram','public_image_mock')
      and (skill_source.visibility<>'public' or skill_source.match_status<>'matched') then
        raise exception 'SOURCE_INVALIDATED';
    end if;
    if skill_source.source_kind='official_instagram' and not exists(
      select 1 from public.integration_connections connection
      where connection.id=skill_source.connection_id
        and connection.workspace_id=p_workspace and connection.creator_id=p_creator
        and connection.generation=skill_source.generation
        and connection.status in ('connected','partial')
    ) then raise exception 'SOURCE_INVALIDATED'; end if;
  end loop;
  if (select count(*) from private.creator_growth_media_sources source
    where source.id=any(source_ids)
      and source.workspace_id=p_workspace and source.creator_id=p_creator)
    <>cardinality(source_ids) then raise exception 'SOURCE_INVALIDATED'; end if;
  if (
    select count(distinct (source.source_kind,source.source_ref))
    from private.creator_growth_media_sources source
    where source.id=any(source_ids)
      and source.workspace_id=p_workspace and source.creator_id=p_creator
  )<>cardinality(source_ids) then raise exception 'SOURCE_INVALIDATED'; end if;

  if exists(
    select 1 from jsonb_array_elements(report->'citations') citation_item
    group by citation_item->>'sourceKind',citation_item->>'sourceRef'
    having count(*)>1
  ) or exists(
    select 1 from jsonb_array_elements(provenance->'officialMetrics') value
    group by value->>'sourceRef' having count(*)>1
  ) or exists(
    select 1 from jsonb_array_elements(skill_result->'sourceRefs') value
    group by value#>>'{}' having count(*)>1
  ) then raise exception 'SOURCE_INVALIDATED'; end if;

  for citation in select value from jsonb_array_elements(report->'citations') citation_item loop
    claim_kind:=citation->>'sourceKind';
    claim_ref:=citation->>'sourceRef';
    if claim_kind='official_metrics' then
      select source.* into claim_source
      from private.creator_growth_media_sources source
      where source.id=any(source_ids) and source.source_kind='official_instagram'
        and source.source_ref=claim_ref and source.workspace_id=p_workspace and source.creator_id=p_creator;
      if not found then raise exception 'SOURCE_INVALIDATED'; end if;
      if jsonb_typeof(citation->'sampleOnly') is distinct from 'boolean'
        or (citation->>'sampleOnly')::boolean is distinct from claim_source.sample_only
        or (citation->>'observedAt')::timestamptz is distinct from claim_source.observed_at then
          raise exception 'SOURCE_INVALIDATED';
      end if;
      claimed_id:=claim_source.id;
      claimed_source_ids:=array_append(claimed_source_ids,claimed_id);
    elsif claim_kind='public_image_mock' then
      select source.* into claim_source
      from private.creator_growth_media_sources source
      where source.id=any(source_ids) and source.source_kind='public_image_mock'
        and source.source_ref=claim_ref and source.workspace_id=p_workspace and source.creator_id=p_creator;
      if not found then raise exception 'SOURCE_INVALIDATED'; end if;
      if jsonb_typeof(citation->'sampleOnly') is distinct from 'boolean'
        or (citation->>'sampleOnly')::boolean is distinct from claim_source.sample_only
        or (citation->>'observedAt')::timestamptz is distinct from claim_source.observed_at then
          raise exception 'SOURCE_INVALIDATED';
      end if;
      claimed_id:=claim_source.id;
      claimed_source_ids:=array_append(claimed_source_ids,claimed_id);
    elsif claim_kind='self_upload_manual' then
      self_ref:='asset:'||p_asset::text;
      if claim_ref<>self_ref then raise exception 'SOURCE_INVALIDATED'; end if;
    else
      raise exception 'SOURCE_INVALIDATED';
    end if;
  end loop;

  for source_item in select value from jsonb_array_elements(provenance->'officialMetrics') loop
    claim_ref:=source_item->>'sourceRef';
    if not exists(
      select 1 from private.creator_growth_media_sources source
      where source.id=any(source_ids) and source.source_kind='official_instagram'
        and source.source_ref=claim_ref and source.workspace_id=p_workspace and source.creator_id=p_creator
    ) or not private.creator_growth_report_has_citation(report,'official_metrics',claim_ref) then
      raise exception 'SOURCE_INVALIDATED';
    end if;
    select source.* into claim_source
    from private.creator_growth_media_sources source
    where source.id=any(source_ids) and source.source_kind='official_instagram'
      and source.source_ref=claim_ref and source.workspace_id=p_workspace and source.creator_id=p_creator;
    if jsonb_typeof(source_item->'sampleOnly') is distinct from 'boolean'
      or (source_item->>'sampleOnly')::boolean is distinct from claim_source.sample_only
      or (source_item->>'observedAt')::timestamptz is distinct from claim_source.observed_at then
        raise exception 'SOURCE_INVALIDATED';
    end if;
    claimed_id:=claim_source.id;
    claimed_source_ids:=array_append(claimed_source_ids,claimed_id);
  end loop;
  for source_item in select value from jsonb_array_elements(report->'metrics') loop
    claim_ref:=source_item->>'sourceRef';
    if (
      source_item->>'status'='available'
      or jsonb_typeof(source_item->'value') is distinct from 'null'
    ) and claim_ref is null then
      raise exception 'SOURCE_INVALIDATED';
    end if;
    if claim_ref is not null then
      if not exists(
        select 1 from private.creator_growth_media_sources source
        where source.id=any(source_ids) and source.source_kind='official_instagram'
          and source.source_ref=claim_ref and source.workspace_id=p_workspace and source.creator_id=p_creator
      ) or not private.creator_growth_report_has_citation(report,'official_metrics',claim_ref)
        or not exists(
          select 1 from jsonb_array_elements(provenance->'officialMetrics') provenance_item
          where provenance_item->>'sourceRef'=claim_ref
        ) then
        raise exception 'SOURCE_INVALIDATED';
      end if;
      select source.id into claimed_id
      from private.creator_growth_media_sources source
      where source.id=any(source_ids) and source.source_kind='official_instagram'
        and source.source_ref=claim_ref and source.workspace_id=p_workspace and source.creator_id=p_creator;
      claimed_source_ids:=array_append(claimed_source_ids,claimed_id);
    end if;
  end loop;
  for source_item in select value from jsonb_array_elements(report->'period'->'metrics') loop
    claim_ref:=source_item->>'sourceRef';
    if not exists(
      select 1 from private.creator_growth_media_sources source
      where source.id=any(source_ids) and source.source_kind='official_instagram'
        and source.source_ref=claim_ref and source.workspace_id=p_workspace and source.creator_id=p_creator
    ) or not private.creator_growth_report_has_citation(report,'official_metrics',claim_ref)
      or not exists(
        select 1 from jsonb_array_elements(provenance->'officialMetrics') provenance_item
        where provenance_item->>'sourceRef'=claim_ref
      ) then
      raise exception 'SOURCE_INVALIDATED';
    end if;
    select source.id into claimed_id
    from private.creator_growth_media_sources source
    where source.id=any(source_ids) and source.source_kind='official_instagram'
      and source.source_ref=claim_ref and source.workspace_id=p_workspace and source.creator_id=p_creator;
    claimed_source_ids:=array_append(claimed_source_ids,claimed_id);
  end loop;

  public_provenance:=provenance->'publicImageMock';
  if public_provenance is not null and jsonb_typeof(public_provenance)<>'null' then
    claim_ref:=public_provenance->>'sourceRef';
    select source.* into claim_source
    from private.creator_growth_media_sources source
    where source.id=any(source_ids) and source.source_kind='public_image_mock'
      and source.source_ref=claim_ref and source.workspace_id=p_workspace and source.creator_id=p_creator;
    if public_provenance->>'assetId'<>p_asset::text
      or public_provenance->>'sha256'<>asset_row.sha256
      or not found
      or jsonb_typeof(public_provenance->'sampleOnly') is distinct from 'boolean'
      or (public_provenance->>'sampleOnly')::boolean is distinct from claim_source.sample_only
      or (public_provenance->>'observedAt')::timestamptz is distinct from claim_source.observed_at
      or not private.creator_growth_report_has_citation(report,'public_image_mock',claim_ref) then
        raise exception 'SOURCE_INVALIDATED';
    end if;
    claimed_id:=claim_source.id;
    claimed_source_ids:=array_append(claimed_source_ids,claimed_id);
  end if;

  self_provenance:=provenance->'selfUploadManual';
  if self_provenance is not null and jsonb_typeof(self_provenance)<>'null' then
    self_ref:='asset:'||p_asset::text;
    if self_provenance->>'assetId'<>p_asset::text
      or self_provenance->>'sha256'<>asset_row.sha256
      or self_provenance->>'sourceKind'<>asset_row.source_kind
      or self_provenance->>'sourceRef'<>self_ref
      or not private.creator_growth_report_has_citation(report,'self_upload_manual',self_ref) then
        raise exception 'SOURCE_INVALIDATED';
    end if;
  end if;

  for source_item in select value from jsonb_array_elements(skill_result->'sourceRefs') loop
    if jsonb_typeof(source_item)<>'string' then raise exception 'INVALID_INPUT'; end if;
    claim_ref:=source_item#>>'{}';
    if claim_ref like 'native:%' or claim_ref like 'curated:%' then continue; end if;
    if not private.creator_growth_report_has_citation(report,'official_metrics',claim_ref)
      and not private.creator_growth_report_has_citation(report,'public_image_mock',claim_ref)
      and not private.creator_growth_report_has_citation(report,'self_upload_manual',claim_ref) then
        raise exception 'SOURCE_INVALIDATED';
    end if;
  end loop;

  select coalesce(array_agg(distinct value),'{}')
    into claimed_source_ids
  from unnest(claimed_source_ids) value;
  if cardinality(claimed_source_ids)<>cardinality(source_ids)
    or exists(select 1 from unnest(source_ids) value where value<>all(claimed_source_ids))
    or exists(select 1 from unnest(claimed_source_ids) value where value<>all(source_ids)) then
      raise exception 'SOURCE_INVALIDATED';
  end if;
  canonical_sample:=asset_row.sample_only or exists(
    select 1 from private.creator_growth_media_sources source
    where source.id=any(source_ids) and source.sample_only
  );
  if (report->>'sampleOnly')::boolean is distinct from canonical_sample
    or (skill_result->>'sampleOnly')::boolean is distinct from canonical_sample then
      raise exception 'SOURCE_INVALIDATED';
  end if;
  return source_ids;
end $$;

create function public.creator_growth_command(
  p_workspace uuid,
  p_creator uuid,
  p_request uuid,
  p_action text,
  p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  receipt private.creator_growth_commands;
  asset private.creator_growth_assets;
  source private.creator_growth_media_sources;
  lineage_source private.creator_growth_media_sources;
  consent private.creator_growth_consents;
  lineage_consent private.creator_growth_consents;
  analysis private.creator_growth_analyses;
  skill private.creator_growth_skill_invocations;
  draft private.creator_growth_drafts;
  existing_draft private.creator_growth_drafts;
  growth_event private.creator_growth_events;
  connection public.integration_connections;
  result jsonb;
  result_hint jsonb:='{}';
  digest text;
  entity_id uuid;
  asset_id uuid;
  source_id uuid;
  thread_id uuid;
  lineage_connection_id uuid;
  lineage_generation integer;
  changed_at timestamptz;
  expires_at timestamptz;
  now_value timestamptz;
  expected integer;
  count_value integer;
  inserted boolean;
  cleanup_queued integer:=0;
  assets_queued integer:=0;
  drafts_deleted integer:=0;
  events_deleted integer:=0;
  receipts_deleted integer:=0;
  skill_source_ids uuid[]:='{}';
begin
  if p_workspace is null or p_creator is null or p_request is null
    or p_action is null or jsonb_typeof(p_payload) is distinct from 'object'
    or octet_length(p_payload::text)>131072 then raise exception 'INVALID_INPUT'; end if;
  if p_action='purge_owner' then
    perform private.creator_growth_assert_non_deleted(p_workspace,p_creator);
  else
    perform private.creator_growth_assert_owner(p_workspace,p_creator);
  end if;
  digest:=md5(p_payload::text);
  if p_action not in ('get_asset','get_draft','list_cleanup','export_owner') then
    select * into receipt from private.creator_growth_commands
      where workspace_id=p_workspace and creator_id=p_creator and request_id=p_request
      for update;
    if found then
      if receipt.action<>p_action or receipt.payload_hash<>digest then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      if receipt.expires_at<=clock_timestamp() then raise exception 'IDEMPOTENCY_EXPIRED'; end if;
      return private.creator_growth_replay(
        p_workspace,p_creator,receipt.action,receipt.entity_id,receipt.result_hint
      );
    end if;
  end if;

  if p_action='reserve_asset' then
    asset_id:=(p_payload->>'id')::uuid;
    thread_id:=(p_payload->>'threadId')::uuid;
    if asset_id is null or thread_id is null
      or coalesce(p_payload->>'mime','') not in ('image/jpeg','image/png','image/webp')
      or coalesce(p_payload->>'sha256','') !~ '^[a-f0-9]{64}$'
      or coalesce((p_payload->>'byteSize')::integer,-1) not between 0 and 8388608
      or coalesce((p_payload->>'width')::integer,-1) not between 1 and 4096
      or coalesce((p_payload->>'height')::integer,-1) not between 1 and 4096
      or p_payload->'rightsConfirmed' is distinct from 'true'::jsonb
      or coalesce(p_payload->>'sourceKind','') not in ('creator-upload','synthetic-fixture')
      or jsonb_typeof(p_payload->'sampleOnly') is distinct from 'boolean' then raise exception 'INVALID_INPUT'; end if;
    if not exists(select 1 from public.studio_threads where id=thread_id and workspace_id=p_workspace and creator_id=p_creator) then raise exception 'NOT_FOUND'; end if;
    insert into private.creator_growth_assets(
      id,workspace_id,creator_id,thread_id,storage_path,sha256,mime,byte_size,width,height,
      rights_confirmed,source_kind,sample_only,fixture_id,expires_at
    ) values(
      asset_id,p_workspace,p_creator,thread_id,
      format('%s/%s/%s/%s.%s',p_workspace,p_creator,thread_id,asset_id,
        case p_payload->>'mime' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end),
      p_payload->>'sha256',p_payload->>'mime',
      (p_payload->>'byteSize')::integer,(p_payload->>'width')::integer,
      (p_payload->>'height')::integer,true,p_payload->>'sourceKind',
      (p_payload->>'sampleOnly')::boolean,p_payload->>'fixtureId',
      clock_timestamp()+interval '24 hours'
    ) returning * into asset;
    entity_id:=asset.id;
    result:=jsonb_build_object('asset',private.creator_growth_asset_json(asset));
  elsif p_action='confirm_asset' then
    asset_id:=(p_payload->>'assetId')::uuid;
    update private.creator_growth_assets set upload_state='uploaded',uploaded_at=clock_timestamp()
      where id=asset_id and workspace_id=p_workspace and creator_id=p_creator
      returning * into asset;
    if not found then raise exception 'NOT_FOUND'; end if;
    entity_id:=asset.id;
    result:=jsonb_build_object('asset',private.creator_growth_asset_json(asset));
  elsif p_action='abandon_asset' then
    select * into asset from private.creator_growth_assets
      where id=(p_payload->>'assetId')::uuid and workspace_id=p_workspace and creator_id=p_creator
      for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    perform private.creator_growth_queue_cleanup(
      p_workspace,p_creator,asset,'upload_abandoned',greatest(clock_timestamp(),asset.expires_at)
    );
    delete from private.creator_growth_assets where id=asset.id;
    entity_id:=asset.id;
    result:='{"state":"queued"}';
  elsif p_action='get_asset' then
    select * into asset from private.creator_growth_assets
      where id=(p_payload->>'assetId')::uuid and workspace_id=p_workspace and creator_id=p_creator;
    if not found then return '{"asset":null}'; end if;
    return jsonb_build_object('asset',private.creator_growth_asset_json(asset));
  elsif p_action='save_media_source' then
    source:=(jsonb_populate_record(null::private.creator_growth_media_sources,jsonb_build_object(
      'id',(p_payload->>'id')::uuid,'workspace_id',p_workspace,'creator_id',p_creator,
      'thread_id',(p_payload->>'threadId')::uuid,'asset_id',(p_payload->>'assetId')::uuid,
      'connection_id',(p_payload->>'connectionId')::uuid,'generation',(p_payload->>'generation')::integer,
      'source_kind',p_payload->>'sourceKind','source_ref',p_payload->>'sourceRef',
      'subject',p_payload->>'subject','media_id',p_payload->>'mediaId',
      'permalink',p_payload->>'permalink','rights',p_payload->>'rights',
      'visibility',p_payload->>'visibility','match_status',p_payload->>'matchStatus',
      'sample_only',(p_payload->>'sampleOnly')::boolean,
      'observed_at',(p_payload->>'observedAt')::timestamptz,
      'fetched_at',(p_payload->>'fetchedAt')::timestamptz
    )));
    if source.source_kind='official_instagram' and source.connection_id is null then raise exception 'GENERATION_REVOKED'; end if;
    if source.source_kind='creator_upload' and source.asset_id is null then raise exception 'NOT_FOUND'; end if;
    if source.connection_id is not null then
      select * into connection from public.integration_connections
        where id=source.connection_id and workspace_id=p_workspace and creator_id=p_creator for update;
      if not found or connection.generation<>source.generation or connection.status not in ('connected','partial') then raise exception 'GENERATION_REVOKED'; end if;
    end if;
    if source.asset_id is not null and not exists(
      select 1 from private.creator_growth_assets a
      where a.id=source.asset_id and a.thread_id=source.thread_id
        and a.workspace_id=p_workspace and a.creator_id=p_creator and a.upload_state='uploaded'
    ) then raise exception 'SOURCE_INVALIDATED'; end if;
    insert into private.creator_growth_media_sources(
      id,workspace_id,creator_id,thread_id,asset_id,connection_id,generation,source_kind,
      source_ref,subject,media_id,permalink,rights,visibility,match_status,sample_only,
      observed_at,fetched_at
    ) values(
      source.id,source.workspace_id,source.creator_id,source.thread_id,source.asset_id,source.connection_id,
      source.generation,source.source_kind,source.source_ref,source.subject,source.media_id,source.permalink,
      source.rights,source.visibility,source.match_status,source.sample_only,source.observed_at,source.fetched_at
    ) returning * into source;
    entity_id:=source.id;
    result:=private.creator_growth_source_json(source);
  elsif p_action='save_consent' then
    consent:=(jsonb_populate_record(null::private.creator_growth_consents,jsonb_build_object(
      'id',(p_payload->>'id')::uuid,'workspace_id',p_workspace,'creator_id',p_creator,
      'processor',p_payload->>'processor','consent_version',p_payload->>'consentVersion',
      'granted_at',(p_payload->>'grantedAt')::timestamptz,
      'expires_at',(p_payload->>'expiresAt')::timestamptz,
      'connection_id',(p_payload->>'connectionId')::uuid,
      'generation',(p_payload->>'generation')::integer
    )));
    if consent.connection_id is not null then
      select * into connection from public.integration_connections
        where id=consent.connection_id and workspace_id=p_workspace and creator_id=p_creator for update;
      if not found or connection.generation<>consent.generation or connection.status not in ('connected','partial') then raise exception 'GENERATION_REVOKED'; end if;
    end if;
    insert into private.creator_growth_consents(
      id,workspace_id,creator_id,processor,consent_version,granted_at,expires_at,connection_id,generation
    ) values(
      consent.id,consent.workspace_id,consent.creator_id,consent.processor,consent.consent_version,
      consent.granted_at,consent.expires_at,consent.connection_id,consent.generation
    ) returning * into consent;
    entity_id:=consent.id;
    result:=private.creator_growth_consent_json(consent);
  elsif p_action='save_analysis' then
    analysis:=(jsonb_populate_record(null::private.creator_growth_analyses,jsonb_build_object(
      'id',(p_payload->>'id')::uuid,'workspace_id',p_workspace,'creator_id',p_creator,
      'thread_id',(p_payload->>'threadId')::uuid,
      'media_source_id',(p_payload->>'mediaSourceId')::uuid,
      'asset_id',(p_payload->>'assetId')::uuid,
      'consent_id',(p_payload->>'consentId')::uuid,
      'source_asset_ref',p_payload->'result'->'binding'->>'assetId',
      'asset_sha256',p_payload->'result'->'binding'->>'sha256',
      'asset_source_kind',p_payload->'result'->'binding'->>'sourceKind',
      'fixture_id',p_payload->'result'->'binding'->>'fixtureId',
      'processor',p_payload->>'processor',
      'processor_version',p_payload->>'processorVersion',
      'observation',p_payload->'result'->'observation',
      'binding',p_payload->'result'->'binding'
    )));
    if analysis.asset_id is null or analysis.source_asset_ref is null then raise exception 'INVALID_INPUT'; end if;
    select * into asset from private.creator_growth_assets a
      where a.id=analysis.asset_id and a.thread_id=analysis.thread_id
        and a.workspace_id=p_workspace and a.creator_id=p_creator and a.upload_state='uploaded';
    if not found
      or analysis.source_asset_ref<>asset.id::text
      or analysis.asset_sha256<>asset.sha256
      or analysis.asset_source_kind<>asset.source_kind
      or analysis.fixture_id is distinct from asset.fixture_id then raise exception 'SOURCE_INVALIDATED'; end if;

    lineage_connection_id:=(p_payload->>'connectionId')::uuid;
    lineage_generation:=(p_payload->>'generation')::integer;
    if (lineage_connection_id is null)<>(lineage_generation is null) then raise exception 'GENERATION_REVOKED'; end if;
    if analysis.media_source_id is not null then
      select * into lineage_source from private.creator_growth_media_sources s
        where s.id=analysis.media_source_id and s.thread_id=analysis.thread_id
          and s.workspace_id=p_workspace and s.creator_id=p_creator
          and s.invalidated_at is null and s.revoked_at is null;
      if not found then raise exception 'SOURCE_INVALIDATED'; end if;
      if lineage_source.rights<>'allowed' then raise exception 'SOURCE_INVALIDATED'; end if;
      if lineage_source.asset_id is not null and lineage_source.asset_id<>analysis.asset_id then
        raise exception 'SOURCE_INVALIDATED';
      end if;
      if lineage_source.source_kind='creator_upload' then
        if lineage_source.asset_id is null or lineage_source.asset_id<>analysis.asset_id then
          raise exception 'SOURCE_INVALIDATED';
        end if;
      elsif lineage_source.visibility<>'public' or lineage_source.match_status<>'matched' then
        raise exception 'SOURCE_INVALIDATED';
      end if;
      if lineage_source.connection_id is not null then
        if lineage_connection_id is not null and
          (lineage_connection_id<>lineage_source.connection_id or lineage_generation<>lineage_source.generation)
        then raise exception 'SOURCE_INVALIDATED'; end if;
        lineage_connection_id:=lineage_source.connection_id;
        lineage_generation:=lineage_source.generation;
      end if;
    end if;
    if analysis.consent_id is not null then
      select * into lineage_consent from private.creator_growth_consents c
        where c.id=analysis.consent_id and c.workspace_id=p_workspace and c.creator_id=p_creator
          and c.revoked_at is null and c.expires_at>clock_timestamp();
      if not found or lineage_consent.processor<>analysis.processor then
        raise exception 'SOURCE_INVALIDATED';
      end if;
      if lineage_consent.connection_id is not null then
        if lineage_connection_id is not null and
          (lineage_connection_id<>lineage_consent.connection_id or lineage_generation<>lineage_consent.generation)
        then raise exception 'SOURCE_INVALIDATED'; end if;
        lineage_connection_id:=lineage_consent.connection_id;
        lineage_generation:=lineage_consent.generation;
      end if;
    end if;
    if lineage_connection_id is not null then
      select * into connection from public.integration_connections
        where id=lineage_connection_id and workspace_id=p_workspace and creator_id=p_creator for update;
      if not found or connection.generation<>lineage_generation
        or connection.status not in ('connected','partial') then raise exception 'GENERATION_REVOKED'; end if;
    end if;
    analysis.connection_id:=lineage_connection_id;
    analysis.generation:=lineage_generation;
    insert into private.creator_growth_analyses(
      id,workspace_id,creator_id,thread_id,media_source_id,asset_id,consent_id,
      connection_id,generation,source_asset_ref,asset_sha256,asset_source_kind,fixture_id,
      processor,processor_version,observation,binding
    ) values(
      analysis.id,analysis.workspace_id,analysis.creator_id,analysis.thread_id,
      analysis.media_source_id,analysis.asset_id,analysis.consent_id,
      analysis.connection_id,analysis.generation,analysis.source_asset_ref,
      analysis.asset_sha256,analysis.asset_source_kind,analysis.fixture_id,
      analysis.processor,analysis.processor_version,analysis.observation,analysis.binding
    ) returning * into analysis;
    entity_id:=analysis.id;
    result:=private.creator_growth_analysis_json(analysis);
  elsif p_action='save_skill_invocation' then
    skill:=(jsonb_populate_record(null::private.creator_growth_skill_invocations,jsonb_build_object(
      'id',(p_payload->>'id')::uuid,'workspace_id',p_workspace,'creator_id',p_creator,
      'thread_id',(p_payload->>'threadId')::uuid,
      'analysis_id',(p_payload->>'analysisId')::uuid,
      'skill_id',p_payload->>'skillId',
      'report',p_payload->'report',
      'proposal',p_payload->'result'->>'proposal',
      'source_refs',p_payload->'result'->'sourceRefs',
      'limitations',p_payload->'result'->'limitations',
      'sample_only',(p_payload->'result'->>'sampleOnly')::boolean
    )));
    if skill.analysis_id is null then raise exception 'INVALID_INPUT'; end if;
    select * into analysis from private.creator_growth_analyses a
      where a.id=skill.analysis_id and a.thread_id=skill.thread_id
        and a.workspace_id=p_workspace and a.creator_id=p_creator
        and a.invalidated_at is null;
    if not found then raise exception 'SOURCE_INVALIDATED'; end if;
    skill_source_ids:=private.creator_growth_validate_skill_report(
      p_workspace,p_creator,skill.thread_id,analysis.id,analysis.asset_id,p_payload
    );
    insert into private.creator_growth_skill_invocations(
      id,workspace_id,creator_id,thread_id,analysis_id,skill_id,report,proposal,
      source_refs,limitations,sample_only
    ) values(
      skill.id,skill.workspace_id,skill.creator_id,skill.thread_id,skill.analysis_id,
      skill.skill_id,skill.report,skill.proposal,skill.source_refs,skill.limitations,skill.sample_only
    ) returning * into skill;
    for source_id in select value from unnest(skill_source_ids) value loop
      insert into private.creator_growth_skill_sources(
        skill_id,media_source_id,workspace_id,creator_id,thread_id
      ) values(
        skill.id,source_id,p_workspace,p_creator,skill.thread_id
      );
    end loop;
    entity_id:=skill.id;
    result:=private.creator_growth_skill_json(skill);
  elsif p_action='save_draft' then
    if coalesce(p_payload->>'status','') not in ('private','completed','cancelled') then raise exception 'INVALID_INPUT'; end if;
    draft:=(jsonb_populate_record(null::private.creator_growth_drafts,jsonb_build_object(
      'id',(p_payload->>'id')::uuid,'workspace_id',p_workspace,'creator_id',p_creator,
      'thread_id',(p_payload->>'threadId')::uuid,
      'asset_id',(p_payload->>'assetId')::uuid,
      'analysis_id',(p_payload->>'analysisId')::uuid,
      'skill_invocation_id',(p_payload->>'skillInvocationId')::uuid,
      'revision',coalesce((p_payload->>'expectedRevision')::integer,-1)+1,
      'caption',p_payload->>'caption',
      'manual_description',p_payload->>'manualDescription',
      'status',p_payload->>'status'
    )));
    if draft.analysis_id is not null and draft.asset_id is null then
      raise exception 'SOURCE_INVALIDATED';
    end if;
    if draft.skill_invocation_id is not null and draft.analysis_id is null then
      raise exception 'SOURCE_INVALIDATED';
    end if;
    if draft.asset_id is not null and not exists(
      select 1 from private.creator_growth_assets a
      where a.id=draft.asset_id and a.thread_id=draft.thread_id
        and a.workspace_id=p_workspace and a.creator_id=p_creator and a.upload_state='uploaded'
    ) then raise exception 'SOURCE_INVALIDATED'; end if;
    if draft.analysis_id is not null and not exists(
      select 1 from private.creator_growth_analyses a
      where a.id=draft.analysis_id and a.thread_id=draft.thread_id
        and a.workspace_id=p_workspace and a.creator_id=p_creator and a.invalidated_at is null
    ) then raise exception 'SOURCE_INVALIDATED'; end if;
    if draft.skill_invocation_id is not null and not exists(
      select 1 from private.creator_growth_skill_invocations s
      where s.id=draft.skill_invocation_id and s.thread_id=draft.thread_id
        and s.workspace_id=p_workspace and s.creator_id=p_creator and s.invalidated_at is null
    ) then raise exception 'SOURCE_INVALIDATED'; end if;
    if draft.asset_id is not null and draft.analysis_id is not null and not exists(
      select 1 from private.creator_growth_analyses a
      where a.id=draft.analysis_id and a.asset_id=draft.asset_id
        and a.workspace_id=p_workspace and a.creator_id=p_creator
    ) then raise exception 'SOURCE_INVALIDATED'; end if;
    if draft.analysis_id is not null and draft.skill_invocation_id is not null and not exists(
      select 1 from private.creator_growth_skill_invocations s
      where s.id=draft.skill_invocation_id and s.analysis_id=draft.analysis_id
        and s.workspace_id=p_workspace and s.creator_id=p_creator
    ) then raise exception 'SOURCE_INVALIDATED'; end if;
    select * into existing_draft from private.creator_growth_drafts
      where id=draft.id and workspace_id=p_workspace and creator_id=p_creator for update;
    if found then
      if existing_draft.status='invalidated' or existing_draft.invalidated_at is not null then raise exception 'SOURCE_INVALIDATED'; end if;
      if existing_draft.revision<>(p_payload->>'expectedRevision')::integer then raise exception 'REVISION_CONFLICT'; end if;
      update private.creator_growth_drafts set
        asset_id=draft.asset_id,analysis_id=draft.analysis_id,
        skill_invocation_id=draft.skill_invocation_id,
        revision=revision+1,caption=draft.caption,manual_description=draft.manual_description,
        status=draft.status,
        terminal_at=case when draft.status in ('completed','cancelled') then clock_timestamp() else null end,
        updated_at=clock_timestamp()
      where id=existing_draft.id returning * into draft;
    else
      if (p_payload->>'expectedRevision')::integer<>0 then raise exception 'REVISION_CONFLICT'; end if;
      insert into private.creator_growth_drafts(
        id,workspace_id,creator_id,thread_id,asset_id,analysis_id,skill_invocation_id,
        revision,caption,manual_description,status,terminal_at
      ) values(
        draft.id,draft.workspace_id,draft.creator_id,draft.thread_id,draft.asset_id,draft.analysis_id,
        draft.skill_invocation_id,1,draft.caption,draft.manual_description,draft.status,
        case when draft.status in ('completed','cancelled') then clock_timestamp() else null end
      ) returning * into draft;
    end if;
    entity_id:=draft.id;
    result:=private.creator_growth_draft_json(draft);
  elsif p_action='get_draft' then
    select * into draft from private.creator_growth_drafts
      where id=(p_payload->>'draftId')::uuid and workspace_id=p_workspace and creator_id=p_creator;
    if not found then return 'null'; end if;
    if draft.invalidated_at is not null or draft.status='invalidated' then raise exception 'SOURCE_INVALIDATED'; end if;
    return private.creator_growth_draft_json(draft);
  elsif p_action='set_draft_status' then
    select * into draft from private.creator_growth_drafts
      where id=(p_payload->>'draftId')::uuid and workspace_id=p_workspace and creator_id=p_creator for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if draft.status='invalidated' or draft.invalidated_at is not null then raise exception 'SOURCE_INVALIDATED'; end if;
    if draft.revision<>(p_payload->'input'->>'expectedRevision')::integer then raise exception 'REVISION_CONFLICT'; end if;
    changed_at:=(p_payload->'input'->>'changedAt')::timestamptz;
    if changed_at is null or coalesce(p_payload->'input'->>'status','') not in ('private','completed','cancelled') then raise exception 'INVALID_INPUT'; end if;
    update private.creator_growth_drafts set revision=revision+1,status=p_payload->'input'->>'status',
      terminal_at=case when p_payload->'input'->>'status' in ('completed','cancelled') then changed_at else null end,
      updated_at=changed_at where id=draft.id returning * into draft;
    entity_id:=draft.id;
    result:=private.creator_growth_draft_json(draft);
  elsif p_action='record_event' then
    insert into private.creator_growth_events(id,workspace_id,creator_id,event_code,entity_id,created_at)
      values((p_payload->>'id')::uuid,p_workspace,p_creator,p_payload->>'code',
        (p_payload->>'entityId')::uuid,coalesce((p_payload->>'createdAt')::timestamptz,clock_timestamp()))
      returning * into growth_event;
    entity_id:=growth_event.id;
    result:=private.creator_growth_event_json(growth_event);
  elsif p_action='apply_retention' then
    now_value:=(p_payload->>'now')::timestamptz;
    if now_value is null then raise exception 'INVALID_INPUT'; end if;
    delete from private.creator_growth_drafts
      where workspace_id=p_workspace and creator_id=p_creator
        and status in ('completed','cancelled','invalidated')
        and terminal_at<=now_value-interval '30 days';
    get diagnostics drafts_deleted=row_count;
    delete from private.creator_growth_route_commands c where c.workspace_id=p_workspace and c.creator_id=p_creator and c.expires_at<=now_value;
    delete from private.creator_growth_commands c
      where c.workspace_id=p_workspace and c.creator_id=p_creator and c.expires_at<=now_value;
    get diagnostics receipts_deleted=row_count;
    for asset in select a.* from private.creator_growth_assets a
      where a.workspace_id=p_workspace and a.creator_id=p_creator
        and (a.expires_at<=now_value or a.created_at<=now_value-interval '24 hours')
        and not exists(
          select 1 from private.creator_growth_drafts d
          where d.asset_id=a.id and d.workspace_id=p_workspace and d.creator_id=p_creator
            and d.status in ('private','completed','cancelled')
        )
      order by a.created_at,a.id for update
    loop
      delete from private.creator_growth_drafts d
        where d.asset_id=asset.id and d.analysis_id is not null
          and d.workspace_id=p_workspace and d.creator_id=p_creator;
      get diagnostics count_value=row_count;
      drafts_deleted:=drafts_deleted+count_value;
      inserted:=private.creator_growth_queue_cleanup(p_workspace,p_creator,asset,'retention',now_value);
      if inserted then cleanup_queued:=cleanup_queued+1; end if;
      delete from private.creator_growth_assets where id=asset.id;
      assets_queued:=assets_queued+1;
    end loop;
    update private.creator_growth_route_commands c set plan=null,invalidated_at=now_value
      where c.workspace_id=p_workspace and c.creator_id=p_creator and c.invalidated_at is null and (
        (c.binding->>'assetId' is not null and not exists(select 1 from private.creator_growth_assets a where a.id=(c.binding->>'assetId')::uuid))
        or (c.binding->>'analysisId' is not null and not exists(select 1 from private.creator_growth_analyses a where a.id=(c.binding->>'analysisId')::uuid))
      );
    delete from private.creator_growth_events
      where workspace_id=p_workspace and creator_id=p_creator and created_at<now_value-interval '90 days';
    get diagnostics events_deleted=row_count;
    insert into private.creator_growth_events(id,workspace_id,creator_id,event_code,created_at)
      values(gen_random_uuid(),p_workspace,p_creator,'retention',now_value);
    result:=jsonb_build_object(
      'now',now_value,'assetsQueued',assets_queued,'draftsDeleted',drafts_deleted,
      'eventsDeleted',events_deleted,'cleanupQueued',cleanup_queued,
      'receiptsDeleted',receipts_deleted
    );
    result_hint:=result;
  elsif p_action='purge_owner' then
    result:=private.creator_growth_purge_private(p_workspace,p_creator);
    result_hint:=result;
  elsif p_action='list_cleanup' then
    return jsonb_build_object('items',coalesce((
      select jsonb_agg(private.creator_growth_cleanup_json(c) order by c.created_at,c.id)
      from private.creator_growth_storage_cleanup c
      where c.workspace_id=p_workspace and c.creator_id=p_creator
    ),'[]'));
  elsif p_action='export_owner' then
    return jsonb_build_object(
      'assets',coalesce((select jsonb_agg(private.creator_growth_asset_json(a)-'storagePath' order by a.created_at,a.id)
        from private.creator_growth_assets a where a.workspace_id=p_workspace and a.creator_id=p_creator),'[]'),
      'mediaSources',coalesce((select jsonb_agg(private.creator_growth_source_json(s) order by s.created_at,s.id)
        from private.creator_growth_media_sources s where s.workspace_id=p_workspace and s.creator_id=p_creator),'[]'),
      'consents',coalesce((select jsonb_agg(private.creator_growth_consent_json(c) order by c.created_at,c.id)
        from private.creator_growth_consents c where c.workspace_id=p_workspace and c.creator_id=p_creator),'[]'),
      'analyses',coalesce((select jsonb_agg(private.creator_growth_analysis_json(a) order by a.created_at,a.id)
        from private.creator_growth_analyses a where a.workspace_id=p_workspace and a.creator_id=p_creator),'[]'),
      'skillInvocations',coalesce((select jsonb_agg(private.creator_growth_skill_json(s) order by s.created_at,s.id)
        from private.creator_growth_skill_invocations s where s.workspace_id=p_workspace and s.creator_id=p_creator),'[]'),
      'drafts',coalesce((select jsonb_agg(private.creator_growth_draft_json(d) order by d.created_at,d.id)
        from private.creator_growth_drafts d where d.workspace_id=p_workspace and d.creator_id=p_creator),'[]'),
      'events',coalesce((select jsonb_agg(private.creator_growth_event_json(e) order by e.created_at,e.id)
        from private.creator_growth_events e where e.workspace_id=p_workspace and e.creator_id=p_creator),'[]')
    );
  else
    raise exception 'INVALID_INPUT';
  end if;
  if p_action not in ('get_asset','get_draft','list_cleanup','export_owner') then
    insert into private.creator_growth_commands(
      workspace_id,creator_id,request_id,action,payload_hash,entity_id,result_hint,expires_at
    ) values(
      p_workspace,p_creator,p_request,p_action,digest,entity_id,result_hint,
      clock_timestamp()+interval '90 days'
    );
  end if;
  return result;
end $$;

create function public.creator_growth_claim_cleanup(
  "workspaceId" uuid,
  "creatorId" uuid,
  "requestId" uuid,
  "workerId" uuid,
  "claimedAt" timestamptz,
  "limit" integer,
  "leaseSeconds" integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare items jsonb;
begin
  if "workspaceId" is null or "creatorId" is null or "requestId" is null
    or "workerId" is null or "claimedAt" is null
    or "limit" not between 1 and 100 or "leaseSeconds" not between 15 and 300 then raise exception 'INVALID_INPUT'; end if;
  with candidates as (
    select id from private.creator_growth_storage_cleanup
    where workspace_id="workspaceId" and creator_id="creatorId"
      and (
        (state='queued' and available_at<="claimedAt")
        or (state='processing' and lease_expires_at<="claimedAt")
      )
    order by available_at,created_at,id
    limit "limit"
    for update skip locked
  ), claimed as (
    update private.creator_growth_storage_cleanup c set
      state='processing',
      attempts=c.attempts+1,
      lease_token="workerId",
      lease_expires_at="claimedAt"+make_interval(secs=>"leaseSeconds"),
      last_error=null,
      available_at="claimedAt"
    from candidates
    where c.id=candidates.id
    returning c.*
  )
  select coalesce(jsonb_agg(private.creator_growth_cleanup_json(claimed) order by claimed.available_at,claimed.id),'[]')
    into items from claimed;
  return jsonb_build_object('items',items);
end $$;

create function public.creator_growth_finish_cleanup(
  "workspaceId" uuid,
  "creatorId" uuid,
  "requestId" uuid,
  "cleanupId" uuid,
  "workerId" uuid,
  "objectPath" text,
  outcome text,
  "finishedAt" timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare cleanup private.creator_growth_storage_cleanup; retry_at timestamptz;
begin
  if "workspaceId" is null or "creatorId" is null or "requestId" is null
    or "cleanupId" is null or "workerId" is null or "objectPath" is null
    or "finishedAt" is null or outcome not in ('completed','failed') then raise exception 'INVALID_INPUT'; end if;
  select * into cleanup from private.creator_growth_storage_cleanup
    where id="cleanupId" and workspace_id="workspaceId" and creator_id="creatorId"
    for update;
  if not found or cleanup.object_path<>"objectPath" then raise exception 'NOT_FOUND'; end if;
  if cleanup.state='completed' then
    if cleanup.lease_token="workerId" and outcome='completed' then
      return jsonb_build_object('state',cleanup.state,'attempts',cleanup.attempts);
    end if;
    raise exception 'INVALID_INPUT';
  end if;
  if cleanup.state<>'processing' or cleanup.lease_token<>"workerId"
    or cleanup.lease_expires_at<"finishedAt" then raise exception 'NOT_FOUND'; end if;
  if outcome='completed' then
    update private.creator_growth_storage_cleanup set
      state='completed',completed_at="finishedAt",last_error=null
      where id=cleanup.id returning * into cleanup;
  elsif cleanup.attempts>=cleanup.max_attempts then
    update private.creator_growth_storage_cleanup set
      state='exhausted',lease_token=null,lease_expires_at=null,
      last_error='STORAGE_DELETE_FAILED'
      where id=cleanup.id returning * into cleanup;
  else
    retry_at:="finishedAt"+make_interval(
      secs=>least(3600,15*power(2,greatest(0,cleanup.attempts-1)))
    );
    update private.creator_growth_storage_cleanup set
      state='queued',available_at=retry_at,lease_token=null,lease_expires_at=null,
      last_error='STORAGE_DELETE_FAILED'
      where id=cleanup.id returning * into cleanup;
  end if;
  if exists(select 1 from public.creators where id="creatorId" and workspace_id="workspaceId") then
    insert into private.creator_growth_events(id,workspace_id,creator_id,event_code,entity_id,created_at)
      values(
        gen_random_uuid(),"workspaceId","creatorId",
        case when cleanup.state='completed' then 'storage_cleanup_completed' else 'storage_cleanup_failed' end,
        cleanup.asset_id,"finishedAt"
      );
  end if;
  return jsonb_build_object('state',cleanup.state,'attempts',cleanup.attempts);
end $$;

create function public.creator_growth_list_cleanup(
  "workspaceId" uuid,
  "creatorId" uuid,
  "requestId" uuid
) returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object('items',coalesce((
    select jsonb_agg(private.creator_growth_cleanup_json(c) order by c.created_at,c.id)
    from private.creator_growth_storage_cleanup c
    where c.workspace_id="workspaceId" and c.creator_id="creatorId"
  ),'[]'))
$$;

create function public.creator_growth_route_command(
  "workspaceId" uuid, "creatorId" uuid, "requestId" uuid, input jsonb, plan jsonb default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  command private.creator_growth_route_commands;
  route_binding jsonb;
  source private.creator_growth_media_sources;
  source_id uuid;
  route_thread_id uuid;
begin
  perform private.creator_growth_assert_owner("workspaceId","creatorId");
  if "requestId" is null or jsonb_typeof(input) is distinct from 'object'
    or coalesce(input->>'requestHash','') !~ '^[a-f0-9]{64}$'
    or coalesce(input->>'operation','') not in ('analyse','skills','media/select')
    or jsonb_typeof(input->'mediaSourceIds') is distinct from 'array'
    or jsonb_array_length(input->'mediaSourceIds')>12
    or octet_length(input::text)>4096 then raise exception 'INVALID_INPUT'; end if;
  route_thread_id:=(input->>'threadId')::uuid;
  if not exists(select 1 from public.studio_threads where id=route_thread_id and workspace_id="workspaceId" and creator_id="creatorId") then raise exception 'NOT_FOUND'; end if;
  -- Include first insertion in serialization; concurrent preparation cannot
  -- replace the first snapshot. The lock is local to this transaction.
  perform pg_advisory_xact_lock(hashtextextended("workspaceId"::text||':'||"creatorId"::text||':'||"requestId"::text,0));
  select * into command from private.creator_growth_route_commands c
    where c.workspace_id="workspaceId" and c.creator_id="creatorId" and c.request_id="requestId" for update;
  if found then
    if command.request_hash<>input->>'requestHash' or command.operation<>input->>'operation' or command.thread_id<>route_thread_id then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    if command.invalidated_at is not null then raise exception 'SOURCE_INVALIDATED'; end if;
    if command.expires_at<=clock_timestamp() then raise exception 'IDEMPOTENCY_EXPIRED'; end if;
  end if;
  route_binding:=coalesce(command.binding,input);
  if route_binding->>'connectionId' is not null and not exists(
    select 1 from public.integration_connections c where c.id=(route_binding->>'connectionId')::uuid
      and c.workspace_id="workspaceId" and c.creator_id="creatorId"
      and c.generation=(route_binding->>'generation')::integer and c.status in ('connected','partial')
  ) then raise exception 'GENERATION_REVOKED'; end if;
  if route_binding->>'assetId' is not null and not exists(
    select 1 from private.creator_growth_assets a where a.id=(route_binding->>'assetId')::uuid
      and a.thread_id=route_thread_id and a.workspace_id="workspaceId" and a.creator_id="creatorId" and a.upload_state='uploaded'
  ) then raise exception 'SOURCE_INVALIDATED'; end if;
  if route_binding->>'analysisId' is not null and not exists(
    select 1 from private.creator_growth_analyses a where a.id=(route_binding->>'analysisId')::uuid
      and a.thread_id=route_thread_id and a.workspace_id="workspaceId" and a.creator_id="creatorId" and a.invalidated_at is null
  ) then raise exception 'SOURCE_INVALIDATED'; end if;
  for source_id in select value::uuid from jsonb_array_elements_text(route_binding->'mediaSourceIds') loop
    select * into source from private.creator_growth_media_sources s where s.id=source_id
      and s.workspace_id="workspaceId" and s.creator_id="creatorId" and s.thread_id=route_thread_id;
    if not found or source.invalidated_at is not null or source.revoked_at is not null or source.rights<>'allowed'
      or (source.asset_id is not null and source.asset_id::text is distinct from route_binding->>'assetId')
      or (source.source_kind<>'creator_upload' and (source.visibility<>'public' or source.match_status<>'matched')) then raise exception 'SOURCE_INVALIDATED'; end if;
    if source.connection_id is not null and not exists(select 1 from public.integration_connections c
      where c.id=source.connection_id and c.workspace_id="workspaceId" and c.creator_id="creatorId"
        and c.generation=source.generation and c.status in ('connected','partial')) then raise exception 'GENERATION_REVOKED'; end if;
  end loop;
  if command.request_id is null then
    insert into private.creator_growth_route_commands(workspace_id,creator_id,request_id,thread_id,operation,request_hash,binding)
      values("workspaceId","creatorId","requestId",route_thread_id,input->>'operation',input->>'requestHash',input)
      returning * into command;
  end if;
  if plan is not null and plan<>'null'::jsonb and command.plan is null then
    if jsonb_typeof(plan) is distinct from 'object' or plan->>'operation' is distinct from command.operation
      or octet_length(plan::text)>262144 then raise exception 'INVALID_INPUT'; end if;
    update private.creator_growth_route_commands c set plan=creator_growth_route_command.plan
      where c.workspace_id="workspaceId" and c.creator_id="creatorId" and c.request_id="requestId" returning * into command;
  end if;
  return jsonb_build_object('startedAt',command.started_at,'plan',command.plan);
end $$;
revoke all on function public.creator_growth_route_command(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.creator_growth_route_command(uuid,uuid,uuid,jsonb,jsonb) to service_role;

create function public.creator_growth_reserve_asset("workspaceId" uuid,"creatorId" uuid,"requestId" uuid,asset jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select public.creator_growth_command("workspaceId","creatorId","requestId",'reserve_asset',asset)
$$;
create function public.creator_growth_confirm_asset("workspaceId" uuid,"creatorId" uuid,"requestId" uuid,"assetId" uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select public.creator_growth_command("workspaceId","creatorId","requestId",'confirm_asset',jsonb_build_object('assetId',"assetId"))
$$;
create function public.creator_growth_abandon_asset("workspaceId" uuid,"creatorId" uuid,"requestId" uuid,"assetId" uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select public.creator_growth_command("workspaceId","creatorId","requestId",'abandon_asset',jsonb_build_object('assetId',"assetId"))
$$;
create function public.creator_growth_get_asset("workspaceId" uuid,"creatorId" uuid,"requestId" uuid,"assetId" uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select public.creator_growth_command("workspaceId","creatorId","requestId",'get_asset',jsonb_build_object('assetId',"assetId"))
$$;
create function public.creator_growth_save_media_source("workspaceId" uuid,"creatorId" uuid,"requestId" uuid,source jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select public.creator_growth_command("workspaceId","creatorId","requestId",'save_media_source',source)
$$;
create function public.creator_growth_save_consent("workspaceId" uuid,"creatorId" uuid,"requestId" uuid,consent jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select public.creator_growth_command("workspaceId","creatorId","requestId",'save_consent',consent)
$$;
create function public.creator_growth_save_analysis("workspaceId" uuid,"creatorId" uuid,"requestId" uuid,analysis jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select public.creator_growth_command("workspaceId","creatorId","requestId",'save_analysis',analysis)
$$;
create function public.creator_growth_save_skill_invocation("workspaceId" uuid,"creatorId" uuid,"requestId" uuid,invocation jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select public.creator_growth_command("workspaceId","creatorId","requestId",'save_skill_invocation',invocation)
$$;
create function public.creator_growth_save_draft("workspaceId" uuid,"creatorId" uuid,"requestId" uuid,draft jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select public.creator_growth_command("workspaceId","creatorId","requestId",'save_draft',draft)
$$;
create function public.creator_growth_get_draft("workspaceId" uuid,"creatorId" uuid,"requestId" uuid,"draftId" uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select public.creator_growth_command("workspaceId","creatorId","requestId",'get_draft',jsonb_build_object('draftId',"draftId"))
$$;
create function public.creator_growth_set_draft_status("workspaceId" uuid,"creatorId" uuid,"requestId" uuid,"draftId" uuid,input jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select public.creator_growth_command("workspaceId","creatorId","requestId",'set_draft_status',jsonb_build_object('draftId',"draftId",'input',input))
$$;
create function public.creator_growth_record_event("workspaceId" uuid,"creatorId" uuid,"requestId" uuid,event jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select public.creator_growth_command("workspaceId","creatorId","requestId",'record_event',event)
$$;
create function public.creator_growth_apply_retention("workspaceId" uuid,"creatorId" uuid,"requestId" uuid,now timestamptz)
returns jsonb language sql security invoker set search_path='' as $$
  select public.creator_growth_command("workspaceId","creatorId","requestId",'apply_retention',jsonb_build_object('now',now))
$$;
create function public.creator_growth_purge_owner("workspaceId" uuid,"creatorId" uuid,"requestId" uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select public.creator_growth_command("workspaceId","creatorId","requestId",'purge_owner','{}')
$$;
create function public.creator_growth_export_owner("workspaceId" uuid,"creatorId" uuid,"requestId" uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select public.creator_growth_command("workspaceId","creatorId","requestId",'export_owner','{}')
$$;

revoke all on function private.creator_growth_asset_json(private.creator_growth_assets),
  private.creator_growth_source_json(private.creator_growth_media_sources),
  private.creator_growth_consent_json(private.creator_growth_consents),
  private.creator_growth_analysis_json(private.creator_growth_analyses),
  private.creator_growth_skill_json(private.creator_growth_skill_invocations),
  private.creator_growth_draft_json(private.creator_growth_drafts),
  private.creator_growth_event_json(private.creator_growth_events),
  private.creator_growth_cleanup_json(private.creator_growth_storage_cleanup),
  private.creator_growth_assert_owner(uuid,uuid),
  private.creator_growth_assert_non_deleted(uuid,uuid),
  private.creator_growth_queue_cleanup(uuid,uuid,private.creator_growth_assets,text,timestamptz),
  private.creator_growth_queue_deleted_asset(),
  private.creator_growth_purge_private(uuid,uuid),
  private.creator_growth_invalidate_generation(uuid,uuid,uuid,integer,timestamptz),
  private.creator_growth_integration_revocation(),
  private.creator_growth_account_cleanup(),
  private.creator_growth_replay(uuid,uuid,text,uuid,jsonb),
  private.creator_growth_report_has_citation(jsonb,text,text),
  private.creator_growth_validate_skill_report(uuid,uuid,uuid,uuid,uuid,jsonb)
from public,anon,authenticated,service_role;
revoke all on function public.creator_growth_command(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.creator_growth_command(uuid,uuid,uuid,text,jsonb) to service_role;
revoke all on function public.creator_growth_reserve_asset(uuid,uuid,uuid,jsonb),
  public.creator_growth_confirm_asset(uuid,uuid,uuid,uuid),
  public.creator_growth_abandon_asset(uuid,uuid,uuid,uuid),
  public.creator_growth_get_asset(uuid,uuid,uuid,uuid),
  public.creator_growth_save_media_source(uuid,uuid,uuid,jsonb),
  public.creator_growth_save_consent(uuid,uuid,uuid,jsonb),
  public.creator_growth_save_analysis(uuid,uuid,uuid,jsonb),
  public.creator_growth_save_skill_invocation(uuid,uuid,uuid,jsonb),
  public.creator_growth_save_draft(uuid,uuid,uuid,jsonb),
  public.creator_growth_get_draft(uuid,uuid,uuid,uuid),
  public.creator_growth_set_draft_status(uuid,uuid,uuid,uuid,jsonb),
  public.creator_growth_record_event(uuid,uuid,uuid,jsonb),
  public.creator_growth_apply_retention(uuid,uuid,uuid,timestamptz),
  public.creator_growth_purge_owner(uuid,uuid,uuid),
  public.creator_growth_list_cleanup(uuid,uuid,uuid),
  public.creator_growth_claim_cleanup(uuid,uuid,uuid,uuid,timestamptz,integer,integer),
  public.creator_growth_finish_cleanup(uuid,uuid,uuid,uuid,uuid,text,text,timestamptz),
  public.creator_growth_export_owner(uuid,uuid,uuid)
from public,anon,authenticated;
grant execute on function public.creator_growth_reserve_asset(uuid,uuid,uuid,jsonb),
  public.creator_growth_confirm_asset(uuid,uuid,uuid,uuid),
  public.creator_growth_abandon_asset(uuid,uuid,uuid,uuid),
  public.creator_growth_get_asset(uuid,uuid,uuid,uuid),
  public.creator_growth_save_media_source(uuid,uuid,uuid,jsonb),
  public.creator_growth_save_consent(uuid,uuid,uuid,jsonb),
  public.creator_growth_save_analysis(uuid,uuid,uuid,jsonb),
  public.creator_growth_save_skill_invocation(uuid,uuid,uuid,jsonb),
  public.creator_growth_save_draft(uuid,uuid,uuid,jsonb),
  public.creator_growth_get_draft(uuid,uuid,uuid,uuid),
  public.creator_growth_set_draft_status(uuid,uuid,uuid,uuid,jsonb),
  public.creator_growth_record_event(uuid,uuid,uuid,jsonb),
  public.creator_growth_apply_retention(uuid,uuid,uuid,timestamptz),
  public.creator_growth_purge_owner(uuid,uuid,uuid),
  public.creator_growth_list_cleanup(uuid,uuid,uuid),
  public.creator_growth_claim_cleanup(uuid,uuid,uuid,uuid,timestamptz,integer,integer),
  public.creator_growth_finish_cleanup(uuid,uuid,uuid,uuid,uuid,text,text,timestamptz),
  public.creator_growth_export_owner(uuid,uuid,uuid)
to service_role;

commit;
