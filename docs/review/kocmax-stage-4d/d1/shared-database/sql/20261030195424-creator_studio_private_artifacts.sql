alter table public.missions add column public_preview_enabled boolean not null default false;

-- Additive, opt-in studio. Browser clients may only read their own private rows.
-- All mutations are authenticated by workspaceAuth and executed by this scoped RPC.
create table public.studio_threads (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
  creator_id uuid not null references public.creators(id), title text not null check(length(title) between 1 and 160),
  topic text not null check(topic in ('missions','creation','performance','rewards')),
  initial_prompt text check(length(initial_prompt)<=4000),
  mission_id uuid references public.missions(id), conversation_id uuid not null unique references public.assistant_conversations(id),
  revision integer not null default 0, created_at timestamptz not null default now(),
  unique(id,workspace_id,creator_id)
);
create index studio_threads_owner on public.studio_threads(creator_id,workspace_id,created_at desc);
create table public.studio_sources (
  id uuid primary key default gen_random_uuid(), thread_id uuid not null,
  workspace_id uuid not null, creator_id uuid not null,
  title text not null check(length(title) between 1 and 160), content text not null check(length(content) between 1 and 8000),
  url text, kind text not null check(kind in ('manual','public','private')), shareable boolean not null default false,
  question text not null check(length(question) between 1 and 500), platform text not null check(length(platform) between 1 and 80),
  region text not null check(region='HK'), language text not null check(language='zh-Hant'),
  observed_at timestamptz not null, status text not null default 'unverified' check(status='unverified'),
  revoked_at timestamptz, created_at timestamptz not null default now(),
  foreign key(thread_id,workspace_id,creator_id) references public.studio_threads(id,workspace_id,creator_id) on delete cascade
);
create index studio_sources_thread on public.studio_sources(thread_id);
create table public.studio_briefs (
  id uuid primary key default gen_random_uuid(), thread_id uuid not null, workspace_id uuid not null, creator_id uuid not null,
  version integer not null check(version>0), sections jsonb not null check(jsonb_typeof(sections)='array'),
  created_at timestamptz not null default now(), unique(thread_id,version),
  foreign key(thread_id,workspace_id,creator_id) references public.studio_threads(id,workspace_id,creator_id) on delete cascade
);
create table public.studio_shares (
  id uuid primary key default gen_random_uuid(), thread_id uuid not null, workspace_id uuid not null, creator_id uuid not null,
  brief_id uuid not null references public.studio_briefs(id) on delete cascade,
  submission_id uuid not null references public.mission_submissions(id), work_item_id uuid not null references public.mission_work_items(id),
  section_ids jsonb not null, source_snapshot jsonb not null, draft_revision integer not null,
  recipient text not null default 'task_review' check(recipient='task_review'), created_at timestamptz not null default now(),
  foreign key(thread_id,workspace_id,creator_id) references public.studio_threads(id,workspace_id,creator_id) on delete cascade
);
create index studio_shares_thread on public.studio_shares(thread_id);
create table public.studio_commands (
  workspace_id uuid not null, creator_id uuid not null, request_id uuid not null,
  action text not null, payload jsonb not null, result jsonb not null, created_at timestamptz not null default now(),
  primary key(workspace_id,creator_id,request_id)
);
create table public.studio_badges (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
  creator_id uuid not null references public.creators(id), badge_key text not null default 'first_verified_task',
  policy_version integer not null default 1, source_event text not null, created_at timestamptz not null default now(),
  unique(workspace_id,creator_id,badge_key,policy_version)
);

