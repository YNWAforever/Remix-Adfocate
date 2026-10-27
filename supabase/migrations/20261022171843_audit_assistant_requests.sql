begin;
create table public.assistant_requests (
  creator_id uuid not null references public.creators(id),
  workspace_id uuid not null references public.workspaces(id),
  request_id uuid not null,
  payload_hash text not null,
  message text not null check (char_length(message) between 1 and 4000),
  locale text not null,
  context_version text not null,
  conversation_id uuid references public.assistant_conversations(id),
  state text not null check (state in ('reserved','generating','saved','unknown')),
  lease_until timestamptz not null,
  provider_started_at timestamptz,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (creator_id, workspace_id, request_id)
);
create index assistant_requests_quota_idx on public.assistant_requests(creator_id, workspace_id, created_at desc);
alter table public.assistant_requests enable row level security;
revoke all on public.assistant_requests from public, anon, authenticated;
grant select on public.assistant_requests to authenticated, service_role;
create policy assistant_requests_self on public.assistant_requests for select to authenticated using (
  creator_id = (select auth.uid()) and exists (select 1 from public.creators c where c.id = creator_id and c.workspace_id = assistant_requests.workspace_id)
);
alter table public.assistant_messages add column request_id uuid;
alter table public.assistant_messages add column turn_order smallint not null default 0 check (turn_order in (0,1));
create unique index assistant_messages_request_role_idx on public.assistant_messages(conversation_id, request_id, role);

create function public.reserve_assistant_request(p_workspace uuid, p_creator uuid, p_request uuid, p_message text, p_locale text,
  p_conversation uuid default null, p_context_version text default 'r1') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_request public.assistant_requests%rowtype; v_hash text; v_creator uuid := p_creator;
begin
  perform 1 from public.creators where id = v_creator and workspace_id = p_workspace for update;
  if not found then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  if p_request is null or p_message is null or char_length(p_message) not between 1 and 4000
    or p_locale not in ('zh-HK','en') or p_context_version is null or char_length(p_context_version) > 80 then
    raise exception using errcode = '22023', message = 'bad_request';
  end if;
  if p_conversation is not null and not exists (select 1 from public.assistant_conversations where id = p_conversation and creator_id = v_creator and workspace = p_workspace::text) then
    raise exception using errcode = 'P0002', message = 'not_found';
  end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object('message',p_message,'locale',p_locale,
    'conversation',p_conversation,'context_version',p_context_version)::text,'UTF8')),'hex');
  select * into v_request from public.assistant_requests where creator_id = v_creator and workspace_id = p_workspace and request_id = p_request;
  if found then
    if v_request.payload_hash <> v_hash then raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT'; end if;
    if v_request.state = 'saved' then return jsonb_build_object('action','replay','result',v_request.result); end if;
    if v_request.state = 'reserved' then return jsonb_build_object('action','reserved','request_id',p_request); end if;
    return jsonb_build_object('action','wait','request_id',p_request,'persistence','unknown');
  end if;
  update public.assistant_requests set state = 'unknown'
    where creator_id = v_creator and workspace_id = p_workspace and state in ('reserved','generating') and lease_until < clock_timestamp();
  if (select count(*) from public.assistant_requests where creator_id = v_creator and workspace_id = p_workspace and created_at > clock_timestamp() - interval '1 minute') >= 5 then
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED';
  end if;
  if exists (select 1 from public.assistant_requests where creator_id = v_creator and workspace_id = p_workspace and state in ('reserved','generating')) then
    raise exception using errcode = 'P0001', message = 'REQUEST_INFLIGHT';
  end if;
  insert into public.assistant_requests(creator_id,workspace_id,request_id,payload_hash,message,locale,context_version,conversation_id,state,lease_until)
    values(v_creator,p_workspace,p_request,v_hash,p_message,p_locale,p_context_version,p_conversation,'reserved',clock_timestamp()+interval '30 seconds');
  return jsonb_build_object('action','reserved','request_id',p_request);
end;
$$;

