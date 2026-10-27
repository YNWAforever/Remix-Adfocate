begin;

-- The existing application, workflow, CRM receipt and audit engines share this
-- transaction. Historical decisions are not backfilled with invented actors.
create function public.decide_mission_application(
  p_workspace uuid, p_operator uuid, p_submission uuid, p_request uuid,
  p_expected_revision bigint, p_decision text, p_notes text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_sub public.mission_submissions%rowtype;
  v_saved public.operator_crm_command_receipts%rowtype;
  v_actor text; v_hash text; v_mode text; v_notes text;
  v_workflow jsonb; v_result jsonb; v_decision jsonb;
  v_at timestamptz;
begin
  if p_request is null or p_expected_revision is null or p_expected_revision < 0
    or p_decision is null or p_decision not in ('accept','decline') then
    raise exception using errcode='22023',message='invalid_command';
  end if;
  v_notes := nullif(btrim(p_notes),'');
  if p_decision='decline' and v_notes is null then
    raise exception using errcode='22023',message='application_reason_required';
  end if;
  if length(coalesce(p_notes,''))>500 then
    raise exception using errcode='22023',message='application_reason_too_long';
  end if;
  select s.email into v_actor from public.staff_users s
    join public.brand_users b on b.user_id=s.user_id
    join public.staff_workspace_roles r on r.user_id=s.user_id and r.workspace_id=b.workspace_id
    where s.user_id=p_operator and s.active and b.workspace_id=p_workspace and b.active
      and r.active and r.role in ('workspace_admin','operator') for share of s,b,r;
  if not found then raise exception using errcode='42501',message='FORBIDDEN'; end if;

  -- Serialize request-key reuse across application resources before the row lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_workspace::text||':'||p_operator::text||':'||p_request::text,21));
  select s.* into v_sub from public.mission_submissions s
    join public.missions m on m.id=s.mission_id and m.workspace_id=s.workspace_id
    join public.creators c on c.id=s.creator_id and c.workspace_id=s.workspace_id
    where s.id=p_submission and s.workspace_id=p_workspace for update of s;
  if not found then raise exception using errcode='P0002',message='application_not_found'; end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object('kind','application_decision',
    'submission',p_submission,'revision',p_expected_revision,'decision',p_decision,
    'notes',case when p_decision='decline' then v_notes else null end)::text,'UTF8')),'hex');
  select * into v_saved from public.operator_crm_command_receipts
    where workspace_id=p_workspace and operator_id=p_operator and request_id=p_request;
  if found then
    if v_saved.payload_hash<>v_hash then
      raise exception using errcode='PT409',message='IDEMPOTENCY_CONFLICT';
    end if;
    return v_saved.result;
  end if;
  if v_sub.status<>'applied' then
    select metadata->'decision' into v_decision from public.operator_audit_events
      where workspace_id=p_workspace and target_type='application' and target_id=p_submission::text
        and event_type='application.decided' order by created_at desc,id desc limit 1;
    if v_decision is null then
      v_decision:=jsonb_build_object('action',null,'status',v_sub.status,
        'actorId',null,'actorLabel',null,'decidedAt',null,'revision',null,'historicalUnknown',true);
    end if;
    return jsonb_build_object('conflict',true,'decision',v_decision);
  end if;
  if p_expected_revision<>0 then raise exception using errcode='PT409',message='APPLICATION_STALE'; end if;
  select creator_workflow_mode into v_mode from public.missions where id=v_sub.mission_id;
  if p_decision='accept' then
    v_sub:=public.accept_application(p_submission);
    if v_mode='active_workspace' then
      select to_jsonb(public.create_mission_workflow(p_submission)) into v_workflow;
    end if;
  else
    v_sub:=public.decline_application(p_submission,v_notes);
  end if;
  v_at:=clock_timestamp();
  update public.mission_submissions set reviewed_at=v_at where id=p_submission returning * into v_sub;
  v_decision:=jsonb_build_object('action',p_decision,'actorId',p_operator,
    'actorLabel',v_actor,'decidedAt',v_at,'revision',1,
    'reason',case when p_decision='decline' then v_notes else null end);
  v_result:=case when v_workflow is null then to_jsonb(v_sub)
    else jsonb_build_object('submission',to_jsonb(v_sub),'workflow',v_workflow) end
    ||jsonb_build_object('decision',v_decision);
  insert into public.operator_audit_events(workspace_id,operator_id,actor_label,event_type,target_type,target_id,creator_id,metadata)
    values(p_workspace,p_operator::text,v_actor,'application.decided','application',p_submission::text,v_sub.creator_id,
      jsonb_build_object('request_id',p_request,'decision',v_decision));
  insert into public.operator_crm_command_receipts(workspace_id,operator_id,request_id,payload_hash,result)
    values(p_workspace,p_operator,p_request,v_hash,v_result);
  return v_result;
end;
$$;
revoke all on function public.decide_mission_application(uuid,uuid,uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.decide_mission_application(uuid,uuid,uuid,uuid,bigint,text,text) to service_role;
commit;
