-- Phase 2 active mission workspace foundation.
-- The legacy mission_submissions row remains the reward anchor and stays joined.

create schema if not exists private;
revoke all on schema private from public;

alter table public.missions
  add column creator_workflow_mode text not null default 'legacy'
    check (creator_workflow_mode in ('legacy', 'active_workspace')),
  add column fulfillment_required boolean not null default false,
  add column revision_limit smallint not null default 2 check (revision_limit >= 0),
  add column review_sla_hours integer not null default 48 check (review_sla_hours > 0),
  add column revision_response_hours integer not null default 48 check (revision_response_hours > 0);

create table public.mission_deliverable_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  platform text not null check (btrim(platform) <> ''),
  position integer not null default 0 check (position >= 0),
  required boolean not null default true,
  draft_due_offset_hours integer check (draft_due_offset_hours is null or draft_due_offset_hours >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mission_id, position)
);

create table public.mission_deliverable_requirements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_deliverable_template_id uuid not null references public.mission_deliverable_templates(id) on delete cascade,
  category text not null check (category in ('format', 'key_message', 'compliance', 'quality', 'other')),
  requirement_text text not null check (btrim(requirement_text) <> ''),
  required boolean not null default true,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  unique (mission_deliverable_template_id, position)
);

create table public.mission_workflows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_submission_id uuid not null unique references public.mission_submissions(id) on delete cascade,
  state text not null check (state in ('accepted', 'fulfillment_pending', 'drafting', 'in_review', 'revision_requested', 'approved_to_publish', 'cancelled', 'expired')),
  accepted_at timestamptz not null,
  deadline timestamptz,
  fulfillment_required boolean not null,
  revision_limit smallint not null check (revision_limit >= 0),
  review_sla_hours integer not null check (review_sla_hours > 0),
  revision_response_hours integer not null check (revision_response_hours > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.mission_work_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_workflow_id uuid not null references public.mission_workflows(id) on delete cascade,
  source_template_id uuid references public.mission_deliverable_templates(id) on delete set null,
  title text not null check (btrim(title) <> ''),
  platform text not null check (btrim(platform) <> ''),
  requirements_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(requirements_snapshot) = 'array'),
  required boolean not null default true,
  position integer not null default 0 check (position >= 0),
  deadline timestamptz,
  state text not null check (state in ('blocked_by_fulfillment', 'drafting', 'submitted', 'under_review', 'revision_requested', 'approved_to_publish', 'cancelled', 'expired')),
  current_submitted_version_id uuid,
  approved_version_id uuid,
  current_reviewer_id uuid references auth.users(id) on delete set null,
  review_started_at timestamptz,
  review_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mission_workflow_id, position)
);

create table public.mission_working_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_work_item_id uuid not null references public.mission_work_items(id) on delete cascade,
  caption_text text not null default '',
  external_draft_url text,
  checklist_answers jsonb not null default '{}'::jsonb check (jsonb_typeof(checklist_answers) = 'object'),
  revision integer not null default 0 check (revision >= 0),
  last_saved_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index mission_working_drafts_one_active_idx
  on public.mission_working_drafts (mission_work_item_id)
  where archived_at is null;

create table public.mission_draft_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_work_item_id uuid not null references public.mission_work_items(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  caption_snapshot text not null default '',
  external_draft_url_snapshot text,
  checklist_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(checklist_snapshot) = 'object'),
  submitted_by uuid not null references auth.users(id),
  submitted_at timestamptz not null default now(),
  content_checksum text not null check (btrim(content_checksum) <> ''),
  unique (mission_work_item_id, version_number),
  unique (mission_work_item_id, content_checksum)
);

alter table public.mission_work_items
  add constraint mission_work_items_current_version_fk
    foreign key (current_submitted_version_id) references public.mission_draft_versions(id),
  add constraint mission_work_items_approved_version_fk
    foreign key (approved_version_id) references public.mission_draft_versions(id);

create table public.mission_draft_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_work_item_id uuid not null references public.mission_work_items(id) on delete cascade,
  creator_id uuid not null references public.creators(id) on delete cascade,
  storage_object_path text not null unique check (btrim(storage_object_path) <> ''),
  original_filename text not null check (btrim(original_filename) <> ''),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 20971520),
  checksum text,
  upload_state text not null default 'pending' check (upload_state in ('pending', 'uploaded', 'ready', 'failed', 'deleted')),
  mission_draft_version_id uuid references public.mission_draft_versions(id),
  created_at timestamptz not null default now(),
  retained_at timestamptz,
  deleted_at timestamptz
);

create table public.mission_review_rounds (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_work_item_id uuid not null references public.mission_work_items(id) on delete cascade,
  mission_draft_version_id uuid not null references public.mission_draft_versions(id),
  round_number integer not null check (round_number > 0),
  state text not null default 'open' check (state in ('open', 'revision_requested', 'approved_to_publish')),
  reviewer_id uuid references auth.users(id) on delete set null,
  review_started_at timestamptz,
  decision_at timestamptz,
  creator_response_deadline timestamptz,
  created_at timestamptz not null default now(),
  unique (mission_work_item_id, round_number)
);
create unique index mission_review_rounds_one_decision_per_version_idx
  on public.mission_review_rounds (mission_draft_version_id)
  where state <> 'open';

create table public.mission_review_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_review_round_id uuid not null references public.mission_review_rounds(id) on delete cascade,
  requirement_id uuid,
  category text not null check (category in ('format', 'key_message', 'compliance', 'quality', 'other')),
  required_change_text text not null check (btrim(required_change_text) <> ''),
  required boolean not null default true,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  unique (mission_review_round_id, position)
);

create table public.mission_revision_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_work_item_id uuid not null references public.mission_work_items(id) on delete cascade,
  granted_by uuid not null references auth.users(id),
  reason text not null check (btrim(reason) <> ''),
  granted_count smallint not null default 1 check (granted_count > 0),
  granted_at timestamptz not null default now()
);

create table public.mission_fulfillments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_workflow_id uuid not null unique references public.mission_workflows(id) on delete cascade,
  status text not null default 'preparing' check (status in ('preparing', 'shipped', 'received')),
  shipped_by uuid references auth.users(id) on delete set null,
  shipped_at timestamptz,
  received_by uuid references auth.users(id) on delete set null,
  received_at timestamptz,
  operational_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.mission_workflow_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_workflow_id uuid not null references public.mission_workflows(id) on delete cascade,
  mission_work_item_id uuid references public.mission_work_items(id) on delete cascade,
  actor_type text not null check (actor_type in ('creator', 'operator', 'system')),
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null check (btrim(event_type) <> ''),
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

