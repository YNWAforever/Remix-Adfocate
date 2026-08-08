create table public.creator_case_command_receipts (
  command_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  creator_id uuid not null references public.creators(id) on delete cascade,
  command_type text not null check (command_type in ('apply_review', 'append_note')),
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.creator_case_command_receipts enable row level security;
grant all on public.creator_case_command_receipts to service_role;

create or replace function private.creator_case_command_snapshot(
  p_workspace_id uuid,
  p_creator_id uuid
)
returns jsonb
language sql
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'creator', (
      select jsonb_build_object(
        'id', creator.id,
        'workspaceId', creator.workspace_id,
        'displayName', creator.display_name,
        'avatarUrl', creator.avatar_url,
        'level', creator.level,
        'categories', coalesce(to_jsonb(creator.categories), '[]'::jsonb),
        'scores', coalesce(creator.scores, '{}'::jsonb),
        'socialHandles', creator.social_handles,
        'createdAt', creator.created_at
      )
      from public.creators creator
      where creator.id = p_creator_id
        and creator.workspace_id = p_workspace_id
    ),
    'review', coalesce((
      select jsonb_build_object(
        'status', review.status,
        'riskLevel', review.risk_level,
        'summary', review.summary,
        'reviewedBy', review.reviewed_by,
        'lastReviewedAt', review.last_reviewed_at,
        'updatedAt', review.updated_at
      )
      from public.creator_review_statuses review
      where review.creator_id = p_creator_id
        and review.workspace_id = p_workspace_id
    ), jsonb_build_object(
      'status', 'needs_review',
      'riskLevel', 'unknown',
      'summary', null,
      'reviewedBy', null,
      'lastReviewedAt', null,
      'updatedAt', null
    )),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', note.id,
        'creatorId', note.creator_id,
        'workspaceId', note.workspace_id,
        'operatorId', note.operator_id,
        'category', note.category,
        'body', note.body,
        'createdAt', note.created_at
      ) order by note.created_at, note.id)
      from public.creator_review_notes note
      where note.creator_id = p_creator_id
        and note.workspace_id = p_workspace_id
    ), '[]'::jsonb),
    'audit', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', audit.id,
        'workspaceId', audit.workspace_id,
        'operatorId', audit.operator_id,
        'actorLabel', audit.actor_label,
        'eventType', audit.event_type,
        'targetType', audit.target_type,
        'targetId', audit.target_id,
        'creatorId', audit.creator_id,
        'missionId', audit.mission_id,
        'metadata', audit.metadata,
        'createdAt', audit.created_at
      ) order by audit.created_at, audit.id)
      from public.operator_audit_events audit
      where audit.creator_id = p_creator_id
        and audit.workspace_id = p_workspace_id
    ), '[]'::jsonb),
    'social', jsonb_build_object('status', 'unavailable', 'reason', 'not_configured'),
    'profile', jsonb_build_object('status', 'unavailable', 'reason', 'not_configured'),
    'missionHistory', jsonb_build_object('status', 'unavailable', 'reason', 'not_configured')
  );
$$;

