-- Caller holds the creator lock. Both resource-rights changes and connection
-- revocation quarantine affected source/model state through the same fence.
create function private.integration_invalidate_sources(p_workspace uuid,p_creator uuid,p_source_ids uuid[])
returns void language plpgsql set search_path='' as $$
declare affected_threads uuid[]; affected_sources uuid[];
begin
  select coalesce(array_agg(distinct thread_id),'{}'),coalesce(array_agg(id),'{}') into affected_threads,affected_sources
    from public.studio_sources where id=any(p_source_ids) and workspace_id=p_workspace and creator_id=p_creator;
  update public.studio_sources set revoked_at=coalesce(revoked_at,clock_timestamp()),shareable=false,
    integration=integration||'{"availability":"revoked","model_allowed":false}'::jsonb where id=any(affected_sources);
  update public.studio_threads set revision=revision+1 where id=any(affected_threads);
  update private.integration_use_permits set revoked_at=coalesce(revoked_at,clock_timestamp()) where source_id=any(affected_sources);
  -- Pending requests cannot complete against a changed Studio context. Completed
  -- answers are quarantined only with source provenance; safe turns and user text
  -- remain. Model permits retain lineage even if a cached citation was removed.
  update public.assistant_requests r set state='unknown',result=jsonb_build_object('code','studio_context_changed','persistence','failed'),lease_until=clock_timestamp()
    where r.workspace_id=p_workspace and r.creator_id=p_creator
      and r.conversation_id in (select conversation_id from public.studio_threads where id=any(affected_threads))
      and (r.state in ('reserved','generating')
        or exists(select 1 from private.integration_use_permits u where u.workspace_id=p_workspace and u.creator_id=p_creator
          and u.use_kind='model' and u.source_id=any(affected_sources) and u.payload_hash=private.integration_hash(jsonb_build_object('requestId',r.request_id)))
        or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(r.result->'citations')='array' then r.result->'citations' else '[]'::jsonb end) ref
          where ref->>'sourceRef'=any(affected_sources::text[]))
        or exists(select 1 from public.assistant_messages m where m.conversation_id=r.conversation_id and m.request_id=r.request_id and m.role='assistant'
          and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(m.citations)='array' then m.citations else '[]'::jsonb end) ref
            where ref->>'sourceRef'=any(affected_sources::text[]))));
end $$;

create function private.integration_invalidate(p_workspace uuid,p_creator uuid,p_connection uuid)
returns void language plpgsql set search_path='' as $$
declare affected_sources uuid[];
begin
  select coalesce(array_agg(id),'{}') into affected_sources from public.studio_sources
    where integration_connection_id=p_connection and workspace_id=p_workspace and creator_id=p_creator;
  perform private.integration_invalidate_sources(p_workspace,p_creator,affected_sources);
  update public.integration_resources set data=jsonb_set(data,'{availability}','"revoked"') where connection_id=p_connection;
  update public.integration_snapshots set expires_at=least(expires_at,clock_timestamp()+interval '24 hours') where connection_id=p_connection;
  update private.integration_oauth_states set consumed_at=coalesce(consumed_at,clock_timestamp())
    where workspace_id=p_workspace and creator_id=p_creator and provider=(select provider from public.integration_connections where id=p_connection);
  update public.integration_sync_runs set status='revoked',result=null,finished_at=clock_timestamp() where connection_id=p_connection;
end $$;