-- Foreign-key, ownership, timeline, and queue indexes.
create index mission_templates_workspace_idx on public.mission_deliverable_templates (workspace_id);
create index mission_templates_mission_idx on public.mission_deliverable_templates (mission_id);
create index mission_requirements_workspace_idx on public.mission_deliverable_requirements (workspace_id);
create index mission_requirements_template_idx on public.mission_deliverable_requirements (mission_deliverable_template_id);
create index mission_workflows_workspace_idx on public.mission_workflows (workspace_id);
create index mission_work_items_workspace_idx on public.mission_work_items (workspace_id);
create index mission_work_items_workflow_idx on public.mission_work_items (mission_workflow_id);
create index mission_work_items_queue_idx on public.mission_work_items (state, review_due_at, deadline, review_started_at);
create index mission_working_drafts_workspace_idx on public.mission_working_drafts (workspace_id);
create index mission_versions_workspace_idx on public.mission_draft_versions (workspace_id);
create index mission_versions_work_item_idx on public.mission_draft_versions (mission_work_item_id);
create index mission_assets_workspace_idx on public.mission_draft_assets (workspace_id);
create index mission_assets_work_item_idx on public.mission_draft_assets (mission_work_item_id);
create index mission_assets_creator_idx on public.mission_draft_assets (creator_id);
create index mission_assets_version_idx on public.mission_draft_assets (mission_draft_version_id);
create index mission_reviews_workspace_idx on public.mission_review_rounds (workspace_id);
create index mission_reviews_work_item_idx on public.mission_review_rounds (mission_work_item_id);
create index mission_reviews_version_idx on public.mission_review_rounds (mission_draft_version_id);
create index mission_review_items_workspace_idx on public.mission_review_items (workspace_id);
create index mission_review_items_round_idx on public.mission_review_items (mission_review_round_id);
create index mission_revision_grants_workspace_idx on public.mission_revision_grants (workspace_id);
create index mission_revision_grants_work_item_idx on public.mission_revision_grants (mission_work_item_id);
create index mission_fulfillments_workspace_idx on public.mission_fulfillments (workspace_id);
create index mission_workflow_events_workspace_idx on public.mission_workflow_events (workspace_id);
create index mission_workflow_events_timeline_idx on public.mission_workflow_events (mission_workflow_id, created_at, id);
create index mission_workflow_events_work_item_idx on public.mission_workflow_events (mission_work_item_id);

-- All public tables are RLS protected. Authenticated users receive read-only Data API grants.
alter table public.mission_deliverable_templates enable row level security;
alter table public.mission_deliverable_requirements enable row level security;
alter table public.mission_workflows enable row level security;
alter table public.mission_work_items enable row level security;
alter table public.mission_working_drafts enable row level security;
alter table public.mission_draft_versions enable row level security;
alter table public.mission_draft_assets enable row level security;
alter table public.mission_review_rounds enable row level security;
alter table public.mission_review_items enable row level security;
alter table public.mission_revision_grants enable row level security;
alter table public.mission_fulfillments enable row level security;
alter table public.mission_workflow_events enable row level security;

create policy mission_templates_creator_read on public.mission_deliverable_templates
  for select to authenticated using (exists (
    select 1 from public.mission_submissions s
    where s.mission_id = mission_deliverable_templates.mission_id
      and s.creator_id = (select auth.uid())
  ));
create policy mission_requirements_creator_read on public.mission_deliverable_requirements
  for select to authenticated using (exists (
    select 1 from public.mission_deliverable_templates t
    join public.mission_submissions s on s.mission_id = t.mission_id
    where t.id = mission_deliverable_requirements.mission_deliverable_template_id
      and s.creator_id = (select auth.uid())
  ));
create policy mission_workflows_creator_read on public.mission_workflows
  for select to authenticated using (exists (
    select 1 from public.mission_submissions s
    where s.id = mission_workflows.mission_submission_id
      and s.creator_id = (select auth.uid())
  ));
create policy mission_work_items_creator_read on public.mission_work_items
  for select to authenticated using (exists (
    select 1 from public.mission_workflows w
    join public.mission_submissions s on s.id = w.mission_submission_id
    where w.id = mission_work_items.mission_workflow_id
      and s.creator_id = (select auth.uid())
  ));
create policy mission_working_drafts_creator_read on public.mission_working_drafts
  for select to authenticated using (exists (
    select 1 from public.mission_work_items i
    join public.mission_workflows w on w.id = i.mission_workflow_id
    join public.mission_submissions s on s.id = w.mission_submission_id
    where i.id = mission_working_drafts.mission_work_item_id
      and s.creator_id = (select auth.uid())
  ));
create policy mission_versions_creator_read on public.mission_draft_versions
  for select to authenticated using (exists (
    select 1 from public.mission_work_items i
    join public.mission_workflows w on w.id = i.mission_workflow_id
    join public.mission_submissions s on s.id = w.mission_submission_id
    where i.id = mission_draft_versions.mission_work_item_id
      and s.creator_id = (select auth.uid())
  ));
create policy mission_assets_creator_read on public.mission_draft_assets
  for select to authenticated using (creator_id = (select auth.uid()));
create policy mission_reviews_creator_read on public.mission_review_rounds
  for select to authenticated using (exists (
    select 1 from public.mission_work_items i
    join public.mission_workflows w on w.id = i.mission_workflow_id
    join public.mission_submissions s on s.id = w.mission_submission_id
    where i.id = mission_review_rounds.mission_work_item_id
      and s.creator_id = (select auth.uid())
  ));
create policy mission_review_items_creator_read on public.mission_review_items
  for select to authenticated using (exists (
    select 1 from public.mission_review_rounds r
    join public.mission_work_items i on i.id = r.mission_work_item_id
    join public.mission_workflows w on w.id = i.mission_workflow_id
    join public.mission_submissions s on s.id = w.mission_submission_id
    where r.id = mission_review_items.mission_review_round_id
      and s.creator_id = (select auth.uid())
  ));
create policy mission_revision_grants_creator_read on public.mission_revision_grants
  for select to authenticated using (exists (
    select 1 from public.mission_work_items i
    join public.mission_workflows w on w.id = i.mission_workflow_id
    join public.mission_submissions s on s.id = w.mission_submission_id
    where i.id = mission_revision_grants.mission_work_item_id
      and s.creator_id = (select auth.uid())
  ));
create policy mission_fulfillments_creator_read on public.mission_fulfillments
  for select to authenticated using (exists (
    select 1 from public.mission_workflows w
    join public.mission_submissions s on s.id = w.mission_submission_id
    where w.id = mission_fulfillments.mission_workflow_id
      and s.creator_id = (select auth.uid())
  ));
create policy mission_events_creator_read on public.mission_workflow_events
  for select to authenticated using (exists (
    select 1 from public.mission_workflows w
    join public.mission_submissions s on s.id = w.mission_submission_id
    where w.id = mission_workflow_events.mission_workflow_id
      and s.creator_id = (select auth.uid())
  ));

