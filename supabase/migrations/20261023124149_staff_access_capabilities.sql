begin;

-- Additive only. No existing staff or brand membership is promoted or rewritten.
create table public.staff_workspace_roles (
  user_id uuid not null references auth.users(id),
  workspace_id uuid not null references public.workspaces(id),
  role text not null check (role in ('workspace_admin','operator','reviewer','finance_viewer')),
  active boolean not null default true,
  granted_by uuid not null references auth.users(id),
  granted_at timestamptz not null default clock_timestamp(),
  revision integer not null default 1 check (revision > 0),
  primary key (user_id,workspace_id)
);
create index staff_workspace_roles_workspace on public.staff_workspace_roles(workspace_id,active,user_id);
create index staff_workspace_roles_granted_by on public.staff_workspace_roles(granted_by);
create table public.staff_platform_roles (
  user_id uuid not null references auth.users(id),
  role text not null check (role='content_editor'),
  active boolean not null default true,
  granted_by uuid not null references auth.users(id),
  granted_at timestamptz not null default clock_timestamp(),
  revision integer not null default 1 check (revision > 0),
  primary key (user_id,role)
);
create index staff_platform_roles_granted_by on public.staff_platform_roles(granted_by);
create table public.staff_access_audit (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  workspace_id uuid references public.workspaces(id),
  user_id uuid not null references auth.users(id),
  actor_id uuid not null references auth.users(id),
  actor_kind text not null check (actor_kind in ('workspace_admin','db_owner_bootstrap')),
  db_session_user text not null,
  before_state jsonb,
  after_state jsonb not null,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  approval_ref text,
  created_at timestamptz not null default clock_timestamp()
);
create index staff_access_audit_workspace on public.staff_access_audit(workspace_id,created_at);
create index staff_access_audit_user on public.staff_access_audit(user_id,created_at);
create index staff_access_audit_actor on public.staff_access_audit(actor_id,created_at);
create table public.staff_access_commands (
  request_id uuid primary key references public.staff_access_audit(request_id),
  payload jsonb not null,
  result jsonb not null
);
alter table public.staff_workspace_roles enable row level security;
alter table public.staff_platform_roles enable row level security;
alter table public.staff_access_audit enable row level security;
alter table public.staff_access_commands enable row level security;
revoke all on public.staff_workspace_roles,public.staff_platform_roles,public.staff_access_audit,public.staff_access_commands from public,anon,authenticated,service_role;
grant select on public.staff_workspace_roles,public.staff_platform_roles,public.staff_access_audit,public.staff_access_commands to service_role;