do $$ declare t text; begin
  foreach t in array array['studio_threads','studio_sources','studio_briefs','studio_shares','studio_commands','studio_badges'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('create policy studio_owner_read on public.%1$I for select to authenticated using (creator_id=(select auth.uid()) and exists(select 1 from public.creators c where c.id=(select auth.uid()) and c.workspace_id=%1$I.workspace_id and c.status<>''deleted''))',t);
  end loop;
end $$;

create function public.studio_command(p_workspace uuid,p_creator uuid,p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  t public.studio_threads; s public.studio_sources; b public.studio_briefs; receipt public.studio_commands;
  section jsonb; source_id text; selected jsonb; result jsonb; draft jsonb; sources jsonb:='[]';
  caption text:=''; part text; conv uuid; next_version integer; share_id uuid; expected_revision integer;
begin
  if p_workspace is null or p_creator is null or p_request is null or p_action is null or jsonb_typeof(p_payload) is distinct from 'object'
    or octet_length(p_payload::text)>64000 then raise exception 'INVALID_INPUT'; end if;
  -- Serialize with account anonymisation before reading private data or writing receipts.
  perform 1 from public.creators where id=p_creator and workspace_id=p_workspace and status in ('active','pending_review') for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace::text||p_creator::text||p_request::text,0));
  select * into receipt from public.studio_commands where workspace_id=p_workspace and creator_id=p_creator and request_id=p_request;
  if found then
    if receipt.action<>p_action or receipt.payload<>p_payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return receipt.result;
  end if;
  if p_action='create_thread' then
    if coalesce(p_payload->>'topic','') not in ('missions','creation','performance','rewards') or coalesce(length(trim(p_payload->>'title')),0) not between 1 and 160 then raise exception 'INVALID_INPUT'; end if;
    if p_payload->>'missionId' is not null and not exists(select 1 from public.missions where id=(p_payload->>'missionId')::uuid and workspace_id=p_workspace) then raise exception 'NOT_FOUND'; end if;
    insert into public.assistant_conversations(creator_id,workspace) values(p_creator,p_workspace::text) returning id into conv;
    insert into public.studio_threads(workspace_id,creator_id,title,topic,mission_id,conversation_id,initial_prompt)
      values(p_workspace,p_creator,trim(p_payload->>'title'),p_payload->>'topic',(p_payload->>'missionId')::uuid,conv,p_payload->>'initialPrompt') returning * into t;
    result:=to_jsonb(t);
  else
    select * into t from public.studio_threads where id=(p_payload->>'threadId')::uuid and creator_id=p_creator and workspace_id=p_workspace for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    expected_revision:=(p_payload->>'revision')::integer;
    if expected_revision is null or t.revision<>expected_revision then raise exception 'WORKFLOW_STALE'; end if;
    if p_action='add_source' then
      if (select count(*) from public.studio_sources where thread_id=t.id)>=100 then raise exception 'SOURCE_LIMIT'; end if;
      if coalesce(p_payload->>'region','')<>'HK' or coalesce(p_payload->>'language','')<>'zh-Hant' then raise exception 'UNSUPPORTED_COVERAGE'; end if;
      if p_payload->>'url' is not null and ((p_payload->>'url') !~ '^https://[^/@[:space:]]+([/?#]|$)' or length(p_payload->>'url')>2000) then raise exception 'INVALID_SOURCE'; end if;
      insert into public.studio_sources(thread_id,workspace_id,creator_id,title,content,url,kind,shareable,question,platform,region,language,observed_at)
        values(t.id,p_workspace,p_creator,trim(p_payload->>'title'),trim(p_payload->>'content'),p_payload->>'url',p_payload->>'kind',coalesce((p_payload->>'shareable')::boolean,false),trim(p_payload->>'question'),trim(p_payload->>'platform'),'HK','zh-Hant',(p_payload->>'observed_at')::timestamptz) returning * into s;
      result:=to_jsonb(s);
    elsif p_action='revoke_source' then
      update public.studio_sources set revoked_at=coalesce(revoked_at,now()),shareable=false where id=(p_payload->>'sourceId')::uuid and thread_id=t.id returning * into s;
      if not found then raise exception 'NOT_FOUND'; end if;
      result:=to_jsonb(s);
    elsif p_action='save_brief' then
      if jsonb_typeof(p_payload->'sections') is distinct from 'array' or jsonb_array_length(p_payload->'sections') not between 1 and 12 then raise exception 'INVALID_INPUT'; end if;
      selected:='[]';
      for section in select value from jsonb_array_elements(p_payload->'sections') loop
        if coalesce(section->>'id','') !~ '^[a-zA-Z0-9_-]{1,60}$' or selected ? (section->>'id') or coalesce(length(trim(section->>'text')),0) not between 1 and 3000
          or jsonb_typeof(section->'sourceIds') is distinct from 'array' or jsonb_array_length(section->'sourceIds')>8 then raise exception 'INVALID_INPUT'; end if;
        selected:=selected||jsonb_build_array(section->>'id');
        -- Edits cannot erase the lineage of a paragraph from an earlier immutable version.
        if exists(select 1 from public.studio_briefs prior, lateral jsonb_array_elements(prior.sections) old_section,
          lateral jsonb_array_elements_text(old_section->'sourceIds') old_source
          where prior.thread_id=t.id and old_section->>'id'=section->>'id' and not (section->'sourceIds') ? old_source)
          then raise exception 'SOURCE_LINEAGE_REQUIRED'; end if;
        for source_id in select jsonb_array_elements_text(section->'sourceIds') loop
          if not exists(select 1 from public.studio_sources where id=source_id::uuid and thread_id=t.id and revoked_at is null) then raise exception 'SOURCE_UNAVAILABLE'; end if;
        end loop;
      end loop;
      select coalesce(max(version),0)+1 into next_version from public.studio_briefs where thread_id=t.id;
      insert into public.studio_briefs(thread_id,workspace_id,creator_id,version,sections)
        values(t.id,p_workspace,p_creator,next_version,p_payload->'sections') returning * into b;
      result:=to_jsonb(b);
    elsif p_action='share_brief' then
      select * into b from public.studio_briefs where id=(p_payload->>'briefId')::uuid and thread_id=t.id;
      if not found then raise exception 'NOT_FOUND'; end if;
      if exists(select 1 from public.studio_briefs where thread_id=t.id and version>b.version) then raise exception 'STALE_BRIEF'; end if;
      selected:=p_payload->'sectionIds';
      if jsonb_typeof(selected) is distinct from 'array' or jsonb_array_length(selected) not between 1 and 12
        or (select count(distinct value) from jsonb_array_elements_text(selected))<>jsonb_array_length(selected)
        or exists(select 1 from jsonb_array_elements_text(selected) x where not exists(select 1 from jsonb_array_elements(b.sections) y where y->>'id'=x)) then raise exception 'INVALID_SELECTION'; end if;
      if not exists(select 1 from public.mission_submissions ms join public.mission_workflows w on w.mission_submission_id=ms.id and w.workspace_id=ms.workspace_id
        join public.mission_work_items i on i.mission_workflow_id=w.id and i.workspace_id=w.workspace_id
        where ms.id=(p_payload->>'submissionId')::uuid and i.id=(p_payload->>'workItemId')::uuid and ms.creator_id=p_creator and ms.workspace_id=p_workspace and (t.mission_id is null or t.mission_id=ms.mission_id)) then raise exception 'NOT_FOUND'; end if;
      for section in select value from jsonb_array_elements(b.sections) loop
        if not selected ? (section->>'id') then continue; end if;
        part:=section->>'text';
        for source_id in select jsonb_array_elements_text(section->'sourceIds') loop
          select * into s from public.studio_sources where id=source_id::uuid and thread_id=t.id;
          if not found or s.revoked_at is not null then raise exception 'SOURCE_UNAVAILABLE'; end if;
          if not s.shareable then raise exception 'SOURCE_PRIVATE'; end if;
          -- Share only the cited metadata; never include the complete private document body.
          sources:=sources||jsonb_build_array(jsonb_build_object('id',s.id,'title',s.title,'question',s.question,'platform',s.platform,'observedAt',s.observed_at,'url',s.url,'status',s.status,'region',s.region,'language',s.language));
          part:=part||E'\n來源：'||s.title||' · '||s.platform||' · '||to_char(s.observed_at at time zone 'Asia/Hong_Kong','YYYY-MM-DD HH24:MI')||' HKT · HK / 繁中 · 未驗證'||coalesce(' · '||s.url,'')||E'\n問題：'||s.question;
        end loop;
        caption:=caption||case when caption='' then '' else E'\n\n' end||part;
      end loop;
      if length(caption)>10000 or (p_payload->>'draftRevision')::integer is null then raise exception 'INVALID_INPUT'; end if;
      -- Use the canonical transaction, preserving checklist/assets and its loaded revision check.
      draft:=private.save_active_mission_draft((p_payload->>'submissionId')::uuid,p_creator,p_workspace,(p_payload->>'workItemId')::uuid,(p_payload->>'draftRevision')::integer,jsonb_build_object('caption',caption));
      if draft ? 'code' then raise exception '%',draft->>'code'; end if;
      if draft->'draft'->>'revision' is null then raise exception 'DRAFT_UNAVAILABLE'; end if;
      insert into public.studio_shares(thread_id,workspace_id,creator_id,brief_id,submission_id,work_item_id,section_ids,source_snapshot,draft_revision)
        values(t.id,p_workspace,p_creator,b.id,(p_payload->>'submissionId')::uuid,(p_payload->>'workItemId')::uuid,selected,sources,(draft->'draft'->>'revision')::integer) returning id into share_id;
      select to_jsonb(sh) into result from public.studio_shares sh where sh.id=share_id;
    else raise exception 'INVALID_ACTION';
    end if;
    update public.studio_threads set revision=revision+1 where id=t.id;
  end if;
  insert into public.studio_commands(workspace_id,creator_id,request_id,action,payload,result) values(p_workspace,p_creator,p_request,p_action,p_payload,result);
  return result;