grant all on
  public.mission_deliverable_templates,
  public.mission_deliverable_requirements,
  public.mission_workflows,
  public.mission_work_items,
  public.mission_working_drafts,
  public.mission_draft_versions,
  public.mission_draft_assets,
  public.mission_review_rounds,
  public.mission_review_items,
  public.mission_revision_grants,
  public.mission_fulfillments,
  public.mission_workflow_events
to service_role;
grant select on
  public.mission_deliverable_templates,
  public.mission_deliverable_requirements,
  public.mission_workflows,
  public.mission_work_items,
  public.mission_working_drafts,
  public.mission_draft_versions,
  public.mission_draft_assets,
  public.mission_review_rounds,
  public.mission_review_items,
  public.mission_revision_grants,
  public.mission_fulfillments,
  public.mission_workflow_events
to authenticated;

-- Privileged implementations live outside exposed schemas and repeat identity checks.
create or replace function private.refresh_mission_workflow_state(p_workflow uuid)
returns public.mission_workflows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workflow public.mission_workflows;
  v_state text;
  v_actor uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
begin
  select w.* into v_workflow
  from public.mission_workflows w
  join public.mission_submissions s on s.id = w.mission_submission_id
  where w.id = p_workflow
    and (v_service or s.creator_id = v_actor)
  for update of w;
  if v_workflow.id is null then raise exception 'not_found'; end if;

  if exists (
    select 1 from public.mission_fulfillments f
    where f.mission_workflow_id = v_workflow.id and f.status <> 'received'
  ) then
    v_state := 'fulfillment_pending';
  elsif not exists (
    select 1 from public.mission_work_items i
    where i.mission_workflow_id = v_workflow.id
      and i.required and i.state <> 'approved_to_publish'
  ) then
    v_state := 'approved_to_publish';
  elsif exists (
    select 1 from public.mission_work_items i
    where i.mission_workflow_id = v_workflow.id and i.state = 'revision_requested'
  ) then
    v_state := 'revision_requested';
  elsif exists (
    select 1 from public.mission_work_items i
    where i.mission_workflow_id = v_workflow.id and i.state in ('submitted', 'under_review')
  ) then
    v_state := 'in_review';
  else
    v_state := 'drafting';
  end if;

  update public.mission_workflows
  set state = v_state, updated_at = now()
  where id = v_workflow.id
  returning * into v_workflow;
  return v_workflow;
end;
$$;

create or replace function private.create_mission_workflow(p_submission uuid)
returns public.mission_workflows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
  v_submission public.mission_submissions;
  v_mission public.missions;
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_template record;
  v_required_count integer;
  v_initial_item_state text;
  v_accepted_at timestamptz := now();
begin
  if v_creator is null and not v_service then raise exception 'not_authenticated'; end if;

  select * into v_submission
  from public.mission_submissions
  where id = p_submission
    and (v_service or creator_id = v_creator)
  for update;
  if v_submission.id is null then raise exception 'not_found'; end if;

  select * into v_workflow
  from public.mission_workflows
  where mission_submission_id = v_submission.id;
  if v_workflow.id is not null then
    return private.refresh_mission_workflow_state(v_workflow.id);
  end if;

  if v_submission.status <> 'joined' then raise exception 'wrong_state'; end if;
  select * into v_mission from public.missions where id = v_submission.mission_id;
  if v_mission.creator_workflow_mode <> 'active_workspace' then raise exception 'legacy_mission'; end if;
  if v_mission.workspace_id <> v_submission.workspace_id then raise exception 'workspace_mismatch'; end if;

  select count(*) into v_required_count
  from public.mission_deliverable_templates
  where mission_id = v_mission.id and required;
  if v_required_count = 0 then raise exception 'required_deliverable_missing'; end if;

  insert into public.mission_workflows (
    workspace_id, mission_submission_id, state, accepted_at, deadline,
    fulfillment_required, revision_limit, review_sla_hours, revision_response_hours
  ) values (
    v_submission.workspace_id, v_submission.id, 'accepted', v_accepted_at,
    v_mission.deadline::timestamptz, v_mission.fulfillment_required,
    v_mission.revision_limit, v_mission.review_sla_hours, v_mission.revision_response_hours
  )
  on conflict (mission_submission_id) do nothing
  returning * into v_workflow;

  if v_workflow.id is null then
    select * into v_workflow from public.mission_workflows
    where mission_submission_id = v_submission.id;
    return private.refresh_mission_workflow_state(v_workflow.id);
  end if;

  v_initial_item_state := case
    when v_workflow.fulfillment_required then 'blocked_by_fulfillment'
    else 'drafting'
  end;

  for v_template in
    select
      t.*,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id,
          'category', r.category,
          'text', r.requirement_text,
          'required', r.required,
          'position', r.position
        ) order by r.position, r.id)
        from public.mission_deliverable_requirements r
        where r.mission_deliverable_template_id = t.id
      ), '[]'::jsonb) as requirement_snapshot
    from public.mission_deliverable_templates t
    where t.mission_id = v_mission.id
    order by t.position, t.id
  loop
    insert into public.mission_work_items (
      workspace_id, mission_workflow_id, source_template_id, title, platform,
      requirements_snapshot, required, position, deadline, state
    ) values (
      v_submission.workspace_id, v_workflow.id, v_template.id, v_template.title,
      v_template.platform, v_template.requirement_snapshot, v_template.required,
      v_template.position,
      case when v_template.draft_due_offset_hours is null then v_workflow.deadline
           else least(
             v_accepted_at + make_interval(hours => v_template.draft_due_offset_hours),
             coalesce(v_workflow.deadline, 'infinity'::timestamptz)
           ) end,
      v_initial_item_state
    ) returning * into v_item;

    insert into public.mission_working_drafts (workspace_id, mission_work_item_id)
    values (v_submission.workspace_id, v_item.id);
  end loop;

  if v_workflow.fulfillment_required then
    insert into public.mission_fulfillments (workspace_id, mission_workflow_id, status)
    values (v_submission.workspace_id, v_workflow.id, 'preparing');
  end if;

  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, actor_type, actor_id, event_type,
    entity_type, entity_id, metadata
  ) values (
    v_submission.workspace_id, v_workflow.id,
    case when v_creator is null then 'system' else 'creator' end,
    v_creator, 'workflow_created', 'mission_workflow', v_workflow.id,
    jsonb_build_object('fulfillment_required', v_workflow.fulfillment_required)
  );

  return private.refresh_mission_workflow_state(v_workflow.id);
end;
$$;

-- Narrow public names authorize before entering private privileged code.
create or replace function public.refresh_mission_workflow_state(p_workflow uuid)
returns public.mission_workflows
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
begin
  if not v_service and not exists (
    select 1 from public.mission_workflows w
    join public.mission_submissions s on s.id = w.mission_submission_id
    where w.id = p_workflow and s.creator_id = v_actor
  ) then raise exception 'not_found'; end if;
  return private.refresh_mission_workflow_state(p_workflow);
