-- REVIEW ONLY: additive provider mission extension; never apply to fixture DBs or remotely without approval.
-- Existing integration/mission/ledger functions remain authoritative. No public media, secrets or live flags.
begin;
alter function private.creator_publish_binding(jsonb) rename to creator_publish_provider_legacy_binding;
alter function private.creator_publish_authority(uuid,uuid,jsonb,timestamptz) rename to creator_publish_provider_legacy_authority;
create or replace function private.creator_publish_binding(v jsonb) returns boolean language sql immutable security definer set search_path='' as $$
 select case when not v ? 'missionBasis' then private.creator_publish_provider_legacy_binding(v)
 else private.creator_publish_provider_legacy_binding(v-'missionBasis') and coalesce(
 private.creator_publish_keys(v->'missionBasis',array['kind','product','appId','submissionId','workItemId','approvedVersionId','instructionRevision','disclosureSha256'],array['kind','product','appId','submissionId','workItemId','approvedVersionId','instructionRevision','disclosureSha256'])
 and v->'missionBasis'->>'kind'='active_mission_provider' and v->'missionBasis'->>'product'='facebook_login'
 and v->'missionBasis'->>'appId' ~ '^[1-9][0-9]{0,63}$'
 and v->'missionBasis'->>'approvedVersionId'=v->>'draftId'
 and v->'missionBasis'->>'disclosureSha256' ~ '^[a-f0-9]{64}$'
 and v->'missionBasis'->>'instructionRevision' ~ '^(0|[1-9][0-9]{0,8})$'
 and not exists(select 1 from unnest(array['submissionId','workItemId','approvedVersionId']) k where v->'missionBasis'->>k !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),false) end
$$;
-- Renaming a function preserves its OID: explicitly rebind the existing CHECK.
alter table private.creator_publish_intents drop constraint creator_publish_intents_binding_check;
alter table private.creator_publish_intents add constraint creator_publish_intents_binding_check check(private.creator_publish_binding(binding));
create table private.controlled_pilot_provider_sources(
 workspace_id uuid not null,creator_id uuid not null,version_id uuid not null,binding jsonb not null check(private.creator_publish_binding(binding) and binding ? 'missionBasis'),available boolean not null default false, expires_at timestamptz not null, rights_confirmed boolean not null default false, label_verified boolean not null default false,
 work_item_id uuid generated always as ((binding->'missionBasis'->>'workItemId')::uuid) stored,
 connection_id uuid generated always as ((binding->>'connectionId')::uuid) stored,
 primary key(workspace_id,creator_id,version_id),foreign key(creator_id,workspace_id) references public.creators(id,workspace_id),check(version_id=(binding->>'draftId')::uuid),
 foreign key(version_id,work_item_id,workspace_id) references public.mission_draft_versions(id,mission_work_item_id,workspace_id),
 foreign key(connection_id,workspace_id,creator_id) references public.integration_connections(id,workspace_id,creator_id)
);
-- Durable one-version reservation survives intent retention cleanup.
create table private.controlled_pilot_provider_revisions(
 workspace_id uuid not null,creator_id uuid not null,version_id uuid not null,revision integer not null,
 intent_id uuid,primary key(workspace_id,creator_id,version_id,revision),
 foreign key(workspace_id,creator_id,version_id) references private.controlled_pilot_provider_sources(workspace_id,creator_id,version_id),
 foreign key(intent_id,workspace_id,creator_id) references private.creator_publish_intents(id,workspace_id,creator_id) on delete set null (intent_id)
);
alter table private.controlled_pilot_provider_revisions enable row level security;
revoke all on private.controlled_pilot_provider_revisions from public,anon,authenticated,service_role;
create table private.controlled_pilot_provider_approvals(
 id uuid primary key,workspace_id uuid not null,creator_id uuid not null,version_id uuid not null,binding jsonb not null,
 nonce_hash text not null unique,session_hash text not null,expires_at timestamptz not null,consumed boolean not null default false,
 foreign key(workspace_id,creator_id,version_id) references private.controlled_pilot_provider_sources(workspace_id,creator_id,version_id),
 check(nonce_hash ~ '^[a-f0-9]{64}$' and session_hash ~ '^[a-f0-9]{64}$')
);
alter table private.controlled_pilot_provider_sources enable row level security;
alter table private.controlled_pilot_provider_approvals enable row level security;
revoke all on private.controlled_pilot_provider_sources,private.controlled_pilot_provider_approvals from public,anon,authenticated,service_role;

