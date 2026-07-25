-- Publication proof validation foundation.
-- Lifecycle mutations are intentionally deferred; these rows are service-owned snapshots and history.

alter table public.mission_deliverable_templates
  add column publication_instructions text not null default 'Publish the approved content'
    check (btrim(publication_instructions) <> ''),
  add column publication_window_hours integer not null default 72
    check (publication_window_hours > 0),
  add column required_disclosures jsonb not null default '[]'::jsonb
    check (jsonb_typeof(required_disclosures) = 'array'),
  add column expected_account text
    check (expected_account is null or btrim(expected_account) <> ''),
  add column proof_evidence_policy jsonb not null default '{}'::jsonb
    check (jsonb_typeof(proof_evidence_policy) = 'object');

alter table public.mission_work_items
  add column current_proof_attempt_id uuid,
  add column verified_proof_attempt_id uuid;

create table public.mission_publication_instructions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_work_item_id uuid not null,
  publication_instructions text not null check (btrim(publication_instructions) <> ''),
  publication_window_hours integer not null check (publication_window_hours > 0),
  required_disclosures jsonb not null default '[]'::jsonb
    check (jsonb_typeof(required_disclosures) = 'array'),
  expected_account text check (expected_account is null or btrim(expected_account) <> ''),
  proof_evidence_policy jsonb not null default '{}'::jsonb
    check (jsonb_typeof(proof_evidence_policy) = 'object'),
  publication_due_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint mission_publication_instructions_work_item_workspace_fk
    foreign key (mission_work_item_id, workspace_id)
    references public.mission_work_items(id, workspace_id) on delete cascade,
  unique (workspace_id, mission_work_item_id),
  unique (workspace_id, id),
  unique (id, workspace_id)
);

create table public.mission_publication_proof_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  mission_work_item_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  primary_url text not null check (primary_url ~ '^https://'),
  additional_urls jsonb not null default '[]'::jsonb check (jsonb_typeof(additional_urls) = 'array'),
  submitted_by uuid not null,
  submitted_at timestamptz not null default now(),
  submitted_late boolean not null,
  metadata_status text not null check (metadata_status in ('available','unavailable','unsafe')),
  metadata_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata_snapshot) = 'object'),
  metadata_error_category text check (metadata_error_category is null or btrim(metadata_error_category) <> ''),
  content_checksum text not null check (btrim(content_checksum) <> ''),
  submission_idempotency_key uuid not null,
  constraint mission_publication_proof_attempts_workspace_fk
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint mission_publication_proof_attempts_work_item_workspace_fk
    foreign key (mission_work_item_id, workspace_id)
    references public.mission_work_items(id, workspace_id) on delete cascade,
  constraint mission_publication_proof_attempts_submitter_workspace_fk
    foreign key (submitted_by, workspace_id)
    references public.creators(id, workspace_id),
  unique (workspace_id, mission_work_item_id, attempt_number),
  unique (workspace_id, mission_work_item_id, submission_idempotency_key),
  unique (workspace_id, id),
  unique (id, workspace_id),
  unique (id, mission_work_item_id, workspace_id)
);

create table public.mission_publication_proof_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  mission_publication_proof_attempt_id uuid not null,
  storage_object_path text not null unique check (btrim(storage_object_path) <> ''),
  original_filename text not null check (btrim(original_filename) <> ''),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 20971520),
  content_checksum text not null check (btrim(content_checksum) <> ''),
  created_at timestamptz not null default now(),
  constraint mission_publication_proof_assets_workspace_fk
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint mission_publication_proof_assets_attempt_workspace_fk
    foreign key (mission_publication_proof_attempt_id, workspace_id)
    references public.mission_publication_proof_attempts(id, workspace_id) on delete cascade,
  unique (workspace_id, id),
  unique (id, workspace_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.brand_users'::regclass
      and conname = 'brand_users_user_workspace_unique'
  ) then
    alter table public.brand_users
      add constraint brand_users_user_workspace_unique unique (user_id, workspace_id);
  end if;
end;
$$;
create table public.mission_publication_proof_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  mission_publication_proof_attempt_id uuid not null,
  review_number integer not null default 1 check (review_number > 0),
  state text not null default 'open' check (state in ('open', 'correction_requested', 'verified')),
  decision text check (decision is null or decision in ('verified', 'rejected')),
  reviewer_id uuid,
  reviewed_at timestamptz,
  summary text check (summary is null or btrim(summary) <> ''),
  created_at timestamptz not null default now(),
  constraint mission_publication_proof_reviews_workspace_fk
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint mission_publication_proof_reviews_attempt_workspace_fk
    foreign key (mission_publication_proof_attempt_id, workspace_id)
    references public.mission_publication_proof_attempts(id, workspace_id) on delete cascade,
  constraint mission_publication_proof_reviews_reviewer_workspace_fk
    foreign key (reviewer_id, workspace_id)
    references public.brand_users(user_id, workspace_id),
  unique (workspace_id, id),
  unique (id, workspace_id),
  unique (workspace_id, mission_publication_proof_attempt_id, review_number)
);
create unique index mission_publication_proof_reviews_one_terminal_decision_idx
  on public.mission_publication_proof_reviews (workspace_id, mission_publication_proof_attempt_id)
  where decision in ('verified', 'rejected');

