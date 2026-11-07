-- Only server-imported rows may carry actual/unknown coverage. The manual command
-- retains its original HK/zh-Hant validation as well as this database constraint.
alter table public.studio_sources
  alter column region drop not null, alter column language drop not null,
  drop constraint studio_sources_region_check, drop constraint studio_sources_language_check,
  add column integration jsonb,
  add column integration_connection_id uuid generated always as ((integration->>'connection_id')::uuid) stored,
  add column integration_resource_id uuid generated always as ((integration->>'resource_id')::uuid) stored,
  add column integration_snapshot_id uuid generated always as ((integration->>'snapshot_id')::uuid) stored,
  add constraint studio_source_owner_key unique(id,workspace_id,creator_id),
  add constraint studio_source_coverage check (
    (integration is null and region is not null and region='HK' and language is not null and language='zh-Hant')
    or (integration is not null and jsonb_typeof(integration)='object' and kind='private'
      and integration ?& array['connection_id','resource_id','snapshot_id','generation','content_hash','source_version','model_allowed','provenance','availability','sample_only','coverage']
      and integration_connection_id is not null and integration_resource_id is not null and integration_snapshot_id is not null
      and jsonb_typeof(integration->'model_allowed')='boolean' and (integration->>'generation')::integer>0
      and (region is not distinct from integration->'coverage'->>'region') and (language is not distinct from integration->'coverage'->>'language'))),
  add constraint studio_source_integration_fk foreign key(integration_snapshot_id,integration_resource_id,integration_connection_id,workspace_id,creator_id)
    references public.integration_snapshots(id,resource_id,connection_id,workspace_id,creator_id);
create unique index studio_source_snapshot_once on public.studio_sources(thread_id,integration_snapshot_id) where integration_snapshot_id is not null and revoked_at is null;
create index studio_source_integration_connection on public.studio_sources(integration_connection_id);
alter table public.studio_shares add column integration_receipt jsonb;

create table private.integration_use_permits (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, creator_id uuid not null,
  source_id uuid not null, snapshot_id uuid not null, generation integer not null, content_hash text not null,
  use_kind text not null check(use_kind in ('read','model','save_brief','share')), payload_hash text,
  created_at timestamptz not null, expires_at timestamptz not null, consumed_at timestamptz, revoked_at timestamptz,
  check(expires_at<=created_at+interval '60 seconds'),
  foreign key(source_id,workspace_id,creator_id) references public.studio_sources(id,workspace_id,creator_id) on delete cascade
);
create index integration_permit_use on private.integration_use_permits(source_id,use_kind,payload_hash,expires_at);
alter table private.integration_use_permits enable row level security;
revoke all on private.integration_use_permits from public,anon,authenticated,service_role;

create function private.integration_source(p_workspace uuid,p_creator uuid,p_id uuid,p_use text)
returns public.studio_sources language plpgsql set search_path='' as $$
declare s public.studio_sources; c public.integration_connections; r public.integration_resources; snap public.integration_snapshots;
begin
  select * into s from public.studio_sources where id=p_id and workspace_id=p_workspace and creator_id=p_creator;
  if not found then raise exception 'NOT_FOUND'; end if;
  if s.integration is null or s.revoked_at is not null then raise exception 'SOURCE_UNAVAILABLE'; end if;
  select * into c from public.integration_connections where id=s.integration_connection_id;
  select * into r from public.integration_resources where id=s.integration_resource_id;
  select * into snap from public.integration_snapshots where id=s.integration_snapshot_id;
  if c.status not in ('connected','partial') or c.generation is distinct from (s.integration->>'generation')::integer
    or r.generation is distinct from c.generation or snap.generation is distinct from c.generation
    or r.snapshot_id is distinct from snap.id or r.data->>'availability' is distinct from 'available'
    or r.data->'selected' is distinct from 'true'::jsonb or r.data->'canDownload' is distinct from 'true'::jsonb
    or s.integration->>'content_hash' is distinct from snap.data->>'contentHash'
    or s.integration->>'availability' is distinct from 'available' then raise exception 'SOURCE_UNAVAILABLE'; end if;
  perform private.integration_connection(p_workspace,p_creator,c.id,c.generation);
  if p_use='model' and s.integration->'model_allowed' is distinct from 'true'::jsonb then raise exception 'MODEL_CONSENT_REQUIRED'; end if;
  if p_use='share' and (not s.shareable or r.data->>'rights' not in ('owned','licensed')) then raise exception 'SOURCE_PRIVATE'; end if;
  return s;
end $$;

