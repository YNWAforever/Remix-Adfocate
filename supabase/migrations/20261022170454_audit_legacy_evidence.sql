-- Forward-only: existing evidence/history is preserved; validate the next submission/review.
begin;
alter table public.mission_submissions add column evidence_revision bigint not null default 0 check (evidence_revision >= 0);
create table public.legacy_evidence_corrections (
  workspace_id uuid not null references public.workspaces(id),
  operator_id uuid not null references auth.users(id),
  request_id uuid not null,
  submission_id uuid not null references public.mission_submissions(id),
  payload_hash text not null,
  previous_evidence jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, operator_id, request_id)
);
alter table public.legacy_evidence_corrections enable row level security;
revoke all on public.legacy_evidence_corrections from public, anon, authenticated;
grant select on public.legacy_evidence_corrections to service_role;
create function private.valid_legacy_evidence(p_urls text[])
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(cardinality(p_urls) > 0 and not exists (
    select 1 from unnest(p_urls) u(url)
    where url is null or btrim(url) = ''
      or btrim(url) !~* '^https?://(\[[0-9a-f:.]+\]|[^/@:?#[:space:]\\]+)(:[0-9]{1,5})?([/?#][^[:space:]\\]*)?$'
  ), false);
$$;
create function private.guard_legacy_submission_evidence()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.content_urls is distinct from old.content_urls or new.status is distinct from old.status then
      new.evidence_revision := old.evidence_revision + 1;
    end if;
  end if;
  if new.status in ('submitted', 'under_review', 'approved')
    and exists (select 1 from public.missions m where m.id = new.mission_id and m.creator_workflow_mode = 'legacy')
    and not private.valid_legacy_evidence(new.content_urls) then
    raise exception using errcode = '22023', message = 'invalid_evidence';
  end if;
  return new;
end;
$$;
revoke all on function private.valid_legacy_evidence(text[]) from public, anon, authenticated;
revoke all on function private.guard_legacy_submission_evidence() from public, anon, authenticated;
grant execute on function private.valid_legacy_evidence(text[]) to service_role;
grant execute on function private.guard_legacy_submission_evidence() to service_role;
create trigger legacy_submission_evidence_guard
  before insert or update of content_urls, status on public.mission_submissions
  for each row execute function private.guard_legacy_submission_evidence();

create function public.request_legacy_evidence_correction(p_workspace uuid, p_operator uuid, p_submission uuid,
  p_request uuid, p_expected_revision bigint, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_submission public.mission_submissions%rowtype; v_receipt public.legacy_evidence_corrections%rowtype;
  v_hash text; v_result jsonb; v_actor text;
begin
  select email into v_actor from public.staff_users where user_id=p_operator and active;
  if not found or not exists(select 1 from public.brand_users where user_id=p_operator and workspace_id=p_workspace and active) then
    raise exception using errcode='42501',message='FORBIDDEN';
  end if;
  if p_request is null or p_expected_revision is null or p_expected_revision<0 or nullif(btrim(p_note),'') is null then
    raise exception using errcode='22023',message='invalid_command';
  end if;
  select * into v_submission from public.mission_submissions where id=p_submission and workspace_id=p_workspace for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('submission',p_submission,'revision',p_expected_revision,'note',btrim(p_note))::text,'UTF8')),'hex');
  select * into v_receipt from public.legacy_evidence_corrections where workspace_id=p_workspace and operator_id=p_operator and request_id=p_request;
  if found then
    if v_receipt.payload_hash<>v_hash then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
    return v_receipt.result;
  end if;
  if v_submission.evidence_revision<>p_expected_revision then raise exception using errcode='P0001',message='EVIDENCE_STALE'; end if;
  if v_submission.status not in ('submitted','under_review','rejected') or private.valid_legacy_evidence(v_submission.content_urls)
    or not exists(select 1 from public.missions where id=v_submission.mission_id and workspace_id=p_workspace and creator_workflow_mode='legacy') then
    raise exception using errcode='P0001',message='wrong_state';
  end if;
  update public.mission_submissions set status='joined',review_notes=btrim(p_note),reviewed_at=null where id=p_submission;
  v_result:=jsonb_build_object('submission_id',p_submission,'status','joined','revision',v_submission.evidence_revision+1,'receipt_id',p_request);
  insert into public.legacy_evidence_corrections(workspace_id,operator_id,request_id,submission_id,payload_hash,previous_evidence,result)
    values(p_workspace,p_operator,p_request,p_submission,v_hash,jsonb_build_object('status',v_submission.status,'urls',v_submission.content_urls,
      'review_notes',v_submission.review_notes,'reviewed_at',v_submission.reviewed_at,'revision',v_submission.evidence_revision),v_result);
  insert into public.operator_audit_events(workspace_id,operator_id,actor_label,event_type,target_type,target_id,creator_id,metadata)
    values(p_workspace,p_operator::text,v_actor,'legacy_evidence.correction_requested','submission',p_submission::text,v_submission.creator_id,
      jsonb_build_object('request_id',p_request,'revision',v_submission.evidence_revision+1));
  return v_result;
end;
$$;
revoke all on function public.request_legacy_evidence_correction(uuid,uuid,uuid,uuid,bigint,text) from public, anon, authenticated;
grant execute on function public.request_legacy_evidence_correction(uuid,uuid,uuid,uuid,bigint,text) to service_role;
commit;