create table public.mission_publication_proof_review_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  mission_publication_proof_review_id uuid not null,
  category text not null check (category in ('disclosure', 'account', 'content', 'url', 'metadata', 'other')),
  finding_text text not null check (btrim(finding_text) <> ''),
  passed boolean not null,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  constraint mission_publication_proof_review_items_workspace_fk
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint mission_publication_proof_review_items_review_workspace_fk
    foreign key (mission_publication_proof_review_id, workspace_id)
    references public.mission_publication_proof_reviews(id, workspace_id) on delete cascade,
  unique (workspace_id, id),
  unique (workspace_id, mission_publication_proof_review_id, position)
);

alter table public.mission_work_items
  add constraint mission_work_items_current_proof_attempt_fk
    foreign key (current_proof_attempt_id, id, workspace_id)
    references public.mission_publication_proof_attempts(id, mission_work_item_id, workspace_id),
  add constraint mission_work_items_verified_proof_attempt_fk
    foreign key (verified_proof_attempt_id, id, workspace_id)
    references public.mission_publication_proof_attempts(id, mission_work_item_id, workspace_id);

create index mission_work_items_current_proof_attempt_idx
  on public.mission_work_items (current_proof_attempt_id)
  where current_proof_attempt_id is not null;
create index mission_publication_instructions_due_at_idx
  on public.mission_publication_instructions (publication_due_at);
create index mission_publication_proof_attempts_late_idx
  on public.mission_publication_proof_attempts (submitted_at)
  where submitted_late;
create index mission_publication_proof_attempts_metadata_status_idx
  on public.mission_publication_proof_attempts (metadata_status, submitted_at);
create index mission_publication_proof_reviews_reviewer_idx
  on public.mission_publication_proof_reviews (reviewer_id, reviewed_at desc);

alter table public.mission_publication_instructions enable row level security;
alter table public.mission_publication_proof_attempts enable row level security;
alter table public.mission_publication_proof_assets enable row level security;
alter table public.mission_publication_proof_reviews enable row level security;
alter table public.mission_publication_proof_review_items enable row level security;

create policy mission_publication_instructions_creator_read on public.mission_publication_instructions
  for select to authenticated using (exists (
    select 1
    from public.mission_work_items i
    join public.mission_workflows w
      on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where i.id = mission_publication_instructions.mission_work_item_id
      and i.workspace_id = mission_publication_instructions.workspace_id
      and s.creator_id = (select auth.uid())
  ));

create policy mission_publication_proof_attempts_creator_read on public.mission_publication_proof_attempts
  for select to authenticated using (exists (
    select 1
    from public.mission_work_items i
    join public.mission_workflows w
      on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where i.id = mission_publication_proof_attempts.mission_work_item_id
      and i.workspace_id = mission_publication_proof_attempts.workspace_id
      and s.creator_id = (select auth.uid())
  ));

create policy mission_publication_proof_assets_creator_read on public.mission_publication_proof_assets
  for select to authenticated using (exists (
    select 1
    from public.mission_publication_proof_attempts a
    join public.mission_work_items i
      on i.id = a.mission_work_item_id and i.workspace_id = a.workspace_id
    join public.mission_workflows w
      on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where a.id = mission_publication_proof_assets.mission_publication_proof_attempt_id
      and a.workspace_id = mission_publication_proof_assets.workspace_id
      and s.creator_id = (select auth.uid())
  ));

create policy mission_publication_proof_reviews_creator_read on public.mission_publication_proof_reviews
  for select to authenticated using (exists (
    select 1
    from public.mission_publication_proof_attempts a
    join public.mission_work_items i
      on i.id = a.mission_work_item_id and i.workspace_id = a.workspace_id
    join public.mission_workflows w
      on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where a.id = mission_publication_proof_reviews.mission_publication_proof_attempt_id
      and a.workspace_id = mission_publication_proof_reviews.workspace_id
      and s.creator_id = (select auth.uid())
  ));

create policy mission_publication_proof_review_items_creator_read on public.mission_publication_proof_review_items
  for select to authenticated using (exists (
    select 1
    from public.mission_publication_proof_reviews r
    join public.mission_publication_proof_attempts a
      on a.id = r.mission_publication_proof_attempt_id and a.workspace_id = r.workspace_id
    join public.mission_work_items i
      on i.id = a.mission_work_item_id and i.workspace_id = a.workspace_id
    join public.mission_workflows w
      on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where r.id = mission_publication_proof_review_items.mission_publication_proof_review_id
      and r.workspace_id = mission_publication_proof_review_items.workspace_id
      and s.creator_id = (select auth.uid())
  ));