end;
$$;

create or replace function public.create_mission_workflow(p_submission uuid)
returns public.mission_workflows
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
begin
  if not v_service and not exists (
    select 1 from public.mission_submissions s
    where s.id = p_submission and s.creator_id = v_actor
  ) then raise exception 'not_found'; end if;
  return private.create_mission_workflow(p_submission);
end;
$$;

revoke all on function private.refresh_mission_workflow_state(uuid) from public, anon, authenticated, service_role;
revoke all on function private.create_mission_workflow(uuid) from public, anon, authenticated, service_role;
revoke all on function public.refresh_mission_workflow_state(uuid) from public, anon;
revoke all on function public.create_mission_workflow(uuid) from public, anon;
revoke usage on schema private from public, anon, authenticated;
grant execute on function public.refresh_mission_workflow_state(uuid) to authenticated, service_role;
grant execute on function public.create_mission_workflow(uuid) to authenticated, service_role;

-- Immutable records and finalized assets cannot be rewritten in place.
create or replace function private.raise_immutable_record()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'immutable_record';
end;
$$;

create or replace function private.guard_completed_review_round()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.state <> 'open' then raise exception 'immutable_record'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.guard_finalized_mission_asset()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.mission_draft_version_id is not null or old.upload_state = 'ready' then
    if tg_op = 'DELETE' then raise exception 'immutable_record'; end if;
    if (to_jsonb(new) - array['retained_at', 'deleted_at'])
       is distinct from
       (to_jsonb(old) - array['retained_at', 'deleted_at']) then
      raise exception 'immutable_record';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger mission_draft_versions_immutable
  before update or delete on public.mission_draft_versions
  for each row execute function private.raise_immutable_record();
create trigger mission_completed_reviews_immutable
  before update or delete on public.mission_review_rounds
  for each row execute function private.guard_completed_review_round();
create trigger mission_revision_grants_immutable
  before update or delete on public.mission_revision_grants
  for each row execute function private.raise_immutable_record();
create trigger mission_workflow_events_immutable
  before update or delete on public.mission_workflow_events
  for each row execute function private.raise_immutable_record();
create trigger mission_finalized_assets_guard
  before update or delete on public.mission_draft_assets
  for each row execute function private.guard_finalized_mission_asset();

revoke all on function private.raise_immutable_record() from public, anon, authenticated, service_role;
revoke all on function private.guard_completed_review_round() from public, anon, authenticated, service_role;
revoke all on function private.guard_finalized_mission_asset() from public, anon, authenticated, service_role;

-- Storage remains private; object access is tied to an owned asset row.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mission-draft-assets',
  'mission-draft-assets',
  false,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy mission_draft_assets_storage_read on storage.objects
  for select to authenticated using (
    bucket_id = 'mission-draft-assets'
    and exists (
      select 1 from public.mission_draft_assets a
      where a.storage_object_path = name and a.creator_id = (select auth.uid())
    )
  );
create policy mission_draft_assets_storage_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'mission-draft-assets'
    and exists (
      select 1 from public.mission_draft_assets a
      where a.storage_object_path = name
        and a.creator_id = (select auth.uid())
        and a.upload_state = 'pending'
    )
  );
create policy mission_draft_assets_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'mission-draft-assets'
    and exists (
      select 1 from public.mission_draft_assets a
      where a.storage_object_path = name
        and a.creator_id = (select auth.uid())
        and a.upload_state in ('pending', 'uploaded')
    )
  )
  with check (
    bucket_id = 'mission-draft-assets'
    and exists (
      select 1 from public.mission_draft_assets a
      where a.storage_object_path = name
        and a.creator_id = (select auth.uid())
        and a.upload_state in ('pending', 'uploaded')
    )
  );
create policy mission_draft_assets_storage_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'mission-draft-assets'
    and exists (
      select 1 from public.mission_draft_assets a
      where a.storage_object_path = name
        and a.creator_id = (select auth.uid())
        and a.mission_draft_version_id is null
    )
  );
alter table public.missions
  add constraint missions_id_workspace_unique unique (id, workspace_id);
alter table public.mission_submissions
  add constraint mission_submissions_id_workspace_unique unique (id, workspace_id);

-- Review hardening: tenant-consistent version links and wrapper-only execution.
alter table public.mission_work_items
  add constraint mission_work_items_id_workspace_unique unique (id, workspace_id);

alter table public.mission_draft_versions
  drop constraint mission_draft_versions_mission_work_item_id_fkey,
  add constraint mission_draft_versions_id_item_workspace_unique
    unique (id, mission_work_item_id, workspace_id),
  add constraint mission_draft_versions_item_workspace_fk
    foreign key (mission_work_item_id, workspace_id)
    references public.mission_work_items(id, workspace_id) on delete cascade;

alter table public.mission_work_items
  drop constraint mission_work_items_current_version_fk,
  drop constraint mission_work_items_approved_version_fk,
  add constraint mission_work_items_current_version_fk
    foreign key (current_submitted_version_id, id, workspace_id)
    references public.mission_draft_versions(id, mission_work_item_id, workspace_id),
  add constraint mission_work_items_approved_version_fk
    foreign key (approved_version_id, id, workspace_id)
    references public.mission_draft_versions(id, mission_work_item_id, workspace_id);

alter table public.mission_draft_assets
  drop constraint mission_draft_assets_mission_work_item_id_fkey,
  drop constraint mission_draft_assets_mission_draft_version_id_fkey,
  add constraint mission_draft_assets_item_workspace_fk
    foreign key (mission_work_item_id, workspace_id)
    references public.mission_work_items(id, workspace_id) on delete cascade,
  add constraint mission_draft_assets_version_item_workspace_fk
    foreign key (mission_draft_version_id, mission_work_item_id, workspace_id)
    references public.mission_draft_versions(id, mission_work_item_id, workspace_id);

alter table public.mission_review_rounds
  drop constraint mission_review_rounds_mission_work_item_id_fkey,
  drop constraint mission_review_rounds_mission_draft_version_id_fkey,
  add constraint mission_review_rounds_item_workspace_fk
    foreign key (mission_work_item_id, workspace_id)
    references public.mission_work_items(id, workspace_id) on delete cascade,
  add constraint mission_review_rounds_version_item_workspace_fk
    foreign key (mission_draft_version_id, mission_work_item_id, workspace_id)
    references public.mission_draft_versions(id, mission_work_item_id, workspace_id);

-- Terminal workflows never re-enter an active state.
create or replace function private.refresh_mission_workflow_state(p_workflow uuid)
returns public.mission_workflows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workflow public.mission_workflows;
  v_state text;
  v_actor uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