create function public.creator_pilot_provider_command(p_workspace uuid,p_creator uuid,p_action text,p_payload jsonb,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb; a private.controlled_pilot_provider_approvals; i private.creator_publish_intents; s private.controlled_pilot_provider_sources; cmd private.creator_publish_commands; digest text;
begin
 perform pg_advisory_xact_lock(431230);
 perform 1 from public.creators where id=p_creator and workspace_id=p_workspace and status='active' for update;
 if not found then raise exception 'PUBLISH_DENIED';end if;
 if p_action not in ('preview','reserve') then return public.creator_publish_command(p_workspace,p_creator,p_action,p_payload,p_now);end if;
 if p_now is null or not isfinite(p_now) or octet_length(p_payload::text)>8192 then raise exception 'PUBLISH_INVALID';end if;
 if not private.creator_publish_keys(p_payload,case when p_action='preview' then array['approvalId','nonceHash','sessionHash','binding','expiresAt'] else array['approvalId','nonceHash','sessionHash','binding','requestId','intentId'] end,case when p_action='preview' then array['approvalId','nonceHash','sessionHash','binding','expiresAt'] else array['approvalId','nonceHash','sessionHash','binding','requestId','intentId'] end) then raise exception 'PUBLISH_INVALID';end if;
 b:=p_payload->'binding';
 perform private.creator_publish_authority(p_workspace,p_creator,b,p_now);
 if not private.creator_publish_binding(b) or not b ? 'missionBasis' or p_payload->>'nonceHash' !~ '^[a-f0-9]{64}$' or p_payload->>'sessionHash' !~ '^[a-f0-9]{64}$' then raise exception 'PUBLISH_INVALID';end if;
 select * into s from private.controlled_pilot_provider_sources where workspace_id=p_workspace and creator_id=p_creator and version_id=(b->>'draftId')::uuid for update;
 if not found or not s.available or s.binding<>b then raise exception 'PUBLISH_STALE';end if;
 if p_action='preview' then
  if (p_payload->>'expiresAt')::timestamptz<=p_now or (p_payload->>'expiresAt')::timestamptz>p_now+interval '5 minutes' then raise exception 'PUBLISH_INVALID';end if;
  insert into private.controlled_pilot_provider_approvals(id,workspace_id,creator_id,version_id,binding,nonce_hash,session_hash,expires_at) values((p_payload->>'approvalId')::uuid,p_workspace,p_creator,s.version_id,b,p_payload->>'nonceHash',p_payload->>'sessionHash',(p_payload->>'expiresAt')::timestamptz);
  return jsonb_build_object('approvalId',p_payload->>'approvalId','expiresAt',p_payload->>'expiresAt');
 end if;
 digest:=encode(sha256(convert_to(jsonb_build_object('action',p_action,'payload',p_payload-'intentId')::text,'UTF8')),'hex');
 select * into cmd from private.creator_publish_commands where workspace_id=p_workspace and creator_id=p_creator and request_id=(p_payload->>'requestId')::uuid;
 if found then
  if cmd.action<>'reserve' or cmd.request_hash<>digest then raise exception 'PUBLISH_CONFLICT';end if;
  select * into i from private.creator_publish_intents where id=cmd.intent_id and workspace_id=p_workspace and creator_id=p_creator;return private.creator_publish_dto(i);
 end if;
 select * into a from private.controlled_pilot_provider_approvals where id=(p_payload->>'approvalId')::uuid and workspace_id=p_workspace and creator_id=p_creator for update;
 if not found or a.consumed or a.expires_at<=p_now or a.nonce_hash<>p_payload->>'nonceHash' or a.session_hash<>p_payload->>'sessionHash' or a.binding<>b then raise exception 'PUBLISH_APPROVAL_INVALID';end if;
 select * into i from private.creator_publish_intents where workspace_id=p_workspace and creator_id=p_creator and binding->>'draftId'=b->>'draftId' and (binding->>'draftRevision')::integer=(b->>'draftRevision')::integer for update;
 if found and i.binding<>b then raise exception 'PUBLISH_CONFLICT';end if;
 if i.id is null then
  if exists(select 1 from private.controlled_pilot_provider_revisions where workspace_id=p_workspace and creator_id=p_creator and version_id=(b->>'draftId')::uuid and revision=(b->>'draftRevision')::integer) then raise exception 'PUBLISH_CONFLICT';end if;
  insert into private.creator_publish_intents(id,workspace_id,creator_id,connection_id,binding,request_id,state,version,sample_only,created_at,updated_at,retention_until) values((p_payload->>'intentId')::uuid,p_workspace,p_creator,(b->>'connectionId')::uuid,b,(p_payload->>'requestId')::uuid,'creator_approved',1,false,p_now,p_now,p_now+interval '90 days') returning * into i;
  insert into private.controlled_pilot_provider_revisions(workspace_id,creator_id,version_id,revision,intent_id) values(p_workspace,p_creator,(b->>'draftId')::uuid,(b->>'draftRevision')::integer,i.id);
 end if;
 update private.controlled_pilot_provider_approvals set consumed=true where id=a.id;
 insert into private.creator_publish_commands(workspace_id,creator_id,request_id,intent_id,action,request_hash,created_at) values(p_workspace,p_creator,(p_payload->>'requestId')::uuid,i.id,'reserve',digest,p_now);
 return private.creator_publish_dto(i);
exception when unique_violation then raise exception 'PUBLISH_CONFLICT';
end $$;
revoke all on function public.creator_pilot_provider_command(uuid,uuid,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.creator_pilot_provider_command(uuid,uuid,text,jsonb,timestamptz) to service_role;

-- Provider attestation is server-only; canonical rows below are rechecked on every
-- preview, reservation and irreversible transition. It is never a browser flag.
grant select,insert,update on private.controlled_pilot_provider_sources to service_role;
create function private.creator_publish_authority(w uuid,c uuid,b jsonb,t timestamptz)
returns boolean language plpgsql set search_path='' as $$
declare s private.controlled_pilot_provider_sources; g public.integration_connections; ok boolean;
begin
 if not b ? 'missionBasis' then return private.creator_publish_provider_legacy_authority(w,c,b,t);end if;
 if not private.creator_publish_binding(b) or b->'missionBasis'->>'kind'<>'active_mission_provider' then raise exception 'PUBLISH_STALE';end if;
 select * into g from public.integration_connections where id=(b->>'connectionId')::uuid and workspace_id=w and creator_id=c for update;
 if not found or g.provider<>'instagram' or g.status<>'connected' or g.generation<>(b->>'grantGeneration')::integer
  or g.data->>'subject' is distinct from b->>'accountSubject' or g.data->>'product' is distinct from 'facebook_login'
  or g.data->>'appId' is distinct from b->'missionBasis'->>'appId' or g.data->'sampleOnly' is distinct from 'false'::jsonb
  or not coalesce(g.data->'scopes' ?& array['instagram_basic','instagram_content_publish','pages_read_engagement'],false)
  or coalesce((g.data->>'expiresAt')::timestamptz,'-infinity')<=t then raise exception 'PUBLISH_STALE';end if;
 perform 1 from private.integration_pilot_bindings pb
 join private.integration_pilot_grants pg on pg.grant_key=pb.grant_key
 where pb.connection_id=g.id and pb.workspace_id=w and pb.creator_id=c and pb.generation=g.generation
 and pb.provider='instagram' and pb.provider_project_id=b->'missionBasis'->>'appId' and pb.activated and pg.state='active'
 for update of pb,pg;
 if not found then raise exception 'PUBLISH_STALE';end if;
 if exists(select 1 from private.integration_pilot_maintenance where workspace_id=w and creator_id=c and restore_pending)
 or exists(select 1 from private.integration_pilot_tombstones where workspace_id=w and creator_id=c
  and (kind='account_delete' or (connection_id=g.id and through_generation>=g.generation))) then raise exception 'PUBLISH_STALE';end if;
 select * into s from private.controlled_pilot_provider_sources where workspace_id=w and creator_id=c and version_id=(b->>'draftId')::uuid for update;
 if not found or not s.available or not s.rights_confirmed or not s.label_verified or s.expires_at<=t or s.binding<>b then raise exception 'PUBLISH_STALE';end if;
 select true into ok from public.mission_work_items i
 join public.mission_workflows f on f.id=i.mission_workflow_id and f.workspace_id=w
 join public.mission_submissions m on m.id=f.mission_submission_id and m.workspace_id=w and m.creator_id=c
 join public.mission_draft_versions v on v.id=i.approved_version_id and v.workspace_id=w and v.mission_work_item_id=i.id
 join public.mission_draft_assets a on a.mission_draft_version_id=v.id and a.mission_work_item_id=i.id and a.workspace_id=w and a.creator_id=c
 join public.mission_publication_instructions p on p.mission_work_item_id=i.id and p.workspace_id=w
 where i.id=(b->'missionBasis'->>'workItemId')::uuid and i.workspace_id=w and i.platform='instagram'
 and m.id=(b->'missionBasis'->>'submissionId')::uuid and i.state='approved_to_publish'
 and i.current_submitted_version_id=v.id and v.id=(b->>'draftId')::uuid and v.version_number=(b->>'draftRevision')::int
 and p.revision=(b->'missionBasis'->>'instructionRevision')::int
 and encode(sha256(convert_to(v.caption_snapshot,'UTF8')),'hex')=b->>'captionSha256'
 and a.id=(b->>'assetId')::uuid and a.mime_type='image/jpeg' and a.upload_state='ready' and a.deleted_at is null and a.checksum=b->>'imageSha256'
 and (select count(*) from public.mission_draft_assets other where other.mission_draft_version_id=v.id and other.deleted_at is null)=1
 and not exists(select 1 from jsonb_array_elements_text(p.required_disclosures) disclosure where btrim(disclosure)='' or position(disclosure in v.caption_snapshot)=0)
 for update of i,f,m,v,a,p;
 if not coalesce(ok,false) then raise exception 'PUBLISH_STALE';end if;
 return false;
end $$;
revoke all on function private.creator_publish_provider_legacy_binding(jsonb),private.creator_publish_provider_legacy_authority(uuid,uuid,jsonb,timestamptz),private.creator_publish_authority(uuid,uuid,jsonb,timestamptz) from public,anon,authenticated,service_role;
revoke all on function private.creator_publish_binding(jsonb) from public,anon,authenticated;
grant execute on function private.creator_publish_binding(jsonb) to service_role;
commit;