-- Creator clients may read their own publication history. All table mutations stay service-only.
revoke all on table
  public.mission_publication_instructions,
  public.mission_publication_proof_attempts,
  public.mission_publication_proof_assets,
  public.mission_publication_proof_reviews,
  public.mission_publication_proof_review_items
from public, anon, authenticated;
grant select on table
  public.mission_publication_instructions,
  public.mission_publication_proof_attempts,
  public.mission_publication_proof_assets,
  public.mission_publication_proof_reviews,
  public.mission_publication_proof_review_items
  to authenticated;
grant all on table
  public.mission_publication_instructions,
  public.mission_publication_proof_attempts,
  public.mission_publication_proof_assets,
  public.mission_publication_proof_reviews,
  public.mission_publication_proof_review_items
  to service_role;

create trigger mission_publication_instructions_immutable
  before update or delete on public.mission_publication_instructions
  for each row execute function private.raise_immutable_record();
create trigger mission_publication_proof_attempts_immutable
  before update or delete on public.mission_publication_proof_attempts
  for each row execute function private.raise_immutable_record();
create trigger mission_publication_proof_assets_immutable
  before update or delete on public.mission_publication_proof_assets
  for each row execute function private.raise_immutable_record();
create trigger mission_publication_proof_reviews_immutable
  before update or delete on public.mission_publication_proof_reviews
  for each row execute function private.raise_immutable_record();
create trigger mission_publication_proof_review_items_immutable
  before update or delete on public.mission_publication_proof_review_items
  for each row execute function private.raise_immutable_record();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mission-publication-proof-assets',
  'mission-publication-proof-assets',
  false,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy mission_publication_proof_assets_storage_read on storage.objects
  for select to authenticated using (
    bucket_id = 'mission-publication-proof-assets'
    and exists (
      select 1
      from public.mission_publication_proof_assets pa
      join public.mission_publication_proof_attempts a
        on a.id = pa.mission_publication_proof_attempt_id and a.workspace_id = pa.workspace_id
      join public.mission_work_items i
        on i.id = a.mission_work_item_id and i.workspace_id = a.workspace_id
      join public.mission_workflows w
        on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
      join public.mission_submissions s
        on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
      where pa.storage_object_path = name
        and s.creator_id = (select auth.uid())
    )
  );
create policy mission_publication_proof_assets_storage_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'mission-publication-proof-assets'
    and exists (
      select 1
      from public.mission_publication_proof_assets pa
      join public.mission_publication_proof_attempts a
        on a.id = pa.mission_publication_proof_attempt_id and a.workspace_id = pa.workspace_id
      join public.mission_work_items i
        on i.id = a.mission_work_item_id and i.workspace_id = a.workspace_id
      join public.mission_workflows w
        on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
      join public.mission_submissions s
        on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
      where pa.storage_object_path = name
        and s.creator_id = (select auth.uid())
    )
  );
-- Phase 3 publication policy authoring, per-work-item snapshots, guarded override, and approval freeze.
alter table public.mission_publication_instructions
  alter column publication_due_at drop not null,
  add column platform text,
  add column source_template_id uuid,
  add column override_reason text check (override_reason is null or btrim(override_reason) <> ''),
  add column overridden_by uuid,
  add column overridden_at timestamptz,
  add column frozen_at timestamptz,
  add column revision integer not null default 0 check (revision >= 0),
  add column idempotency_keys uuid[] not null default '{}'::uuid[],
  add constraint mission_publication_instructions_source_template_workspace_fk
    foreign key (source_template_id, workspace_id)
    references public.mission_deliverable_templates(id, workspace_id) on delete set null (source_template_id),
  add constraint mission_publication_instructions_overridden_by_workspace_fk
    foreign key (overridden_by, workspace_id)
    references public.brand_users(user_id, workspace_id);


alter function private.author_mission_workflow(uuid, jsonb, jsonb, jsonb)
  rename to author_mission_workflow_phase2;

