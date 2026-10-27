begin;
alter table public.creator_review_statuses add column revision bigint not null default 0 check (revision >= 0);
create table public.operator_crm_command_receipts (
  workspace_id uuid not null references public.workspaces(id),
  operator_id uuid not null references auth.users(id),
  request_id uuid not null,
  payload_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, operator_id, request_id)
);
alter table public.operator_crm_command_receipts enable row level security;
revoke all on public.operator_crm_command_receipts from public, anon, authenticated;
grant select on public.operator_crm_command_receipts to service_role;

create function private.execute_creator_crm_command(
  p_workspace uuid, p_operator uuid, p_request uuid, p_expected_revision bigint,
  p_creator uuid, p_kind text, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_review public.creator_review_statuses%rowtype;
  v_receipt public.operator_crm_command_receipts%rowtype;
  v_revision bigint;
  v_hash text;
  v_note jsonb;
  v_result jsonb;
  v_actor text;
  v_body text;
begin
  if p_request is null or p_expected_revision is null or p_expected_revision < 0 or p_kind not in ('review', 'note') then
    raise exception using errcode = '22023', message = 'invalid_command';
  end if;
  select email into v_actor from public.staff_users where user_id = p_operator and active;
  if not found or not exists (select 1 from public.brand_users where user_id = p_operator and workspace_id = p_workspace and active) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  -- This existing row is the lock anchor even before a creator has a review record.
  perform 1 from public.creators where id = p_creator and workspace_id = p_workspace for update;
  if not found then raise exception using errcode = 'P0002', message = 'creator_not_found'; end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object('creator', p_creator, 'kind', p_kind,
    'revision', p_expected_revision, 'payload', p_payload)::text, 'UTF8')), 'hex');
  select * into v_receipt from public.operator_crm_command_receipts
    where workspace_id = p_workspace and operator_id = p_operator and request_id = p_request;
  if found then
    if v_receipt.payload_hash <> v_hash then raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT'; end if;
    return v_receipt.result;
  end if;
  select * into v_review from public.creator_review_statuses where workspace_id = p_workspace and creator_id = p_creator;
  v_revision := coalesce(v_review.revision, 0);
  if v_revision <> p_expected_revision then raise exception using errcode = 'P0001', message = 'CRM_STALE'; end if;

  if p_kind = 'review' then
    if coalesce(p_payload->>'status', '') not in ('needs_review', 'approved', 'flagged')
      or coalesce(p_payload->>'risk_level', '') not in ('low', 'medium', 'high', 'unknown') then
      raise exception using errcode = '22023', message = 'invalid_command';
    end if;
    v_body := nullif(btrim(p_payload->>'note'), '');
    if p_payload->>'status' = 'flagged' and v_body is null then
      raise exception using errcode = '22023', message = 'flagged_note_required';
    end if;
    insert into public.creator_review_statuses(creator_id, workspace_id, status, risk_level, summary, reviewed_by, last_reviewed_at, revision)
      values (p_creator, p_workspace, p_payload->>'status', p_payload->>'risk_level', nullif(btrim(p_payload->>'summary'), ''), p_operator::text, now(), v_revision + 1)
      on conflict (workspace_id, creator_id) do update set status = excluded.status, risk_level = excluded.risk_level,
        summary = excluded.summary, reviewed_by = excluded.reviewed_by, last_reviewed_at = excluded.last_reviewed_at, revision = excluded.revision
      returning * into v_review;
    insert into public.operator_audit_events(workspace_id, operator_id, actor_label, event_type, target_type, target_id, creator_id, metadata)
      values (p_workspace, p_operator::text, v_actor, 'creator_review.updated', 'creator', p_creator::text, p_creator,
        jsonb_build_object('request_id', p_request, 'revision', v_review.revision, 'status', v_review.status, 'risk_level', v_review.risk_level));
  else
    v_body := nullif(btrim(p_payload->>'body'), '');
    if v_body is null or coalesce(p_payload->>'category', '') not in ('quality', 'brand_safety', 'fit', 'social', 'other') then
      raise exception using errcode = '22023', message = 'invalid_command';
    end if;
    insert into public.creator_review_statuses(creator_id, workspace_id, revision) values(p_creator, p_workspace, v_revision + 1)
      on conflict (workspace_id, creator_id) do update set revision = excluded.revision returning * into v_review;
  end if;
  if v_body is not null then
    insert into public.creator_review_notes(creator_id, workspace_id, operator_id, category, body)
      values (p_creator, p_workspace, p_operator::text, case when p_kind = 'review' then 'other' else p_payload->>'category' end, v_body)
      returning to_jsonb(creator_review_notes.*) into v_note;
    insert into public.operator_audit_events(workspace_id, operator_id, actor_label, event_type, target_type, target_id, creator_id, metadata)
      values (p_workspace, p_operator::text, v_actor, 'creator_note.created', 'creator', p_creator::text, p_creator,
        jsonb_build_object('request_id', p_request, 'revision', v_review.revision, 'category', case when p_kind = 'review' then 'other' else p_payload->>'category' end));
  end if;
  v_result := jsonb_build_object('revision', v_review.revision, 'receipt_id', p_request, 'review', to_jsonb(v_review), 'note', v_note);
  insert into public.operator_crm_command_receipts(workspace_id, operator_id, request_id, payload_hash, result)
    values (p_workspace, p_operator, p_request, v_hash, v_result);
  return v_result;
end;
$$;
create function public.apply_creator_review_command(p_workspace uuid, p_operator uuid, p_request uuid, p_expected_revision bigint,
  p_creator uuid, p_status text, p_risk_level text, p_summary text, p_note text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.execute_creator_crm_command(p_workspace, p_operator, p_request, p_expected_revision, p_creator, 'review',
    jsonb_build_object('status', p_status, 'risk_level', p_risk_level, 'summary', nullif(btrim(p_summary), ''), 'note', nullif(btrim(p_note), '')));
$$;
create function public.add_creator_review_note_command(p_workspace uuid, p_operator uuid, p_request uuid, p_expected_revision bigint,
  p_creator uuid, p_category text, p_body text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.execute_creator_crm_command(p_workspace, p_operator, p_request, p_expected_revision, p_creator, 'note',
    jsonb_build_object('category', p_category, 'body', nullif(btrim(p_body), '')));
$$;
revoke all on function private.execute_creator_crm_command(uuid,uuid,uuid,bigint,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.apply_creator_review_command(uuid,uuid,uuid,bigint,uuid,text,text,text,text) from public, anon, authenticated;
revoke all on function public.add_creator_review_note_command(uuid,uuid,uuid,bigint,uuid,text,text) from public, anon, authenticated;
grant execute on function private.execute_creator_crm_command(uuid,uuid,uuid,bigint,uuid,text,jsonb) to service_role;
grant execute on function public.apply_creator_review_command(uuid,uuid,uuid,bigint,uuid,text,text,text,text) to service_role;
grant execute on function public.add_creator_review_note_command(uuid,uuid,uuid,bigint,uuid,text,text) to service_role;
commit;
