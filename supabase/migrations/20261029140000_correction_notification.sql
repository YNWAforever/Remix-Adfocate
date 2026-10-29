begin;

-- F-012: a legacy correction request returns the submission to 'joined', but the creator was
-- never told (the submission notification trigger only covers approve/reject/decide). Adds the
-- submission_correction_requested type and emits it from the correction command; the command
-- is otherwise unchanged from its current definition.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'submission_approved','submission_rejected','submission_correction_requested','redemption_ready',
    'level_up','application_accepted','application_declined',
    'campaign_goal_reached','campaign_prize_awarded','campaign_started',
    'mission_product_shipped','mission_receipt_required',
    'mission_revision_requested','mission_draft_approved',
    'mission_approved_to_publish','mission_deadline_approaching',
    'mission_deadline_overdue',
    'mission_publication_correction_requested',
    'mission_publication_verified',
    'mission_reward_pending',
    'mission_reward_pending_cancelled',
    'mission_reward_settled'
  ));

CREATE OR REPLACE FUNCTION public.request_legacy_evidence_correction(p_workspace uuid, p_operator uuid, p_submission uuid, p_request uuid, p_expected_revision bigint, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if v_submission.status not in ('submitted','under_review','rejected')
    or not exists(select 1 from public.missions where id=v_submission.mission_id and workspace_id=p_workspace and creator_workflow_mode='legacy') then
    raise exception using errcode='P0001',message='wrong_state';
  end if;
  update public.mission_submissions set status='joined',reviewer_notes=btrim(p_note),reviewed_at=null where id=p_submission;
  v_result:=jsonb_build_object('submission_id',p_submission,'status','joined','revision',v_submission.evidence_revision+1,'receipt_id',p_request);
  insert into public.legacy_evidence_corrections(workspace_id,operator_id,request_id,submission_id,payload_hash,previous_evidence,result)
    values(p_workspace,p_operator,p_request,p_submission,v_hash,jsonb_build_object('status',v_submission.status,'urls',v_submission.content_urls,
      'review_notes',v_submission.reviewer_notes,'reviewed_at',v_submission.reviewed_at,'revision',v_submission.evidence_revision),v_result);
  insert into public.operator_audit_events(workspace_id,operator_id,actor_label,event_type,target_type,target_id,creator_id,metadata)
    values(p_workspace,p_operator::text,v_actor,'legacy_evidence.correction_requested','submission',p_submission::text,v_submission.creator_id,
      jsonb_build_object('request_id',p_request,'revision',v_submission.evidence_revision+1));
  -- F-012: tell the creator their work came back (best-effort: never blocks the correction).
  begin
    insert into public.notifications(user_id,workspace_id,type,entity_type,entity_id,data)
      select v_submission.creator_id,p_workspace,'submission_correction_requested','mission_submission',p_submission,
        jsonb_build_object('mission_title',m.title,'mission_slug',m.slug,'notes',btrim(p_note))
      from public.missions m where m.id=v_submission.mission_id;
  exception when others then null;
  end;
  return v_result;
end;
$function$;

commit;
