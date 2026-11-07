-- PGLITE TEST FIXTURE ONLY. Not a migration or deployable authority.
-- Synthetic mission projections replace external product reads only in this fixture.
create function private.creator_publish_fixture_legacy_binding(v jsonb)
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
create or replace function private.creator_publish_binding(v jsonb) returns boolean language sql immutable set search_path='' as $$
 select case when not v ? 'missionBasis' then private.creator_publish_fixture_legacy_binding(v)
 else private.creator_publish_fixture_legacy_binding(v-'missionBasis') and coalesce(
 private.creator_publish_keys(v->'missionBasis',array['kind','product','appId','submissionId','workItemId','approvedVersionId','instructionRevision','disclosureSha256'],array['kind','product','appId','submissionId','workItemId','approvedVersionId','instructionRevision','disclosureSha256'])
 and v->'missionBasis'->>'kind'='active_mission_fixture' and v->'missionBasis'->>'product'='facebook_login'
 and v->'missionBasis'->>'appId' ~ '^[1-9][0-9]{0,63}$'
 and v->'missionBasis'->>'approvedVersionId'=v->>'draftId'
 and v->'missionBasis'->>'disclosureSha256' ~ '^[a-f0-9]{64}$'
 and v->'missionBasis'->>'instructionRevision' ~ '^(0|[1-9][0-9]{0,8})$'
 and not exists(select 1 from unnest(array['submissionId','workItemId','approvedVersionId']) k where v->'missionBasis'->>k !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),false) end
$$;
create table private.controlled_pilot_fixture_sources(
 workspace_id uuid not null,creator_id uuid not null,version_id uuid not null,binding jsonb not null check(private.creator_publish_binding(binding) and binding ? 'missionBasis'),available boolean not null default true,
 primary key(workspace_id,creator_id,version_id),foreign key(creator_id,workspace_id) references public.creators(id,workspace_id),check(version_id=(binding->>'draftId')::uuid)
);
-- Durable one-version reservation survives intent retention cleanup.
create table private.controlled_pilot_fixture_revisions(
 workspace_id uuid not null,creator_id uuid not null,version_id uuid not null,revision integer not null,
 intent_id uuid,primary key(workspace_id,creator_id,version_id,revision),
 foreign key(workspace_id,creator_id,version_id) references private.controlled_pilot_fixture_sources(workspace_id,creator_id,version_id),
 foreign key(intent_id,workspace_id,creator_id) references private.creator_publish_intents(id,workspace_id,creator_id) on delete set null (intent_id)
);
alter table private.controlled_pilot_fixture_revisions enable row level security;
revoke all on private.controlled_pilot_fixture_revisions from public,anon,authenticated,service_role;
create table private.controlled_pilot_fixture_approvals(
 id uuid primary key,workspace_id uuid not null,creator_id uuid not null,version_id uuid not null,binding jsonb not null,
 nonce_hash text not null unique,session_hash text not null,expires_at timestamptz not null,consumed boolean not null default false,
 foreign key(workspace_id,creator_id,version_id) references private.controlled_pilot_fixture_sources(workspace_id,creator_id,version_id),
 check(nonce_hash ~ '^[a-f0-9]{64}$' and session_hash ~ '^[a-f0-9]{64}$')
);
alter table private.controlled_pilot_fixture_sources enable row level security;
alter table private.controlled_pilot_fixture_approvals enable row level security;
revoke all on private.controlled_pilot_fixture_sources,private.controlled_pilot_fixture_approvals from public,anon,authenticated,service_role;

