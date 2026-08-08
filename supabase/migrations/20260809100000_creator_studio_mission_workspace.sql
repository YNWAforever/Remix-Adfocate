-- Creator Studio owns the execution workflow separately from the legacy
-- mission_submissions lifecycle. Creator writes remain RPC/service-only.

alter table public.creators
  add constraint creators_id_workspace_key unique (id, workspace_id);
alter table public.mission_submissions
  add constraint mission_submissions_id_workspace_key unique (id, workspace_id);
alter table public.mission_submissions
  add constraint mission_submissions_id_creator_workspace_key unique (id, creator_id, workspace_id);

create table public.mission_workflows (
  id uuid primary key default gen_random_uuid(),
  mission_submission_id uuid not null,
  creator_id uuid not null,
  workspace_id uuid not null,
  state text not null default 'not_started' check (state in ('not_started','drafting','ready_to_submit','submitted','changes_requested','resubmitted','approved')),
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (mission_submission_id, workspace_id),
  constraint mission_workflows_id_submission_creator_workspace_key unique (id, mission_submission_id, creator_id, workspace_id),
  foreign key (mission_submission_id, workspace_id) references public.mission_submissions(id, workspace_id) on delete cascade,
  constraint mission_workflows_submission_lineage_fk foreign key (mission_submission_id, creator_id, workspace_id) references public.mission_submissions(id, creator_id, workspace_id) on delete cascade,
  foreign key (creator_id, workspace_id) references public.creators(id, workspace_id) on delete cascade
);

create table public.mission_work_items (
  id uuid primary key default gen_random_uuid(),
  mission_workflow_id uuid not null,
  mission_submission_id uuid not null,
  creator_id uuid not null,
  workspace_id uuid not null,
  position integer not null check (position > 0),
  title text not null,
  instructions text not null default '',
  requirements jsonb not null default '{}'::jsonb,
  requires_asset boolean not null default false,
  state text not null default 'not_started' check (state in ('not_started','drafting','ready_to_submit','submitted','changes_requested','resubmitted','approved')),
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (mission_workflow_id, position, workspace_id),
  constraint mission_work_items_id_workflow_submission_creator_workspace_key unique (id, mission_workflow_id, mission_submission_id, creator_id, workspace_id),
  foreign key (mission_workflow_id, workspace_id) references public.mission_workflows(id, workspace_id) on delete cascade,
  constraint mission_work_items_workflow_lineage_fk foreign key (mission_workflow_id, mission_submission_id, creator_id, workspace_id) references public.mission_workflows(id, mission_submission_id, creator_id, workspace_id) on delete cascade,
  foreign key (mission_submission_id, workspace_id) references public.mission_submissions(id, workspace_id) on delete cascade,
  foreign key (creator_id, workspace_id) references public.creators(id, workspace_id) on delete cascade
);

create table public.mission_working_drafts (
  id uuid primary key default gen_random_uuid(),
  mission_work_item_id uuid not null,
  mission_workflow_id uuid not null,
  mission_submission_id uuid not null,
  creator_id uuid not null,
  workspace_id uuid not null,
  caption text,
  external_url text,
  checklist jsonb not null default '{}'::jsonb,
  version integer not null default 0 check (version >= 0),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (mission_work_item_id, workspace_id),
  foreign key (mission_work_item_id, workspace_id) references public.mission_work_items(id, workspace_id) on delete cascade,
  constraint mission_working_drafts_item_lineage_fk foreign key (mission_work_item_id, mission_workflow_id, mission_submission_id, creator_id, workspace_id) references public.mission_work_items(id, mission_workflow_id, mission_submission_id, creator_id, workspace_id) on delete cascade,
  foreign key (mission_workflow_id, workspace_id) references public.mission_workflows(id, workspace_id) on delete cascade,
  foreign key (mission_submission_id, workspace_id) references public.mission_submissions(id, workspace_id) on delete cascade,
  foreign key (creator_id, workspace_id) references public.creators(id, workspace_id) on delete cascade
);