create function private.integration_purge(p_workspace uuid,p_creator uuid,p_connection uuid)
returns void language plpgsql set search_path='' as $$
declare c public.integration_connections; v_source_ids uuid[]; thread_ids uuid[];
begin
  select * into c from public.integration_connections where id=p_connection and workspace_id=p_workspace and creator_id=p_creator for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select coalesce(array_agg(id),'{}'),coalesce(array_agg(distinct thread_id),'{}') into v_source_ids,thread_ids
    from public.studio_sources where integration_connection_id=c.id;
  perform private.integration_invalidate(p_workspace,p_creator,c.id);
  if c.status<>'revoked' then c.generation:=c.generation+1; end if;
  update public.integration_connections set generation=c.generation,status='revoked',revoked_at=coalesce(revoked_at,clock_timestamp()),
    data=data||jsonb_build_object('generation',c.generation,'status','revoked','label','Disconnected','subject','','scopes','[]'::jsonb,
      'lastSyncAt',null,'lastError',null,'providerRevocation',case when data->>'providerRevocation'='revoked' then 'revoked' else 'manual_action' end)
    where id=c.id;
  delete from private.integration_credentials where connection_id=c.id;
  delete from private.integration_oauth_states where workspace_id=p_workspace and creator_id=p_creator and provider=c.provider;
  -- Privacy erasure is the sole exception to immutable private Brief history.
  -- Retain unrelated paragraphs and independent, already-delivered task copies.
  update public.studio_briefs b set sections=(select coalesce(jsonb_agg(section),'[]') from jsonb_array_elements(b.sections) section
    where not exists(select 1 from jsonb_array_elements_text(section->'sourceIds') ref where ref::uuid=any(v_source_ids)))
    where b.thread_id=any(thread_ids);
  update public.studio_shares sh set source_snapshot=(select coalesce(jsonb_agg(case when (s->>'id')::uuid=any(v_source_ids)
    then jsonb_build_object('id',s->>'id','status','purged') else s end),'[]') from jsonb_array_elements(sh.source_snapshot) s)
    where sh.thread_id=any(thread_ids);
  -- Retained integration receipts contain IDs, hashes, versions and destination,
  -- never original excerpts. Canonical drafts, rewards and ledgers are untouched.
  delete from public.studio_commands where workspace_id=p_workspace and creator_id=p_creator
    and ((payload->>'threadId')::uuid=any(thread_ids) or (result->>'id')::uuid=any(v_source_ids));
  update private.integration_commands set result='{}',invalidated_at=clock_timestamp()
    where workspace_id=p_workspace and creator_id=p_creator and action<>'purge'
      and (connection_id=c.id or v_source_ids && integration_commands.source_ids);
  update public.assistant_messages m set content='[integration content removed]',citations='[]',tool_calls='[]'
    where m.role='assistant' and m.conversation_id in (select conversation_id from public.studio_threads where id=any(thread_ids))
      and (exists(select 1 from jsonb_array_elements(case when jsonb_typeof(m.citations)='array' then m.citations else '[]'::jsonb end) ref
          where ref->>'sourceRef'=any(v_source_ids::text[]))
        or exists(select 1 from private.integration_use_permits u where u.workspace_id=p_workspace and u.creator_id=p_creator
          and u.use_kind='model' and u.source_id=any(v_source_ids) and u.payload_hash=private.integration_hash(jsonb_build_object('requestId',m.request_id))));
  delete from public.studio_sources where id=any(v_source_ids);
  update public.integration_resources set snapshot_id=null where connection_id=c.id;
  delete from public.integration_resources where connection_id=c.id;
  update public.integration_sync_runs set status='revoked',result=null where connection_id=c.id;
end $$;