create function public.creator_pilot_fixture_command(p_workspace uuid,p_creator uuid,p_action text,p_payload jsonb,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb; a private.controlled_pilot_fixture_approvals; i private.creator_publish_intents; s private.controlled_pilot_fixture_sources; cmd private.creator_publish_commands; digest text;
begin
 perform 1 from public.creators where id=p_creator and workspace_id=p_workspace and status='active' for update;
 if not found then raise exception 'PUBLISH_DENIED';end if;
 if p_action not in ('preview','reserve') then return public.creator_publish_command(p_workspace,p_creator,p_action,p_payload,p_now);end if;
 if p_now is null or not isfinite(p_now) or octet_length(p_payload::text)>8192 then raise exception 'PUBLISH_INVALID';end if;
 if not private.creator_publish_keys(p_payload,case when p_action='preview' then array['approvalId','nonceHash','sessionHash','binding','expiresAt'] else array['approvalId','nonceHash','sessionHash','binding','requestId','intentId'] end,case when p_action='preview' then array['approvalId','nonceHash','sessionHash','binding','expiresAt'] else array['approvalId','nonceHash','sessionHash','binding','requestId','intentId'] end) then raise exception 'PUBLISH_INVALID';end if;
 b:=p_payload->'binding';
 if not private.creator_publish_binding(b) or not b ? 'missionBasis' or p_payload->>'nonceHash' !~ '^[a-f0-9]{64}$' or p_payload->>'sessionHash' !~ '^[a-f0-9]{64}$' then raise exception 'PUBLISH_INVALID';end if;
 select * into s from private.controlled_pilot_fixture_sources where workspace_id=p_workspace and creator_id=p_creator and version_id=(b->>'draftId')::uuid for update;
 if not found or not s.available or s.binding<>b then raise exception 'PUBLISH_STALE';end if;
 if p_action='preview' then
  if (p_payload->>'expiresAt')::timestamptz<=p_now or (p_payload->>'expiresAt')::timestamptz>p_now+interval '5 minutes' then raise exception 'PUBLISH_INVALID';end if;
  insert into private.controlled_pilot_fixture_approvals(id,workspace_id,creator_id,version_id,binding,nonce_hash,session_hash,expires_at) values((p_payload->>'approvalId')::uuid,p_workspace,p_creator,s.version_id,b,p_payload->>'nonceHash',p_payload->>'sessionHash',(p_payload->>'expiresAt')::timestamptz);
  return jsonb_build_object('approvalId',p_payload->>'approvalId','expiresAt',p_payload->>'expiresAt');
 end if;
 digest:=encode(sha256(convert_to(jsonb_build_object('action',p_action,'payload',p_payload-'intentId')::text,'UTF8')),'hex');
 select * into cmd from private.creator_publish_commands where workspace_id=p_workspace and creator_id=p_creator and request_id=(p_payload->>'requestId')::uuid;
 if found then
  if cmd.action<>'reserve' or cmd.request_hash<>digest then raise exception 'PUBLISH_CONFLICT';end if;
  select * into i from private.creator_publish_intents where id=cmd.intent_id and workspace_id=p_workspace and creator_id=p_creator;return private.creator_publish_dto(i);
 end if;
 select * into a from private.controlled_pilot_fixture_approvals where id=(p_payload->>'approvalId')::uuid and workspace_id=p_workspace and creator_id=p_creator for update;
 if not found or a.consumed or a.expires_at<=p_now or a.nonce_hash<>p_payload->>'nonceHash' or a.session_hash<>p_payload->>'sessionHash' or a.binding<>b then raise exception 'PUBLISH_APPROVAL_INVALID';end if;
 select * into i from private.creator_publish_intents where workspace_id=p_workspace and creator_id=p_creator and binding->>'draftId'=b->>'draftId' and (binding->>'draftRevision')::integer=(b->>'draftRevision')::integer for update;
 if found and i.binding<>b then raise exception 'PUBLISH_CONFLICT';end if;
 if i.id is null then
  if exists(select 1 from private.controlled_pilot_fixture_revisions where workspace_id=p_workspace and creator_id=p_creator and version_id=(b->>'draftId')::uuid and revision=(b->>'draftRevision')::integer) then raise exception 'PUBLISH_CONFLICT';end if;
  insert into private.creator_publish_intents(id,workspace_id,creator_id,binding,request_id,state,version,sample_only,created_at,updated_at,retention_until) values((p_payload->>'intentId')::uuid,p_workspace,p_creator,b,(p_payload->>'requestId')::uuid,'creator_approved',1,true,p_now,p_now,p_now+interval '90 days') returning * into i;
  insert into private.controlled_pilot_fixture_revisions(workspace_id,creator_id,version_id,revision,intent_id) values(p_workspace,p_creator,(b->>'draftId')::uuid,(b->>'draftRevision')::integer,i.id);
 end if;
 update private.controlled_pilot_fixture_approvals set consumed=true where id=a.id;
 insert into private.creator_publish_commands(workspace_id,creator_id,request_id,intent_id,action,request_hash,created_at) values(p_workspace,p_creator,(p_payload->>'requestId')::uuid,i.id,'reserve',digest,p_now);
 return private.creator_publish_dto(i);
exception when unique_violation then raise exception 'PUBLISH_CONFLICT';
end $$;
revoke all on function public.creator_pilot_fixture_command(uuid,uuid,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.creator_pilot_fixture_command(uuid,uuid,text,jsonb,timestamptz) to service_role;

create function private.creator_publish_fixture_legacy_authority(w uuid,c uuid,b jsonb,t timestamptz) returns boolean
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


create or replace function private.creator_publish_authority(w uuid,c uuid,b jsonb,t timestamptz) returns boolean language plpgsql set search_path='' as $$
declare s private.controlled_pilot_fixture_sources;
begin
 if not b ? 'missionBasis' then return private.creator_publish_fixture_legacy_authority(w,c,b,t);end if;
 select * into s from private.controlled_pilot_fixture_sources where workspace_id=w and creator_id=c and version_id=(b->>'draftId')::uuid for update;
 if not found or not s.available or s.binding<>b then raise exception 'PUBLISH_STALE';end if;
 return true; -- Only sample_only. This is never real mission/provider authority.
end $$;
revoke all on function private.creator_publish_fixture_legacy_authority(uuid,uuid,jsonb,timestamptz),private.creator_publish_fixture_legacy_binding(jsonb) from public,anon,authenticated,service_role;
