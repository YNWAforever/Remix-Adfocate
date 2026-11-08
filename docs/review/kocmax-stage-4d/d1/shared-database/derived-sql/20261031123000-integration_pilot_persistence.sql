-- D0 installs no provider credentials, jobs, target settings, or network clients.
-- The existing 4A-C functions remain intact behind this service-only boundary.
create table private.integration_pilot_grants (
  grant_key text primary key, state text not null default 'active' check(state in ('active','pending','manual_action','confirmed')),
  changed_at timestamptz not null default clock_timestamp()
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE private.integration_pilot_grants FROM PUBLIC, anon, authenticated, service_role;

create table private.integration_pilot_bindings (
  id uuid primary key default gen_random_uuid(), connection_id uuid not null, workspace_id uuid not null, creator_id uuid not null,
  generation integer not null check(generation>0), provider text not null check(provider in ('google_drive','instagram')),
  environment_id text not null, database_project_id text not null, origin text not null, provider_project_id text not null,
  subject_hash text not null check(subject_hash ~ '^[a-f0-9]{64}$'), api_version text not null,
  grant_key text not null references private.integration_pilot_grants, activated boolean not null default false,
  unique(connection_id,generation), foreign key(creator_id,workspace_id) references public.creators(id,workspace_id)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE private.integration_pilot_bindings FROM PUBLIC, anon, authenticated, service_role;

create table private.integration_pilot_oauth (
  state_hash text primary key references private.integration_oauth_states(state_hash) on delete cascade,
  workspace_id uuid not null, creator_id uuid not null, secret jsonb,
  ticket_hash text unique check(ticket_hash ~ '^[a-f0-9]{64}$'), code jsonb, ticket_expires_at timestamptz, completed_at timestamptz,
  foreign key(creator_id,workspace_id) references public.creators(id,workspace_id)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE private.integration_pilot_oauth FROM PUBLIC, anon, authenticated, service_role;

alter table private.integration_credentials add column credential_version integer not null default 1 check(credential_version>0);
create table private.integration_refresh_leases (
  connection_id uuid primary key, workspace_id uuid not null, creator_id uuid not null, generation integer not null,
  lease_id uuid not null default gen_random_uuid(), holder_id text not null, credential_version integer not null,
  expires_at timestamptz not null,
  foreign key(connection_id,workspace_id,creator_id) references public.integration_connections(id,workspace_id,creator_id) on delete cascade
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE private.integration_refresh_leases FROM PUBLIC, anon, authenticated, service_role;

create table private.integration_pilot_evidence (
  resource_id uuid not null, workspace_id uuid not null, creator_id uuid not null, generation integer not null,
  content_hash text not null, fetched_at timestamptz not null, evidence jsonb not null,
  primary key(resource_id,generation,content_hash,fetched_at),
  foreign key(resource_id) references public.integration_resources(id) on delete cascade deferrable initially deferred
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE private.integration_pilot_evidence FROM PUBLIC, anon, authenticated, service_role;

-- Deliberately no FK: erasure fences must survive deletion and backup restoration.
create table private.integration_pilot_tombstones (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, creator_id uuid not null, connection_id uuid,
  through_generation integer not null check(through_generation>0), kind text not null check(kind in ('revoke','purge','account_delete')),
  created_at timestamptz not null default clock_timestamp(), unique(workspace_id,creator_id,connection_id,through_generation,kind)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE private.integration_pilot_tombstones FROM PUBLIC, anon, authenticated, service_role;

create table private.integration_pilot_maintenance (
  workspace_id uuid not null, creator_id uuid not null, lease_id uuid, expires_at timestamptz,
  restore_pending boolean not null default false, primary key(workspace_id,creator_id)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE private.integration_pilot_maintenance FROM PUBLIC, anon, authenticated, service_role;

do $$ declare t text; begin
  foreach t in array array['integration_pilot_grants','integration_pilot_bindings','integration_pilot_oauth','integration_refresh_leases',
    'integration_pilot_evidence','integration_pilot_tombstones','integration_pilot_maintenance'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;
create function private.integration_pilot_return_path(p_path text) returns boolean language sql immutable set search_path='' as $$
  select p_path is not null and length(p_path) between 1 and 2048 and p_path ~ '^/(connections|studio|home)([?]|$)'
    and position(chr(92) in p_path)=0 and position('%' in p_path)=0 and p_path !~ '[[:space:][:cntrl:]]';
$$;
alter table private.integration_oauth_states drop constraint integration_oauth_states_return_path_check;
alter table private.integration_oauth_states add constraint integration_oauth_states_return_path_check check(private.integration_pilot_return_path(return_path));
revoke all on function private.integration_pilot_return_path(text) from public,anon,authenticated,service_role;
create function private.integration_pilot_metadata(p_connection uuid,p_generation integer) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('sampleOnly',b.id is null,'mode',case when b.id is null then 'mock' else 'live_pilot' end,
    'acquisitionMethod',case when b.id is null then 'mock' else 'provider_api' end,'apiVersion',b.api_version,'claimVerification','unverified')
  from (select 1) seed left join private.integration_pilot_bindings b on b.connection_id=p_connection and b.generation=p_generation and b.activated;
$$;
create function private.integration_pilot_provenance() returns trigger language plpgsql set search_path='' as $$
declare meta jsonb; proof jsonb;
begin
  if tg_table_name='studio_sources' then
    if new.integration is null then return new; end if;
    select data into proof from public.integration_snapshots where id=(new.integration->>'snapshot_id')::uuid
      and workspace_id=new.workspace_id and creator_id=new.creator_id;
    if proof is null then raise exception 'NOT_FOUND'; end if;
    new.integration:=new.integration||jsonb_build_object('sample_only',coalesce(proof->'sampleOnly','true'),
      'mode',coalesce(proof->>'mode','mock'),'acquisition_method',coalesce(proof->>'acquisitionMethod','mock'),
      'api_version',proof->'apiVersion','claim_verification','unverified');
    if proof ? 'evidence' then new.integration:=new.integration||jsonb_build_object('evidence',proof->'evidence'); end if;
  else
    if tg_table_name='integration_connections' then meta:=private.integration_pilot_metadata(new.id,new.generation);
    else meta:=private.integration_pilot_metadata(new.connection_id,new.generation); end if;
    -- Revocation increments the connection generation; provenance stays that of the original grant.
    if tg_table_name='integration_connections' and tg_op='UPDATE' then
      if new.status='revoked' then
      meta:=jsonb_build_object('sampleOnly',coalesce(old.data->'sampleOnly','true'),'mode',coalesce(old.data->>'mode','mock'),
        'acquisitionMethod',coalesce(old.data->>'acquisitionMethod','mock'),'apiVersion',old.data->'apiVersion','claimVerification','unverified');
      end if;
    end if;
    new.data:=new.data||meta;
    if tg_table_name<>'integration_connections' then
      select evidence into proof from private.integration_pilot_evidence where resource_id=(new.data->>'id')::uuid
        and workspace_id=new.workspace_id and creator_id=new.creator_id and generation=new.generation and content_hash=new.data->>'contentHash'
        and fetched_at=(new.data->>'fetchedAt')::timestamptz;
      if proof is not null then new.data:=new.data||jsonb_build_object('evidence',proof); end if;
    end if;
  end if;
  return new;
end $$;
create trigger integration_pilot_connection_provenance before insert or update on public.integration_connections for each row execute function private.integration_pilot_provenance();
create trigger integration_pilot_resource_provenance before insert or update on public.integration_resources for each row execute function private.integration_pilot_provenance();
create trigger integration_pilot_snapshot_provenance before insert on public.integration_snapshots for each row execute function private.integration_pilot_provenance();
create trigger integration_pilot_source_provenance before insert on public.studio_sources for each row execute function private.integration_pilot_provenance();
create function private.integration_pilot_tombstone() returns trigger language plpgsql set search_path='' as $$
declare c public.integration_connections;
begin
  if tg_table_name='creators' then
    if new.status='deleted' and old.status is distinct from 'deleted' then
      insert into private.integration_pilot_tombstones(workspace_id,creator_id,through_generation,kind)
        values(old.workspace_id,old.id,2147483647,'account_delete');
    end if;
    return new;
  end if;
  if tg_op='DELETE' then c:=old; else c:=new; end if;
  if tg_op='DELETE' or c.status='revoked' then
    insert into private.integration_pilot_tombstones(workspace_id,creator_id,connection_id,through_generation,kind)
      values(c.workspace_id,c.creator_id,c.id,c.generation,case when tg_op='DELETE' or c.data->>'subject'='' then 'purge' else 'revoke' end)
      on conflict do nothing;
    delete from private.integration_refresh_leases where connection_id=c.id;
    update private.integration_pilot_oauth o set secret=null,code=null,completed_at=clock_timestamp()
      from private.integration_oauth_states s where s.state_hash=o.state_hash and s.workspace_id=c.workspace_id and s.creator_id=c.creator_id and s.provider=c.provider;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger integration_pilot_tombstone after update or delete on public.integration_connections for each row execute function private.integration_pilot_tombstone();
create trigger integration_pilot_account_tombstone before update of status on public.creators for each row execute function private.integration_pilot_tombstone();
-- Only the callback service can resolve the original owner, before encrypting its code.
create function public.integration_oauth_lookup(p_state_hash text,p_provider text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.integration_oauth_states;
begin
  select st.* into s from private.integration_oauth_states st join private.integration_pilot_oauth o on o.state_hash=st.state_hash
    join public.creators c on c.id=st.creator_id and c.workspace_id=st.workspace_id and c.status='active'
    where st.state_hash=p_state_hash and st.provider=p_provider and st.consumed_at is null and st.expires_at>clock_timestamp()
      and o.secret is not null and o.completed_at is null and st.expected_generation=coalesce((select generation from public.integration_connections
        where workspace_id=st.workspace_id and creator_id=st.creator_id and provider=st.provider),0);
  if not found then raise exception 'OAUTH_STATE_INVALID'; end if;
  return jsonb_build_object('actor',jsonb_build_object('workspaceId',s.workspace_id,'creatorId',s.creator_id),
    'expectedGeneration',s.expected_generation,'returnPath',s.return_path,'expiresAt',s.expires_at);
end $$;
revoke all on function public.integration_oauth_lookup(text,text) from public,anon,authenticated;
grant execute on function public.integration_oauth_lookup(text,text) to service_role;
-- Callback service has no actor argument. The original state is the only lookup authority.
create function public.integration_oauth_callback(p_state_hash text,p_provider text,p_ticket_hash text,p_code jsonb,p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.integration_oauth_states;
begin
  if coalesce(p_state_hash,'') !~ '^[a-f0-9]{64}$' or coalesce(p_ticket_hash,'') !~ '^[a-f0-9]{64}$'
    or private.integration_envelope(p_code) is not true or octet_length(p_code::text)>16384
    or p_expires_at is null or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '5 minutes' then raise exception 'OAUTH_STATE_INVALID'; end if;
  select * into s from private.integration_oauth_states where state_hash=p_state_hash;
  perform 1 from public.creators where id=s.creator_id and workspace_id=s.workspace_id and status='active' for update;
  if not found then raise exception 'OAUTH_STATE_INVALID'; end if;
  update private.integration_oauth_states set consumed_at=clock_timestamp()
    where state_hash=p_state_hash and provider=p_provider and consumed_at is null and expires_at>clock_timestamp()
      and expected_generation=coalesce((select generation from public.integration_connections where workspace_id=s.workspace_id and creator_id=s.creator_id and provider=p_provider),0)
    returning * into s;
  if not found then raise exception 'OAUTH_STATE_INVALID'; end if;
  update private.integration_pilot_oauth set ticket_hash=p_ticket_hash,code=p_code,ticket_expires_at=least(p_expires_at,s.expires_at)
    where state_hash=p_state_hash and secret is not null and ticket_hash is null and completed_at is null;
  if not found then raise exception 'OAUTH_STATE_INVALID'; end if;
  return '{"stored":true}';
end $$;
revoke all on function public.integration_oauth_callback(text,text,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.integration_oauth_callback(text,text,text,jsonb,timestamptz) to service_role;
-- Rename rather than rewrite the reviewed 4A-C command dispatcher and helpers.
alter function public.integration_command(uuid,uuid,uuid,text,jsonb) set schema private;
alter function private.integration_command(uuid,uuid,uuid,text,jsonb) rename to integration_command_stage4abc;
revoke all on function private.integration_command_stage4abc(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.integration_command(p_workspace uuid,p_creator uuid,p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
<<pilot>>
declare
  c public.integration_connections; peer public.integration_connections; b private.integration_pilot_bindings;
  o private.integration_pilot_oauth; s private.integration_oauth_states; k private.integration_credentials; lease private.integration_refresh_leases; cached private.integration_commands;
  d jsonb; v jsonb; proof jsonb; result jsonb; payload jsonb:=p_payload; clean jsonb:='[]'; grantkey text; expiry timestamptz; duration integer;
begin
  if p_workspace is null or p_creator is null or p_request is null or p_action is null or jsonb_typeof(p_payload) is distinct from 'object'
    or octet_length(p_payload::text)>1048576 then raise exception 'INVALID_INPUT'; end if;
  -- Small pilot: one DB transaction advisory lock gives a deterministic order for
  -- cross-owner grant invalidation BEFORE any creator lock (Studio uses creator locks).
  perform pg_advisory_xact_lock(431230);
  perform 1 from public.creators where id=p_creator and workspace_id=p_workspace and (status='active'
    or p_action in ('tombstone_export','restore_import','restore_replay','maintenance','maintenance_acquire')) for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists(select 1 from private.integration_pilot_tombstones where workspace_id=p_workspace and creator_id=p_creator and kind='account_delete')
    and p_action not in ('tombstone_export','restore_import','restore_replay','maintenance','maintenance_acquire','revoke','purge','export') then raise exception 'SOURCE_UNAVAILABLE'; end if;
  if exists(select 1 from private.integration_pilot_maintenance where workspace_id=p_workspace and creator_id=p_creator and restore_pending)
    and p_action not in ('restore_replay','restore_import','tombstone_export','maintenance') then raise exception 'RESTORE_PENDING'; end if;

  if p_action='pilot_bind' then
    if coalesce(p_payload->>'provider','') not in ('google_drive','instagram') or coalesce(p_payload->>'subjectHash','') !~ '^[a-f0-9]{64}$'
      or exists(select 1 from unnest(array['environmentId','databaseProjectId','providerProjectId','apiVersion']) x
        where jsonb_typeof(p_payload->x) is distinct from 'string' or length(p_payload->>x) not between 1 and 160)
      or coalesce(p_payload->>'origin','') !~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$'
      or coalesce((p_payload->>'generation')::integer,0)<1 then raise exception 'INVALID_INPUT'; end if;
    select * into c from public.integration_connections where workspace_id=p_workspace and creator_id=p_creator and provider=p_payload->>'provider';
    if coalesce(c.generation,0)+1<>(p_payload->>'generation')::integer or (c.id is not null and c.id<>(p_payload->>'id')::uuid) then raise exception 'STALE_CONNECTION'; end if;
    grantkey:=private.integration_hash(jsonb_build_array(p_payload->>'provider',p_payload->>'providerProjectId',p_payload->>'subjectHash'));
    insert into private.integration_pilot_grants(grant_key) values(grantkey) on conflict do nothing;
    if exists(select 1 from private.integration_pilot_grants where grant_key=grantkey and state in ('pending','manual_action')) then raise exception 'REVOCATION_PENDING'; end if;
    insert into private.integration_pilot_bindings(connection_id,workspace_id,creator_id,generation,provider,environment_id,database_project_id,origin,provider_project_id,subject_hash,api_version,grant_key)
      values((p_payload->>'id')::uuid,p_workspace,p_creator,(p_payload->>'generation')::integer,p_payload->>'provider',p_payload->>'environmentId',p_payload->>'databaseProjectId',p_payload->>'origin',p_payload->>'providerProjectId',p_payload->>'subjectHash',p_payload->>'apiVersion',grantkey)
      returning * into b;
    return jsonb_build_object('bindingId',b.id);
  elsif p_action='oauth_start' then
    if private.integration_envelope(p_payload->'secret') is not true or octet_length((p_payload->'secret')::text)>16384
      or jsonb_typeof(p_payload->'returnPath') is distinct from 'string' or private.integration_pilot_return_path(p_payload->>'returnPath') is not true then raise exception 'INVALID_INPUT'; end if;
    -- Preserve the old mock start validator, then store the separately validated pilot path.
    perform private.integration_command_stage4abc(p_workspace,p_creator,p_request,'start',jsonb_set(p_payload-'secret','{returnPath}','"/connections"'));
    update private.integration_oauth_states set return_path=p_payload->>'returnPath'
      where state_hash=p_payload->>'stateHash' and workspace_id=p_workspace and creator_id=p_creator;
    insert into private.integration_pilot_oauth(state_hash,workspace_id,creator_id,secret) values(p_payload->>'stateHash',p_workspace,p_creator,p_payload->'secret');
    return '{}';
  elsif p_action in ('oauth_consume','oauth_complete') then
    select * into o from private.integration_pilot_oauth where workspace_id=p_workspace and creator_id=p_creator
      and case when p_action='oauth_complete' then ticket_hash=p_payload->>'ticketHash' else state_hash=p_payload->>'stateHash' end for update;
    if not found or o.completed_at is not null or o.secret is null then raise exception 'OAUTH_STATE_INVALID'; end if;
    select * into s from private.integration_oauth_states where state_hash=o.state_hash for update;
    if s.provider is distinct from p_payload->>'provider' or s.expires_at<=clock_timestamp()
      or s.expected_generation<>coalesce((select generation from public.integration_connections where workspace_id=p_workspace and creator_id=p_creator and provider=s.provider),0)
      or (s.session_hash is distinct from p_payload->>'sessionHash' and (p_action<>'oauth_complete' or p_payload->'allowRelogin' is distinct from 'true'::jsonb))
      or (p_action='oauth_complete' and (o.code is null or o.ticket_expires_at<=clock_timestamp()))
      or (p_action='oauth_consume' and (s.consumed_at is not null or o.ticket_hash is not null)) then raise exception 'OAUTH_STATE_INVALID'; end if;
    result:=jsonb_build_object('stateHash',s.state_hash,'expectedGeneration',s.expected_generation,'returnPath',s.return_path,'secret',o.secret);
    if p_action='oauth_complete' then result:=result||jsonb_build_object('code',o.code); end if;
    update private.integration_oauth_states set consumed_at=coalesce(consumed_at,clock_timestamp()) where state_hash=s.state_hash;
    update private.integration_pilot_oauth set secret=null,code=null,completed_at=clock_timestamp() where state_hash=s.state_hash;
    return result;
  end if;

  if p_action in ('refresh_acquire','refresh_commit','refresh_abandon') then
    if p_action<>'refresh_acquire' and (jsonb_typeof(p_payload->'leaseId') is distinct from 'string'
      or coalesce(p_payload->>'leaseId','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'
      or jsonb_typeof(p_payload->'credentialVersion') is distinct from 'number'
      or coalesce(p_payload->>'credentialVersion','') !~ '^[1-9][0-9]*$'
      or (p_payload->>'credentialVersion')::numeric>2147483647) then raise exception 'INVALID_INPUT'; end if;
    select * into c from public.integration_connections where id=(p_payload->>'id')::uuid and workspace_id=p_workspace and creator_id=p_creator for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if c.generation is distinct from (p_payload->>'generation')::integer or c.status='revoked' then raise exception 'STALE_CONNECTION'; end if;
    if c.status='reauth_required' then raise exception 'REAUTH_REQUIRED'; end if;
    select * into k from private.integration_credentials where connection_id=c.id and generation=c.generation and revoke_until is null;
    if not found then raise exception 'REAUTH_REQUIRED'; end if;
    select * into lease from private.integration_refresh_leases where connection_id=c.id;
    if p_action='refresh_acquire' then
      duration:=coalesce((p_payload->>'leaseSeconds')::integer,30);
      if duration not between 1 and 60 or coalesce(length(p_payload->>'holderId'),0) not between 1 and 160 then raise exception 'INVALID_INPUT'; end if;
      if lease.connection_id is not null then
        if lease.expires_at>clock_timestamp() then return '{"status":"busy"}'; end if;
        update public.integration_connections set status='reauth_required',data=data||'{"status":"reauth_required","lastError":"REAUTH_REQUIRED"}'::jsonb where id=c.id;
        delete from private.integration_credentials where connection_id=c.id;
        delete from private.integration_refresh_leases where connection_id=c.id;
        return '{"status":"reauth_required"}';
      end if;
      insert into private.integration_refresh_leases(connection_id,workspace_id,creator_id,generation,holder_id,credential_version,expires_at)
        values(c.id,p_workspace,p_creator,c.generation,p_payload->>'holderId',k.credential_version,clock_timestamp()+duration*interval '1 second') returning * into lease;
      return jsonb_build_object('status','acquired','leaseId',lease.lease_id,'credentialVersion',k.credential_version,'credential',k.credential,'expiresAt',lease.expires_at);
    end if;
    if not found then raise exception 'REFRESH_LEASE_STALE'; end if;
    if lease.lease_id is distinct from (p_payload->>'leaseId')::uuid or lease.generation is distinct from c.generation
      or lease.credential_version is distinct from (p_payload->>'credentialVersion')::integer or k.credential_version is distinct from lease.credential_version
      or (p_action='refresh_commit' and lease.expires_at<=clock_timestamp()) then raise exception 'REFRESH_LEASE_STALE'; end if;
    if p_action='refresh_abandon' then
      update public.integration_connections set status='reauth_required',data=data||'{"status":"reauth_required","lastError":"REAUTH_REQUIRED"}'::jsonb where id=c.id;
      delete from private.integration_credentials where connection_id=c.id;
      delete from private.integration_refresh_leases where connection_id=c.id;
      return '{"status":"reauth_required"}';
    end if;
    expiry:=(p_payload->>'expiresAt')::timestamptz;
    if private.integration_envelope(p_payload->'credential') is not true or octet_length((p_payload->'credential')::text)>16384
      or expiry is null or expiry<=clock_timestamp() then raise exception 'INVALID_INPUT'; end if;
    update private.integration_credentials set credential=p_payload->'credential',credential_version=k.credential_version + 1,expires_at=expiry where connection_id=c.id;
    update public.integration_connections set data=jsonb_set(data,'{expiresAt}',p_payload->'expiresAt') where id=c.id;
    delete from private.integration_refresh_leases where connection_id=c.id;
    return jsonb_build_object('credentialVersion',k.credential_version+1);
  end if;

  if p_action in ('maintenance_acquire','maintenance','tombstone_export','restore_import','restore_replay') then
    return private.integration_pilot_maintenance_command(p_workspace,p_creator,p_request,p_action,p_payload);
  end if;

  if p_action='connect' then
    d:=p_payload->'connection';
    if exists(select 1 from public.integration_connections cc join private.integration_pilot_bindings bb on bb.connection_id=cc.id and bb.activated
      and bb.generation=case when cc.status='revoked' then cc.generation-1 else cc.generation end
      join private.integration_pilot_grants gg on gg.grant_key=bb.grant_key where cc.workspace_id=p_workspace and cc.creator_id=p_creator
      and cc.provider=d->>'provider' and gg.state in ('pending','manual_action')) then raise exception 'REVOCATION_PENDING'; end if;
    if d->'sampleOnly'='false'::jsonb then
      select * into b from private.integration_pilot_bindings where id=(p_payload->>'bindingId')::uuid and connection_id=(d->>'id')::uuid
        and workspace_id=p_workspace and creator_id=p_creator and provider=d->>'provider' and generation=(d->>'generation')::integer;
      if not found then raise exception 'PILOT_BINDING_REQUIRED'; end if;
      if exists(select 1 from private.integration_pilot_grants where grant_key=b.grant_key and state in ('pending','manual_action')) then raise exception 'REVOCATION_PENDING'; end if;
      update private.integration_pilot_bindings set activated=true where id=b.id;
      update private.integration_pilot_grants set state='active',changed_at=clock_timestamp() where grant_key=b.grant_key;
    elsif exists(select 1 from private.integration_pilot_bindings where connection_id=(d->>'id')::uuid and generation=(d->>'generation')::integer and activated) then
      raise exception 'PILOT_BINDING_REQUIRED';
    end if;
    if d->>'provider'='google_drive' then
      -- Offline injected adapters also use OIDC; retaining its scope does not activate live provenance.
      d:=jsonb_set(d,'{scopes}',(select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements(d->'scopes') x where x<>'"openid"'::jsonb));
    end if;
    d:=(d-array['mode','acquisitionMethod','apiVersion','claimVerification'])||'{"sampleOnly":true}'::jsonb;
    payload:=jsonb_set(payload-'bindingId','{connection}',d);
  elsif p_action='resources' then
    select * into b from private.integration_pilot_bindings where connection_id=(p_payload->>'id')::uuid and workspace_id=p_workspace and creator_id=p_creator
      and generation=(p_payload->>'generation')::integer and activated;
    for v in select value from jsonb_array_elements(p_payload->'resources') loop
      if v->'sampleOnly'='false'::jsonb and b.id is null then raise exception 'PILOT_BINDING_REQUIRED'; end if;
      if b.id is not null and v->'sampleOnly' is distinct from 'false'::jsonb then raise exception 'PILOT_BINDING_REQUIRED'; end if;
      proof:=v->'evidence';
      if proof is not null then
        if private.integration_keys(proof,array['apiVersion','endpoint','measurementPeriod','selectionPeriod','permalink']) is not true
          or exists(select 1 from unnest(array['apiVersion','endpoint','measurementPeriod']) x where jsonb_typeof(proof->x) is distinct from 'string' or length(proof->>x) not between 1 and 300)
          or (proof ? 'permalink' and (jsonb_typeof(proof->'permalink')<>'string' or length(proof->>'permalink')>2000 or proof->>'permalink' !~ '^https://'))
          or (proof ? 'selectionPeriod' and (private.integration_keys(proof->'selectionPeriod',array['start','end']) is not true
            or (proof->'selectionPeriod'->>'start')::timestamptz is null or (proof->'selectionPeriod'->>'end')::timestamptz is null)) then raise exception 'INVALID_INPUT'; end if;
      end if;
      clean:=clean||jsonb_build_array((v-array['mode','acquisitionMethod','apiVersion','claimVerification','evidence'])||'{"sampleOnly":true}'::jsonb);
    end loop;
    payload:=jsonb_set(payload,'{resources}',clean);
    -- The legacy dispatcher validates cached intent, current generation and source
    -- availability before replay. A provider reread must not mutate that state first.
    if exists(select 1 from private.integration_commands where workspace_id=p_workspace and creator_id=p_creator and request_id=p_request) then
      return private.integration_command_stage4abc(p_workspace,p_creator,p_request,p_action,payload);
    end if;
    for v in select value from jsonb_array_elements(p_payload->'resources') loop
      proof:=v->'evidence';
      if proof is not null then
        insert into private.integration_pilot_evidence(resource_id,workspace_id,creator_id,generation,content_hash,fetched_at,evidence)
          values((v->>'id')::uuid,p_workspace,p_creator,(p_payload->>'generation')::integer,v->>'contentHash',(v->>'fetchedAt')::timestamptz,proof) on conflict do nothing;
        if not exists(select 1 from private.integration_pilot_evidence where resource_id=(v->>'id')::uuid and workspace_id=p_workspace and creator_id=p_creator
          and generation=(p_payload->>'generation')::integer and content_hash=v->>'contentHash' and fetched_at=(v->>'fetchedAt')::timestamptz and evidence=proof) then raise exception 'SOURCE_CHANGED'; end if;
        -- Observation metadata can evolve without changing the provider content hash.
        -- Detach only the current pointer so the original dispatcher appends a snapshot;
        -- historical snapshots and imported source evidence remain immutable.
        update public.integration_resources r set snapshot_id=null where r.id=(v->>'id')::uuid and r.workspace_id=p_workspace and r.creator_id=p_creator
          and r.connection_id=(p_payload->>'id')::uuid and r.generation=(p_payload->>'generation')::integer
          and exists(select 1 from public.integration_snapshots snap where snap.id=r.snapshot_id
            and ((snap.data->>'fetchedAt')::timestamptz is distinct from (v->>'fetchedAt')::timestamptz or snap.data->'evidence' is distinct from proof));
      end if;
    end loop;
  elsif p_action='update_credentials' then
    if exists(select 1 from private.integration_pilot_bindings where connection_id=(p_payload->>'id')::uuid and generation=(p_payload->>'generation')::integer and activated)
      or exists(select 1 from private.integration_refresh_leases where connection_id=(p_payload->>'id')::uuid) then raise exception 'REFRESH_LEASE_REQUIRED'; end if;
  end if;

  if p_action in ('revoke','purge','revoke_result') then
    select * into c from public.integration_connections where id=(p_payload->>'id')::uuid and workspace_id=p_workspace and creator_id=p_creator;
    if not found then raise exception 'NOT_FOUND'; end if;
    select * into b from private.integration_pilot_bindings where connection_id=c.id and activated
      and generation=case when c.status='revoked' then c.generation-1 else c.generation end;
    if b.id is not null and c.provider='google_drive' then
      select * into cached from private.integration_commands where workspace_id=p_workspace and creator_id=p_creator and request_id=p_request;
      if found then
        if cached.action<>p_action or cached.payload_hash<>private.integration_hash(p_payload) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
        if cached.invalidated_at is not null then raise exception 'SOURCE_UNAVAILABLE'; end if;
        if p_action<>'purge' and c.generation is distinct from cached.generation then raise exception 'STALE_CONNECTION'; end if;
        return cached.result;
      end if;
      if p_action<>'purge' and c.generation is distinct from (p_payload->>'generation')::integer then raise exception 'STALE_CONNECTION'; end if;
      -- Cleanup/retry of an already revoked grant cannot revoke a peer's later authorization.
      if c.status='revoked' and p_action in ('purge','revoke') then
        return private.integration_command_stage4abc(p_workspace,p_creator,p_request,p_action,p_payload);
      end if;
      if p_action='revoke_result' then
        if c.status<>'revoked' then raise exception 'STALE_CONNECTION'; end if;
        if coalesce(p_payload->>'provider','') not in ('revoked','pending','manual_action') then raise exception 'INVALID_INPUT'; end if;
        if c.data->>'providerRevocation'='revoked' then return jsonb_build_object('connection',c.data); end if;
      end if;
      -- Never disclose peer IDs, owner names, scopes, credentials or connection count.
      for peer in select distinct cc.* from public.integration_connections cc join private.integration_pilot_bindings bb on bb.connection_id=cc.id
        and bb.generation=case when cc.status='revoked' then cc.generation-1 else cc.generation end and bb.activated
        where bb.grant_key=b.grant_key order by cc.workspace_id,cc.creator_id,cc.id loop
        perform 1 from public.creators where id=peer.creator_id and workspace_id=peer.workspace_id for update;
        if p_action in ('revoke','purge') and peer.status<>'revoked' then
          perform private.integration_privacy_command(peer.workspace_id,peer.creator_id,gen_random_uuid(),'revoke',jsonb_build_object('id',peer.id,'generation',peer.generation));
        elsif p_action='revoke_result' and peer.status='revoked' then
          perform private.integration_privacy_command(peer.workspace_id,peer.creator_id,gen_random_uuid(),'revoke_result',jsonb_build_object('id',peer.id,'generation',peer.generation,'provider',p_payload->>'provider'));
        end if;
      end loop;
      update private.integration_pilot_grants set state=case when p_action='revoke_result' then case p_payload->>'provider' when 'revoked' then 'confirmed' when 'pending' then 'pending' else 'manual_action' end
        when state='confirmed' and c.status='revoked' then state else 'pending' end,changed_at=clock_timestamp() where grant_key=b.grant_key;
      if p_action='purge' then perform private.integration_purge(p_workspace,p_creator,c.id); result:='{"state":"complete"}';
      else select jsonb_build_object('connection',data) into result from public.integration_connections where id=c.id; end if;
      insert into private.integration_commands(workspace_id,creator_id,request_id,action,payload_hash,result,connection_id,generation)
        select p_workspace,p_creator,p_request,p_action,private.integration_hash(p_payload),pilot.result,c.id,generation from public.integration_connections where id=c.id;
      return result;
    end if;
  end if;

  result:=private.integration_command_stage4abc(p_workspace,p_creator,p_request,p_action,payload);
  if p_action='connect' then
    delete from private.integration_refresh_leases where connection_id=(result->'connection'->>'id')::uuid;
    if p_payload->'connection'->>'provider'='google_drive' and p_payload->'connection'->'scopes' ? 'openid' then
      update public.integration_connections set data=jsonb_set(data,'{scopes}',p_payload->'connection'->'scopes') where id=(result->'connection'->>'id')::uuid returning data into d;
      result:=jsonb_build_object('connection',d);
    end if;
  elsif p_action='resources' then
    select jsonb_build_object('resources',coalesce(jsonb_agg(r.data order by x.ord),'[]')) into result
      from jsonb_array_elements(result->'resources') with ordinality x(value,ord) join public.integration_resources r on r.id=(x.value->>'id')::uuid;
  end if;
  if p_action in ('resources','connect') then
    update private.integration_commands set result=pilot.result where workspace_id=p_workspace and creator_id=p_creator and request_id=p_request;
  end if;
  return result;
exception
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format
    or not_null_violation or check_violation or invalid_parameter_value then raise exception 'INVALID_INPUT' using detail='',hint='';
  when foreign_key_violation then raise exception 'NOT_FOUND' using detail='',hint='';
  when unique_violation then raise exception 'IDEMPOTENCY_CONFLICT' using detail='',hint='';
end $$;
revoke all on function public.integration_command(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.integration_command(uuid,uuid,uuid,text,jsonb) to service_role;
revoke all on function private.integration_pilot_metadata(uuid,integer),private.integration_pilot_provenance(),private.integration_pilot_tombstone() from public,anon,authenticated,service_role;
create function private.integration_pilot_restore_candidates(p_workspace uuid,p_creator uuid)
returns setof public.integration_connections language sql stable set search_path='' as $$
  select c.* from public.integration_connections c where c.workspace_id=p_workspace and c.creator_id=p_creator and exists(
    select 1 from private.integration_pilot_tombstones t where t.workspace_id=p_workspace and t.creator_id=p_creator
      and (t.kind='account_delete' or (t.connection_id=c.id and c.generation<=t.through_generation))
      and (c.status<>'revoked' or (t.kind in ('purge','account_delete') and (
        exists(select 1 from public.integration_resources where connection_id=c.id)
        or exists(select 1 from private.integration_credentials where connection_id=c.id))))) order by c.id;
$$;
create function private.integration_pilot_maintenance_command(p_workspace uuid,p_creator uuid,p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare
  m private.integration_pilot_maintenance; c public.integration_connections; t private.integration_pilot_tombstones;
  n integer:=coalesce((p_payload->>'batchSize')::integer,50); duration integer; dry boolean:=coalesce((p_payload->>'dryRun')::boolean,true);
  stamp timestamptz:=clock_timestamp(); snaps uuid[]; creds uuid[]; states text[]; permits uuid[]; events uuid[];
  v jsonb; output jsonb:='[]'; counts jsonb; more boolean; replayed integer:=0;
begin
  if n not between 1 and 100 then raise exception 'INVALID_INPUT'; end if;
  select * into m from private.integration_pilot_maintenance where workspace_id=p_workspace and creator_id=p_creator for update;
  if p_action='maintenance_acquire' then
    duration:=coalesce((p_payload->>'leaseSeconds')::integer,30);
    if duration not between 1 and 60 then raise exception 'INVALID_INPUT'; end if;
    if m.expires_at>clock_timestamp() then return '{"status":"busy"}'; end if;
    insert into private.integration_pilot_maintenance(workspace_id,creator_id,lease_id,expires_at) values(p_workspace,p_creator,gen_random_uuid(),clock_timestamp()+duration*interval '1 second')
      on conflict(workspace_id,creator_id) do update set lease_id=excluded.lease_id,expires_at=excluded.expires_at returning * into m;
    return jsonb_build_object('status','acquired','leaseId',m.lease_id,'expiresAt',m.expires_at);
  elsif p_action='tombstone_export' then
    n:=coalesce((p_payload->>'limit')::integer,100);
    if n not between 1 and 100 then raise exception 'INVALID_INPUT'; end if;
    for t in select * from private.integration_pilot_tombstones where workspace_id=p_workspace and creator_id=p_creator
      and (p_payload->>'after' is null or id>(p_payload->>'after')::uuid) order by id limit n loop
      output:=output||jsonb_build_array(jsonb_build_object('id',t.id,'workspaceId',t.workspace_id,'creatorId',t.creator_id,
        'connectionId',t.connection_id,'throughGeneration',t.through_generation,'kind',t.kind,'createdAt',t.created_at));
    end loop;
    return jsonb_build_object('tombstones',output,'nextCursor',case when jsonb_array_length(output)=n then output->-1->>'id' else null end);
  elsif p_action='restore_import' then
    if jsonb_typeof(p_payload->'tombstones') is distinct from 'array' or jsonb_array_length(p_payload->'tombstones') not between 1 and 100 then raise exception 'INVALID_INPUT'; end if;
    for v in select value from jsonb_array_elements(p_payload->'tombstones') loop
      if private.integration_keys(v,array['id','workspaceId','creatorId','connectionId','throughGeneration','kind','createdAt']) is not true then raise exception 'INVALID_INPUT'; end if;
      if (v->>'workspaceId')::uuid is distinct from p_workspace or (v->>'creatorId')::uuid is distinct from p_creator then raise exception 'NOT_FOUND'; end if;
      if v->>'kind'<>'account_delete' and v->>'connectionId' is null then raise exception 'INVALID_INPUT'; end if;
      insert into private.integration_pilot_tombstones(id,workspace_id,creator_id,connection_id,through_generation,kind,created_at)
        values((v->>'id')::uuid,p_workspace,p_creator,(v->>'connectionId')::uuid,(v->>'throughGeneration')::integer,v->>'kind',(v->>'createdAt')::timestamptz) on conflict do nothing;
      if not exists(select 1 from private.integration_pilot_tombstones where id=(v->>'id')::uuid and workspace_id=p_workspace and creator_id=p_creator
        and connection_id is not distinct from (v->>'connectionId')::uuid and through_generation=(v->>'throughGeneration')::integer and kind=v->>'kind') then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    end loop;
    insert into private.integration_pilot_maintenance(workspace_id,creator_id,restore_pending) values(p_workspace,p_creator,true)
      on conflict(workspace_id,creator_id) do update set restore_pending=true;
    return jsonb_build_object('imported',jsonb_array_length(p_payload->'tombstones'),'restorePending',true);
  elsif p_action='restore_replay' then
    for c in select * from private.integration_pilot_restore_candidates(p_workspace,p_creator) limit n loop
      if exists(select 1 from private.integration_pilot_tombstones where workspace_id=p_workspace and creator_id=p_creator
        and (kind='account_delete' or (connection_id=c.id and through_generation>=c.generation and kind='purge'))) then
        perform private.integration_purge(p_workspace,p_creator,c.id);
      else
        perform private.integration_privacy_command(p_workspace,p_creator,p_request,'revoke',jsonb_build_object('id',c.id,'generation',c.generation));
      end if;
      replayed:=replayed+1;
    end loop;
    more:=exists(select 1 from private.integration_pilot_restore_candidates(p_workspace,p_creator));
    update private.integration_pilot_maintenance set restore_pending=more where workspace_id=p_workspace and creator_id=p_creator;
    return jsonb_build_object('replayed',replayed,'complete',not more);
  elsif p_action<>'maintenance' then raise exception 'INVALID_INPUT'; end if;

  if not dry and (m.lease_id is null or m.lease_id is distinct from (p_payload->>'leaseId')::uuid or m.expires_at<=clock_timestamp()) then raise exception 'MAINTENANCE_LEASE_REQUIRED'; end if;
  select coalesce(array_agg(id),'{}') into snaps from (select id from public.integration_snapshots snap where workspace_id=p_workspace and creator_id=p_creator
    and expires_at<=stamp and not exists(select 1 from public.studio_sources s where s.integration_snapshot_id=snap.id) order by expires_at,id limit n+1) q;
  select coalesce(array_agg(connection_id),'{}') into creds from (select connection_id from private.integration_credentials where workspace_id=p_workspace and creator_id=p_creator
    and revoke_until<=stamp order by revoke_until,connection_id limit n+1) q;
  select coalesce(array_agg(state_hash),'{}') into states from (select state_hash from private.integration_oauth_states where workspace_id=p_workspace and creator_id=p_creator
    and expires_at<=stamp order by expires_at,state_hash limit n+1) q;
  select coalesce(array_agg(id),'{}') into permits from (select id from private.integration_use_permits where workspace_id=p_workspace and creator_id=p_creator
    and expires_at<=stamp and consumed_at is null and use_kind<>'model' order by expires_at,id limit n+1) q;
  select coalesce(array_agg(id),'{}') into events from (select id from public.integration_events where workspace_id=p_workspace and creator_id=p_creator
    and created_at<stamp-interval '90 days' order by created_at,id limit n+1) q;
  more:=greatest(cardinality(snaps),cardinality(creds),cardinality(states),cardinality(permits),cardinality(events))>n;
  snaps:=snaps[1:n]; creds:=creds[1:n]; states:=states[1:n]; permits:=permits[1:n]; events:=events[1:n];
  counts:=jsonb_build_object('snapshots',cardinality(snaps),'credentials',cardinality(creds),'states',cardinality(states),'permits',cardinality(permits),'events',cardinality(events));
  if not dry then
    update public.integration_resources set snapshot_id=null,data=data||'{"snapshotId":null,"excerpt":null,"metrics":{},"availability":"stale"}'::jsonb where snapshot_id=any(snaps);
    update private.integration_commands cmd set result='{}',invalidated_at=stamp where cmd.workspace_id=p_workspace and cmd.creator_id=p_creator and cmd.action='resources'
      and exists(select 1 from jsonb_array_elements(cmd.result->'resources') r where (r->>'snapshotId')::uuid=any(snaps));
    update public.integration_sync_runs run set result=null,status='unknown' where run.workspace_id=p_workspace and run.creator_id=p_creator
      and exists(select 1 from jsonb_array_elements(run.result->'resources') r where (r->>'snapshotId')::uuid=any(snaps));
    delete from public.integration_snapshots where id=any(snaps);
    update public.integration_connections set data=jsonb_set(data,'{providerRevocation}','"manual_action"') where id=any(creds) and status='revoked' and data->>'providerRevocation'='pending';
    update private.integration_pilot_grants set state='manual_action',changed_at=stamp where state='pending' and grant_key in
      (select grant_key from private.integration_pilot_bindings where connection_id=any(creds) and activated);
    delete from private.integration_credentials where connection_id=any(creds);
    delete from private.integration_oauth_states where state_hash=any(states);
    delete from private.integration_use_permits where id=any(permits);
    delete from public.integration_events where id=any(events);
  end if;
  return jsonb_build_object('dryRun',dry,'counts',counts,'hasMore',more,
    'pendingRevocations',(select count(*) from public.integration_connections where workspace_id=p_workspace and creator_id=p_creator and data->>'providerRevocation'='pending'),
    'manualAction',(select count(*) from public.integration_connections where workspace_id=p_workspace and creator_id=p_creator and data->>'providerRevocation'='manual_action'));
end $$;
revoke all on function private.integration_pilot_restore_candidates(uuid,uuid),private.integration_pilot_maintenance_command(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
-- Verified mapping is injected by the server verifier. This function never accepts
-- an app-scoped user_id and never equates it with the raw provider subject.
create table private.integration_pilot_notices (
  receipt_hash text primary key check(receipt_hash ~ '^[a-f0-9]{64}$'),
  provider_project_id text not null, subject_hash text not null check(subject_hash ~ '^[a-f0-9]{64}$'),
  kind text not null check(kind in ('deauthorization','deletion')),
  confirmation_code text not null unique default replace(gen_random_uuid()::text,'-',''),
  status text not null default 'pending' check(status in ('pending','completed')),
  created_at timestamptz not null default clock_timestamp()
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE private.integration_pilot_notices FROM PUBLIC, anon, authenticated, service_role;

alter table private.integration_pilot_notices enable row level security;
revoke all on private.integration_pilot_notices from public,anon,authenticated,service_role;
alter table private.integration_pilot_bindings add column notice_invalidated_at timestamptz;
create function private.integration_notice_binding_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if new.activated and new.notice_invalidated_at is not null then raise exception 'SOURCE_UNAVAILABLE'; end if;
  return new;
end $$;
create trigger integration_notice_binding_guard before update of activated on private.integration_pilot_bindings
  for each row execute function private.integration_notice_binding_guard();
revoke all on function private.integration_notice_binding_guard() from public,anon,authenticated,service_role;
create function public.integration_provider_notice(p_provider_project_id text,p_subject_hash text,p_receipt_hash text,p_kind text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  receipt private.integration_pilot_notices; affected record; c public.integration_connections;
  stamp timestamptz:=clock_timestamp(); remaining boolean:=false;
begin
  if p_provider_project_id is null or length(p_provider_project_id) not between 1 and 160
    or p_provider_project_id<>trim(p_provider_project_id) or p_provider_project_id ~ '[[:cntrl:]]'
    or coalesce(p_subject_hash,'') !~ '^[a-f0-9]{64}$' or coalesce(p_receipt_hash,'') !~ '^[a-f0-9]{64}$'
    or coalesce(p_kind,'') not in ('deauthorization','deletion') then raise exception 'INVALID_INPUT'; end if;
  -- Same lock order as all pilot connect/refresh/management commands. The receipt
  -- and every affected owner mutation commit or roll back together.
  perform pg_advisory_xact_lock(431230);
  select * into receipt from private.integration_pilot_notices where receipt_hash=p_receipt_hash for update;
  if found then
    if receipt.provider_project_id<>p_provider_project_id or receipt.subject_hash<>p_subject_hash or receipt.kind<>p_kind then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('confirmationCode',receipt.confirmation_code,'status',receipt.status);
  end if;
  insert into private.integration_pilot_notices(receipt_hash,provider_project_id,subject_hash,kind)
    values(p_receipt_hash,p_provider_project_id,p_subject_hash,p_kind) returning * into receipt;

  for affected in select distinct b.workspace_id,b.creator_id from private.integration_pilot_bindings b
    where b.provider='instagram' and b.provider_project_id=p_provider_project_id and b.subject_hash=p_subject_hash
    order by b.workspace_id,b.creator_id loop
    perform 1 from public.creators where workspace_id=affected.workspace_id and id=affected.creator_id for update;
    -- Source invalidation is lineage-scoped, including retained historical sources.
    -- It uses the unchanged creator-lock/redaction/permit fence from Stage 4A-C.
    perform private.integration_invalidate_sources(affected.workspace_id,affected.creator_id,array(
      select s.id from public.studio_sources s join private.integration_pilot_bindings b
        on b.connection_id=s.integration_connection_id and b.generation=(s.integration->>'generation')::integer
        and b.workspace_id=s.workspace_id and b.creator_id=s.creator_id
      where b.provider='instagram' and b.provider_project_id=p_provider_project_id and b.subject_hash=p_subject_hash
        and s.workspace_id=affected.workspace_id and s.creator_id=affected.creator_id and s.revoked_at is null));
    -- A historical binding must not cancel a different current account's OAuth.
    -- Current/revoked-current or prepared future bindings do fence unfinished work.
    if exists(select 1 from private.integration_pilot_bindings b left join public.integration_connections cc
      on cc.id=b.connection_id and cc.provider='instagram' and cc.workspace_id=b.workspace_id and cc.creator_id=b.creator_id
      where b.provider='instagram' and b.provider_project_id=p_provider_project_id and b.subject_hash=p_subject_hash
        and b.workspace_id=affected.workspace_id and b.creator_id=affected.creator_id
        and b.generation>=coalesce(case when cc.status='revoked' then cc.generation-1 else cc.generation end,0)) then
      update private.integration_oauth_states set consumed_at=coalesce(consumed_at,stamp)
        where workspace_id=affected.workspace_id and creator_id=affected.creator_id and provider='instagram';
      update private.integration_pilot_oauth o set secret=null,code=null,completed_at=coalesce(completed_at,stamp)
        from private.integration_oauth_states s where s.state_hash=o.state_hash and s.workspace_id=affected.workspace_id
          and s.creator_id=affected.creator_id and s.provider='instagram';
    end if;
  end loop;
  -- Keep provenance intact; prohibit any later activation using a prepared binding.
  update private.integration_pilot_bindings set notice_invalidated_at=coalesce(notice_invalidated_at,stamp)
    where provider='instagram' and provider_project_id=p_provider_project_id and subject_hash=p_subject_hash;

  for c in select cc.* from public.integration_connections cc where cc.provider='instagram' and exists(
    select 1 from private.integration_pilot_bindings b where b.connection_id=cc.id and b.workspace_id=cc.workspace_id and b.creator_id=cc.creator_id
      and b.provider='instagram' and b.provider_project_id=p_provider_project_id and b.subject_hash=p_subject_hash and b.activated
      and b.generation=case when cc.status='revoked' then cc.generation-1 else cc.generation end)
    order by cc.workspace_id,cc.creator_id,cc.id for update loop
    if c.status<>'revoked' then
      perform private.integration_privacy_command(c.workspace_id,c.creator_id,gen_random_uuid(),'revoke',jsonb_build_object('id',c.id,'generation',c.generation));
      select * into c from public.integration_connections where id=c.id;
    end if;
    if p_kind='deauthorization' then
      -- The verified notice attests deauthorization; no provider HTTP call occurs.
      perform private.integration_privacy_command(c.workspace_id,c.creator_id,gen_random_uuid(),'revoke_result',jsonb_build_object('id',c.id,'generation',c.generation,'provider','revoked'));
    else
      -- completed refers to local erasure. A deletion request alone is not a
      -- claim that a separate remote token revocation request succeeded.
      if exists(select 1 from public.integration_snapshots snap where snap.connection_id=c.id and not exists(
        select 1 from private.integration_pilot_bindings b where b.connection_id=c.id and b.generation=snap.generation
          and b.workspace_id=c.workspace_id and b.creator_id=c.creator_id and b.provider='instagram'
          and b.provider_project_id=p_provider_project_id and b.subject_hash=p_subject_hash))
        or exists(select 1 from public.integration_resources r where r.connection_id=c.id and not exists(
        select 1 from private.integration_pilot_bindings b where b.connection_id=c.id and b.generation=r.generation
          and b.workspace_id=c.workspace_id and b.creator_id=c.creator_id and b.provider='instagram'
          and b.provider_project_id=p_provider_project_id and b.subject_hash=p_subject_hash)) then
        -- Whole-connection purge would erase unrelated account history. Quarantine
        -- matching uses and erase its credential now; keep deletion visibly pending.
        perform private.integration_privacy_command(c.workspace_id,c.creator_id,gen_random_uuid(),'revoke_result',jsonb_build_object('id',c.id,'generation',c.generation,'provider','manual_action'));
        remaining:=true;
      else perform private.integration_purge(c.workspace_id,c.creator_id,c.id); end if;
    end if;
  end loop;
  if p_kind='deletion' then
    -- Do not purge a newer, differently mapped account that reused a connection ID.
    -- Historical lineage needing narrower erasure is explicit pending work.
    remaining:=remaining or exists(select 1 from public.integration_snapshots snap join private.integration_pilot_bindings b
      on b.connection_id=snap.connection_id and b.workspace_id=snap.workspace_id and b.creator_id=snap.creator_id and b.generation=snap.generation
      where b.provider='instagram' and b.provider_project_id=p_provider_project_id and b.subject_hash=p_subject_hash);
  end if;
  update private.integration_pilot_notices set status=case when remaining then 'pending' else 'completed' end
    where receipt_hash=p_receipt_hash returning * into receipt;
  return jsonb_build_object('confirmationCode',receipt.confirmation_code,'status',receipt.status);
end $$;
revoke all on function public.integration_provider_notice(text,text,text,text) from public,anon,authenticated;
grant execute on function public.integration_provider_notice(text,text,text,text) to service_role;