create or replace function private.author_mission_workflow(
  p_mission_id uuid, p_mission jsonb, p_policy jsonb, p_templates jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_mission_id uuid;
  v_template_json jsonb;
begin
  if jsonb_typeof(p_templates) <> 'array' then raise exception 'invalid_mission_authoring_payload'; end if;
  if p_policy->>'creator_workflow_mode' = 'active_workspace' and exists (
    select 1 from jsonb_array_elements(p_templates) template
    where not (template ? 'publication_instructions')
       or nullif(btrim(template->>'publication_instructions'), '') is null
       or not (template ? 'publication_window_hours')
       or coalesce((template->>'publication_window_hours') ~ '^[1-9][0-9]*$', false) is not true
       or not (template ? 'required_disclosures')
       or case when jsonb_typeof(template->'required_disclosures') = 'array' then exists (
            select 1 from jsonb_array_elements(template->'required_disclosures') disclosure
            where jsonb_typeof(disclosure) <> 'string' or nullif(btrim(disclosure #>> '{}'), '') is null
          ) else true end
       or (template ? 'expected_account' and jsonb_typeof(template->'expected_account') not in ('null', 'string'))
       or (jsonb_typeof(template->'expected_account') = 'string' and nullif(btrim(template->>'expected_account'), '') is null)
       or not (template ? 'proof_evidence_policy')
       or jsonb_typeof(template->'proof_evidence_policy') <> 'object'
  ) then raise exception 'active_publication_policy_incomplete'; end if;

  v_result := private.author_mission_workflow_phase2(p_mission_id, p_mission, p_policy, p_templates);
  v_mission_id := (v_result->>'id')::uuid;
  if p_policy->>'creator_workflow_mode' = 'active_workspace' then
    for v_template_json in select value from jsonb_array_elements(p_templates) loop
      update public.mission_deliverable_templates
      set publication_instructions = btrim(v_template_json->>'publication_instructions'),
          publication_window_hours = (v_template_json->>'publication_window_hours')::integer,
          required_disclosures = v_template_json->'required_disclosures',
          expected_account = nullif(btrim(v_template_json->>'expected_account'), ''),
          proof_evidence_policy = v_template_json->'proof_evidence_policy', updated_at = now()
      where mission_id = v_mission_id and (
        (v_template_json ? 'id' and id = (v_template_json->>'id')::uuid)
        or (not (v_template_json ? 'id') and position = (v_template_json->>'position')::integer)
      );
    end loop;
  end if;

  return v_result || jsonb_build_object('deliverable_templates', coalesce((
    select jsonb_agg(
      to_jsonb(template_row) - 'workspace_id' - 'mission_id' - 'created_at' - 'updated_at'
      || jsonb_build_object('requirements', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', requirement_row.id, 'category', requirement_row.category,
          'text', requirement_row.requirement_text, 'required', requirement_row.required,
          'position', requirement_row.position
        ) order by requirement_row.position)
        from public.mission_deliverable_requirements requirement_row
        where requirement_row.mission_deliverable_template_id = template_row.id
      ), '[]'::jsonb)) order by template_row.position
    ) from public.mission_deliverable_templates template_row
    where template_row.mission_id = v_mission_id
  ), '[]'::jsonb));
end;
$$;

