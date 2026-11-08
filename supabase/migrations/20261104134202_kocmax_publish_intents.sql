begin;

-- Prepared offline only. No provider transport, credentials, public media route or reward writes.
-- All time/identity arguments come from the trusted server, never browser request JSON.
create function private.creator_publish_keys(v jsonb, allowed text[], required text[])
returns boolean language sql immutable set search_path='' as $$
  select coalesce(jsonb_typeof(v)='object' and v ?& required
    and not exists(select 1 from jsonb_object_keys(v) k where k<>all(allowed)),false)
$$;
create function private.creator_publish_binding(v jsonb)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(private.creator_publish_keys(v,
    array['draftId','draftRevision','assetId','imageSha256','captionSha256','connectionId','accountSubject','grantGeneration','fingerprint'],
    array['draftId','draftRevision','assetId','imageSha256','captionSha256','connectionId','accountSubject','grantGeneration','fingerprint'])
    and not exists(select 1 from unnest(array['draftId','assetId','connectionId']) k
      where jsonb_typeof(v->k)<>'string' or v->>k !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    and not exists(select 1 from unnest(array['imageSha256','captionSha256','fingerprint']) k
      where jsonb_typeof(v->k)<>'string' or v->>k !~ '^[0-9a-f]{64}$')
    and jsonb_typeof(v->'accountSubject')='string' and v->>'accountSubject' ~ '^[1-9][0-9]{0,63}$'
    and jsonb_typeof(v->'draftRevision')='number' and v->>'draftRevision' ~ '^[1-9][0-9]{0,9}$' and (v->>'draftRevision')::numeric<=2147483647
    and jsonb_typeof(v->'grantGeneration')='number' and v->>'grantGeneration' ~ '^[1-9][0-9]{0,9}$' and (v->>'grantGeneration')::numeric<=2147483647,false)
$$;
create function private.creator_publish_receipt(v jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
begin
  return coalesce(private.creator_publish_keys(v,array['containerId','mediaId','status','code','observedAt','sampleOnly'],array[]::text[])
    and octet_length(v::text)<=1024
    and not exists(select 1 from unnest(array['containerId','mediaId']) k where v ? k and (jsonb_typeof(v->k)<>'string' or v->>k !~ '^[1-9][0-9]{0,63}$'))
    and (not v ? 'status' or (jsonb_typeof(v->'status')='string' and v->>'status' in ('processing','ready','published','failed','unknown')))
    and (not v ? 'code' or (jsonb_typeof(v->'code')='string' and v->>'code' in ('PROVIDER_REJECTED','PROVIDER_TIMEOUT','INTERRUPTED')))
    and (not v ? 'sampleOnly' or jsonb_typeof(v->'sampleOnly')='boolean')
    and (not v ? 'observedAt' or (jsonb_typeof(v->'observedAt')='string' and v->>'observedAt' ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$' and isfinite((v->>'observedAt')::timestamptz))),false);
exception when others then return false;
end $$;

create table private.creator_publish_intents (
  id uuid primary key, workspace_id uuid not null, creator_id uuid not null,
  -- Nullable live references detach on source deletion; immutable hashes/IDs remain for uncertain external outcomes.
  draft_id uuid, asset_id uuid, connection_id uuid,
  binding jsonb not null check(private.creator_publish_binding(binding)),
  request_id uuid not null,
  state text not null check(state in ('creator_approved','container_preparing','provider_processing','publish_requested','published','failed','outcome_unknown','cancelled','invalidated')),
  version integer not null check(version>0),
  -- Immutable internal history of the single CAS publish claim, bound to this intent's target/binding.
  publish_claim_request_id uuid, publish_claim_version integer,
  publish_claim_container_id text, publish_claimed_at timestamptz,
  receipt jsonb not null default '{}' check(private.creator_publish_receipt(receipt)),
  late_receipt jsonb not null default '{}' check(private.creator_publish_receipt(late_receipt)),
  sample_only boolean not null, stopped_at timestamptz,
  created_at timestamptz not null, updated_at timestamptz not null, retention_until timestamptz not null,
  unique(id,workspace_id,creator_id),
  foreign key(draft_id,workspace_id,creator_id) references private.creator_growth_drafts(id,workspace_id,creator_id) on delete set null (draft_id),
  foreign key(asset_id,workspace_id,creator_id) references private.creator_growth_assets(id,workspace_id,creator_id) on delete set null (asset_id),
  foreign key(connection_id,workspace_id,creator_id) references public.integration_connections(id,workspace_id,creator_id) on delete set null (connection_id),
  check(draft_id is null or draft_id=(binding->>'draftId')::uuid),
  check(asset_id is null or asset_id=(binding->>'assetId')::uuid),
  check(connection_id is null or connection_id=(binding->>'connectionId')::uuid),
  check((publish_claim_request_id is null and publish_claim_version is null and publish_claim_container_id is null and publish_claimed_at is null)
    or (publish_claim_request_id is not null and publish_claim_version is not null and publish_claim_container_id is not null and publish_claimed_at is not null
      and publish_claim_version between 1 and version and publish_claim_container_id ~ '^[1-9][0-9]{0,63}$'
      and receipt->>'containerId' is not distinct from publish_claim_container_id)),
  check(state not in ('publish_requested','published') or publish_claim_request_id is not null)
);
-- Lifetime uniqueness, including terminal rows. A new preview never reopens an old revision.
create unique index creator_publish_intents_revision on private.creator_publish_intents(workspace_id,creator_id,(binding->>'draftId'),((binding->>'draftRevision')::integer));
create index creator_publish_intents_owner_recent on private.creator_publish_intents(workspace_id,creator_id,created_at desc);
create index creator_publish_intents_owner_expiry on private.creator_publish_intents(workspace_id,creator_id,retention_until);
create index creator_publish_intents_draft_fk on private.creator_publish_intents(draft_id,workspace_id,creator_id);
create index creator_publish_intents_asset_fk on private.creator_publish_intents(asset_id,workspace_id,creator_id);
create index creator_publish_intents_connection_fk on private.creator_publish_intents(connection_id,workspace_id,creator_id);

create table private.creator_publish_approvals (
  id uuid primary key, workspace_id uuid not null, creator_id uuid not null,
  draft_id uuid not null, asset_id uuid not null, connection_id uuid not null,
  binding jsonb not null check(private.creator_publish_binding(binding)),
  nonce_hash text not null unique check(nonce_hash ~ '^[0-9a-f]{64}$'),
  session_hash text not null check(session_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null, created_at timestamptz not null,
  consumed_at timestamptz, invalidated_at timestamptz,
  foreign key(creator_id,workspace_id) references public.creators(id,workspace_id) on delete cascade,
  foreign key(draft_id,workspace_id,creator_id) references private.creator_growth_drafts(id,workspace_id,creator_id) on delete cascade,
  foreign key(asset_id,workspace_id,creator_id) references private.creator_growth_assets(id,workspace_id,creator_id) on delete cascade,
  foreign key(connection_id,workspace_id,creator_id) references public.integration_connections(id,workspace_id,creator_id) on delete cascade,
  check(draft_id=(binding->>'draftId')::uuid and asset_id=(binding->>'assetId')::uuid and connection_id=(binding->>'connectionId')::uuid),
  check(expires_at>created_at and expires_at<=created_at+interval '5 minutes')
);
create index creator_publish_approvals_owner_expiry on private.creator_publish_approvals(workspace_id,creator_id,expires_at);
create index creator_publish_approvals_creator_fk on private.creator_publish_approvals(creator_id,workspace_id);
create index creator_publish_approvals_draft_fk on private.creator_publish_approvals(draft_id,workspace_id,creator_id);
create index creator_publish_approvals_asset_fk on private.creator_publish_approvals(asset_id,workspace_id,creator_id);
create index creator_publish_approvals_connection_fk on private.creator_publish_approvals(connection_id,workspace_id,creator_id);

create table private.creator_publish_commands (
  workspace_id uuid not null, creator_id uuid not null, request_id uuid not null,
  intent_id uuid not null, action text not null check(action in ('reserve','transition','late')),
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'), created_at timestamptz not null,
  primary key(workspace_id,creator_id,request_id),
  foreign key(intent_id,workspace_id,creator_id) references private.creator_publish_intents(id,workspace_id,creator_id) on delete cascade
);
create index creator_publish_commands_intent_fk on private.creator_publish_commands(intent_id,workspace_id,creator_id);

-- A source-lifetime consumption marker survives 90-day receipt cleanup. It contains no
-- content/session/provider data, and disappears with the canonical draft. Never reopen a revision.
create table private.creator_publish_revisions (
  workspace_id uuid not null, creator_id uuid not null, draft_id uuid not null,
  revision integer not null check(revision>0), intent_id uuid,
  primary key(workspace_id,creator_id,draft_id,revision),
  foreign key(draft_id,workspace_id,creator_id) references private.creator_growth_drafts(id,workspace_id,creator_id) on delete cascade,
  foreign key(intent_id,workspace_id,creator_id) references private.creator_publish_intents(id,workspace_id,creator_id) on delete set null (intent_id)
);
create index creator_publish_revisions_draft_fk on private.creator_publish_revisions(draft_id,workspace_id,creator_id);
create index creator_publish_revisions_intent_fk on private.creator_publish_revisions(intent_id,workspace_id,creator_id);

alter table private.creator_publish_intents enable row level security;
alter table private.creator_publish_approvals enable row level security;
alter table private.creator_publish_commands enable row level security;
alter table private.creator_publish_revisions enable row level security;
revoke all on private.creator_publish_intents,private.creator_publish_approvals,private.creator_publish_commands,private.creator_publish_revisions from public,anon,authenticated,service_role;

create function private.creator_publish_time(v timestamptz) returns text language sql immutable set search_path='' as $$
  select to_char(v at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
create function private.creator_publish_dto(i private.creator_publish_intents) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',i.id,'owner',jsonb_build_object('workspaceId',i.workspace_id,'creatorId',i.creator_id),
    'binding',i.binding,'requestId',i.request_id,'state',i.state,'version',i.version,'receipt',i.receipt,'lateReceipt',i.late_receipt,
    'sampleOnly',i.sample_only,'stoppedAt',private.creator_publish_time(i.stopped_at),
    'createdAt',private.creator_publish_time(i.created_at),'updatedAt',private.creator_publish_time(i.updated_at),'retentionUntil',private.creator_publish_time(i.retention_until))
$$;
create function private.creator_publish_authority(w uuid,c uuid,b jsonb,t timestamptz) returns boolean
language plpgsql set search_path='' as $$
declare d private.creator_growth_drafts; a private.creator_growth_assets; g public.integration_connections;
begin
  -- The caller holds the active creator lock. Match canonical integration lock order.
  select * into g from public.integration_connections where id=(b->>'connectionId')::uuid and workspace_id=w and creator_id=c for update;
  if not found or g.provider<>'instagram' or g.status not in ('connected','partial') or g.generation<>(b->>'grantGeneration')::integer
    or g.data->>'subject' is distinct from b->>'accountSubject'
    or not coalesce(g.data->'scopes' ?& array['instagram_business_basic','instagram_business_content_publish'],false)
    or coalesce((g.data->>'expiresAt')::timestamptz,'-infinity')<=t then raise exception 'PUBLISH_STALE'; end if;
  select * into a from private.creator_growth_assets where id=(b->>'assetId')::uuid and workspace_id=w and creator_id=c for update;
  if not found or a.upload_state<>'uploaded' or not a.rights_confirmed or a.sha256<>b->>'imageSha256' or a.expires_at<=t then raise exception 'PUBLISH_STALE'; end if;
  select * into d from private.creator_growth_drafts where id=(b->>'draftId')::uuid and workspace_id=w and creator_id=c for update;
  if not found or d.status<>'private' or d.invalidated_at is not null or d.revision<>(b->>'draftRevision')::integer
    or d.asset_id is distinct from a.id or d.thread_id<>a.thread_id
    or encode(sha256(convert_to(d.caption,'UTF8')),'hex')<>b->>'captionSha256' then raise exception 'PUBLISH_STALE'; end if;
  return a.sample_only or coalesce((g.data->>'sampleOnly')::boolean,true);
end $$;

create function private.creator_publish_stop(w uuid,c uuid,kind text,source_id uuid,t timestamptz) returns void
language plpgsql set search_path='' as $$
begin
  update private.creator_publish_approvals set invalidated_at=coalesce(invalidated_at,t)
    where workspace_id=w and creator_id=c and invalidated_at is null
      and (kind='owner' or (kind='connection' and connection_id=source_id) or (kind='draft' and draft_id=source_id) or (kind='asset' and asset_id=source_id));
  update private.creator_publish_intents set state=case when state='creator_approved' then 'invalidated' else 'outcome_unknown' end,
    stopped_at=t,updated_at=t,version=version+1
    where workspace_id=w and creator_id=c and stopped_at is null
      and state in ('creator_approved','container_preparing','provider_processing','publish_requested','outcome_unknown')
      and (kind='owner' or (kind='connection' and connection_id=source_id) or (kind='draft' and draft_id=source_id) or (kind='asset' and asset_id=source_id));
end $$;
create function private.creator_publish_source_change() returns trigger language plpgsql security definer set search_path='' as $$
declare kind text; invalidate boolean:=true;
begin
  if tg_table_name='integration_connections' then
    kind:='connection';
    if tg_op='UPDATE' then invalidate:=new.generation<>old.generation or new.status not in ('connected','partial')
      or new.data->>'subject' is distinct from old.data->>'subject'
      or not coalesce(new.data->'scopes' ?& array['instagram_business_basic','instagram_business_content_publish'],false)
      or coalesce((new.data->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp(); end if;
  elsif tg_table_name='creator_growth_drafts' then
    kind:='draft';
    if tg_op='UPDATE' then invalidate:=(new.revision,new.asset_id,new.caption,new.status,new.invalidated_at) is distinct from (old.revision,old.asset_id,old.caption,old.status,old.invalidated_at); end if;
  else
    kind:='asset';
    if tg_op='UPDATE' then invalidate:=(new.sha256,new.upload_state,new.rights_confirmed,new.expires_at,new.mime,new.width,new.height) is distinct from (old.sha256,old.upload_state,old.rights_confirmed,old.expires_at,old.mime,old.width,old.height); end if;
  end if;
  if invalidate then perform private.creator_publish_stop(old.workspace_id,old.creator_id,kind,old.id,clock_timestamp()); end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger creator_publish_connection_change before update of generation,status,data or delete on public.integration_connections
  for each row execute function private.creator_publish_source_change();
create trigger creator_publish_draft_change before update of revision,asset_id,caption,status,invalidated_at or delete on private.creator_growth_drafts
  for each row execute function private.creator_publish_source_change();
create trigger creator_publish_asset_change before update of sha256,upload_state,rights_confirmed,expires_at,mime,width,height or delete on private.creator_growth_assets
  for each row execute function private.creator_publish_source_change();
create function private.creator_publish_owner_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' or new.status is distinct from 'active' then
    perform private.creator_publish_stop(old.workspace_id,old.id,'owner',old.id,clock_timestamp());
    delete from private.creator_publish_approvals where workspace_id=old.workspace_id and creator_id=old.id;
    if tg_op='DELETE' or new.status='deleted' then
      delete from private.creator_publish_intents where workspace_id=old.workspace_id and creator_id=old.id and state in ('published','failed','cancelled','invalidated');
    end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger creator_publish_owner_change before update of status or delete on public.creators
  for each row execute function private.creator_publish_owner_change();

create function public.creator_publish_command(p_workspace uuid,p_creator uuid,p_action text,p_payload jsonb,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  a private.creator_publish_approvals; i private.creator_publish_intents; cmd private.creator_publish_commands;
  b jsonb; r jsonb; merged jsonb; request uuid; digest text; expected text[]; allowed boolean; sample boolean;
  next_state text; approvals_deleted integer:=0; intents_deleted integer:=0; held integer:=0; n integer;
begin
  -- EXECUTE is service-only, but service authority alone does not establish a creator owner.
  perform 1 from public.creators where id=p_creator and workspace_id=p_workspace and status='active' for update;
  if not found then raise exception 'PUBLISH_DENIED'; end if;
  if p_now is null or not isfinite(p_now) or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>8192 then raise exception 'PUBLISH_INVALID'; end if;
  expected:=case p_action
    when 'preview' then array['approvalId','nonceHash','sessionHash','binding','expiresAt']
    when 'reserve' then array['approvalId','nonceHash','sessionHash','binding','requestId','intentId']
    when 'transition' then array['intentId','expectedVersion','expectedState','nextState','fingerprint','receipt','requestId']
    when 'late' then array['intentId','target','receipt','requestId']
    when 'get' then array['intentId'] when 'cleanup' then array['limit'] else null end;
  if expected is null or not private.creator_publish_keys(p_payload,expected,expected) then raise exception 'PUBLISH_INVALID'; end if;
  if exists(select 1 from unnest(array['intentId','approvalId','requestId']) k where p_payload ? k and
    (jsonb_typeof(p_payload->k)<>'string' or p_payload->>k !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')) then raise exception 'PUBLISH_INVALID'; end if;
  if p_action in ('preview','reserve') then
    b:=p_payload->'binding';
    if not private.creator_publish_binding(b) or jsonb_typeof(p_payload->'nonceHash')<>'string' or p_payload->>'nonceHash' !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(p_payload->'sessionHash')<>'string' or p_payload->>'sessionHash' !~ '^[0-9a-f]{64}$' then raise exception 'PUBLISH_INVALID'; end if;
  end if;
  if p_action in ('transition','late') then
    r:=p_payload->'receipt';
    if not private.creator_publish_receipt(r) or (r ? 'observedAt' and (r->>'observedAt')::timestamptz>p_now+interval '1 minute') then raise exception 'PUBLISH_INVALID'; end if;
    if p_action='transition' and (jsonb_typeof(p_payload->'expectedVersion')<>'number' or p_payload->>'expectedVersion' !~ '^[1-9][0-9]{0,9}$'
      or (p_payload->>'expectedVersion')::numeric>2147483647 or jsonb_typeof(p_payload->'fingerprint')<>'string' or p_payload->>'fingerprint' !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(p_payload->'expectedState')<>'string' or p_payload->>'expectedState' not in ('creator_approved','container_preparing','provider_processing','publish_requested','published','failed','outcome_unknown','cancelled','invalidated')
      or jsonb_typeof(p_payload->'nextState')<>'string' or p_payload->>'nextState' not in ('creator_approved','container_preparing','provider_processing','publish_requested','published','failed','outcome_unknown','cancelled','invalidated')) then raise exception 'PUBLISH_INVALID'; end if;
    if p_action='late' and (not private.creator_publish_keys(p_payload->'target',array['connectionId','accountSubject','grantGeneration'],array['connectionId','accountSubject','grantGeneration'])
      or jsonb_typeof(p_payload->'target'->'connectionId')<>'string' or p_payload->'target'->>'connectionId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(p_payload->'target'->'accountSubject')<>'string' or p_payload->'target'->>'accountSubject' !~ '^[1-9][0-9]{0,63}$'
      or jsonb_typeof(p_payload->'target'->'grantGeneration')<>'number' or p_payload->'target'->>'grantGeneration' !~ '^[1-9][0-9]{0,9}$'
      or (p_payload->'target'->>'grantGeneration')::numeric>2147483647) then raise exception 'PUBLISH_INVALID'; end if;
  end if;
  if p_action='preview' then
    sample:=private.creator_publish_authority(p_workspace,p_creator,b,p_now);
    if jsonb_typeof(p_payload->'expiresAt')<>'string' or (p_payload->>'expiresAt')::timestamptz<=p_now or (p_payload->>'expiresAt')::timestamptz>p_now+interval '5 minutes' then raise exception 'PUBLISH_INVALID'; end if;
    insert into private.creator_publish_approvals(id,workspace_id,creator_id,draft_id,asset_id,connection_id,binding,nonce_hash,session_hash,expires_at,created_at)
      values((p_payload->>'approvalId')::uuid,p_workspace,p_creator,(b->>'draftId')::uuid,(b->>'assetId')::uuid,(b->>'connectionId')::uuid,b,p_payload->>'nonceHash',p_payload->>'sessionHash',(p_payload->>'expiresAt')::timestamptz,p_now);
    return jsonb_build_object('approvalId',p_payload->>'approvalId','expiresAt',p_payload->>'expiresAt');
  elsif p_action='cleanup' then
    if jsonb_typeof(p_payload->'limit')<>'number' or p_payload->>'limit' !~ '^[1-9][0-9]{0,2}$' or (p_payload->>'limit')::integer>100 then raise exception 'PUBLISH_INVALID'; end if;
    n:=(p_payload->>'limit')::integer;
    delete from private.creator_publish_approvals where id in (select id from private.creator_publish_approvals where workspace_id=p_workspace and creator_id=p_creator and expires_at<=p_now order by expires_at,id limit n);
    get diagnostics approvals_deleted=row_count;
    delete from private.creator_publish_intents where id in (select id from private.creator_publish_intents where workspace_id=p_workspace and creator_id=p_creator and retention_until<=p_now and state in ('creator_approved','published','failed','cancelled','invalidated') order by retention_until,id limit n);
    get diagnostics intents_deleted=row_count;
    select count(*) into held from private.creator_publish_intents where workspace_id=p_workspace and creator_id=p_creator and retention_until<=p_now and state in ('container_preparing','provider_processing','publish_requested','outcome_unknown');
    return jsonb_build_object('approvalsDeleted',approvals_deleted,'intentsDeleted',intents_deleted,'heldUnknown',held);
  end if;
  if p_action in ('reserve','transition','late') then
    request:=(p_payload->>'requestId')::uuid;
    -- Generated IDs/time are excluded. The complete caller command (including nonce/session hashes) is included.
    digest:=encode(sha256(convert_to(jsonb_build_object('action',p_action,'payload',case when p_action='reserve' then p_payload-'intentId' else p_payload end)::text,'UTF8')),'hex');
    select * into cmd from private.creator_publish_commands where workspace_id=p_workspace and creator_id=p_creator and request_id=request;
    if found and (cmd.request_hash<>digest or cmd.action<>p_action) then raise exception 'PUBLISH_CONFLICT'; end if;
  end if;
  if p_action='reserve' then
    sample:=private.creator_publish_authority(p_workspace,p_creator,b,p_now);
    if cmd.intent_id is not null then
      select * into i from private.creator_publish_intents where id=cmd.intent_id and workspace_id=p_workspace and creator_id=p_creator;
      return private.creator_publish_dto(i);
    end if;
    select * into a from private.creator_publish_approvals where id=(p_payload->>'approvalId')::uuid and workspace_id=p_workspace and creator_id=p_creator for update;
    if not found or a.invalidated_at is not null or a.consumed_at is not null or a.expires_at<=p_now or a.nonce_hash<>p_payload->>'nonceHash'
      or a.session_hash<>p_payload->>'sessionHash' or a.binding<>b then raise exception 'PUBLISH_APPROVAL_INVALID'; end if;
    select * into i from private.creator_publish_intents where workspace_id=p_workspace and creator_id=p_creator and binding->>'draftId'=b->>'draftId' and (binding->>'draftRevision')::integer=(b->>'draftRevision')::integer for update;
    if found and i.binding<>b then raise exception 'PUBLISH_CONFLICT'; end if;
    if i.id is null then
      if exists(select 1 from private.creator_publish_revisions where workspace_id=p_workspace and creator_id=p_creator and draft_id=(b->>'draftId')::uuid and revision=(b->>'draftRevision')::integer) then raise exception 'PUBLISH_CONFLICT'; end if;
      insert into private.creator_publish_intents(id,workspace_id,creator_id,draft_id,asset_id,connection_id,binding,request_id,state,version,sample_only,created_at,updated_at,retention_until)
        values((p_payload->>'intentId')::uuid,p_workspace,p_creator,(b->>'draftId')::uuid,(b->>'assetId')::uuid,(b->>'connectionId')::uuid,b,request,'creator_approved',1,sample,p_now,p_now,p_now+interval '90 days') returning * into i;
      insert into private.creator_publish_revisions(workspace_id,creator_id,draft_id,revision,intent_id)
        values(p_workspace,p_creator,(b->>'draftId')::uuid,(b->>'draftRevision')::integer,i.id);
    end if;
    update private.creator_publish_approvals set consumed_at=p_now where id=a.id;
  else
    select * into i from private.creator_publish_intents where id=(p_payload->>'intentId')::uuid and workspace_id=p_workspace and creator_id=p_creator for update;
    if not found then raise exception 'PUBLISH_DENIED'; end if;
    if p_action='get' then return private.creator_publish_dto(i); end if;
    if cmd.intent_id is not null then
      if p_action='transition' then return jsonb_build_object('intent',private.creator_publish_dto(i),'applied',false); end if;
      return private.creator_publish_dto(i);
    end if;
    if r ? 'sampleOnly' and (r->>'sampleOnly')::boolean<>i.sample_only then raise exception 'PUBLISH_INVALID'; end if;
    if exists(select 1 from unnest(array['containerId','mediaId']) k where r ? k and coalesce(i.receipt->>k,i.late_receipt->>k) is not null and r->>k<>coalesce(i.receipt->>k,i.late_receipt->>k)) then raise exception 'PUBLISH_CONFLICT'; end if;
    if p_action='late' then
      if p_payload->'target'<>jsonb_build_object('connectionId',i.binding->'connectionId','accountSubject',i.binding->'accountSubject','grantGeneration',i.binding->'grantGeneration') then raise exception 'PUBLISH_CONFLICT'; end if;
      if i.state not in ('container_preparing','provider_processing','publish_requested','outcome_unknown','published') or not (r ? 'containerId' or r ? 'mediaId')
        or (r ? 'mediaId' and (i.publish_claim_request_id is null or i.publish_claim_container_id is distinct from i.receipt->>'containerId')) then raise exception 'PUBLISH_TRANSITION'; end if;
      update private.creator_publish_intents set late_receipt=late_receipt||r,version=version+1,updated_at=p_now where id=i.id returning * into i;
    else
      if i.version<>(p_payload->>'expectedVersion')::integer or i.state<>p_payload->>'expectedState' then raise exception 'PUBLISH_CAS'; end if;
      if i.binding->>'fingerprint'<>p_payload->>'fingerprint' or i.stopped_at is not null then raise exception 'PUBLISH_STALE'; end if;
      if (i.state='creator_approved' and r<>'{}'::jsonb) or (i.state in ('container_preparing','provider_processing') and r ? 'mediaId')
        or (r ? 'mediaId' and (i.publish_claim_request_id is null or i.publish_claim_container_id is distinct from i.receipt->>'containerId')) then raise exception 'PUBLISH_TRANSITION'; end if;
      next_state:=p_payload->>'nextState'; merged:=i.receipt||r;
      allowed:=(i.state='creator_approved' and next_state in ('container_preparing','cancelled','invalidated'))
        or (i.state='container_preparing' and next_state='provider_processing' and merged ? 'containerId' and merged->>'status' in ('ready','processing'))
        or (i.state='provider_processing' and next_state='provider_processing' and i.receipt ? 'containerId' and merged->>'status' in ('ready','processing'))
        or (i.state='provider_processing' and next_state='publish_requested' and i.receipt ? 'containerId' and i.receipt->>'status'='ready' and i.publish_claim_request_id is null)
        or (i.state='publish_requested' and next_state='published' and i.publish_claim_request_id is not null and merged ? 'mediaId' and merged->>'status'='published')
        or (i.state='outcome_unknown' and next_state='published' and i.publish_claim_request_id is not null and r ? 'mediaId' and r->>'mediaId'=coalesce(i.receipt->>'mediaId',i.late_receipt->>'mediaId') and r->>'status'='published')
        or (i.state in ('container_preparing','provider_processing','publish_requested') and next_state='outcome_unknown')
        or (i.state in ('container_preparing','provider_processing','publish_requested') and next_state='failed' and r->>'code'='PROVIDER_REJECTED');
      if allowed is not true then raise exception 'PUBLISH_TRANSITION'; end if;
      if next_state in ('container_preparing','publish_requested','published','provider_processing') then sample:=private.creator_publish_authority(p_workspace,p_creator,i.binding,p_now); end if;
      update private.creator_publish_intents set state=next_state,receipt=merged,version=version+1,updated_at=p_now,
        publish_claim_request_id=case when next_state='publish_requested' then request else i.publish_claim_request_id end,
        publish_claim_version=case when next_state='publish_requested' then i.version+1 else i.publish_claim_version end,
        publish_claim_container_id=case when next_state='publish_requested' then i.receipt->>'containerId' else i.publish_claim_container_id end,
        publish_claimed_at=case when next_state='publish_requested' then p_now else i.publish_claimed_at end
        where id=i.id returning * into i;
    end if;
  end if;
  if (select count(*) from private.creator_publish_commands where intent_id=i.id)>=256 then raise exception 'PUBLISH_LIMIT'; end if;
  insert into private.creator_publish_commands(workspace_id,creator_id,request_id,intent_id,action,request_hash,created_at)
    values(p_workspace,p_creator,request,i.id,p_action,digest,p_now);
  if p_action='transition' then return jsonb_build_object('intent',private.creator_publish_dto(i),'applied',true); end if;
  return private.creator_publish_dto(i);
exception
  when unique_violation then raise exception 'PUBLISH_CONFLICT';
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then raise exception 'PUBLISH_INVALID';
end $$;

revoke all on function private.creator_publish_keys(jsonb,text[],text[]),private.creator_publish_binding(jsonb),private.creator_publish_receipt(jsonb),
  private.creator_publish_time(timestamptz),private.creator_publish_dto(private.creator_publish_intents),private.creator_publish_authority(uuid,uuid,jsonb,timestamptz),
  private.creator_publish_stop(uuid,uuid,text,uuid,timestamptz),private.creator_publish_source_change(),private.creator_publish_owner_change()
  from public,anon,authenticated,service_role;
revoke all on function public.creator_publish_command(uuid,uuid,text,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.creator_publish_command(uuid,uuid,text,jsonb,timestamptz) to service_role;

commit;