create function private.integration_evidence_command(p_workspace uuid,p_creator uuid,p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare
  c public.integration_connections; t public.studio_threads; r public.integration_resources; s public.studio_sources;
  permission private.integration_use_permits; ids jsonb; sid text; content text; result jsonb:='[]'; metadata jsonb; snapshot_data jsonb;
  inserted integer:=0; stamp timestamptz:=clock_timestamp(); usage text; fingerprint text;
begin
  if p_action='source_refs' then
    ids:=p_payload->'sourceIds';
    if jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids)>100 then raise exception 'INVALID_INPUT'; end if;
    for sid in select distinct jsonb_array_elements_text(ids) loop
      select * into s from public.studio_sources where id=sid::uuid and workspace_id=p_workspace and creator_id=p_creator;
      if not found then raise exception 'NOT_FOUND'; end if;
      result:=result||jsonb_build_array(to_jsonb(s));
    end loop;
    return jsonb_build_object('sources',result);
  elsif p_action='import' then
    c:=private.integration_connection(p_workspace,p_creator,(p_payload->>'id')::uuid,(p_payload->>'generation')::integer);
    select * into t from public.studio_threads where id=(p_payload->>'threadId')::uuid and workspace_id=p_workspace and creator_id=p_creator for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if t.revision is distinct from (p_payload->>'revision')::integer then raise exception 'WORKFLOW_STALE'; end if;
    ids:=p_payload->'resourceIds';
    if jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids) not between 1 and 5
      or (select count(distinct value) from jsonb_array_elements_text(ids))<>jsonb_array_length(ids)
      or coalesce(length(trim(p_payload->>'question')),0) not between 1 and 500
      or jsonb_typeof(p_payload->'modelConsent') is distinct from 'boolean' or jsonb_typeof(p_payload->'processingRights') is distinct from 'boolean'
      or jsonb_typeof(p_payload->'shareRights') is distinct from 'boolean' then raise exception 'INVALID_INPUT'; end if;
    for sid in select jsonb_array_elements_text(ids) loop
      select * into r from public.integration_resources where id=sid::uuid and connection_id=c.id and workspace_id=p_workspace and creator_id=p_creator;
      if not found then raise exception 'NOT_FOUND'; end if;
      if r.generation<>c.generation then raise exception 'STALE_CONNECTION'; end if;
      if r.snapshot_id is null or r.data->>'availability'<>'available' or r.data->'selected'<>'true'::jsonb or r.data->'canDownload'<>'true'::jsonb then raise exception 'SOURCE_UNAVAILABLE'; end if;
      select * into s from public.studio_sources where thread_id=t.id and integration_snapshot_id=r.snapshot_id and revoked_at is null;
      if found then
        if s.revoked_at is not null then raise exception 'SOURCE_UNAVAILABLE'; end if;
        result:=result||jsonb_build_array(to_jsonb(s)); continue;
      end if;
      if (select count(*) from public.studio_sources where thread_id=t.id)>=100 then raise exception 'SOURCE_LIMIT'; end if;
      select data into snapshot_data from public.integration_snapshots where id=r.snapshot_id;
      -- Reading/selecting a resource does not authorize retaining its excerpt in
      -- Studio. Without processing rights retain only the permission notice.
      content:=case when (p_payload->>'processingRights')::boolean
        then coalesce(nullif(trim(snapshot_data->>'excerpt'),''),nullif((snapshot_data->'metrics')::text,'{}'))
        else '未確認此來源的處理權限；僅保留來源資訊，不會使用原文。' end;
      if coalesce(length(content),0) not between 1 and 8000 then raise exception 'INVALID_INPUT'; end if;
      metadata:=jsonb_build_object('connection_id',c.id,'resource_id',r.id,'snapshot_id',r.snapshot_id,'generation',c.generation,
        'source_version',r.data->>'version','content_hash',r.data->>'contentHash','model_allowed',(p_payload->>'modelConsent')::boolean and (p_payload->>'processingRights')::boolean,
        'provenance',c.provider,'availability',r.data->>'availability','sample_only',true,'coverage',snapshot_data->'coverage','consent_version',c.data->>'consentVersion');
      insert into public.studio_sources(thread_id,workspace_id,creator_id,title,content,kind,shareable,question,platform,region,language,observed_at,integration)
        values(t.id,p_workspace,p_creator,snapshot_data->>'title',content,'private',(p_payload->>'processingRights')::boolean and (p_payload->>'shareRights')::boolean and r.data->>'rights' in ('owned','licensed'),
          trim(p_payload->>'question'),case c.provider when 'instagram' then 'instagram_api' else 'google_drive' end,
          snapshot_data->'coverage'->>'region',snapshot_data->'coverage'->>'language',(snapshot_data->>'observedAt')::timestamptz,metadata) returning * into s;
      inserted:=inserted+1; result:=result||jsonb_build_array(to_jsonb(s));
    end loop;
    if inserted>0 then update public.studio_threads set revision=revision+1 where id=t.id; end if;
    return jsonb_build_object('sources',result);
  elsif p_action='permit' then
    ids:=p_payload->'sourceIds'; usage:=p_payload->>'use';
    if coalesce(usage,'') not in ('read','model','save_brief','share') or jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids) not between 1 and 100
      or (select count(distinct value) from jsonb_array_elements_text(ids))<>jsonb_array_length(ids) then raise exception 'INVALID_INPUT'; end if;
    if usage in ('save_brief','share') then
      if jsonb_typeof(p_payload->'commandPayload') is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
      fingerprint:=private.integration_hash(p_payload->'commandPayload');
    end if;
    for sid in select jsonb_array_elements_text(ids) loop
      s:=private.integration_source(p_workspace,p_creator,sid::uuid,usage);
      if usage='model' then
        if private.integration_keys(p_payload->'commandPayload',array['requestId']) is not true
          or (p_payload->'commandPayload'->>'requestId')::uuid is null then raise exception 'INVALID_INPUT'; end if;
        fingerprint:=private.integration_hash(p_payload->'commandPayload');
      end if;
      insert into private.integration_use_permits(workspace_id,creator_id,source_id,snapshot_id,generation,content_hash,use_kind,payload_hash,created_at,expires_at,consumed_at)
        values(p_workspace,p_creator,s.id,s.integration_snapshot_id,(s.integration->>'generation')::integer,s.integration->>'content_hash',usage,fingerprint,
          stamp,stamp+interval '60 seconds',null) returning * into permission;
      -- Model permits bind to an assistant request and are consumed by durable
      -- persistence; save/share permits bind to the complete Studio command JSON.
      result:=result||jsonb_build_array(jsonb_build_object('id',permission.id,'sourceId',s.id,'snapshotId',permission.snapshot_id,
        'generation',permission.generation,'contentHash',permission.content_hash,'use',usage,'expiresAt',permission.expires_at));
    end loop;
    return jsonb_build_object('permits',result);
  end if;
  raise exception 'INVALID_INPUT';