begin
  select w.* into v_workflow
  from public.mission_workflows w
  join public.mission_submissions s on s.id = w.mission_submission_id
  where w.id = p_workflow
    and (v_service or s.creator_id = v_actor)
  for update of w;
  if v_workflow.id is null then raise exception 'not_found'; end if;
  if v_workflow.state in ('cancelled', 'expired') then return v_workflow; end if;

  if exists (
    select 1 from public.mission_fulfillments f
    where f.mission_workflow_id = v_workflow.id and f.status <> 'received'
  ) then
    v_state := 'fulfillment_pending';
  elsif not exists (
    select 1 from public.mission_work_items i
    where i.mission_workflow_id = v_workflow.id
      and i.required and i.state <> 'approved_to_publish'
  ) then
    v_state := 'approved_to_publish';
  elsif exists (
    select 1 from public.mission_work_items i
    where i.mission_workflow_id = v_workflow.id and i.state = 'revision_requested'
  ) then
    v_state := 'revision_requested';
  elsif exists (
    select 1 from public.mission_work_items i
    where i.mission_workflow_id = v_workflow.id and i.state in ('submitted', 'under_review')
  ) then
    v_state := 'in_review';
  else
    v_state := 'drafting';
  end if;

  update public.mission_workflows
  set state = v_state, updated_at = now()
  where id = v_workflow.id
  returning * into v_workflow;
  return v_workflow;
end;
$$;

-- Public wrappers are the only authenticated entry points.
create or replace function public.refresh_mission_workflow_state(p_workflow uuid)
returns public.mission_workflows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
begin
  if not v_service and not exists (
    select 1 from public.mission_workflows w
    join public.mission_submissions s on s.id = w.mission_submission_id
    where w.id = p_workflow and s.creator_id = v_actor
  ) then raise exception 'not_found'; end if;
  return private.refresh_mission_workflow_state(p_workflow);
end;
$$;

create or replace function public.create_mission_workflow(p_submission uuid)
returns public.mission_workflows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
begin
  if not v_service and not exists (
    select 1 from public.mission_submissions s
    where s.id = p_submission and s.creator_id = v_actor
  ) then raise exception 'not_found'; end if;
  return private.create_mission_workflow(p_submission);
end;
$$;

revoke all on function private.refresh_mission_workflow_state(uuid) from public, anon, authenticated, service_role;
revoke all on function private.create_mission_workflow(uuid) from public, anon, authenticated, service_role;
revoke usage on schema private from public, anon, authenticated;
revoke all on function public.refresh_mission_workflow_state(uuid) from public, anon;
revoke all on function public.create_mission_workflow(uuid) from public, anon;
grant execute on function public.refresh_mission_workflow_state(uuid) to authenticated, service_role;
grant execute on function public.create_mission_workflow(uuid) to authenticated, service_role;

-- Fail the migration if RLS, Data API grants, or RPC privileges drift.
do $$
declare
  v_table regclass;
  v_index text;