create table public.mission_draft_versions (
  id uuid primary key default gen_random_uuid(),
  mission_work_item_id uuid not null,
  mission_workflow_id uuid not null,
  mission_submission_id uuid not null,
  creator_id uuid not null,
  workspace_id uuid not null,
  version integer not null check (version > 0),
  caption text,
  external_url text,
  checklist jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (mission_work_item_id, version, workspace_id),
  foreign key (mission_work_item_id, workspace_id) references public.mission_work_items(id, workspace_id) on delete cascade,
  constraint mission_draft_versions_item_lineage_fk foreign key (mission_work_item_id, mission_workflow_id, mission_submission_id, creator_id, workspace_id) references public.mission_work_items(id, mission_workflow_id, mission_submission_id, creator_id, workspace_id) on delete cascade,
  foreign key (mission_workflow_id, workspace_id) references public.mission_workflows(id, workspace_id) on delete cascade,
  foreign key (mission_submission_id, workspace_id) references public.mission_submissions(id, workspace_id) on delete cascade,
  foreign key (creator_id, workspace_id) references public.creators(id, workspace_id) on delete cascade
);

create table public.mission_draft_assets (
  id uuid primary key default gen_random_uuid(),
  mission_work_item_id uuid not null,
  mission_workflow_id uuid not null,
  mission_submission_id uuid not null,
  creator_id uuid not null,
  workspace_id uuid not null,
  storage_object_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0),
  checksum_sha256 text,
  upload_state text not null default 'pending' check (upload_state in ('pending','finalized','abandoned')),
  upload_grant_expires_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (mission_work_item_id, workspace_id) references public.mission_work_items(id, workspace_id) on delete cascade,
  constraint mission_draft_assets_item_lineage_fk foreign key (mission_work_item_id, mission_workflow_id, mission_submission_id, creator_id, workspace_id) references public.mission_work_items(id, mission_workflow_id, mission_submission_id, creator_id, workspace_id) on delete cascade,
  foreign key (mission_workflow_id, workspace_id) references public.mission_workflows(id, workspace_id) on delete cascade,
  foreign key (mission_submission_id, workspace_id) references public.mission_submissions(id, workspace_id) on delete cascade,
  foreign key (creator_id, workspace_id) references public.creators(id, workspace_id) on delete cascade
);

create table public.mission_review_rounds (
  id uuid primary key default gen_random_uuid(),
  mission_workflow_id uuid not null,
  mission_submission_id uuid not null,
  creator_id uuid not null,
  workspace_id uuid not null,
  outcome text not null check (outcome in ('changes_requested','approved')),
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (id, mission_workflow_id, mission_submission_id, creator_id, workspace_id),
  foreign key (mission_workflow_id, workspace_id) references public.mission_workflows(id, workspace_id) on delete cascade,
  constraint mission_review_rounds_workflow_lineage_fk foreign key (mission_workflow_id, mission_submission_id, creator_id, workspace_id) references public.mission_workflows(id, mission_submission_id, creator_id, workspace_id) on delete cascade,
  foreign key (mission_submission_id, workspace_id) references public.mission_submissions(id, workspace_id) on delete cascade,
  foreign key (creator_id, workspace_id) references public.creators(id, workspace_id) on delete cascade
);

create table public.mission_review_items (
  id uuid primary key default gen_random_uuid(),
  mission_review_round_id uuid not null,
  mission_work_item_id uuid not null,
  mission_workflow_id uuid not null,
  mission_submission_id uuid not null,
  creator_id uuid not null,
  workspace_id uuid not null,
  outcome text not null check (outcome in ('changes_requested','approved')),
  message text not null,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (mission_review_round_id, workspace_id) references public.mission_review_rounds(id, workspace_id) on delete cascade,
  constraint mission_review_items_round_lineage_fk foreign key (mission_review_round_id, mission_workflow_id, mission_submission_id, creator_id, workspace_id) references public.mission_review_rounds(id, mission_workflow_id, mission_submission_id, creator_id, workspace_id) on delete cascade,
  foreign key (mission_work_item_id, workspace_id) references public.mission_work_items(id, workspace_id) on delete cascade,
  constraint mission_review_items_item_lineage_fk foreign key (mission_work_item_id, mission_workflow_id, mission_submission_id, creator_id, workspace_id) references public.mission_work_items(id, mission_workflow_id, mission_submission_id, creator_id, workspace_id) on delete cascade,
  foreign key (mission_workflow_id, workspace_id) references public.mission_workflows(id, workspace_id) on delete cascade,
  foreign key (mission_submission_id, workspace_id) references public.mission_submissions(id, workspace_id) on delete cascade,
  foreign key (creator_id, workspace_id) references public.creators(id, workspace_id) on delete cascade
);

