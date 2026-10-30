begin;

-- Legacy approve/reject credited points, cash and budget without recording who decided.
-- This command wraps the existing engines in one transaction: it checks the operator's
-- active review role in the workspace, requires a rejection reason, and appends an
-- operator_audit_events row whenever the status actually changes (idempotent replays of an
-- already-decided submission add nothing). Historical decisions are not backfilled.
create function public.decide_legacy_submission(
  p_workspace uuid, p_operator uuid, p_submission uuid, p_decision text, p_notes text,
  p_quality_rating smallint default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor text; v_before text; v_notes text;
  v_sub public.mission_submissions%rowtype;
begin
  if p_decision is null or p_decision not in ('approve','reject') then
    raise exception using errcode='22023',message='invalid_command';
  end if;
  v_notes := nullif(btrim(p_notes),'');
  if p_decision='reject' and v_notes is null then
    raise exception using errcode='22023',message='rejection_reason_required';
  end if;
  if char_length(coalesce(p_notes,''))>500 then
    raise exception using errcode='22023',message='rejection_reason_too_long';
  end if;
  select s.email into v_actor from public.staff_users s
    join public.brand_users b on b.user_id=s.user_id
    join public.staff_workspace_roles r on r.user_id=s.user_id and r.workspace_id=b.workspace_id
    where s.user_id=p_operator and s.active and b.workspace_id=p_workspace and b.active
      and r.active and r.role in ('workspace_admin','operator','reviewer') for share of s,b,r;
  if not found then raise exception using errcode='42501',message='FORBIDDEN'; end if;

  select s.status into v_before from public.mission_submissions s
    where s.id=p_submission and s.workspace_id=p_workspace for update;
  if not found then raise exception 'not_found'; end if;

  if p_decision='approve' then
    select * into v_sub from public.approve_submission(p_submission, v_notes, p_quality_rating);
  else
    select * into v_sub from public.reject_submission(p_submission, v_notes);
  end if;

  if v_sub.status is distinct from v_before then
    insert into public.operator_audit_events(workspace_id,operator_id,actor_label,event_type,target_type,target_id,creator_id,mission_id,metadata)
      values(p_workspace,p_operator::text,v_actor,
        case p_decision when 'approve' then 'submission.approved' else 'submission.rejected' end,
        'submission',p_submission::text,v_sub.creator_id,v_sub.mission_id,
        jsonb_build_object('quality_rating',p_quality_rating,'reason_provided',v_notes is not null));
  end if;
  return to_jsonb(v_sub);
end;
$$;
revoke all on function public.decide_legacy_submission(uuid,uuid,uuid,text,text,smallint) from public,anon,authenticated;
grant execute on function public.decide_legacy_submission(uuid,uuid,uuid,text,text,smallint) to service_role;

commit;