create function private.integration_privacy_command(p_workspace uuid,p_creator uuid,p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare c public.integration_connections; cleanup_at timestamptz; expired_ids uuid[]; n integer:=0; retained private.integration_credentials;
begin
  if p_action='export' then
    return jsonb_build_object(
      'connections',coalesce((select jsonb_agg(data order by id) from public.integration_connections where workspace_id=p_workspace and creator_id=p_creator),'[]'),
      'resources',coalesce((select jsonb_agg(data order by id) from public.integration_resources where workspace_id=p_workspace and creator_id=p_creator),'[]'),
      'sources',coalesce((select jsonb_agg(to_jsonb(s) order by id) from public.studio_sources s where workspace_id=p_workspace and creator_id=p_creator and integration is not null),'[]'));
  elsif p_action='expire' then
    cleanup_at:=(p_payload->>'now')::timestamptz;
    if cleanup_at is null then raise exception 'INVALID_INPUT'; end if;
    update public.integration_connections conn set data=jsonb_set(data,'{providerRevocation}','"manual_action"')
      where conn.workspace_id=p_workspace and conn.creator_id=p_creator and conn.status='revoked' and conn.data->>'providerRevocation'='pending'
        and exists(select 1 from private.integration_credentials k where k.connection_id=conn.id and k.revoke_until<=cleanup_at);
    delete from private.integration_credentials where workspace_id=p_workspace and creator_id=p_creator
      and (revoke_until<=cleanup_at or (revoke_until is null and expires_at<=cleanup_at));
    get diagnostics n=row_count;
    select coalesce(array_agg(id),'{}') into expired_ids from public.integration_snapshots snap where workspace_id=p_workspace and creator_id=p_creator
      and expires_at<=cleanup_at and not exists(select 1 from public.studio_sources s where s.integration_snapshot_id=snap.id);
    update public.integration_resources set snapshot_id=null,data=data||'{"snapshotId":null,"excerpt":null,"metrics":{},"availability":"stale"}'::jsonb where snapshot_id=any(expired_ids);
    delete from public.integration_snapshots where id=any(expired_ids);
    delete from private.integration_oauth_states where workspace_id=p_workspace and creator_id=p_creator and expires_at<=cleanup_at;
    -- Keep expired model lineage as a content-free tombstone until source/account
    -- purge. Deleting it would let a late result omit all citations and look manual.
    delete from private.integration_use_permits where workspace_id=p_workspace and creator_id=p_creator and expires_at<=cleanup_at and consumed_at is null and use_kind<>'model';
    -- A result cache is also retained source content: scrub it when its snapshot is
    -- expired. Preserve fingerprints as tombstones to prevent request resurrection.
    update private.integration_commands cmd set result='{}',invalidated_at=cleanup_at
      where cmd.workspace_id=p_workspace and cmd.creator_id=p_creator and cmd.action='resources'
        and exists(select 1 from jsonb_array_elements(cmd.result->'resources') r where (r->>'snapshotId')::uuid=any(expired_ids));
    update public.integration_sync_runs run set result=null,status='unknown' where run.workspace_id=p_workspace and run.creator_id=p_creator
      and exists(select 1 from jsonb_array_elements(run.result->'resources') r where (r->>'snapshotId')::uuid=any(expired_ids));
    delete from public.integration_events where workspace_id=p_workspace and creator_id=p_creator and created_at<cleanup_at-interval '90 days';
    return jsonb_build_object('purged',n+cardinality(expired_ids));
  end if;
  select * into c from public.integration_connections where id=(p_payload->>'id')::uuid and workspace_id=p_workspace and creator_id=p_creator for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_action='revocation_credentials' then
    if jsonb_typeof(p_payload->'generation') is distinct from 'number' or coalesce((p_payload->>'generation')::integer,0)<=0 then raise exception 'INVALID_INPUT'; end if;
    if c.generation<>(p_payload->>'generation')::integer or c.status<>'revoked' or c.data->>'providerRevocation' is distinct from 'pending' then raise exception 'STALE_CONNECTION'; end if;
    -- A dedicated management read only. Normal credentials remain unavailable
    -- after revoke. Return the original generation for authenticated decryption.
    select * into retained from private.integration_credentials where connection_id=c.id and workspace_id=p_workspace and creator_id=p_creator
      and revoke_until>clock_timestamp() and c.revoked_at>clock_timestamp()-interval '24 hours';
    return jsonb_build_object('credential',retained.credential,'credentialGeneration',retained.generation);
  elsif p_action='revoke' then
    if c.generation is distinct from (p_payload->>'generation')::integer then raise exception 'STALE_CONNECTION'; end if;
    if c.status<>'revoked' then
      perform private.integration_invalidate(p_workspace,p_creator,c.id);
      update public.integration_connections set status='revoked',generation=generation+1,revoked_at=clock_timestamp(),
        data=data||jsonb_build_object('status','revoked','generation',generation+1,'providerRevocation','pending') where id=c.id returning * into c;
      update private.integration_credentials set revoke_until=clock_timestamp()+interval '24 hours' where connection_id=c.id;
      insert into public.integration_events(connection_id,workspace_id,creator_id,event,generation,outcome) values(c.id,p_workspace,p_creator,'revoked',c.generation,'pending');
    end if;
    return jsonb_build_object('connection',c.data);
  elsif p_action='revoke_result' then
    -- Provider completion belongs to the generation returned by local revoke.
    -- The status alone cannot distinguish an old completion from a newer revoke
    -- after reconnect; fence before touching the newer credential or receipt.
    if jsonb_typeof(p_payload->'generation') is distinct from 'number' or coalesce((p_payload->>'generation')::integer,0)<=0 then raise exception 'INVALID_INPUT'; end if;
    if c.status<>'revoked' or c.generation<>(p_payload->>'generation')::integer then raise exception 'STALE_CONNECTION'; end if;
    if coalesce(p_payload->>'provider','') not in ('revoked','pending','manual_action') then raise exception 'INVALID_INPUT'; end if;
    if p_payload->>'provider' in ('revoked','manual_action') then delete from private.integration_credentials where connection_id=c.id; end if;
    update public.integration_connections set data=jsonb_set(data,'{providerRevocation}',p_payload->'provider') where id=c.id returning * into c;
    insert into public.integration_events(connection_id,workspace_id,creator_id,event,generation,outcome) values(c.id,p_workspace,p_creator,'revoke_result',c.generation,p_payload->>'provider');
    return jsonb_build_object('connection',c.data);
  elsif p_action='purge' then
    perform private.integration_purge(p_workspace,p_creator,c.id);
    insert into public.integration_events(connection_id,workspace_id,creator_id,event,generation,outcome)
      select id,p_workspace,p_creator,'purged',generation,'complete' from public.integration_connections where id=c.id;
    return '{"state":"complete"}';
  end if;
  raise exception 'INVALID_INPUT';
end $$;

create function public.integration_command(p_workspace uuid,p_creator uuid,p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  cached private.integration_commands; c public.integration_connections; run public.integration_sync_runs; sid uuid;
  fingerprint text; result jsonb; cacheable boolean; v_connection_id uuid; v_generation integer; source_ids uuid[]:='{}'; item jsonb;
begin
  if p_workspace is null or p_creator is null or p_request is null or p_action is null or jsonb_typeof(p_payload) is distinct from 'object'
    or octet_length(p_payload::text)>1048576 then raise exception 'INVALID_INPUT'; end if;
  -- Serialize every operation (including secret reads and replay) with deletion,
  -- revoke, reconnect and Studio persistence. Browser JWT claims are never actors.
  perform 1 from public.creators where id=p_creator and workspace_id=p_workspace and status='active' for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  fingerprint:=private.integration_hash(p_payload);
  if p_action='resources' and p_payload ? 'intent' then
    if private.integration_keys(p_payload->'intent',array['fileIds']) is not true
      or jsonb_typeof(p_payload->'intent'->'fileIds') is distinct from 'array' or jsonb_array_length(p_payload->'intent'->'fileIds') not between 1 and 5
      or exists(select 1 from jsonb_array_elements(p_payload->'intent'->'fileIds') v where jsonb_typeof(v)<>'string' or length(v#>>'{}') not between 1 and 500)
      or (select count(distinct v) from jsonb_array_elements(p_payload->'intent'->'fileIds') v)<>jsonb_array_length(p_payload->'intent'->'fileIds') then raise exception 'INVALID_INPUT'; end if;
    fingerprint:=private.integration_hash(jsonb_build_object('action',p_action,'id',p_payload->'id','generation',p_payload->'generation','intent',p_payload->'intent'));
  end if;
  cacheable:=p_action not in ('start','consume_state','credentials','update_credentials','revocation_credentials','source_refs','export','expire','reserve_sync');
  select * into run from public.integration_sync_runs where workspace_id=p_workspace and creator_id=p_creator and request_id=p_request;
  if found and (p_action<>'reserve_sync' or run.payload_hash<>fingerprint) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  select * into cached from private.integration_commands where workspace_id=p_workspace and creator_id=p_creator and request_id=p_request;
  if found then
    if cached.action<>p_action or cached.payload_hash<>fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    if cached.invalidated_at is not null then raise exception 'SOURCE_UNAVAILABLE'; end if;
    if cached.connection_id is not null and p_action<>'purge' then
      select * into c from public.integration_connections where id=cached.connection_id and workspace_id=p_workspace and creator_id=p_creator;
      if not found or c.generation is distinct from cached.generation then raise exception 'STALE_CONNECTION'; end if;
      if p_action not in ('revoke','revoke_result','reauth') and c.status not in ('connected','partial') then raise exception 'SOURCE_UNAVAILABLE'; end if;
    end if;
    foreach sid in array cached.source_ids loop
      perform private.integration_source(p_workspace,p_creator,sid,case when p_action='permit' then p_payload->>'use' else 'read' end);
    end loop;
    if p_action='permit' and exists(select 1 from jsonb_array_elements(cached.result->'permits') p where not exists(
      select 1 from private.integration_use_permits u where u.id=(p->>'id')::uuid and u.expires_at>clock_timestamp() and u.consumed_at is null and u.revoked_at is null)) then raise exception 'SOURCE_UNAVAILABLE'; end if;
    if p_action='resources' and not private.integration_cached_resources(p_workspace,p_creator,cached.connection_id,cached.generation,cached.result->'resources') then raise exception 'SOURCE_UNAVAILABLE'; end if;
    return cached.result;
  end if;
  if p_action in ('start','consume_state','connect','credentials','update_credentials','resources','reserve_sync','finish_sync','fail_sync','reauth') then
    result:=private.integration_foundation_command(p_workspace,p_creator,p_request,p_action,p_payload);
  elsif p_action in ('source_refs','import','permit') then
    result:=private.integration_evidence_command(p_workspace,p_creator,p_request,p_action,p_payload);
  elsif p_action in ('revoke','revoke_result','revocation_credentials','purge','export','expire') then
    result:=private.integration_privacy_command(p_workspace,p_creator,p_request,p_action,p_payload);
  else raise exception 'INVALID_INPUT'; end if;
  if cacheable then
    v_connection_id:=coalesce((p_payload->>'id')::uuid,(result->'connection'->>'id')::uuid);
    if v_connection_id is not null then select conn.generation into v_generation from public.integration_connections conn where conn.id=v_connection_id; end if;
    if p_action='import' then select coalesce(array_agg((s->>'id')::uuid),'{}') into source_ids from jsonb_array_elements(result->'sources') s;
    elsif p_action='permit' then select coalesce(array_agg(s::uuid),'{}') into source_ids from jsonb_array_elements_text(p_payload->'sourceIds') s; end if;
    -- Full-payload hash detects changed credentials without persisting ciphertext,
    -- state secrets or request bodies in any result/audit cache.
    insert into private.integration_commands(workspace_id,creator_id,request_id,action,payload_hash,result,connection_id,generation,source_ids)
      values(p_workspace,p_creator,p_request,p_action,fingerprint,result,v_connection_id,v_generation,source_ids);
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

-- Atomic model-result fencing. Keep the original manual/request semantics intact,
-- and never use a service-supplied sourceType as the authority for source ownership.
alter function public.save_assistant_turn(uuid,uuid,uuid,text,jsonb) set schema private;
alter function private.save_assistant_turn(uuid,uuid,uuid,text,jsonb) rename to save_assistant_turn_stage3;
revoke all on function private.save_assistant_turn_stage3(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.save_assistant_turn(p_workspace uuid,p_creator uuid,p_request uuid,p_answer text,p_citations jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  r public.assistant_requests; s public.studio_sources; permission private.integration_use_permits;
  citation jsonb; sid uuid; source_ids uuid[]:='{}'; permit_ids uuid[]:='{}'; result jsonb;
  fingerprint text:=private.integration_hash(jsonb_build_object('requestId',p_request));
begin
  perform 1 from public.creators where id=p_creator and workspace_id=p_workspace and status<>'deleted' for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select * into r from public.assistant_requests where workspace_id=p_workspace and creator_id=p_creator and request_id=p_request for update;
  if not found or jsonb_typeof(p_citations) is distinct from 'array' then
    return private.save_assistant_turn_stage3(p_workspace,p_creator,p_request,p_answer,p_citations);
  end if;
  for citation in select value from jsonb_array_elements(p_citations) loop
    select * into s from public.studio_sources where id::text=citation->>'sourceRef' and integration is not null;
    if found then
      if s.workspace_id<>p_workspace or s.creator_id<>p_creator then raise exception 'SOURCE_UNAVAILABLE'; end if;
      if not s.id=any(source_ids) then source_ids:=array_append(source_ids,s.id); end if;
    elsif citation->>'sourceType'='integration_mock_unverified' then raise exception 'SOURCE_UNAVAILABLE';
    end if;
  end loop;
  -- A result cannot remove citations after obtaining authorization for those
  -- sources, even if the caller also removes their sourceType labels.
  for sid in select distinct u.source_id from private.integration_use_permits u where u.workspace_id=p_workspace and u.creator_id=p_creator and u.use_kind='model' and u.payload_hash=fingerprint loop
    if not sid=any(source_ids) then raise exception 'SOURCE_LINEAGE_REQUIRED'; end if;
  end loop;
  foreach sid in array source_ids loop
    perform 1 from public.creators where id=p_creator and workspace_id=p_workspace and status='active';
    if not found then raise exception 'SOURCE_UNAVAILABLE'; end if;
    s:=private.integration_source(p_workspace,p_creator,sid,'model');
    if not exists(select 1 from public.studio_threads t where t.id=s.thread_id and t.conversation_id=r.conversation_id) then raise exception 'SOURCE_UNAVAILABLE'; end if;
    select u.* into permission from private.integration_use_permits u where u.workspace_id=p_workspace and u.creator_id=p_creator and u.source_id=s.id
      and u.snapshot_id=s.integration_snapshot_id and u.generation=(s.integration->>'generation')::integer and u.content_hash=s.integration->>'content_hash'
      and u.use_kind='model' and u.payload_hash=fingerprint and u.revoked_at is null
      and ((r.state='saved' and u.consumed_at is not null) or (r.state<>'saved' and u.consumed_at is null and u.expires_at>clock_timestamp()))
      order by u.created_at limit 1 for update;
    if not found then raise exception 'SOURCE_UNAVAILABLE'; end if;
    permit_ids:=array_append(permit_ids,permission.id);
  end loop;
  result:=private.save_assistant_turn_stage3(p_workspace,p_creator,p_request,p_answer,p_citations);
  update private.integration_use_permits set consumed_at=coalesce(consumed_at,clock_timestamp()) where id=any(permit_ids);
  return result;
end $$;
revoke all on function public.save_assistant_turn(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_assistant_turn(uuid,uuid,uuid,text,jsonb) to service_role;

alter function public.get_assistant_request(uuid,uuid) set schema private;
alter function private.get_assistant_request(uuid,uuid) rename to get_assistant_request_stage3;
revoke all on function private.get_assistant_request_stage3(uuid,uuid) from public,anon,authenticated,service_role;
create function public.get_assistant_request(p_workspace uuid,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.assistant_requests; s public.studio_sources; sid uuid; actor uuid:=auth.uid();
begin
  perform 1 from public.creators where id=actor and workspace_id=p_workspace for update;
  if not found then return null; end if;
  select * into r from public.assistant_requests where creator_id=actor and workspace_id=p_workspace and request_id=p_request;
  for sid in select distinct u.source_id from private.integration_use_permits u where u.workspace_id=p_workspace and u.creator_id=actor
    and u.use_kind='model' and u.payload_hash=private.integration_hash(jsonb_build_object('requestId',p_request)) loop
    begin
      s:=private.integration_source(p_workspace,actor,sid,'model');
    exception when raise_exception then
      return jsonb_build_object('request_id',p_request,'conversation_id',r.conversation_id,'code','studio_context_changed','persistence','failed');
    end;
  end loop;
  return private.get_assistant_request_stage3(p_workspace,p_request);
end $$;
revoke all on function public.get_assistant_request(uuid,uuid) from public,anon;
grant execute on function public.get_assistant_request(uuid,uuid) to authenticated;

-- Run before the existing Studio cleanup so private lineage is still available.
-- The existing anonymisation/settlement functions and their bodies are unchanged.
create function private.integration_account_cleanup() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.integration_connections;
begin
  if new.status='deleted' then
    for c in select * from public.integration_connections where creator_id=new.id order by id loop
      perform private.integration_purge(c.workspace_id,new.id,c.id);
    end loop;
    delete from private.integration_commands where creator_id=new.id;
    delete from private.integration_oauth_states where creator_id=new.id;
    delete from private.integration_use_permits where creator_id=new.id;
    delete from public.integration_connections where creator_id=new.id;
  end if;
  return new;
end $$;
create trigger integration_account_cleanup before update of status on public.creators for each row execute function private.integration_account_cleanup();
revoke all on function private.integration_invalidate_sources(uuid,uuid,uuid[]),private.integration_invalidate(uuid,uuid,uuid),private.integration_purge(uuid,uuid,uuid),
  private.integration_privacy_command(uuid,uuid,uuid,text,jsonb),private.integration_account_cleanup() from public,anon,authenticated,service_role;