create or replace function public.apply_creator_review(
  p_command_id uuid,
  p_workspace_id uuid,
  p_creator_id uuid,
  p_operator_id text,
  p_actor_label text,
  p_status text,
  p_risk_level text,
  p_summary text,
  p_note_category text,
  p_note_body text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_receipt public.creator_case_command_receipts%rowtype;
  v_workspace_id uuid;
  v_payload jsonb;
  v_result jsonb;
  v_note_body text;
begin
  v_note_body := nullif(btrim(p_note_body), '');
  v_payload := jsonb_build_object(
    'workspace_id', p_workspace_id,
    'creator_id', p_creator_id,
    'operator_id', p_operator_id,
    'actor_label', p_actor_label,
    'status', p_status,
    'risk_level', p_risk_level,
    'summary', p_summary,
    'note_category', p_note_category,
    'note_body', v_note_body
  );

  perform pg_advisory_xact_lock(hashtextextended(p_command_id::text, 0));
  select * into v_receipt
  from public.creator_case_command_receipts
  where command_id = p_command_id
  for update;

  if found then
    if v_receipt.workspace_id = p_workspace_id
      and v_receipt.creator_id = p_creator_id
      and v_receipt.command_type = 'apply_review'
      and v_receipt.payload = v_payload then
      return v_receipt.result;
    end if;
    raise exception 'command_conflict';
  end if;

  select workspace_id into v_workspace_id
  from public.creators
  where id = p_creator_id;

  if not found then
    raise exception 'creator_not_found';
  end if;
  if v_workspace_id <> p_workspace_id then
    raise exception 'workspace_mismatch';
  end if;

  if p_status is null or p_status not in ('needs_review', 'approved', 'flagged') then
    raise exception 'bad_review_status';
  end if;
  if p_risk_level is null or p_risk_level not in ('low', 'medium', 'high', 'unknown') then
    raise exception 'bad_risk_level';
  end if;
  if p_note_category is not null
    and p_note_category not in ('quality', 'brand_safety', 'fit', 'social', 'other') then
    raise exception 'bad_note_category';
  end if;
  if p_note_body is not null and v_note_body is null then
    raise exception 'bad_note_body';
  end if;
  if p_note_body is not null and p_note_category is null then
    raise exception 'bad_note_category';
  end if;
  if p_note_body is null and p_note_category is not null then
    raise exception 'bad_note_body';
  end if;
  if p_status = 'flagged' and v_note_body is null then
    raise exception 'flagged_review_note_required';
  end if;

  insert into public.creator_review_statuses (
    workspace_id,
    creator_id,
    status,
    risk_level,
    summary,
    reviewed_by,
    last_reviewed_at,
    updated_at
  )
  values (
    p_workspace_id,
    p_creator_id,
    p_status,
    p_risk_level,
    p_summary,
    p_operator_id,
    now(),
    now()
  )
  on conflict (workspace_id, creator_id) do update
  set
    status = excluded.status,
    risk_level = excluded.risk_level,
    summary = excluded.summary,
    reviewed_by = excluded.reviewed_by,
    last_reviewed_at = excluded.last_reviewed_at,
    updated_at = excluded.updated_at;

  insert into public.operator_audit_events (
    workspace_id,
    operator_id,
    actor_label,
    event_type,
    target_type,
    target_id,
    creator_id,
    metadata
  )
  values (
    p_workspace_id,
    p_operator_id,
    p_actor_label,
    'creator_review.updated',
    'creator',
    p_creator_id::text,
    p_creator_id,
    jsonb_build_object(
      'command_id', p_command_id,
      'status', p_status,
      'risk_level', p_risk_level,
      'summary', p_summary
    )
  );

  if v_note_body is not null then
    insert into public.creator_review_notes (
      creator_id,
      workspace_id,
      operator_id,
      category,
      body
    )
    values (
      p_creator_id,
      p_workspace_id,
      p_operator_id,
      p_note_category,
      v_note_body
    );

    insert into public.operator_audit_events (
      workspace_id,
      operator_id,
      actor_label,
      event_type,
      target_type,
      target_id,
      creator_id,
      metadata
    )
    values (
      p_workspace_id,
      p_operator_id,
      p_actor_label,
      'creator_note.created',
      'creator',
      p_creator_id::text,
      p_creator_id,
      jsonb_build_object('command_id', p_command_id, 'category', p_note_category)
    );
  end if;

  v_result := private.creator_case_command_snapshot(p_workspace_id, p_creator_id);
  insert into public.creator_case_command_receipts (
    command_id,
    workspace_id,
    creator_id,
    command_type,
    payload,
    result
  )
  values (p_command_id, p_workspace_id, p_creator_id, 'apply_review', v_payload, v_result);

  return v_result;
end;
$$;

create or replace function public.append_creator_review_note(
  p_command_id uuid,
  p_workspace_id uuid,
  p_creator_id uuid,
  p_operator_id text,
  p_actor_label text,
  p_note_category text,
  p_note_body text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_receipt public.creator_case_command_receipts%rowtype;
  v_workspace_id uuid;
  v_payload jsonb;
  v_result jsonb;
  v_note_body text;
begin
  v_note_body := nullif(btrim(p_note_body), '');
  v_payload := jsonb_build_object(
    'workspace_id', p_workspace_id,
    'creator_id', p_creator_id,
    'operator_id', p_operator_id,
    'actor_label', p_actor_label,
    'note_category', p_note_category,
    'note_body', v_note_body
  );

  perform pg_advisory_xact_lock(hashtextextended(p_command_id::text, 0));
  select * into v_receipt
  from public.creator_case_command_receipts
  where command_id = p_command_id
  for update;

  if found then
    if v_receipt.workspace_id = p_workspace_id
      and v_receipt.creator_id = p_creator_id
      and v_receipt.command_type = 'append_note'
      and v_receipt.payload = v_payload then
      return v_receipt.result;
    end if;
    raise exception 'command_conflict';
  end if;

  select workspace_id into v_workspace_id
  from public.creators
  where id = p_creator_id;

  if not found then
    raise exception 'creator_not_found';
  end if;
  if v_workspace_id <> p_workspace_id then
    raise exception 'workspace_mismatch';
  end if;
  if p_note_category is null
    or p_note_category not in ('quality', 'brand_safety', 'fit', 'social', 'other') then
    raise exception 'bad_note_category';
  end if;
  if p_note_body is null or v_note_body is null then
    raise exception 'bad_note_body';
  end if;

  insert into public.creator_review_notes (
    creator_id,
    workspace_id,
    operator_id,
    category,
    body
  )
  values (
    p_creator_id,
    p_workspace_id,
    p_operator_id,
    p_note_category,
    v_note_body
  );

  insert into public.operator_audit_events (
    workspace_id,
    operator_id,
    actor_label,
    event_type,
    target_type,
    target_id,
    creator_id,
    metadata
  )
  values (
    p_workspace_id,
    p_operator_id,
    p_actor_label,
    'creator_note.created',
    'creator',
    p_creator_id::text,
    p_creator_id,
    jsonb_build_object('command_id', p_command_id, 'category', p_note_category)
  );

  v_result := private.creator_case_command_snapshot(p_workspace_id, p_creator_id);
  insert into public.creator_case_command_receipts (
    command_id,
    workspace_id,
    creator_id,
    command_type,
    payload,
    result
  )
  values (p_command_id, p_workspace_id, p_creator_id, 'append_note', v_payload, v_result);

  return v_result;
end;
$$;

revoke execute on function public.apply_creator_review(uuid, uuid, uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_creator_review(uuid, uuid, uuid, text, text, text, text, text, text, text) to service_role;

revoke execute on function public.append_creator_review_note(uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.append_creator_review_note(uuid, uuid, uuid, text, text, text, text) to service_role;

revoke execute on function private.creator_case_command_snapshot(uuid, uuid) from public, anon, authenticated;
grant execute on function private.creator_case_command_snapshot(uuid, uuid) to service_role;
