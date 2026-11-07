-- Opt-in, service-mediated integration storage. No provider calls or credentials are
-- provisioned by this migration. The service owns feature flags and external ACL checks.
alter table public.creators add constraint integration_creator_workspace_key unique(id,workspace_id);
create table public.integration_connections (
  id uuid primary key, workspace_id uuid not null, creator_id uuid not null,
  provider text not null check(provider in ('instagram','google_drive')),
  generation integer not null check(generation>0),
  status text not null check(status in ('connected','partial','reauth_required','revoked')),
  data jsonb not null check(jsonb_typeof(data)='object'),
  revoked_at timestamptz, created_at timestamptz not null default clock_timestamp(),
  unique(workspace_id,creator_id,provider), unique(id,workspace_id,creator_id),
  foreign key(creator_id,workspace_id) references public.creators(id,workspace_id)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.integration_connections FROM PUBLIC, anon, authenticated, service_role;

create table public.integration_resources (
  id uuid primary key, connection_id uuid not null, workspace_id uuid not null, creator_id uuid not null,
  generation integer not null check(generation>0), snapshot_id uuid,
  data jsonb not null check(jsonb_typeof(data)='object'),
  unique(id,connection_id,workspace_id,creator_id),
  foreign key(connection_id,workspace_id,creator_id) references public.integration_connections(id,workspace_id,creator_id) on delete cascade
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.integration_resources FROM PUBLIC, anon, authenticated, service_role;

create unique index integration_resource_external on public.integration_resources(connection_id,(data->>'externalId'));
create table public.integration_snapshots (
  id uuid primary key default gen_random_uuid(), connection_id uuid not null, resource_id uuid not null,
  workspace_id uuid not null, creator_id uuid not null, generation integer not null check(generation>0),
  data jsonb not null check(jsonb_typeof(data)='object'),
  created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default clock_timestamp()+interval '30 days',
  unique(id,resource_id,connection_id,workspace_id,creator_id),
  foreign key(resource_id,connection_id,workspace_id,creator_id) references public.integration_resources(id,connection_id,workspace_id,creator_id) on delete cascade
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.integration_snapshots FROM PUBLIC, anon, authenticated, service_role;

alter table public.integration_resources add constraint integration_resource_snapshot_fk
  foreign key(snapshot_id,id,connection_id,workspace_id,creator_id)
  references public.integration_snapshots(id,resource_id,connection_id,workspace_id,creator_id);
create index integration_snapshots_expiry on public.integration_snapshots(creator_id,workspace_id,expires_at);
create table public.integration_events (
  id uuid primary key default gen_random_uuid(), connection_id uuid not null, workspace_id uuid not null, creator_id uuid not null,
  event text not null check(event in ('connected','revoked','revoke_result','purged','credential_expired')),
  generation integer not null, outcome text check(outcome in ('revoked','pending','manual_action','complete')),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(connection_id,workspace_id,creator_id) references public.integration_connections(id,workspace_id,creator_id) on delete cascade
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.integration_events FROM PUBLIC, anon, authenticated, service_role;

create table public.integration_sync_runs (
  workspace_id uuid not null, creator_id uuid not null, request_id uuid not null,
  connection_id uuid not null, generation integer not null,
  payload_hash text not null, status text not null check(status in ('running','completed','partial','unknown','revoked')),
  result jsonb check(result is null or jsonb_typeof(result)='object'),
  created_at timestamptz not null default clock_timestamp(), finished_at timestamptz,
  primary key(workspace_id,creator_id,request_id),
  foreign key(connection_id,workspace_id,creator_id) references public.integration_connections(id,workspace_id,creator_id) on delete cascade
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.integration_sync_runs FROM PUBLIC, anon, authenticated, service_role;

create index integration_sync_connection on public.integration_sync_runs(connection_id,generation,status);
create table private.integration_credentials (
  connection_id uuid primary key, workspace_id uuid not null, creator_id uuid not null,
  generation integer not null, credential jsonb not null check(jsonb_typeof(credential)='object'),
  expires_at timestamptz not null, revoke_until timestamptz,
  foreign key(connection_id,workspace_id,creator_id) references public.integration_connections(id,workspace_id,creator_id) on delete cascade
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE private.integration_credentials FROM PUBLIC, anon, authenticated, service_role;

create table private.integration_oauth_states (
  state_hash text primary key, session_hash text not null, workspace_id uuid not null, creator_id uuid not null,
  provider text not null check(provider in ('instagram','google_drive')), expected_generation integer not null check(expected_generation>=0),
  return_path text not null check(return_path='/connections'), expires_at timestamptz not null, consumed_at timestamptz,
  foreign key(creator_id,workspace_id) references public.creators(id,workspace_id)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE private.integration_oauth_states FROM PUBLIC, anon, authenticated, service_role;

create index integration_oauth_owner on private.integration_oauth_states(creator_id,workspace_id,provider);
create table private.integration_commands (
  workspace_id uuid not null, creator_id uuid not null, request_id uuid not null,
  action text not null, payload_hash text not null, result jsonb not null,
  connection_id uuid, generation integer, source_ids uuid[] not null default '{}', invalidated_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  primary key(workspace_id,creator_id,request_id),
  foreign key(creator_id,workspace_id) references public.creators(id,workspace_id),
  foreign key(connection_id,workspace_id,creator_id) references public.integration_connections(id,workspace_id,creator_id)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE private.integration_commands FROM PUBLIC, anon, authenticated, service_role;

do $$ declare t text; begin
  foreach t in array array['integration_connections','integration_resources','integration_snapshots','integration_events','integration_sync_runs'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to authenticated,service_role',t);
    execute format('create policy integration_owner_read on public.%1$I for select to authenticated using (creator_id=(select auth.uid()) and exists(select 1 from public.creators c where c.id=(select auth.uid()) and c.workspace_id=%1$I.workspace_id and c.status=''active''))',t);
  end loop;
  foreach t in array array['integration_credentials','integration_oauth_states','integration_commands'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;
create function private.integration_hash(p_value jsonb) returns text language sql immutable set search_path='' as $$
  select encode(sha256(convert_to(p_value::text,'UTF8')),'hex');
$$;
create function private.integration_keys(p_value jsonb,p_keys text[]) returns boolean language sql immutable set search_path='' as $$
  select case when jsonb_typeof(p_value)='object' then not exists(select 1 from jsonb_object_keys(p_value) k where not k=any(p_keys)) else false end;
$$;
create function private.integration_envelope(p_value jsonb) returns boolean language sql immutable set search_path='' as $$
  select private.integration_keys(p_value,array['keyId','iv','ciphertext']) and p_value ?& array['keyId','iv','ciphertext']
    and jsonb_typeof(p_value->'keyId')='string' and length(p_value->>'keyId') between 1 and 100
    and jsonb_typeof(p_value->'iv')='string' and length(p_value->>'iv') between 1 and 100
    and jsonb_typeof(p_value->'ciphertext')='string' and length(p_value->>'ciphertext') between 1 and 16000;
$$;
create function private.integration_cached_resources(p_workspace uuid,p_creator uuid,p_connection uuid,p_generation integer,p_resources jsonb)
returns boolean language sql stable set search_path='' as $$
  select not exists(select 1 from jsonb_array_elements(p_resources) v where not exists(
    select 1 from public.integration_resources live where live.workspace_id=p_workspace and live.creator_id=p_creator
      and live.connection_id=p_connection and live.generation=p_generation and live.id=(v->>'id')::uuid
      and live.snapshot_id=(v->>'snapshotId')::uuid and live.data->>'availability' not in ('revoked','stale')
      and live.data->'availability' is not distinct from v->'availability' and live.data->'rights' is not distinct from v->'rights'
      and live.data->'selected' is not distinct from v->'selected' and live.data->'canDownload' is not distinct from v->'canDownload'));
$$;
create function private.integration_immutable_snapshot() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.id,new.connection_id,new.resource_id,new.workspace_id,new.creator_id,new.generation,new.data)
    is distinct from (old.id,old.connection_id,old.resource_id,old.workspace_id,old.creator_id,old.generation,old.data)
    then raise exception 'IMMUTABLE_SNAPSHOT'; end if;
  return new;
end $$;
create trigger integration_immutable_snapshot before update on public.integration_snapshots for each row execute function private.integration_immutable_snapshot();
create function private.integration_connection(p_workspace uuid,p_creator uuid,p_id uuid,p_generation integer,p_scopes boolean default true)
returns public.integration_connections language plpgsql set search_path='' as $$
declare c public.integration_connections;
begin
  select * into c from public.integration_connections where id=p_id and workspace_id=p_workspace and creator_id=p_creator for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_generation is null or c.generation<>p_generation then raise exception 'STALE_CONNECTION'; end if;
  if c.status not in ('connected','partial') then raise exception 'SOURCE_UNAVAILABLE'; end if;
  if p_scopes and ((c.provider='google_drive' and not coalesce(c.data->'scopes' ? 'https://www.googleapis.com/auth/drive.file',false))
    or (c.provider='instagram' and not coalesce(c.data->'scopes' ?& array['instagram_business_basic','instagram_business_manage_insights'],false))) then raise exception 'SCOPE_REQUIRED'; end if;
  return c;
end $$;
-- All helpers are unexposed and called only under the actor lock in integration_command.
create function private.integration_foundation_command(p_workspace uuid,p_creator uuid,p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare
  c public.integration_connections; previous public.integration_connections; r public.integration_resources;
  snap public.integration_snapshots; state private.integration_oauth_states; run public.integration_sync_runs;
  d jsonb; x jsonb; metric jsonb; output jsonb:='[]'; v_result jsonb; sid uuid; expected integer; expiry timestamptz;
  fingerprint text:=private.integration_hash(p_payload);
begin
  if p_action='start' then
    if coalesce(p_payload->>'stateHash','') !~ '^[a-fA-F0-9]{64}$' or coalesce(p_payload->>'sessionHash','') !~ '^[a-fA-F0-9]{64}$'
      or coalesce(p_payload->>'provider','') not in ('instagram','google_drive') or p_payload->>'returnPath' is distinct from '/connections'
      or coalesce((p_payload->>'expectedGeneration')::integer,-1)<0 then raise exception 'INVALID_INPUT'; end if;
    expiry:=(p_payload->>'expiresAt')::timestamptz;
    if expiry is null or expiry<=clock_timestamp() or expiry>clock_timestamp()+interval '10 minutes' then raise exception 'INVALID_INPUT'; end if;
    select * into c from public.integration_connections where workspace_id=p_workspace and creator_id=p_creator and provider=p_payload->>'provider';
    if coalesce(c.generation,0)<>(p_payload->>'expectedGeneration')::integer then raise exception 'STALE_CONNECTION'; end if;
    insert into private.integration_oauth_states(state_hash,session_hash,workspace_id,creator_id,provider,expected_generation,return_path,expires_at)
      values(p_payload->>'stateHash',p_payload->>'sessionHash',p_workspace,p_creator,p_payload->>'provider',(p_payload->>'expectedGeneration')::integer,'/connections',expiry);
    return '{}';
  elsif p_action='consume_state' then
    update private.integration_oauth_states set consumed_at=clock_timestamp()
      where state_hash=p_payload->>'stateHash' and session_hash=p_payload->>'sessionHash' and provider=p_payload->>'provider'
        and workspace_id=p_workspace and creator_id=p_creator and consumed_at is null and expires_at>clock_timestamp()
        and expected_generation=coalesce((select generation from public.integration_connections where workspace_id=p_workspace and creator_id=p_creator and provider=p_payload->>'provider'),0)
      returning * into state;
    if not found then raise exception 'OAUTH_STATE_INVALID'; end if;
    return jsonb_build_object('expectedGeneration',state.expected_generation,'returnPath',state.return_path);
  elsif p_action='connect' then
    d:=p_payload->'connection'; expected:=(p_payload->>'expectedGeneration')::integer;
    if private.integration_keys(d,array['id','workspaceId','creatorId','provider','subject','consentVersion','label','status','scopes','generation','lastSyncAt','expiresAt','lastError','sampleOnly','providerRevocation']) is not true
      or exists(select 1 from unnest(array['id','workspaceId','creatorId','provider','subject','consentVersion','label','status','expiresAt']) k where jsonb_typeof(d->k) is distinct from 'string')
      or jsonb_typeof(d->'generation') is distinct from 'number'
      or d->>'provider' not in ('instagram','google_drive') or coalesce(d->>'status','') not in ('connected','partial')
      or jsonb_typeof(d->'scopes') is distinct from 'array' or jsonb_array_length(d->'scopes')>10
      or coalesce(length(d->>'subject'),0) not between 1 and 500 or coalesce(length(d->>'consentVersion'),0) not between 1 and 100
      or coalesce(length(d->>'label'),0) not between 1 and 160 or d->'sampleOnly' is distinct from 'true'::jsonb
      or private.integration_envelope(p_payload->'credential') is not true or octet_length((p_payload->'credential')::text)>16384
      or expected is null or expected<0 then raise exception 'INVALID_INPUT'; end if;
    if (d->>'workspaceId')::uuid is distinct from p_workspace or (d->>'creatorId')::uuid is distinct from p_creator then raise exception 'NOT_FOUND'; end if;
    if exists(select 1 from jsonb_array_elements(d->'scopes') v where jsonb_typeof(v)<>'string'
      or (d->>'provider'='google_drive' and v#>>'{}'<>'https://www.googleapis.com/auth/drive.file')
      or (d->>'provider'='instagram' and v#>>'{}' not in ('instagram_business_basic','instagram_business_manage_insights'))) then raise exception 'INVALID_INPUT'; end if;
    expiry:=(d->>'expiresAt')::timestamptz;
    if expiry is null or expiry<=clock_timestamp() then raise exception 'INVALID_INPUT'; end if;
    select * into previous from public.integration_connections where workspace_id=p_workspace and creator_id=p_creator and provider=d->>'provider' for update;
    if coalesce(previous.generation,0)<>expected or (d->>'generation')::integer is distinct from expected+1
      or (previous.id is not null and (previous.id<>(d->>'id')::uuid or (previous.data->>'subject' is distinct from d->>'subject' and previous.status<>'revoked'))) then raise exception 'STALE_CONNECTION'; end if;
    if previous.id is not null then perform private.integration_invalidate(p_workspace,p_creator,previous.id); end if;
    d:=d||jsonb_build_object('generation',expected+1,'lastError',null,'lastSyncAt',null,'providerRevocation','not_requested');
    insert into public.integration_connections(id,workspace_id,creator_id,provider,generation,status,data)
      values((d->>'id')::uuid,p_workspace,p_creator,d->>'provider',expected+1,d->>'status',d)
      on conflict(workspace_id,creator_id,provider) do update set generation=excluded.generation,status=excluded.status,data=excluded.data,revoked_at=null returning * into c;
    insert into private.integration_credentials(connection_id,workspace_id,creator_id,generation,credential,expires_at)
      values(c.id,p_workspace,p_creator,c.generation,p_payload->'credential',expiry)
      on conflict(connection_id) do update set generation=excluded.generation,credential=excluded.credential,expires_at=excluded.expires_at,revoke_until=null;
    insert into public.integration_events(connection_id,workspace_id,creator_id,event,generation) values(c.id,p_workspace,p_creator,'connected',c.generation);
    return jsonb_build_object('connection',c.data);
  elsif p_action='reauth' then
    select * into c from public.integration_connections where id=(p_payload->>'id')::uuid and workspace_id=p_workspace and creator_id=p_creator for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if c.generation is distinct from (p_payload->>'generation')::integer or c.status='revoked' then raise exception 'STALE_CONNECTION'; end if;
    update public.integration_connections set status='reauth_required',data=data||'{"status":"reauth_required","lastError":"REAUTH_REQUIRED"}'::jsonb where id=c.id returning * into c;
    return jsonb_build_object('connection',c.data);
  end if;

  -- These are current-generation reads/writes. Revocation credentials have no general
  -- read route: only a separately approved platform-revocation worker may use them.
  c:=private.integration_connection(p_workspace,p_creator,(p_payload->>'id')::uuid,(p_payload->>'generation')::integer,p_action not in ('credentials','update_credentials'));
  if p_action='credentials' then
    select credential into v_result from private.integration_credentials where connection_id=c.id and generation=c.generation and revoke_until is null;
    if not found then raise exception 'SOURCE_UNAVAILABLE'; end if;
    return jsonb_build_object('credential',v_result);
  elsif p_action='update_credentials' then
    if private.integration_envelope(p_payload->'credential') is not true or octet_length((p_payload->'credential')::text)>16384 then raise exception 'INVALID_INPUT'; end if;
    expiry:=(p_payload->>'expiresAt')::timestamptz;
    if expiry is null or expiry<=clock_timestamp() then raise exception 'INVALID_INPUT'; end if;
    update private.integration_credentials set credential=p_payload->'credential',expires_at=expiry where connection_id=c.id and generation=c.generation and revoke_until is null;
    if not found then raise exception 'SOURCE_UNAVAILABLE'; end if;
    update public.integration_connections set data=jsonb_set(data,'{expiresAt}',p_payload->'expiresAt') where id=c.id;
    return '{}';
  elsif p_action='resources' then
    if jsonb_typeof(p_payload->'resources') is distinct from 'array' or jsonb_array_length(p_payload->'resources')>50 then raise exception 'INVALID_INPUT'; end if;
    if p_payload ? 'intent' and (c.provider<>'google_drive' or jsonb_array_length(p_payload->'resources')<>jsonb_array_length(p_payload->'intent'->'fileIds')
      or exists(select 1 from jsonb_array_elements(p_payload->'resources') v where not (p_payload->'intent'->'fileIds') ? (v->>'externalId'))) then raise exception 'INVALID_INPUT'; end if;
    if (select count(distinct value->>'id') from jsonb_array_elements(p_payload->'resources'))<>jsonb_array_length(p_payload->'resources') then raise exception 'INVALID_INPUT'; end if;
    for d in select value from jsonb_array_elements(p_payload->'resources') loop
      if private.integration_keys(d,array['id','connectionId','workspaceId','creatorId','generation','externalId','title','mimeType','version','selected','canDownload','rights','availability','excerpt','metrics','observedAt','fetchedAt','coverage','contentHash','sizeBytes','sampleOnly','snapshotId']) is not true
        or exists(select 1 from unnest(array['id','connectionId','workspaceId','creatorId','externalId','title','mimeType','version','rights','availability','observedAt','fetchedAt','contentHash']) k where jsonb_typeof(d->k) is distinct from 'string')
        or jsonb_typeof(d->'generation') is distinct from 'number' or jsonb_typeof(d->'sizeBytes') is distinct from 'number'
        or not (d ? 'excerpt') or jsonb_typeof(d->'excerpt') not in ('null','string')
        or coalesce(length(d->>'title'),0) not between 1 and 160 or coalesce(length(d->>'externalId'),0) not between 1 and 500
        or coalesce(length(d->>'version'),0) not between 1 and 500 or coalesce(length(d->>'contentHash'),0) not between 1 and 256
        or coalesce(length(d->>'mimeType'),0) not between 1 and 160 or length(d->>'excerpt')>8000
        or jsonb_typeof(d->'selected') is distinct from 'boolean' or jsonb_typeof(d->'canDownload') is distinct from 'boolean'
        or coalesce(d->>'rights','') not in ('owned','licensed','unknown')
        or coalesce(d->>'availability','') not in ('available','missing','unsupported','stale','revoked','rate_limited')
        or d->'sampleOnly' is distinct from 'true'::jsonb or jsonb_typeof(d->'metrics') is distinct from 'object'
        or private.integration_keys(d->'coverage',array['region','language','partial']) is not true
        or not (d->'coverage' ?& array['region','language','partial'])
        or jsonb_typeof(d->'coverage'->'partial') is distinct from 'boolean'
        or jsonb_typeof(d->'coverage'->'region') not in ('null','string') or jsonb_typeof(d->'coverage'->'language') not in ('null','string')
        or length(d->'coverage'->>'region')>80 or length(d->'coverage'->>'language')>80
        or coalesce((d->>'sizeBytes')::bigint,-1) not between 0 and 5242880 then raise exception 'INVALID_INPUT'; end if;
      if (d->>'workspaceId')::uuid is distinct from p_workspace or (d->>'creatorId')::uuid is distinct from p_creator or (d->>'connectionId')::uuid is distinct from c.id then raise exception 'NOT_FOUND'; end if;
      if (d->>'generation')::integer is distinct from c.generation then raise exception 'STALE_CONNECTION'; end if;
      if (d->>'observedAt')::timestamptz is null or (d->>'fetchedAt')::timestamptz is null then raise exception 'INVALID_INPUT'; end if;
      for metric in select value from jsonb_each(d->'metrics') loop
        if private.integration_keys(metric,array['value','availability','reason']) is not true or not (metric ?& array['value','availability','reason'])
          or jsonb_typeof(metric->'value') not in ('null','number') or jsonb_typeof(metric->'reason') not in ('null','string')
          or length(metric->>'reason')>300 or coalesce(metric->>'availability','') not in ('available','missing','unsupported','stale','revoked','rate_limited')
          or (metric->>'availability'<>'available' and metric->'value'<>'null'::jsonb) then raise exception 'INVALID_INPUT'; end if;
      end loop;
      select * into r from public.integration_resources where id=(d->>'id')::uuid for update;
      if found and (r.connection_id<>c.id or r.workspace_id<>p_workspace or r.creator_id<>p_creator) then raise exception 'NOT_FOUND'; end if;
      if r.id is not null and r.data->>'externalId' is distinct from d->>'externalId' then raise exception 'INVALID_INPUT'; end if;
      if r.id is not null and r.data->'rights' is distinct from d->'rights' then
        perform private.integration_invalidate_sources(p_workspace,p_creator,array(select id from public.studio_sources
          where integration_resource_id=r.id and workspace_id=p_workspace and creator_id=p_creator and revoked_at is null));
      end if;
      d:=d-'snapshotId';
      insert into public.integration_resources(id,connection_id,workspace_id,creator_id,generation,data)
        values((d->>'id')::uuid,c.id,p_workspace,p_creator,c.generation,d)
        on conflict(id) do update set generation=excluded.generation,data=excluded.data;
      -- Reuse only the unchanged current snapshot. Returning to a historical
      -- rights/version state must never reactivate its old source consent.
      select * into snap from public.integration_snapshots where id=r.snapshot_id and resource_id=(d->>'id')::uuid and generation=c.generation
        and data->>'version'=d->>'version' and data->>'contentHash'=d->>'contentHash' and data->'rights'=d->'rights';
      if snap.id is null then
        insert into public.integration_snapshots(connection_id,resource_id,workspace_id,creator_id,generation,data)
          values(c.id,(d->>'id')::uuid,p_workspace,p_creator,c.generation,d) returning * into snap;
      end if;
      d:=d||jsonb_build_object('snapshotId',snap.id);
      update public.integration_resources set snapshot_id=snap.id,data=d where id=(d->>'id')::uuid;
      output:=output||jsonb_build_array(d);
    end loop;
    if p_payload ? 'lastSyncAt' then
      if (p_payload->>'lastSyncAt')::timestamptz is null then raise exception 'INVALID_INPUT'; end if;
      update public.integration_connections set data=jsonb_set(data,'{lastSyncAt}',p_payload->'lastSyncAt') where id=c.id;
    end if;
    return jsonb_build_object('resources',output);
  elsif p_action='reserve_sync' then
    select * into run from public.integration_sync_runs where workspace_id=p_workspace and creator_id=p_creator and request_id=p_request for update;
    if found then
      if run.payload_hash<>fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      if run.status in ('completed','partial') then
        if not private.integration_cached_resources(p_workspace,p_creator,c.id,c.generation,run.result->'resources') then raise exception 'SOURCE_UNAVAILABLE'; end if;
        return jsonb_build_object('action','replay','result',run.result);
      end if;
      return '{"action":"pending"}';
    end if;
    if (c.data->>'lastSyncAt')::timestamptz>clock_timestamp()-interval '60 minutes' then raise exception 'RATE_LIMITED'; end if;
    -- An explicit new request after an unknown outcome may start a new run. An
    -- in-flight run is never taken over or implicitly re-executed by lease expiry.
    if exists(select 1 from public.integration_sync_runs where connection_id=c.id and generation=c.generation and status='running') then
      insert into public.integration_sync_runs(workspace_id,creator_id,request_id,connection_id,generation,payload_hash,status)
        values(p_workspace,p_creator,p_request,c.id,c.generation,fingerprint,'unknown');
      return '{"action":"pending"}';
    end if;
    insert into public.integration_sync_runs(workspace_id,creator_id,request_id,connection_id,generation,payload_hash,status)
      values(p_workspace,p_creator,p_request,c.id,c.generation,fingerprint,'running');
    return '{"action":"reserved"}';
  elsif p_action in ('finish_sync','fail_sync') then
    select * into run from public.integration_sync_runs where workspace_id=p_workspace and creator_id=p_creator and connection_id=c.id and generation=c.generation and request_id=(p_payload->>'runRequestId')::uuid for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if run.status<>'running' then raise exception 'SOURCE_UNAVAILABLE'; end if;
    if p_action='fail_sync' then
      update public.integration_sync_runs set status='unknown',finished_at=clock_timestamp() where workspace_id=p_workspace and creator_id=p_creator and request_id=run.request_id;
    else
      v_result:=p_payload->'result';
      if private.integration_keys(v_result,array['status','resources']) is not true or coalesce(v_result->>'status','') not in ('completed','partial')
        or jsonb_typeof(v_result->'resources') is distinct from 'array' or jsonb_array_length(v_result->'resources')>50 then raise exception 'INVALID_INPUT'; end if;
      for x in select value from jsonb_array_elements(v_result->'resources') loop
        if not exists(select 1 from public.integration_resources where id=(x->>'id')::uuid and connection_id=c.id and generation=c.generation and data=x) then raise exception 'INVALID_INPUT'; end if;
      end loop;
      update public.integration_sync_runs set status=v_result->>'status',result=v_result,finished_at=clock_timestamp() where workspace_id=p_workspace and creator_id=p_creator and request_id=run.request_id;
      update public.integration_connections set data=jsonb_set(data,'{lastSyncAt}',to_jsonb(clock_timestamp())) where id=c.id;
    end if;
    return '{}';
  end if;
  raise exception 'INVALID_INPUT';
end $$;
revoke all on function private.integration_hash(jsonb),private.integration_keys(jsonb,text[]),private.integration_envelope(jsonb),private.integration_cached_resources(uuid,uuid,uuid,integer,jsonb),private.integration_immutable_snapshot(),
  private.integration_connection(uuid,uuid,uuid,integer,boolean),private.integration_foundation_command(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