create table public.mission_workflow_commands (
  id uuid primary key default gen_random_uuid(),
  mission_submission_id uuid not null,
  actor_id uuid not null,
  creator_id uuid not null,
  workspace_id uuid not null,
  command_id text not null,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (mission_submission_id, actor_id, command_id),
  constraint mission_workflow_commands_actor_is_creator check (actor_id = creator_id),
  constraint mission_workflow_commands_submission_creator_lineage_fk foreign key (mission_submission_id, creator_id, workspace_id) references public.mission_submissions(id, creator_id, workspace_id) on delete cascade
);

create table public.mission_workflow_events (
  id uuid primary key default gen_random_uuid(),
  mission_workflow_id uuid not null,
  mission_work_item_id uuid,
  mission_submission_id uuid not null,
  creator_id uuid not null,
  workspace_id uuid not null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (mission_workflow_id, workspace_id) references public.mission_workflows(id, workspace_id) on delete cascade,
  constraint mission_workflow_events_workflow_lineage_fk foreign key (mission_workflow_id, mission_submission_id, creator_id, workspace_id) references public.mission_workflows(id, mission_submission_id, creator_id, workspace_id) on delete cascade,
  foreign key (mission_work_item_id, workspace_id) references public.mission_work_items(id, workspace_id) on delete cascade,
  constraint mission_workflow_events_item_lineage_fk foreign key (mission_work_item_id, mission_workflow_id, mission_submission_id, creator_id, workspace_id) references public.mission_work_items(id, mission_workflow_id, mission_submission_id, creator_id, workspace_id) on delete cascade,
  foreign key (mission_submission_id, workspace_id) references public.mission_submissions(id, workspace_id) on delete cascade,
  foreign key (creator_id, workspace_id) references public.creators(id, workspace_id) on delete cascade
);

-- Composite lineage keys bind every descendant to its exact submission,
-- workflow, and work item; the existing workspace-pair keys remain for
-- publication-proof relationships created by earlier migrations.

create index mission_workflows_owner_idx on public.mission_workflows (workspace_id, creator_id, mission_submission_id);
create index mission_work_items_owner_idx on public.mission_work_items (workspace_id, creator_id, mission_submission_id);
create index mission_working_drafts_owner_idx on public.mission_working_drafts (workspace_id, creator_id, mission_submission_id);
create index mission_draft_versions_owner_idx on public.mission_draft_versions (workspace_id, creator_id, mission_submission_id);
create index mission_draft_assets_owner_idx on public.mission_draft_assets (workspace_id, creator_id, mission_submission_id);
create index mission_review_rounds_owner_idx on public.mission_review_rounds (workspace_id, creator_id, mission_submission_id);
create index mission_review_items_owner_idx on public.mission_review_items (workspace_id, creator_id, mission_submission_id);
create index mission_workflow_commands_owner_idx on public.mission_workflow_commands (workspace_id, creator_id, mission_submission_id);
create index mission_workflow_events_owner_idx on public.mission_workflow_events (workspace_id, creator_id, mission_submission_id);

alter table public.mission_workflows enable row level security;
alter table public.mission_work_items enable row level security;
alter table public.mission_working_drafts enable row level security;
alter table public.mission_draft_versions enable row level security;
alter table public.mission_draft_assets enable row level security;
alter table public.mission_review_rounds enable row level security;
alter table public.mission_review_items enable row level security;
alter table public.mission_workflow_commands enable row level security;
alter table public.mission_workflow_events enable row level security;

create policy mission_workflows_creator_read on public.mission_workflows for select to authenticated using (creator_id = (select auth.uid()));
create policy mission_work_items_creator_read on public.mission_work_items for select to authenticated using (creator_id = (select auth.uid()));
create policy mission_working_drafts_creator_read on public.mission_working_drafts for select to authenticated using (creator_id = (select auth.uid()));
create policy mission_draft_versions_creator_read on public.mission_draft_versions for select to authenticated using (creator_id = (select auth.uid()));
create policy mission_draft_assets_creator_read on public.mission_draft_assets for select to authenticated using (creator_id = (select auth.uid()));
create policy mission_review_rounds_creator_read on public.mission_review_rounds for select to authenticated using (creator_id = (select auth.uid()));
create policy mission_review_items_creator_read on public.mission_review_items for select to authenticated using (creator_id = (select auth.uid()));
create policy mission_workflow_commands_creator_read on public.mission_workflow_commands for select to authenticated using (creator_id = (select auth.uid()));
create policy mission_workflow_events_creator_read on public.mission_workflow_events for select to authenticated using (creator_id = (select auth.uid()));