end $$;
revoke all on function public.studio_command(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.studio_command(uuid,uuid,uuid,text,jsonb) to service_role;

-- Badge-only projections: no ledger, balance, XP, notification or workflow mutation.
create function private.studio_settlement_badge() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='settled' and old.status is distinct from 'settled' then
    insert into public.studio_badges(workspace_id,creator_id,source_event) values(new.workspace_id,new.creator_id,'mission_reward:'||new.id) on conflict do nothing;
  end if; return new;
end $$;
create trigger studio_settlement_badge after update of status on public.mission_pending_rewards for each row execute function private.studio_settlement_badge();
create function private.studio_legacy_badge() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='approved' and old.status is distinct from 'approved'
    and exists(select 1 from public.point_transactions p where p.source_ref='mission_submission:'||new.id and p.creator_id=new.creator_id and p.workspace_id=new.workspace_id and p.type='earn' and p.delta>0) then
    insert into public.studio_badges(workspace_id,creator_id,source_event) values(new.workspace_id,new.creator_id,'mission_submission:'||new.id) on conflict do nothing;
  end if; return new;
end $$;
create trigger studio_legacy_badge after update of status on public.mission_submissions for each row execute function private.studio_legacy_badge();

-- The existing account deletion transaction changes creators.status before scrubbing chat.
-- Clean private studio records in that same transaction; canonical financial audit stays intact.
create function private.studio_account_cleanup() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='deleted' then
    update public.assistant_messages set citations='[]'::jsonb
      where conversation_id in (select id from public.assistant_conversations where creator_id=new.id);
    update public.assistant_requests set result=case when result ? 'citations' then jsonb_set(result,'{citations}','[]'::jsonb) else result end
      where creator_id=new.id;
    delete from public.studio_threads where creator_id=new.id;
    delete from public.studio_commands where creator_id=new.id;
    delete from public.studio_badges where creator_id=new.id;
  end if; return new;
end $$;
create trigger studio_account_cleanup after update of status on public.creators for each row execute function private.studio_account_cleanup();
revoke all on function private.studio_settlement_badge(),private.studio_legacy_badge(),private.studio_account_cleanup() from public,anon,authenticated;

-- Preserve the existing durable-save signature and replay contract. Take the same creator
-- lock as anonymisation BEFORE the request lock, so a late generation cannot restore PII.
create or replace function public.save_assistant_turn(p_workspace uuid,p_creator uuid,p_request uuid,p_answer text,p_citations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_request public.assistant_requests%rowtype; v_conversation uuid; v_result jsonb;
begin
  perform 1 from public.creators where id=p_creator and workspace_id=p_workspace and status<>'deleted' for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select * into v_request from public.assistant_requests where creator_id=p_creator and workspace_id=p_workspace and request_id=p_request for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
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
end $$;
revoke all on function public.save_assistant_turn(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_assistant_turn(uuid,uuid,uuid,text,jsonb) to service_role;

-- Resolve only an identical creator intent whose evidence basis changed. Never start a
-- second generation automatically, cancel a running provider, or replace a saved receipt.
create function public.resolve_studio_request_context(p_workspace uuid,p_creator uuid,p_request uuid,p_message text,p_locale text,p_conversation uuid,p_context_version text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.assistant_requests%rowtype; outcome jsonb;
begin
  perform 1 from public.creators where id=p_creator and workspace_id=p_workspace and status<>'deleted' for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not exists(select 1 from public.studio_threads where creator_id=p_creator and workspace_id=p_workspace and conversation_id=p_conversation)
    or p_context_version is null or p_context_version not like 'studio:%' or length(p_context_version)>80 then raise exception 'NOT_FOUND'; end if;
  select * into r from public.assistant_requests where creator_id=p_creator and workspace_id=p_workspace and request_id=p_request for update;
  if not found or r.message is distinct from p_message or r.locale is distinct from p_locale or r.conversation_id is distinct from p_conversation
    or r.context_version=p_context_version then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if r.result is not null then return r.result; end if;
  if r.state='reserved' then
    outcome:=jsonb_build_object('request_id',p_request,'conversation_id',p_conversation,'code','studio_context_changed','persistence','failed','generation','not_started');
    update public.assistant_requests set state='unknown',result=outcome,lease_until=clock_timestamp() where creator_id=p_creator and workspace_id=p_workspace and request_id=p_request;
    return outcome;
  end if;
  return jsonb_build_object('request_id',p_request,'state',r.state,'persistence','unknown');
end $$;
revoke all on function public.resolve_studio_request_context(uuid,uuid,uuid,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.resolve_studio_request_context(uuid,uuid,uuid,text,text,uuid,text) to service_role;