-- One write engine: authorization, optimistic revision, receipt and audit share a transaction.
-- Only owner-executed wrappers can call it; application callers cannot select bootstrap mode.
create function private.apply_staff_access(
  p_actor uuid,p_workspace uuid,p_subject uuid,p_role text,p_active boolean,
  p_expected_revision integer,p_request uuid,p_reason text,p_approval_ref text,p_owner_bootstrap boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_before jsonb; v_after jsonb; v_result jsonb; v_payload jsonb; v_saved public.staff_access_commands%rowtype; v_revision integer;
begin
  if p_actor is null or p_subject is null or p_request is null or p_active is null or p_owner_bootstrap is null
    or p_expected_revision is null or p_expected_revision<0 or nullif(btrim(p_reason),'') is null or length(p_reason)>500 then
    raise exception using errcode='22023',message='STAFF_ACCESS_INVALID';
  end if;
  if (p_workspace is null and p_role is distinct from 'content_editor')
    or (p_workspace is not null and (p_role is null or p_role not in ('workspace_admin','operator','reviewer','finance_viewer'))) then
    raise exception using errcode='22023',message='STAFF_ACCESS_INVALID';
  end if;
  -- Serialize role changes within a workspace before locking actor and target grants.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(coalesce(p_workspace::text,'platform')||':staff-access',0));
  perform 1 from public.staff_users where user_id=p_actor and active for share;
  if not found then raise exception using errcode='42501',message='STAFF_ACCESS_FORBIDDEN'; end if;
  if p_owner_bootstrap then
    if nullif(btrim(p_approval_ref),'') is null or length(p_approval_ref)>500 then
      raise exception using errcode='22023',message='STAFF_OWNER_APPROVAL_REQUIRED';
    end if;
  else
    if p_workspace is null or p_actor=p_subject then
      raise exception using errcode='42501',message='STAFF_SELF_CHANGE_FORBIDDEN';
    end if;
    perform 1 from public.brand_users b join public.staff_workspace_roles r on r.user_id=b.user_id and r.workspace_id=b.workspace_id
      where b.user_id=p_actor and b.workspace_id=p_workspace and b.active and r.active and r.role='workspace_admin' for share of b,r;
    if not found then raise exception using errcode='42501',message='STAFF_ACCESS_FORBIDDEN'; end if;
  end if;
  if p_active then
    perform 1 from public.staff_users where user_id=p_subject and active for share;
    if not found then raise exception using errcode='42501',message='STAFF_TARGET_NOT_ELIGIBLE'; end if;
    if p_workspace is not null then
      perform 1 from public.brand_users where user_id=p_subject and workspace_id=p_workspace and active for share;
      if not found then raise exception using errcode='42501',message='STAFF_TARGET_NOT_ELIGIBLE'; end if;
    end if;
  elsif not ((p_workspace is not null and exists(select 1 from public.staff_workspace_roles where user_id=p_subject and workspace_id=p_workspace))
    or (p_workspace is null and exists(select 1 from public.staff_platform_roles where user_id=p_subject and role=p_role))) then
    -- Revoking a known scoped grant remains possible after staff/membership removal.
    raise exception using errcode='42501',message='STAFF_TARGET_NOT_ELIGIBLE';
  end if;
  -- Authorization is checked even for exact replay, so revocation takes effect immediately.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request::text,1));
  v_payload:=jsonb_build_object('actor',p_actor,'workspace',p_workspace,'subject',p_subject,'role',p_role,'active',p_active,
    'expectedRevision',p_expected_revision,'reason',p_reason,'approvalRef',p_approval_ref,'ownerBootstrap',p_owner_bootstrap);
  select * into v_saved from public.staff_access_commands where request_id=p_request;
  if found then
    if v_saved.payload<>v_payload then raise exception using errcode='PT409',message='STAFF_ACCESS_IDEMPOTENCY_CONFLICT'; end if;
    return v_saved.result;
  end if;
  if p_workspace is null then
    select to_jsonb(r) into v_before from public.staff_platform_roles r where user_id=p_subject and role=p_role for update;
  else
    select to_jsonb(r) into v_before from public.staff_workspace_roles r where user_id=p_subject and workspace_id=p_workspace for update;
  end if;
  v_revision:=coalesce((v_before->>'revision')::integer,0);
  if v_revision<>p_expected_revision then raise exception using errcode='PT409',message='STAFF_ACCESS_STALE'; end if;
  if p_workspace is null then
    insert into public.staff_platform_roles as r(user_id,role,active,granted_by,revision)
      values(p_subject,p_role,p_active,p_actor,v_revision+1)
      on conflict(user_id,role) do update set active=excluded.active,granted_by=excluded.granted_by,granted_at=clock_timestamp(),revision=excluded.revision
      returning to_jsonb(r) into v_after;
  else
    insert into public.staff_workspace_roles as r(user_id,workspace_id,role,active,granted_by,revision)
      values(p_subject,p_workspace,p_role,p_active,p_actor,v_revision+1)
      on conflict(user_id,workspace_id) do update set role=excluded.role,active=excluded.active,granted_by=excluded.granted_by,granted_at=clock_timestamp(),revision=excluded.revision
      returning to_jsonb(r) into v_after;
  end if;
  v_result:=jsonb_build_object('userId',p_subject,'workspaceId',p_workspace,'role',p_role,'active',p_active,
    'revision',v_revision+1,'grantedBy',p_actor,'grantedAt',v_after->'granted_at');
  insert into public.staff_access_audit(request_id,workspace_id,user_id,actor_id,actor_kind,db_session_user,before_state,after_state,reason,approval_ref)
    values(p_request,p_workspace,p_subject,p_actor,case when p_owner_bootstrap then 'db_owner_bootstrap' else 'workspace_admin' end,
      session_user,v_before,v_after,p_reason,p_approval_ref);
  insert into public.staff_access_commands(request_id,payload,result) values(p_request,v_payload,v_result);
  return v_result;
end;
$$;
revoke all on function private.apply_staff_access(uuid,uuid,uuid,text,boolean,integer,uuid,text,text,boolean) from public,anon,authenticated,service_role;

create function public.set_staff_workspace_role(p_workspace uuid,p_actor uuid,p_subject uuid,p_role text,p_active boolean,p_expected_revision integer,p_request uuid,p_reason text)
returns jsonb language sql security definer set search_path='' as $$
  select private.apply_staff_access(p_actor,p_workspace,p_subject,p_role,p_active,p_expected_revision,p_request,p_reason,null,false);
$$;
revoke all on function public.set_staff_workspace_role(uuid,uuid,uuid,text,boolean,integer,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.set_staff_workspace_role(uuid,uuid,uuid,text,boolean,integer,uuid,text) to service_role;

-- Explicit protected DB-owner step, never exposed by an API or granted to service_role.
-- The reference is an owner's attestation; it is not independently verified approval.
create function private.bootstrap_staff_access(p_actor uuid,p_workspace uuid,p_subject uuid,p_role text,p_active boolean,p_expected_revision integer,p_request uuid,p_reason text,p_approval_ref text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.apply_staff_access(p_actor,p_workspace,p_subject,p_role,p_active,p_expected_revision,p_request,p_reason,p_approval_ref,true);
$$;
revoke all on function private.bootstrap_staff_access(uuid,uuid,uuid,text,boolean,integer,uuid,text,text) from public,anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;