create or replace function public.author_mission_workflow(
  p_mission_id uuid, p_mission jsonb, p_policy jsonb, p_templates jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  return private.author_mission_workflow(p_mission_id, p_mission, p_policy, p_templates);
end;
$$;
revoke all on function private.author_mission_workflow(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.author_mission_workflow(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.author_mission_workflow(uuid, jsonb, jsonb, jsonb) to service_role;
create or replace function private.snapshot_publication_instructions()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_template public.mission_deliverable_templates;
begin
  if new.source_template_id is null then return new; end if;
  select template.* into v_template
  from public.mission_deliverable_templates template
  join public.mission_workflows workflow
    on workflow.id = new.mission_workflow_id and workflow.workspace_id = new.workspace_id
  join public.mission_submissions submission
    on submission.id = workflow.mission_submission_id and submission.workspace_id = workflow.workspace_id
  join public.missions mission
    on mission.id = submission.mission_id and mission.workspace_id = submission.workspace_id
  where template.id = new.source_template_id
    and template.workspace_id = new.workspace_id
    and mission.creator_workflow_mode = 'active_workspace';
  if v_template.id is null then return new; end if;
  insert into public.mission_publication_instructions (
    workspace_id, mission_work_item_id, platform, source_template_id,
    publication_instructions, publication_window_hours, required_disclosures,
    expected_account, proof_evidence_policy, publication_due_at
  ) values (
    new.workspace_id, new.id, coalesce(new.platform, v_template.platform), v_template.id,
    v_template.publication_instructions, v_template.publication_window_hours,
    v_template.required_disclosures, v_template.expected_account, v_template.proof_evidence_policy, null
  );
  return new;
end;
$$;
create trigger mission_work_items_snapshot_publication_instructions
  after insert on public.mission_work_items
  for each row execute function private.snapshot_publication_instructions();

drop trigger mission_publication_instructions_immutable on public.mission_publication_instructions;
create or replace function private.guard_publication_instruction_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'mission_publication_instructions_immutable'; end if;
  if old.frozen_at is not null then raise exception 'mission_publication_instructions_frozen'; end if;
  return new;
end;
$$;
create trigger mission_publication_instructions_immutable
  before update or delete on public.mission_publication_instructions
  for each row execute function private.guard_publication_instruction_mutation();
create or replace function private.set_publication_instructions(
  p_workspace uuid, p_workflow uuid, p_work_item uuid, p_operator uuid,
  p_expected_state text, p_expected_revision integer,
  p_idempotency_key uuid, p_instructions jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_instruction public.mission_publication_instructions;
  v_reason text := nullif(btrim(p_instructions->>'override_reason'), '');
  v_changed boolean;
begin
  perform private.assert_active_mission_operator(p_operator);
  if p_expected_state is null or btrim(p_expected_state) = ''
    or p_expected_revision is null or p_expected_revision < 0 or p_idempotency_key is null
    or jsonb_typeof(p_instructions) <> 'object'
    or nullif(btrim(p_instructions->>'publication_instructions'), '') is null
    or coalesce((p_instructions->>'publication_window_hours') ~ '^[1-9][0-9]*$', false) is not true
    or case when jsonb_typeof(p_instructions->'required_disclosures') = 'array' then exists (
      select 1 from jsonb_array_elements(p_instructions->'required_disclosures') disclosure
      where jsonb_typeof(disclosure) <> 'string' or nullif(btrim(disclosure #>> '{}'), '') is null
    ) else true end
    or (p_instructions ? 'expected_account' and jsonb_typeof(p_instructions->'expected_account') not in ('null', 'string'))
    or (jsonb_typeof(p_instructions->'expected_account') = 'string' and nullif(btrim(p_instructions->>'expected_account'), '') is null)
    or jsonb_typeof(p_instructions->'proof_evidence_policy') <> 'object'
  then return jsonb_build_object('code', 'VALIDATION_FAILED'); end if;

  select workflow.* into v_workflow from public.mission_workflows workflow
  where workflow.id = p_workflow and workflow.workspace_id = p_workspace for update;
  if v_workflow.id is null then return jsonb_build_object('code', 'WORKFLOW_NOT_FOUND'); end if;
  select item.* into v_item from public.mission_work_items item
  where item.id = p_work_item and item.mission_workflow_id = p_workflow and item.workspace_id = p_workspace
  for update;
  if v_item.id is null then return jsonb_build_object('code', 'WORKFLOW_NOT_FOUND'); end if;
  select instruction.* into v_instruction from public.mission_publication_instructions instruction
  where instruction.mission_work_item_id = p_work_item and instruction.workspace_id = p_workspace for update;
  if v_instruction.id is null then return jsonb_build_object('code', 'PUBLICATION_SETUP_REQUIRED'); end if;
  if p_idempotency_key = any(v_instruction.idempotency_keys) then
    return jsonb_build_object('instruction', to_jsonb(v_instruction));
  end if;
  if v_instruction.frozen_at is not null then return jsonb_build_object('code', 'WRONG_STATE'); end if;
  if v_item.state <> p_expected_state or v_instruction.revision <> p_expected_revision then
    return jsonb_build_object('code', 'WORKFLOW_STALE', 'current_instruction', to_jsonb(v_instruction));
  end if;
  if v_item.state = 'approved_to_publish' then return jsonb_build_object('code', 'WRONG_STATE'); end if;

  v_changed := v_instruction.publication_instructions is distinct from btrim(p_instructions->>'publication_instructions')
    or v_instruction.publication_window_hours is distinct from (p_instructions->>'publication_window_hours')::integer
    or v_instruction.required_disclosures is distinct from p_instructions->'required_disclosures'
    or v_instruction.expected_account is distinct from nullif(btrim(p_instructions->>'expected_account'), '')
    or v_instruction.proof_evidence_policy is distinct from p_instructions->'proof_evidence_policy';
  if not v_changed then
    update public.mission_publication_instructions
    set idempotency_keys = array_append(idempotency_keys, p_idempotency_key)
    where id = v_instruction.id and workspace_id = p_workspace
    returning * into v_instruction;
    return jsonb_build_object('instruction', to_jsonb(v_instruction));
  end if;
  if v_reason is null then raise exception 'override_reason_required'; end if;

  update public.mission_publication_instructions
  set publication_instructions = btrim(p_instructions->>'publication_instructions'),
      publication_window_hours = (p_instructions->>'publication_window_hours')::integer,
      required_disclosures = p_instructions->'required_disclosures',
      expected_account = nullif(btrim(p_instructions->>'expected_account'), ''),
      proof_evidence_policy = p_instructions->'proof_evidence_policy',
      override_reason = v_reason,
      overridden_by = p_operator,
      overridden_at = now(),
      revision = revision + 1,
      idempotency_keys = array_append(idempotency_keys, p_idempotency_key)
  where id = v_instruction.id and workspace_id = p_workspace
  returning * into v_instruction;
  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id,
    event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, p_workflow, p_work_item, 'operator', p_operator,
    'mission_publication_instructions_overridden', 'mission_publication_instruction', v_instruction.id,
    jsonb_build_object('revision', v_instruction.revision)
  );
  return jsonb_build_object('instruction', to_jsonb(v_instruction));
end;
$$;

create or replace function public.set_publication_instructions(
  p_workspace uuid, p_workflow uuid, p_work_item uuid, p_operator uuid,
  p_expected_state text, p_expected_revision integer,
  p_idempotency_key uuid, p_instructions jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then raise exception 'not_authorized'; end if;
  perform private.assert_active_mission_operator(p_operator);
  return private.set_publication_instructions(
    p_workspace, p_workflow, p_work_item, p_operator, p_expected_state,
    p_expected_revision, p_idempotency_key, p_instructions
  );
end;
$$;
revoke all on function private.set_publication_instructions(uuid, uuid, uuid, uuid, text, integer, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.set_publication_instructions(uuid, uuid, uuid, uuid, text, integer, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_publication_instructions(uuid, uuid, uuid, uuid, text, integer, uuid, jsonb) to service_role;
create or replace function private.approve_mission_version(
  p_workflow uuid, p_work_item uuid, p_version uuid,
  p_operator uuid, p_workspace uuid, p_expected_state text
) returns public.mission_work_items
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_version public.mission_draft_versions;
  v_round public.mission_review_rounds;
  v_instruction public.mission_publication_instructions;
  v_publish_due_at timestamptz;
begin
  perform private.assert_active_mission_operator(p_operator);
  select workflow.* into v_workflow from public.mission_workflows workflow
  where workflow.id = p_workflow and workflow.workspace_id = p_workspace for update;
  if v_workflow.id is null then raise exception 'not_found'; end if;
  select item.* into v_item from public.mission_work_items item
  where item.id = p_work_item and item.mission_workflow_id = p_workflow and item.workspace_id = p_workspace
  for update;
  if v_item.id is null then raise exception 'not_found'; end if;
  if v_item.state <> p_expected_state or v_item.current_submitted_version_id <> p_version then raise exception 'stale'; end if;
  if v_item.state not in ('submitted', 'under_review') then raise exception 'wrong_state'; end if;

  select version.* into v_version from public.mission_draft_versions version
  where version.id = p_version and version.mission_work_item_id = p_work_item and version.workspace_id = p_workspace
  for update;
  if v_version.id is null then raise exception 'stale'; end if;
  if exists (
    select 1 from public.mission_draft_versions newer
    where newer.mission_work_item_id = p_work_item and newer.workspace_id = p_workspace
      and newer.version_number > v_version.version_number
  ) then raise exception 'stale'; end if;
  select round.* into v_round from public.mission_review_rounds round
  where round.mission_work_item_id = p_work_item and round.mission_draft_version_id = p_version
    and round.workspace_id = p_workspace and round.state = 'open' for update;
  if v_round.id is null then raise exception 'wrong_state'; end if;

  select instruction.* into v_instruction from public.mission_publication_instructions instruction
  where instruction.mission_work_item_id = p_work_item and instruction.workspace_id = p_workspace for update;
  if v_instruction.id is null
     or nullif(btrim(v_instruction.publication_instructions), '') is null
     or v_instruction.publication_window_hours <= 0
     or jsonb_typeof(v_instruction.required_disclosures) <> 'array'
     or exists (
       select 1 from jsonb_array_elements(v_instruction.required_disclosures) disclosure
       where jsonb_typeof(disclosure) <> 'string' or nullif(btrim(disclosure #>> '{}'), '') is null
     )
     or jsonb_typeof(v_instruction.proof_evidence_policy) <> 'object'
  then raise exception 'PUBLICATION_SETUP_REQUIRED'; end if;

  v_publish_due_at := v_now + make_interval(hours => v_instruction.publication_window_hours);
  if v_workflow.deadline is not null then v_publish_due_at := least(v_publish_due_at, v_workflow.deadline); end if;
  update public.mission_publication_instructions
  set publication_due_at = v_publish_due_at, frozen_at = coalesce(frozen_at, v_now)
  where id = v_instruction.id and frozen_at is null
  returning * into v_instruction;
  if v_instruction.publication_due_at is null then raise exception 'PUBLICATION_SETUP_REQUIRED'; end if;

  update public.mission_review_rounds
  set state = 'approved_to_publish', reviewer_id = p_operator,
      review_started_at = coalesce(review_started_at, v_now), decision_at = v_now
  where id = v_round.id and workspace_id = p_workspace;
  update public.mission_work_items
  set state = 'approved_to_publish', approved_version_id = p_version,
      current_reviewer_id = p_operator, updated_at = v_now
  where id = p_work_item and mission_workflow_id = p_workflow and workspace_id = p_workspace
  returning * into v_item;
  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id,
    event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, p_workflow, p_work_item, 'operator', p_operator,
    'mission_version_approved_to_publish', 'mission_draft_version', p_version,
    jsonb_build_object('publication_due_at', v_instruction.publication_due_at)
  );
  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id,
    event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, p_workflow, p_work_item, 'operator', p_operator,
    'mission_publication_instructions_frozen', 'mission_publication_instruction', v_instruction.id,
    jsonb_build_object('publication_due_at', v_instruction.publication_due_at)
  );
  perform private.refresh_mission_workflow_state(p_workflow);
  return v_item;
end;
$$;

create or replace function public.approve_mission_version(
  p_workflow uuid, p_work_item uuid, p_version uuid,
  p_operator uuid, p_workspace uuid, p_expected_state text
) returns public.mission_work_items
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then raise exception 'not_authorized'; end if;
  perform private.assert_active_mission_operator(p_operator);
  return private.approve_mission_version(p_workflow, p_work_item, p_version, p_operator, p_workspace, p_expected_state);
end;
$$;
revoke all on function private.approve_mission_version(uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.approve_mission_version(uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.approve_mission_version(uuid, uuid, uuid, uuid, uuid, text) to service_role;

create or replace function public.submit_mission_publication_proof(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_expected_state text,
  p_expected_revision integer,
  p_idempotency_key uuid,
  p_proof jsonb,
  p_evidence_asset_ids uuid[]
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_instruction public.mission_publication_instructions;
  v_attempt public.mission_publication_proof_attempts;
  v_attempt_number integer;
  v_evidence_count integer;
  v_unassigned_evidence_count integer;
  v_required_evidence boolean;
  v_evidence_checksums jsonb;
  v_content_checksum text;
  v_submitted_late boolean;
  v_canonical jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then
    raise exception 'not_authorized';
  end if;
  if p_submission is null or p_creator is null or p_workspace is null or p_work_item is null
     or p_expected_revision is null or p_expected_revision < 0 or p_idempotency_key is null
     or p_expected_state not in ('approved_to_publish', 'proof_correction_requested')
     or jsonb_typeof(p_proof) <> 'object'
     or jsonb_typeof(p_proof->'primary_url') <> 'string'
     or nullif(btrim(p_proof->>'primary_url'), '') is null
     or jsonb_typeof(p_proof->'additional_urls') <> 'array'
     or jsonb_array_length(p_proof->'additional_urls') > 4
     or jsonb_typeof(p_proof->'metadata_snapshot') <> 'object'
     or jsonb_typeof(p_proof->'metadata_status') <> 'string'
     or p_proof->>'metadata_status' not in ('available', 'unavailable')
  then raise exception 'validation_failed'; end if;

  select workflow.* into v_workflow
  from public.mission_workflows workflow
  join public.mission_submissions submission
    on submission.id = workflow.mission_submission_id
   and submission.workspace_id = workflow.workspace_id
  where workflow.mission_submission_id = p_submission
    and workflow.workspace_id = p_workspace
    and submission.creator_id = p_creator
  for update of workflow;
  if v_workflow.id is null then raise exception 'not_found'; end if;

  select item.* into v_item
  from public.mission_work_items item
  where item.id = p_work_item
    and item.mission_workflow_id = v_workflow.id
    and item.workspace_id = p_workspace
  for update;
  if v_item.id is null then raise exception 'not_found'; end if;

  select instruction.* into v_instruction
  from public.mission_publication_instructions instruction
  where instruction.mission_work_item_id = p_work_item
    and instruction.workspace_id = p_workspace
  for update;
  if v_instruction.id is null or v_instruction.frozen_at is null then
    return jsonb_build_object('code', 'PUBLICATION_SETUP_REQUIRED');
  end if;

  if exists (
    select 1 from unnest(coalesce(p_evidence_asset_ids, '{}'::uuid[])) left_id
    group by left_id having count(*) > 1
  ) then raise exception 'validation_failed'; end if;

  with locked_assets as (
    select asset.*
    from public.mission_publication_proof_assets asset
    where asset.id = any(coalesce(p_evidence_asset_ids, '{}'::uuid[]))
      and asset.workspace_id = p_workspace
      and asset.mission_submission_id = p_submission
      and asset.mission_workflow_id = v_workflow.id
      and asset.mission_work_item_id = p_work_item
      and asset.creator_id = p_creator
      and asset.upload_state = 'finalized'
      and asset.content_checksum is not null
    for update
  )
  select coalesce(jsonb_agg(asset.content_checksum order by asset.id), '[]'::jsonb),
         count(*)::integer,
         count(*) filter (where asset.mission_publication_proof_attempt_id is null)::integer
  into v_evidence_checksums, v_evidence_count, v_unassigned_evidence_count
  from locked_assets asset;
  if v_evidence_count <> cardinality(coalesce(p_evidence_asset_ids, '{}'::uuid[])) then
    raise exception 'evidence_invalid';
  end if;
  v_required_evidence := v_instruction.proof_evidence_policy <> '{}'::jsonb;
  if v_required_evidence and v_evidence_count = 0 then raise exception 'evidence_required'; end if;

  v_canonical := jsonb_build_object(
    'primary_url', p_proof->>'primary_url',
    'additional_urls', p_proof->'additional_urls',
    'evidence_checksums', v_evidence_checksums
  );
  v_content_checksum := encode(
    extensions.digest(convert_to(v_canonical::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select attempt.* into v_attempt
  from public.mission_publication_proof_attempts attempt
  where attempt.workspace_id = p_workspace
    and attempt.mission_work_item_id = p_work_item
    and attempt.submission_idempotency_key = p_idempotency_key;
  if v_attempt.id is not null then
    if v_attempt.content_checksum <> v_content_checksum then raise exception 'idempotency_conflict'; end if;
    return jsonb_build_object('attempt', to_jsonb(v_attempt), 'idempotent', true);
  end if;

  select attempt.* into v_attempt
  from public.mission_publication_proof_attempts attempt
  where attempt.workspace_id = p_workspace
    and attempt.mission_work_item_id = p_work_item
    and attempt.content_checksum = v_content_checksum
  order by attempt.attempt_number desc limit 1;
  if v_attempt.id is not null then
    return jsonb_build_object('attempt', to_jsonb(v_attempt), 'idempotent', true);
  end if;

  if v_unassigned_evidence_count <> v_evidence_count then
    raise exception 'evidence_invalid';
  end if;

  if v_item.state <> p_expected_state or v_instruction.revision <> p_expected_revision then
    return jsonb_build_object(
      'code', 'WORKFLOW_STALE',
      'current_publication', jsonb_build_object(
        'workItemId', v_item.id,
        'state', v_item.state,
        'revision', v_instruction.revision,
        'currentAttemptId', v_item.current_proof_attempt_id
      )
    );
  end if;

  select coalesce(max(attempt.attempt_number), 0) + 1 into v_attempt_number
  from public.mission_publication_proof_attempts attempt
  where attempt.workspace_id = p_workspace and attempt.mission_work_item_id = p_work_item;
  v_submitted_late := v_now > v_instruction.publication_due_at;

  insert into public.mission_publication_proof_attempts (
    workspace_id, mission_work_item_id, attempt_number, primary_url, additional_urls,
    submitted_by, submitted_at, submitted_late, metadata_status, metadata_snapshot,
    metadata_error_category, content_checksum, submission_idempotency_key
  ) values (
    p_workspace, p_work_item, v_attempt_number, p_proof->>'primary_url', p_proof->'additional_urls',
    p_creator, v_now, v_submitted_late, p_proof->>'metadata_status', p_proof->'metadata_snapshot',
    nullif(p_proof->>'metadata_error_category', ''), v_content_checksum, p_idempotency_key
  ) returning * into v_attempt;

  update public.mission_publication_proof_assets
  set mission_publication_proof_attempt_id = v_attempt.id
  where id = any(coalesce(p_evidence_asset_ids, '{}'::uuid[]))
    and workspace_id = p_workspace
    and creator_id = p_creator
    and upload_state = 'finalized'
    and mission_publication_proof_attempt_id is null;

  insert into public.mission_publication_proof_reviews (
    workspace_id, mission_publication_proof_attempt_id, review_number, state
  ) values (p_workspace, v_attempt.id, v_attempt_number, 'open');

  update public.mission_work_items
  set current_proof_attempt_id = v_attempt.id,
      state = 'proof_submitted',
      current_reviewer_id = null,
      review_started_at = null,
      review_due_at = null,
      updated_at = v_now
  where id = p_work_item and workspace_id = p_workspace;
  perform private.refresh_mission_workflow_state(v_workflow.id);

  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id,
    event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, v_workflow.id, p_work_item, 'creator', p_creator,
    'mission_publication_proof_submitted', 'mission_publication_proof_attempt', v_attempt.id,
    jsonb_build_object(
      'platform', v_item.platform, 'attempt_number', v_attempt_number,
      'submitted_late', v_submitted_late, 'evidence_count', v_evidence_count,
      'url_count', 1 + jsonb_array_length(p_proof->'additional_urls'),
      'metadata_status', p_proof->>'metadata_status'
    )
  );
  return jsonb_build_object('attempt', to_jsonb(v_attempt), 'idempotent', false);
end;
$$;
revoke all on function public.submit_mission_publication_proof(uuid, uuid, uuid, uuid, text, integer, uuid, jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.submit_mission_publication_proof(uuid, uuid, uuid, uuid, text, integer, uuid, jsonb, uuid[])
  to service_role;