grant select on public.mission_workflows to authenticated;
grant select on public.mission_work_items to authenticated;
grant select on public.mission_working_drafts to authenticated;
grant select on public.mission_draft_versions to authenticated;
grant select on public.mission_draft_assets to authenticated;
grant select on public.mission_review_rounds to authenticated;
grant select on public.mission_review_items to authenticated;
grant select on public.mission_workflow_commands to authenticated;
grant select on public.mission_workflow_events to authenticated;
grant all on public.mission_workflows to service_role;
grant all on public.mission_work_items to service_role;
grant all on public.mission_working_drafts to service_role;
grant all on public.mission_draft_versions to service_role;
grant all on public.mission_draft_assets to service_role;
grant all on public.mission_review_rounds to service_role;
grant all on public.mission_review_items to service_role;
grant all on public.mission_workflow_commands to service_role;
grant all on public.mission_workflow_events to service_role;

create or replace function public.reject_creator_studio_immutable_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end;
$$;

create trigger mission_draft_versions_append_only
  before update or delete or truncate on public.mission_draft_versions
  for each statement execute function public.reject_creator_studio_immutable_mutation();
create trigger mission_review_rounds_append_only
  before update or delete or truncate on public.mission_review_rounds
  for each statement execute function public.reject_creator_studio_immutable_mutation();
create trigger mission_review_items_append_only
  before update or delete or truncate on public.mission_review_items
  for each statement execute function public.reject_creator_studio_immutable_mutation();
create trigger mission_workflow_events_append_only
  before update or delete or truncate on public.mission_workflow_events
  for each statement execute function public.reject_creator_studio_immutable_mutation();

create or replace function public.require_creator_studio_asset_work_item_editable()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_work_item public.mission_work_items;
begin
  select * into v_work_item
  from public.mission_work_items
  where id = new.mission_work_item_id
    and mission_workflow_id = new.mission_workflow_id
    and mission_submission_id = new.mission_submission_id
    and creator_id = new.creator_id
    and workspace_id = new.workspace_id
  for update;

  if v_work_item.id is null then raise exception 'work_item_not_found'; end if;
  if v_work_item.state not in ('not_started', 'drafting', 'ready_to_submit', 'changes_requested') then
    raise exception 'invalid_transition' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger mission_draft_assets_editable_work_item
  before insert or update of upload_state on public.mission_draft_assets
  for each row execute function public.require_creator_studio_asset_work_item_editable();

insert into storage.buckets (id, name, public) values ('creator-studio-assets', 'creator-studio-assets', false)
on conflict (id) do nothing;
create policy creator_studio_assets_read on storage.objects for select to authenticated using (
  bucket_id = 'creator-studio-assets' and exists (
    select 1 from public.mission_draft_assets asset
    where asset.storage_object_path = name and asset.creator_id = (select auth.uid()) and asset.upload_state = 'finalized'
  )
);
create policy creator_studio_assets_pending_read on storage.objects for select to authenticated using (
  bucket_id = 'creator-studio-assets' and owner_id = (select auth.uid()::text) and exists (
    select 1 from public.mission_draft_assets asset
    where asset.storage_object_path = name and asset.creator_id = (select auth.uid())
      and asset.upload_state = 'pending' and asset.upload_grant_expires_at > now()
  )
);
create policy creator_studio_assets_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'creator-studio-assets' and exists (
    select 1 from public.mission_draft_assets asset
    where asset.storage_object_path = name and asset.creator_id = (select auth.uid())
      and asset.upload_state = 'pending' and asset.upload_grant_expires_at > now()
  )
);
create policy creator_studio_assets_update on storage.objects for update to authenticated using (
  bucket_id = 'creator-studio-assets' and owner_id = (select auth.uid()::text) and exists (
    select 1 from public.mission_draft_assets asset
    where asset.storage_object_path = name and asset.creator_id = (select auth.uid())
      and asset.upload_state = 'pending' and asset.upload_grant_expires_at > now()
  )
) with check (
  bucket_id = 'creator-studio-assets' and owner_id = (select auth.uid()::text) and exists (
    select 1 from public.mission_draft_assets asset
    where asset.storage_object_path = name and asset.creator_id = (select auth.uid())
      and asset.upload_state = 'pending' and asset.upload_grant_expires_at > now()
  )
);