begin
  foreach v_table in array array[
    'public.mission_deliverable_templates'::regclass,
    'public.mission_deliverable_requirements'::regclass,
    'public.mission_workflows'::regclass,
    'public.mission_work_items'::regclass,
    'public.mission_working_drafts'::regclass,
    'public.mission_draft_versions'::regclass,
    'public.mission_draft_assets'::regclass,
    'public.mission_review_rounds'::regclass,
    'public.mission_review_items'::regclass,
    'public.mission_revision_grants'::regclass,
    'public.mission_fulfillments'::regclass,
    'public.mission_workflow_events'::regclass
  ] loop
    if not (select relrowsecurity from pg_class where oid = v_table) then
      raise exception 'rls_required:%', v_table;
    end if;
    if not has_table_privilege('authenticated', v_table, 'SELECT')
       or has_table_privilege('authenticated', v_table, 'INSERT')
       or has_table_privilege('authenticated', v_table, 'UPDATE')
       or has_table_privilege('authenticated', v_table, 'DELETE') then
      raise exception 'authenticated_grant_drift:%', v_table;
    end if;
    if not has_table_privilege('service_role', v_table, 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'service_role_grant_missing:%', v_table;
    end if;
    if not exists (select 1 from pg_policy where polrelid = v_table) then
      raise exception 'creator_read_policy_required:%', v_table;
    end if;
  end loop;

  if has_function_privilege('authenticated', 'private.create_mission_workflow(uuid)'::regprocedure, 'EXECUTE')
     or has_function_privilege('authenticated', 'private.refresh_mission_workflow_state(uuid)'::regprocedure, 'EXECUTE')
     or has_schema_privilege('authenticated', 'private', 'USAGE') then
    raise exception 'private_rpc_exposed';
  end if;
  if not has_function_privilege('authenticated', 'public.create_mission_workflow(uuid)'::regprocedure, 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.refresh_mission_workflow_state(uuid)'::regprocedure, 'EXECUTE') then
    raise exception 'public_rpc_grant_missing';
  end if;

  foreach v_index in array array[
    'mission_templates_mission_idx',
    'mission_requirements_template_idx',
    'mission_workflows_mission_submission_id_key',
    'mission_work_items_workflow_idx',
    'mission_versions_work_item_idx',
    'mission_assets_creator_idx',
    'mission_reviews_work_item_idx',
    'mission_review_items_round_idx',
    'mission_revision_grants_work_item_idx',
    'mission_fulfillments_mission_workflow_id_key',
    'mission_workflow_events_timeline_idx'
  ] loop
    if to_regclass('public.' || v_index) is null then
      raise exception 'ownership_index_required:%', v_index;
    end if;
  end loop;
end;
$$;

-- Independent-review hardening: tenant identity is part of every relationship,
-- future private routines default closed, and draft assets use one canonical key.
alter default privileges for role postgres revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema private revoke execute on functions from public, anon, authenticated;

alter table public.creators
  add constraint creators_id_workspace_unique unique (id, workspace_id);
alter table public.mission_deliverable_templates
  add constraint mission_templates_id_workspace_unique unique (id, workspace_id);
alter table public.mission_workflows
  add constraint mission_workflows_id_workspace_unique unique (id, workspace_id);
alter table public.mission_work_items
  add constraint mission_work_items_id_workflow_workspace_unique unique (id, mission_workflow_id, workspace_id);
alter table public.mission_review_rounds
  add constraint mission_review_rounds_id_workspace_unique unique (id, workspace_id);

alter table public.mission_submissions
  add constraint mission_submissions_mission_workspace_fk
    foreign key (mission_id, workspace_id)
    references public.missions(id, workspace_id) on delete cascade,
  add constraint mission_submissions_creator_workspace_fk
    foreign key (creator_id, workspace_id)
    references public.creators(id, workspace_id) on delete cascade;
alter table public.mission_deliverable_templates
  add constraint mission_templates_mission_workspace_fk
    foreign key (mission_id, workspace_id)
    references public.missions(id, workspace_id) on delete cascade;
alter table public.mission_deliverable_requirements
  add constraint mission_requirements_template_workspace_fk
    foreign key (mission_deliverable_template_id, workspace_id)
    references public.mission_deliverable_templates(id, workspace_id) on delete cascade;
alter table public.mission_workflows
  add constraint mission_workflows_submission_workspace_fk
    foreign key (mission_submission_id, workspace_id)
    references public.mission_submissions(id, workspace_id) on delete cascade;
alter table public.mission_work_items
  add constraint mission_work_items_workflow_workspace_fk
    foreign key (mission_workflow_id, workspace_id)
    references public.mission_workflows(id, workspace_id) on delete cascade,
  add constraint mission_work_items_template_workspace_fk
    foreign key (source_template_id, workspace_id)
    references public.mission_deliverable_templates(id, workspace_id) on delete set null;
alter table public.mission_working_drafts
  add constraint mission_working_drafts_item_workspace_fk
    foreign key (mission_work_item_id, workspace_id)
    references public.mission_work_items(id, workspace_id) on delete cascade;
alter table public.mission_review_items
  add constraint mission_review_items_round_workspace_fk
    foreign key (mission_review_round_id, workspace_id)
    references public.mission_review_rounds(id, workspace_id) on delete cascade;
alter table public.mission_revision_grants
  add constraint mission_revision_grants_item_workspace_fk
    foreign key (mission_work_item_id, workspace_id)
    references public.mission_work_items(id, workspace_id) on delete cascade;
alter table public.mission_fulfillments
  add constraint mission_fulfillments_workflow_workspace_fk
    foreign key (mission_workflow_id, workspace_id)
    references public.mission_workflows(id, workspace_id) on delete cascade;
alter table public.mission_workflow_events
  add constraint mission_events_workflow_workspace_fk
    foreign key (mission_workflow_id, workspace_id)
    references public.mission_workflows(id, workspace_id) on delete cascade,
  add constraint mission_events_item_workflow_workspace_fk
    foreign key (mission_work_item_id, mission_workflow_id, workspace_id)
    references public.mission_work_items(id, mission_workflow_id, workspace_id) on delete cascade;

alter table public.mission_draft_assets
  add column mission_workflow_id uuid not null,
  add column file_extension text not null,
  add constraint mission_draft_assets_extension_check
    check (file_extension in ('jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov', 'webm')),
  add constraint mission_draft_assets_mime_extension_check check (
    (mime_type = 'image/jpeg' and file_extension in ('jpg', 'jpeg')) or
    (mime_type = 'image/png' and file_extension = 'png') or
    (mime_type = 'image/webp' and file_extension = 'webp') or
    (mime_type = 'image/gif' and file_extension = 'gif') or
    (mime_type = 'video/mp4' and file_extension = 'mp4') or
    (mime_type = 'video/quicktime' and file_extension = 'mov') or
    (mime_type = 'video/webm' and file_extension = 'webm')
  ),
  add constraint mission_draft_assets_canonical_path_check check (
    storage_object_path = creator_id::text || '/' || mission_workflow_id::text || '/' || mission_work_item_id::text || '/' || id::text || '.' || file_extension
  ),
  add constraint mission_draft_assets_creator_workspace_fk
    foreign key (creator_id, workspace_id)
    references public.creators(id, workspace_id) on delete cascade,
  add constraint mission_draft_assets_workflow_workspace_fk
    foreign key (mission_workflow_id, workspace_id)
    references public.mission_workflows(id, workspace_id) on delete cascade,
  add constraint mission_draft_assets_item_workflow_workspace_fk
    foreign key (mission_work_item_id, mission_workflow_id, workspace_id)
    references public.mission_work_items(id, mission_workflow_id, workspace_id) on delete cascade;
create index mission_assets_workflow_workspace_idx
  on public.mission_draft_assets (mission_workflow_id, workspace_id);

drop policy mission_templates_creator_read on public.mission_deliverable_templates;
create policy mission_templates_creator_read on public.mission_deliverable_templates
  for select to authenticated using (exists (
    select 1 from public.mission_submissions s
    where s.mission_id = mission_deliverable_templates.mission_id
      and s.workspace_id = mission_deliverable_templates.workspace_id
      and s.creator_id = (select auth.uid())
  ));
drop policy mission_requirements_creator_read on public.mission_deliverable_requirements;
create policy mission_requirements_creator_read on public.mission_deliverable_requirements
  for select to authenticated using (exists (
    select 1 from public.mission_deliverable_templates t
    join public.mission_submissions s
      on s.mission_id = t.mission_id and s.workspace_id = t.workspace_id
    where t.id = mission_deliverable_requirements.mission_deliverable_template_id
      and t.workspace_id = mission_deliverable_requirements.workspace_id
      and s.creator_id = (select auth.uid())
  ));
drop policy mission_workflows_creator_read on public.mission_workflows;
create policy mission_workflows_creator_read on public.mission_workflows
  for select to authenticated using (exists (
    select 1 from public.mission_submissions s
    where s.id = mission_workflows.mission_submission_id
      and s.workspace_id = mission_workflows.workspace_id
      and s.creator_id = (select auth.uid())
  ));
drop policy mission_work_items_creator_read on public.mission_work_items;
create policy mission_work_items_creator_read on public.mission_work_items
  for select to authenticated using (exists (
    select 1 from public.mission_workflows w
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where w.id = mission_work_items.mission_workflow_id
      and w.workspace_id = mission_work_items.workspace_id
      and s.creator_id = (select auth.uid())
  ));
drop policy mission_working_drafts_creator_read on public.mission_working_drafts;
create policy mission_working_drafts_creator_read on public.mission_working_drafts
  for select to authenticated using (exists (
    select 1 from public.mission_work_items i
    join public.mission_workflows w
      on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where i.id = mission_working_drafts.mission_work_item_id
      and i.workspace_id = mission_working_drafts.workspace_id
      and s.creator_id = (select auth.uid())
  ));
drop policy mission_versions_creator_read on public.mission_draft_versions;
create policy mission_versions_creator_read on public.mission_draft_versions
  for select to authenticated using (exists (
    select 1 from public.mission_work_items i
    join public.mission_workflows w
      on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where i.id = mission_draft_versions.mission_work_item_id
      and i.workspace_id = mission_draft_versions.workspace_id
      and s.creator_id = (select auth.uid())
  ));
drop policy mission_assets_creator_read on public.mission_draft_assets;
create policy mission_assets_creator_read on public.mission_draft_assets
  for select to authenticated using (exists (
    select 1 from public.creators c
    join public.mission_work_items i
      on i.id = mission_draft_assets.mission_work_item_id
      and i.mission_workflow_id = mission_draft_assets.mission_workflow_id
      and i.workspace_id = mission_draft_assets.workspace_id
    join public.mission_workflows w
      on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where c.id = mission_draft_assets.creator_id
      and c.workspace_id = mission_draft_assets.workspace_id
      and s.creator_id = c.id
      and c.id = (select auth.uid())
  ));
drop policy mission_reviews_creator_read on public.mission_review_rounds;
create policy mission_reviews_creator_read on public.mission_review_rounds
  for select to authenticated using (exists (
    select 1 from public.mission_work_items i
    join public.mission_workflows w
      on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where i.id = mission_review_rounds.mission_work_item_id
      and i.workspace_id = mission_review_rounds.workspace_id
      and s.creator_id = (select auth.uid())
  ));
drop policy mission_review_items_creator_read on public.mission_review_items;
create policy mission_review_items_creator_read on public.mission_review_items
  for select to authenticated using (exists (
    select 1 from public.mission_review_rounds r
    join public.mission_work_items i
      on i.id = r.mission_work_item_id and i.workspace_id = r.workspace_id
    join public.mission_workflows w
      on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where r.id = mission_review_items.mission_review_round_id
      and r.workspace_id = mission_review_items.workspace_id
      and s.creator_id = (select auth.uid())
  ));
drop policy mission_revision_grants_creator_read on public.mission_revision_grants;
create policy mission_revision_grants_creator_read on public.mission_revision_grants
  for select to authenticated using (exists (
    select 1 from public.mission_work_items i
    join public.mission_workflows w
      on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where i.id = mission_revision_grants.mission_work_item_id
      and i.workspace_id = mission_revision_grants.workspace_id
      and s.creator_id = (select auth.uid())
  ));
drop policy mission_fulfillments_creator_read on public.mission_fulfillments;
create policy mission_fulfillments_creator_read on public.mission_fulfillments
  for select to authenticated using (exists (
    select 1 from public.mission_workflows w
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where w.id = mission_fulfillments.mission_workflow_id
      and w.workspace_id = mission_fulfillments.workspace_id
      and s.creator_id = (select auth.uid())
  ));
drop policy mission_events_creator_read on public.mission_workflow_events;
create policy mission_events_creator_read on public.mission_workflow_events
  for select to authenticated using (exists (
    select 1 from public.mission_workflows w
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where w.id = mission_workflow_events.mission_workflow_id
      and w.workspace_id = mission_workflow_events.workspace_id
      and s.creator_id = (select auth.uid())
  ));

drop policy mission_draft_assets_storage_read on storage.objects;
drop policy mission_draft_assets_storage_insert on storage.objects;
drop policy mission_draft_assets_storage_update on storage.objects;
drop policy mission_draft_assets_storage_delete on storage.objects;
create policy mission_draft_assets_storage_read on storage.objects
  for select to authenticated using (
    bucket_id = 'mission-draft-assets' and exists (
      select 1 from public.mission_draft_assets a
      where a.storage_object_path = name
        and name = a.creator_id::text || '/' || a.mission_workflow_id::text || '/' || a.mission_work_item_id::text || '/' || a.id::text || '.' || a.file_extension
        and a.creator_id = (select auth.uid())
    )
  );
create policy mission_draft_assets_storage_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'mission-draft-assets' and exists (
      select 1 from public.mission_draft_assets a
      where a.storage_object_path = name
        and name = a.creator_id::text || '/' || a.mission_workflow_id::text || '/' || a.mission_work_item_id::text || '/' || a.id::text || '.' || a.file_extension
        and a.creator_id = (select auth.uid()) and a.upload_state = 'pending'
    )
  );
create policy mission_draft_assets_storage_update on storage.objects
  for update to authenticated using (
    bucket_id = 'mission-draft-assets' and exists (
      select 1 from public.mission_draft_assets a
      where a.storage_object_path = name
        and name = a.creator_id::text || '/' || a.mission_workflow_id::text || '/' || a.mission_work_item_id::text || '/' || a.id::text || '.' || a.file_extension
        and a.creator_id = (select auth.uid()) and a.upload_state in ('pending', 'uploaded')
    )
  ) with check (
    bucket_id = 'mission-draft-assets' and exists (
      select 1 from public.mission_draft_assets a
      where a.storage_object_path = name
        and name = a.creator_id::text || '/' || a.mission_workflow_id::text || '/' || a.mission_work_item_id::text || '/' || a.id::text || '.' || a.file_extension
        and a.creator_id = (select auth.uid()) and a.upload_state in ('pending', 'uploaded')
    )
  );
create policy mission_draft_assets_storage_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'mission-draft-assets' and exists (
      select 1 from public.mission_draft_assets a
      where a.storage_object_path = name
        and name = a.creator_id::text || '/' || a.mission_workflow_id::text || '/' || a.mission_work_item_id::text || '/' || a.id::text || '.' || a.file_extension
        and a.creator_id = (select auth.uid()) and a.mission_draft_version_id is null
    )
  );