create function public.claim_assistant_request(p_workspace uuid,p_creator uuid,p_request uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.creators where id = p_creator and workspace_id = p_workspace) then return false; end if;
  update public.assistant_requests set state='generating', provider_started_at=clock_timestamp(), lease_until=clock_timestamp()+interval '30 seconds'
    where creator_id=p_creator and workspace_id=p_workspace and request_id=p_request and state='reserved' and lease_until>=clock_timestamp();
  return found;
end;
$$;
create function public.save_assistant_turn(p_workspace uuid,p_creator uuid,p_request uuid,p_answer text,p_citations jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_request public.assistant_requests%rowtype; v_conversation uuid; v_result jsonb;
begin
  select * into v_request from public.assistant_requests where creator_id=p_creator and workspace_id=p_workspace and request_id=p_request for update;
  if not found or not exists(select 1 from public.creators where id=p_creator and workspace_id=p_workspace) then
    raise exception using errcode='P0002',message='not_found';
  end if;
  if v_request.state='saved' then
    if v_request.result->>'answer' is distinct from p_answer or v_request.result->'citations' is distinct from p_citations then
      raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT';
    end if;
    return v_request.result;
  end if;
  if v_request.state<>'generating' then raise exception using errcode='P0001',message='outcome_unknown'; end if;
  if p_answer is null or char_length(p_answer)>40000 or jsonb_typeof(p_citations) is distinct from 'array' then
    raise exception using errcode='22023',message='bad_result';
  end if;
  v_conversation:=v_request.conversation_id;
  if v_conversation is null then
    insert into public.assistant_conversations(creator_id,workspace) values(p_creator,p_workspace::text) returning id into v_conversation;
  elsif not exists(select 1 from public.assistant_conversations where id=v_conversation and creator_id=p_creator and workspace=p_workspace::text) then
    raise exception using errcode='P0002',message='not_found';
  end if;
  insert into public.assistant_messages(conversation_id,role,content,citations,request_id,turn_order) values
    (v_conversation,'user',v_request.message,'[]'::jsonb,p_request,0), (v_conversation,'assistant',p_answer,p_citations,p_request,1);
  update public.assistant_conversations set last_message_at=clock_timestamp() where id=v_conversation;
  v_result:=jsonb_build_object('conversation_id',v_conversation,'request_id',p_request,'answer',p_answer,'citations',p_citations,'persistence','saved');
  update public.assistant_requests set state='saved',conversation_id=v_conversation,result=v_result
    where creator_id=p_creator and workspace_id=p_workspace and request_id=p_request;
  return v_result;
end;
$$;
create function public.mark_assistant_request_unknown(p_workspace uuid,p_creator uuid,p_request uuid) returns void
language sql security definer set search_path = '' as $$
  update public.assistant_requests set state='unknown' where creator_id=p_creator and workspace_id=p_workspace and request_id=p_request and state='generating';
$$;
create function public.get_assistant_request(p_workspace uuid,p_request uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select coalesce(r.result,jsonb_build_object('request_id',r.request_id,'state',r.state,'persistence','unknown'))
    from public.assistant_requests r where r.creator_id=auth.uid() and r.workspace_id=p_workspace and r.request_id=p_request
    and exists(select 1 from public.creators c where c.id=auth.uid() and c.workspace_id=p_workspace);
$$;
revoke all on function public.reserve_assistant_request(uuid,uuid,uuid,text,text,uuid,text) from public, anon, authenticated;
revoke all on function public.claim_assistant_request(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.save_assistant_turn(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.mark_assistant_request_unknown(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.get_assistant_request(uuid,uuid) from public, anon;
grant execute on function public.reserve_assistant_request(uuid,uuid,uuid,text,text,uuid,text) to service_role;
grant execute on function public.claim_assistant_request(uuid,uuid,uuid) to service_role;
grant execute on function public.save_assistant_turn(uuid,uuid,uuid,text,jsonb) to service_role;
grant execute on function public.mark_assistant_request_unknown(uuid,uuid,uuid) to service_role;
grant execute on function public.get_assistant_request(uuid,uuid) to authenticated;
commit;