create or replace function public.refresh_creator_studio_state(p_mission_workflow_id uuid)
returns public.mission_workflows
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_workflow public.mission_workflows;
  v_states text[];
  v_state text;
begin
  select * into v_workflow from public.mission_workflows where id = p_mission_workflow_id for update;
  if v_workflow.id is null then raise exception 'workflow_not_found'; end if;
  select array_agg(state) into v_states from (
    select state from public.mission_work_items where mission_workflow_id = v_workflow.id for update
  ) locked_items;
  v_state := case
    when 'changes_requested' = any(coalesce(v_states, '{}'::text[])) then 'changes_requested'
    when cardinality(v_states) > 0 and (select bool_and(item_state = 'approved') from unnest(v_states) item_state) then 'approved'
    when 'resubmitted' = any(coalesce(v_states, '{}'::text[])) then 'resubmitted'
    when 'submitted' = any(coalesce(v_states, '{}'::text[])) then 'submitted'
    when 'ready_to_submit' = any(coalesce(v_states, '{}'::text[])) then 'ready_to_submit'
    when 'drafting' = any(coalesce(v_states, '{}'::text[])) then 'drafting'
    else 'not_started'
  end;
  update public.mission_workflows set state = v_state, revision = revision + 1, updated_at = now()
    where id = v_workflow.id returning * into v_workflow;
  return v_workflow;
end;
$$;

create or replace function public.initialize_creator_studio_workflow(p_mission_submission_id uuid)
returns public.mission_workflows
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_submission public.mission_submissions;
  v_mission public.missions;
  v_workflow public.mission_workflows;
  v_deliverable text;
  v_position integer;
begin
  select * into v_submission from public.mission_submissions where id = p_mission_submission_id for update;
  if v_submission.id is null then raise exception 'submission_not_found'; end if;
  if v_submission.status <> 'joined' then raise exception 'invalid_submission_status'; end if;
  select * into v_mission from public.missions where id = v_submission.mission_id and workspace_id = v_submission.workspace_id;
  if v_mission.id is null then raise exception 'mission_not_found'; end if;
  insert into public.mission_workflows (mission_submission_id, creator_id, workspace_id)
  values (v_submission.id, v_submission.creator_id, v_submission.workspace_id)
  on conflict (mission_submission_id, workspace_id) do update set updated_at = public.mission_workflows.updated_at
  returning * into v_workflow;
  if exists (select 1 from public.mission_work_items where mission_workflow_id = v_workflow.id) then return v_workflow; end if;
  if coalesce(array_length(v_mission.deliverables, 1), 0) = 0 then
    insert into public.mission_work_items (mission_workflow_id, mission_submission_id, creator_id, workspace_id, position, title, requirements)
    values (v_workflow.id, v_submission.id, v_submission.creator_id, v_submission.workspace_id, 1, v_mission.title,
      jsonb_build_object('requirements', to_jsonb(v_mission.requirements), 'platforms', to_jsonb(v_mission.platforms)));
  else
    for v_deliverable, v_position in select deliverable, ordinal::integer from unnest(v_mission.deliverables) with ordinality as source(deliverable, ordinal) loop
      insert into public.mission_work_items (mission_workflow_id, mission_submission_id, creator_id, workspace_id, position, title, requirements)
      values (v_workflow.id, v_submission.id, v_submission.creator_id, v_submission.workspace_id, v_position, v_deliverable,
        jsonb_build_object('requirements', to_jsonb(v_mission.requirements), 'platforms', to_jsonb(v_mission.platforms)));
    end loop;
  end if;
  return public.refresh_creator_studio_state(v_workflow.id);
end;
$$;

create or replace function public.on_joined_creator_studio_workflow()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.status = 'joined' then perform public.initialize_creator_studio_workflow(new.id); end if;
  return new;
end;
$$;
create trigger mission_submissions_initialize_creator_studio
  after insert or update of status on public.mission_submissions
  for each row when (new.status = 'joined')
  execute function public.on_joined_creator_studio_workflow();

select public.initialize_creator_studio_workflow(id)
from public.mission_submissions
where status = 'joined';

revoke all on function public.initialize_creator_studio_workflow(uuid) from public, anon, authenticated;
revoke all on function public.refresh_creator_studio_state(uuid) from public, anon, authenticated;
grant execute on function public.initialize_creator_studio_workflow(uuid) to service_role;
grant execute on function public.refresh_creator_studio_state(uuid) to service_role;