create or replace function private.refresh_mission_workflow_state(p_workflow uuid)
returns public.mission_workflows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workflow public.mission_workflows;
  v_state text;
  v_actor uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
begin
  select w.* into v_workflow
  from public.mission_workflows w
  join public.mission_submissions s
    on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
  where w.id = p_workflow
    and (v_service or exists (
      select 1 from public.creators c
      where c.id = v_actor and c.id = s.creator_id and c.workspace_id = w.workspace_id
    ))
  for update of w;
  if v_workflow.id is null then raise exception 'not_found'; end if;
  if v_workflow.state in ('cancelled', 'expired') then return v_workflow; end if;

  if exists (
    select 1 from public.mission_fulfillments f
    where f.mission_workflow_id = v_workflow.id
      and f.workspace_id = v_workflow.workspace_id
      and f.status <> 'received'
  ) then
    v_state := 'fulfillment_pending';
  elsif not exists (
    select 1 from public.mission_work_items i
    where i.mission_workflow_id = v_workflow.id
      and i.workspace_id = v_workflow.workspace_id
      and i.required and i.state <> 'approved_to_publish'
  ) then
    v_state := 'approved_to_publish';
  elsif exists (
    select 1 from public.mission_work_items i
    where i.mission_workflow_id = v_workflow.id
      and i.workspace_id = v_workflow.workspace_id
      and i.state = 'revision_requested'
  ) then
    v_state := 'revision_requested';
  elsif exists (
    select 1 from public.mission_work_items i
    where i.mission_workflow_id = v_workflow.id
      and i.workspace_id = v_workflow.workspace_id
      and i.state in ('submitted', 'under_review')
  ) then
    v_state := 'in_review';
  else
    v_state := 'drafting';
  end if;

  update public.mission_workflows
  set state = v_state, updated_at = now()
  where id = v_workflow.id and workspace_id = v_workflow.workspace_id
  returning * into v_workflow;
  return v_workflow;
end;
$$;

create or replace function private.create_mission_workflow(p_submission uuid)
returns public.mission_workflows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
  v_submission public.mission_submissions;
  v_mission public.missions;
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_template record;
  v_required_count integer;
  v_initial_item_state text;
  v_accepted_at timestamptz := now();