end $$;

-- Preserve the original body byte-for-byte, including manual source, revision,
-- lineage and canonical-draft behavior. It is not a second service/browser API.
alter function public.studio_command(uuid,uuid,uuid,text,jsonb) set schema private;
alter function private.studio_command(uuid,uuid,uuid,text,jsonb) rename to studio_command_stage3;
revoke all on function private.studio_command_stage3(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;

create function public.studio_command(p_workspace uuid,p_creator uuid,p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  t public.studio_threads; b public.studio_briefs; s public.studio_sources; cached public.studio_commands;
  permission private.integration_use_permits; sections jsonb; section jsonb; selected jsonb; source_id text;
  source_ids uuid[]:='{}'; sid uuid; fingerprint text; result jsonb; draft jsonb; snapshots jsonb:='[]'; evidence jsonb:='[]';
  caption text:=''; part text; share_id uuid; receipt jsonb; already_saved boolean;
begin
  if p_workspace is null or p_creator is null or p_request is null or p_action is null or jsonb_typeof(p_payload) is distinct from 'object'
    or octet_length(p_payload::text)>64000 then raise exception 'INVALID_INPUT'; end if;
  perform 1 from public.creators where id=p_creator and workspace_id=p_workspace and status in ('active','pending_review') for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_action='add_source' and (p_payload ?| array['integration','integration_connection_id','integration_snapshot_id','integration_resource_id','snapshotId','connectionId','generation','provenance']
    or lower(coalesce(p_payload->>'platform','')) in ('google_drive','instagram','instagram_api')) then raise exception 'INVALID_INPUT'; end if;
  if p_action not in ('save_brief','share_brief') then
    -- Stage 3 uses transaction-start now(). For imported sources the privacy
    -- boundary must follow answers committed while this transaction awaited the
    -- creator lock above. Pre-stamp only a fresh revocation; Stage 3 then preserves
    -- it in both the row and receipt. Its validation failure rolls this back too.
    if p_action='revoke_source' and not exists(select 1 from public.studio_commands
      where workspace_id=p_workspace and creator_id=p_creator and request_id=p_request) then
      update public.studio_sources set revoked_at=clock_timestamp()
        where id=(p_payload->>'sourceId')::uuid and thread_id=(p_payload->>'threadId')::uuid
          and workspace_id=p_workspace and creator_id=p_creator and integration is not null and revoked_at is null;
    end if;
    result:=private.studio_command_stage3(p_workspace,p_creator,p_request,p_action,p_payload);
    if p_action='revoke_source' then
      update private.integration_use_permits u set revoked_at=clock_timestamp() where u.source_id=(p_payload->>'sourceId')::uuid;
      -- Invalidate pending model results without discarding the user's input.
      update public.assistant_requests set state='unknown',result=jsonb_build_object('code','studio_context_changed','persistence','failed'),lease_until=clock_timestamp()
        where creator_id=p_creator and workspace_id=p_workspace and state in ('reserved','generating')
          and conversation_id in (select conversation_id from public.studio_threads where id=(p_payload->>'threadId')::uuid);
    end if;
    return result;
  end if;
  if p_action='share_brief' and p_payload ? 'recipient' and p_payload->>'recipient' is distinct from 'task_review' then raise exception 'INVALID_INPUT'; end if;
  select * into t from public.studio_threads where id=(p_payload->>'threadId')::uuid and workspace_id=p_workspace and creator_id=p_creator for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into cached from public.studio_commands where workspace_id=p_workspace and creator_id=p_creator and request_id=p_request;
  already_saved:=found;
  if already_saved and (cached.action<>p_action or cached.payload<>p_payload) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if p_action='save_brief' then
    sections:=p_payload->'sections';
    if jsonb_typeof(sections) is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
  else
    select * into b from public.studio_briefs where id=(p_payload->>'briefId')::uuid and thread_id=t.id;
    if not found then raise exception 'NOT_FOUND'; end if;
    selected:=p_payload->'sectionIds';
    if jsonb_typeof(selected) is distinct from 'array' or jsonb_array_length(selected) not between 1 and 12
      or (select count(distinct value) from jsonb_array_elements_text(selected))<>jsonb_array_length(selected)
      or exists(select 1 from jsonb_array_elements_text(selected) x where not exists(select 1 from jsonb_array_elements(b.sections) y where y->>'id'=x)) then raise exception 'INVALID_SELECTION'; end if;
    select coalesce(jsonb_agg(value),'[]') into sections from jsonb_array_elements(b.sections) where selected ? (value->>'id');
  end if;
  for section in select value from jsonb_array_elements(sections) loop
    if jsonb_typeof(section->'sourceIds') is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
    for source_id in select jsonb_array_elements_text(section->'sourceIds') loop
      select * into s from public.studio_sources where id=source_id::uuid and thread_id=t.id;
      if not found then raise exception 'SOURCE_UNAVAILABLE'; end if;
      if s.integration is not null and not s.id=any(source_ids) then source_ids:=array_append(source_ids,s.id); end if;
    end loop;
  end loop;
  fingerprint:=private.integration_hash(p_payload);
  foreach sid in array source_ids loop
    perform 1 from public.creators where id=p_creator and workspace_id=p_workspace and status='active';
    if not found then raise exception 'NOT_FOUND'; end if;
    s:=private.integration_source(p_workspace,p_creator,sid,case p_action when 'share_brief' then 'share' else 'save_brief' end);
    if not already_saved then
      select u.* into permission from private.integration_use_permits u where u.workspace_id=p_workspace and u.creator_id=p_creator
        and u.source_id=s.id and u.snapshot_id=s.integration_snapshot_id and u.generation=(s.integration->>'generation')::integer
        and u.content_hash=s.integration->>'content_hash' and u.use_kind=case p_action when 'share_brief' then 'share' else 'save_brief' end
        and u.payload_hash=fingerprint and u.expires_at>clock_timestamp() and u.consumed_at is null and u.revoked_at is null order by u.created_at limit 1 for update;
      if not found then raise exception 'SOURCE_UNAVAILABLE'; end if;
      update private.integration_use_permits set consumed_at=clock_timestamp() where id=permission.id;
    end if;
  end loop;
  -- Successful command replay doesn't need a second permit, but still rechecks all
  -- provider sources above. Revocation can never resurrect cached private output.
  if already_saved then return cached.result; end if;
  if p_action='save_brief' or cardinality(source_ids)=0 then
    return private.studio_command_stage3(p_workspace,p_creator,p_request,p_action,p_payload);
  end if;

  -- Provider-aware share uses the same canonical draft transaction and validations.
  -- Only citation coverage and the permission receipt differ from the legacy path.
  if t.revision is distinct from (p_payload->>'revision')::integer then raise exception 'WORKFLOW_STALE'; end if;
  if exists(select 1 from public.studio_briefs where thread_id=t.id and version>b.version) then raise exception 'STALE_BRIEF'; end if;
  if not exists(select 1 from public.mission_submissions ms join public.mission_workflows w on w.mission_submission_id=ms.id and w.workspace_id=ms.workspace_id
    join public.mission_work_items i on i.mission_workflow_id=w.id and i.workspace_id=w.workspace_id
    where ms.id=(p_payload->>'submissionId')::uuid and i.id=(p_payload->>'workItemId')::uuid and ms.creator_id=p_creator and ms.workspace_id=p_workspace
      and (t.mission_id is null or t.mission_id=ms.mission_id)) then raise exception 'NOT_FOUND'; end if;
  for section in select value from jsonb_array_elements(sections) loop
    part:=section->>'text';
    for source_id in select jsonb_array_elements_text(section->'sourceIds') loop
      select * into s from public.studio_sources where id=source_id::uuid and thread_id=t.id;
      if not found or s.revoked_at is not null then raise exception 'SOURCE_UNAVAILABLE'; end if;
      if not s.shareable then raise exception 'SOURCE_PRIVATE'; end if;
      snapshots:=snapshots||jsonb_build_array(jsonb_build_object('id',s.id,'title',s.title,'question',s.question,'platform',s.platform,
        'observedAt',s.observed_at,'url',s.url,'status',s.status,'region',s.region,'language',s.language));
      part:=part||E'\n來源：'||s.title||' · '||s.platform||' · '||to_char(s.observed_at at time zone 'Asia/Hong_Kong','YYYY-MM-DD HH24:MI')||' HKT · '
        ||case when s.integration is null then 'HK / 繁中' else coalesce(s.region,'地區未驗證')||' / '||coalesce(s.language,'語言未驗證') end
        ||' · 未驗證'||coalesce(' · '||s.url,'')||E'\n問題：'||s.question;
      if s.integration is not null then
        evidence:=evidence||jsonb_build_array(jsonb_build_object('source_id',s.id,'snapshot_id',s.integration_snapshot_id,'generation',(s.integration->>'generation')::integer,
          'content_hash',s.integration->>'content_hash','source_version',s.integration->>'source_version','consent_version',s.integration->>'consent_version',
          'provenance',s.integration->>'provenance','coverage',s.integration->'coverage'));
      end if;
    end loop;
    caption:=caption||case when caption='' then '' else E'\n\n' end||part;
  end loop;
  if length(caption)>10000 or (p_payload->>'draftRevision')::integer is null then raise exception 'INVALID_INPUT'; end if;
  draft:=private.save_active_mission_draft((p_payload->>'submissionId')::uuid,p_creator,p_workspace,(p_payload->>'workItemId')::uuid,(p_payload->>'draftRevision')::integer,jsonb_build_object('caption',caption));
  if draft ? 'code' then raise exception '%',draft->>'code'; end if;
  if draft->'draft'->>'revision' is null then raise exception 'DRAFT_UNAVAILABLE'; end if;
  receipt:=jsonb_build_object('brief_id',b.id,'brief_version',b.version,'section_ids',selected,'sources',evidence,'command_hash',fingerprint,
    'content_hash',private.integration_hash(sections),'submission_id',p_payload->>'submissionId','work_item_id',p_payload->>'workItemId','recipient','task_review');
  insert into public.studio_shares(thread_id,workspace_id,creator_id,brief_id,submission_id,work_item_id,section_ids,source_snapshot,draft_revision,integration_receipt)
    values(t.id,p_workspace,p_creator,b.id,(p_payload->>'submissionId')::uuid,(p_payload->>'workItemId')::uuid,selected,snapshots,(draft->'draft'->>'revision')::integer,receipt) returning id into share_id;
  select to_jsonb(sh) into result from public.studio_shares sh where sh.id=share_id;
  update public.studio_threads set revision=revision+1 where id=t.id;
  insert into public.studio_commands(workspace_id,creator_id,request_id,action,payload,result) values(p_workspace,p_creator,p_request,p_action,p_payload,result);
  return result;
end $$;
revoke all on function public.studio_command(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.studio_command(uuid,uuid,uuid,text,jsonb) to service_role;
revoke all on function private.integration_source(uuid,uuid,uuid,text),private.integration_evidence_command(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