begin
  if v_creator is null and not v_service then raise exception 'not_authenticated'; end if;

  select s.* into v_submission
  from public.mission_submissions s
  where s.id = p_submission
    and (v_service or exists (
      select 1 from public.creators c
      where c.id = v_creator and c.id = s.creator_id and c.workspace_id = s.workspace_id
    ))
  for update;
  if v_submission.id is null then raise exception 'not_found'; end if;

  select * into v_workflow
  from public.mission_workflows
  where mission_submission_id = v_submission.id
    and workspace_id = v_submission.workspace_id;
  if v_workflow.id is not null then
    return private.refresh_mission_workflow_state(v_workflow.id);
  end if;

  if v_submission.status <> 'joined' then raise exception 'wrong_state'; end if;
  select * into v_mission from public.missions
  where id = v_submission.mission_id and workspace_id = v_submission.workspace_id;
  if v_mission.id is null then raise exception 'workspace_mismatch'; end if;
  if v_mission.creator_workflow_mode <> 'active_workspace' then raise exception 'legacy_mission'; end if;

  select count(*) into v_required_count
  from public.mission_deliverable_templates
  where mission_id = v_mission.id and workspace_id = v_mission.workspace_id and required;
  if v_required_count = 0 then raise exception 'required_deliverable_missing'; end if;

  insert into public.mission_workflows (
    workspace_id, mission_submission_id, state, accepted_at, deadline,
    fulfillment_required, revision_limit, review_sla_hours, revision_response_hours
  ) values (
    v_submission.workspace_id, v_submission.id, 'accepted', v_accepted_at,
    v_mission.deadline::timestamptz, v_mission.fulfillment_required,
    v_mission.revision_limit, v_mission.review_sla_hours, v_mission.revision_response_hours
  )
  on conflict (mission_submission_id) do nothing
  returning * into v_workflow;

  if v_workflow.id is null then
    select * into v_workflow from public.mission_workflows
    where mission_submission_id = v_submission.id and workspace_id = v_submission.workspace_id;
    return private.refresh_mission_workflow_state(v_workflow.id);
  end if;

  v_initial_item_state := case when v_workflow.fulfillment_required
    then 'blocked_by_fulfillment' else 'drafting' end;

  for v_template in
    select t.*, coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'category', r.category, 'text', r.requirement_text,
        'required', r.required, 'position', r.position
      ) order by r.position, r.id)
      from public.mission_deliverable_requirements r
      where r.mission_deliverable_template_id = t.id and r.workspace_id = t.workspace_id
    ), '[]'::jsonb) as requirement_snapshot
    from public.mission_deliverable_templates t
    where t.mission_id = v_mission.id and t.workspace_id = v_mission.workspace_id
    order by t.position, t.id
  loop
    insert into public.mission_work_items (
      workspace_id, mission_workflow_id, source_template_id, title, platform,
      requirements_snapshot, required, position, deadline, state
    ) values (
      v_submission.workspace_id, v_workflow.id, v_template.id, v_template.title,
      v_template.platform, v_template.requirement_snapshot, v_template.required,
      v_template.position,
      case when v_template.draft_due_offset_hours is null then v_workflow.deadline
           else least(
             v_accepted_at + make_interval(hours => v_template.draft_due_offset_hours),
             coalesce(v_workflow.deadline, 'infinity'::timestamptz)
           ) end,
      v_initial_item_state
    ) returning * into v_item;
    insert into public.mission_working_drafts (workspace_id, mission_work_item_id)
    values (v_submission.workspace_id, v_item.id);
  end loop;

  if v_workflow.fulfillment_required then
    insert into public.mission_fulfillments (workspace_id, mission_workflow_id, status)
    values (v_submission.workspace_id, v_workflow.id, 'preparing');
  end if;
  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, actor_type, actor_id, event_type,
    entity_type, entity_id, metadata
  ) values (
    v_submission.workspace_id, v_workflow.id,
    case when v_creator is null then 'system' else 'creator' end,
    v_creator, 'workflow_created', 'mission_workflow', v_workflow.id,
    jsonb_build_object('fulfillment_required', v_workflow.fulfillment_required)
  );
  return private.refresh_mission_workflow_state(v_workflow.id);
end;
$$;

create or replace function public.refresh_mission_workflow_state(p_workflow uuid)
returns public.mission_workflows language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
begin
  if not v_service and not exists (
    select 1 from public.mission_workflows w
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    join public.creators c
      on c.id = s.creator_id and c.workspace_id = s.workspace_id
    where w.id = p_workflow and c.id = v_actor
  ) then raise exception 'not_found'; end if;
  return private.refresh_mission_workflow_state(p_workflow);
end;
$$;

create or replace function public.create_mission_workflow(p_submission uuid)
returns public.mission_workflows language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
begin
  if not v_service and not exists (
    select 1 from public.mission_submissions s
    join public.creators c on c.id = s.creator_id and c.workspace_id = s.workspace_id
    where s.id = p_submission and c.id = v_actor
  ) then raise exception 'not_found'; end if;
  return private.create_mission_workflow(p_submission);
end;
$$;

revoke all on function private.refresh_mission_workflow_state(uuid) from public, anon, authenticated, service_role;
revoke all on function private.create_mission_workflow(uuid) from public, anon, authenticated, service_role;
revoke all on function private.raise_immutable_record() from public, anon, authenticated, service_role;
revoke all on function private.guard_completed_review_round() from public, anon, authenticated, service_role;
revoke all on function private.guard_finalized_mission_asset() from public, anon, authenticated, service_role;
revoke usage on schema private from public, anon, authenticated;
revoke all on function public.refresh_mission_workflow_state(uuid) from public, anon;
revoke all on function public.create_mission_workflow(uuid) from public, anon;
grant execute on function public.refresh_mission_workflow_state(uuid) to authenticated, service_role;
grant execute on function public.create_mission_workflow(uuid) to authenticated, service_role;

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in (
        'refresh_mission_workflow_state',
        'create_mission_workflow',
        'raise_immutable_record',
        'guard_completed_review_round',
        'guard_finalized_mission_asset'
      )
      and (
        has_function_privilege('anon', p.oid, 'EXECUTE') or
        has_function_privilege('authenticated', p.oid, 'EXECUTE') or
        has_function_privilege('service_role', p.oid, 'EXECUTE')
      )
  ) then raise exception 'private_function_execute_exposed'; end if;
end;
$$;

-- Preserve the original nullable source-template behavior without allowing a
-- composite SET NULL action to clear the non-null workspace_id column.
alter table public.mission_work_items
  drop constraint mission_work_items_template_workspace_fk,
  add constraint mission_work_items_template_workspace_fk
    foreign key (source_template_id, workspace_id)
    references public.mission_deliverable_templates(id, workspace_id);
