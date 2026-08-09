-- Creator Studio publication-proof contract.
-- Creator writes remain repository/RPC-only; authenticated clients receive reads only.

alter table public.missions
  add column deliverable_specs jsonb not null default '[]'::jsonb;

alter table public.mission_work_items
  add column proof_requirement jsonb;

create table public.mission_publication_proof_attempts (
  id uuid primary key default gen_random_uuid(),
  mission_work_item_id uuid not null,
  mission_workflow_id uuid not null,
  mission_submission_id uuid not null,
  creator_id uuid not null,
  workspace_id uuid not null,
  parent_attempt_id uuid,
  sequence integer not null check (sequence > 0),
  published_url text not null,
  platform text,
  state text not null default 'draft'
    check (state in ('draft','submitted','verified','changes_requested')),
  metadata_state text not null default 'pending'
    check (metadata_state in ('pending','available','unavailable','failed')),
  metadata jsonb,
  operator_message text,
  submitted_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (mission_work_item_id, sequence, workspace_id),
  constraint mission_publication_proof_attempts_item_lineage_fk
    foreign key (
      mission_work_item_id,
      mission_workflow_id,
      mission_submission_id,
      creator_id,
      workspace_id
    ) references public.mission_work_items(
      id,
      mission_workflow_id,
      mission_submission_id,
      creator_id,
      workspace_id
    ) on delete cascade,
  constraint mission_publication_proof_attempts_parent_lineage_fk
    foreign key (parent_attempt_id, workspace_id)
    references public.mission_publication_proof_attempts(id, workspace_id)
    on delete restrict,
  foreign key (mission_workflow_id, workspace_id)
    references public.mission_workflows(id, workspace_id) on delete cascade,
  foreign key (mission_submission_id, workspace_id)
    references public.mission_submissions(id, workspace_id) on delete cascade,
  foreign key (creator_id, workspace_id)
    references public.creators(id, workspace_id) on delete cascade
);

create table public.mission_publication_proof_assets (
  id uuid primary key default gen_random_uuid(),
  mission_publication_proof_attempt_id uuid,
  mission_submission_id uuid,
  mission_workflow_id uuid,
  mission_work_item_id uuid,
  creator_id uuid,
  workspace_id uuid not null,
  storage_object_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0),
  content_checksum text,
  upload_state text not null default 'pending'
    check (upload_state in ('pending','finalized','abandoned')),
  upload_grant_expires_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  constraint mission_publication_proof_assets_attempt_workspace_fk
    foreign key (mission_publication_proof_attempt_id, workspace_id)
    references public.mission_publication_proof_attempts(id, workspace_id)
    on delete cascade,
  constraint mission_publication_proof_assets_submission_workspace_fk
    foreign key (mission_submission_id, workspace_id)
    references public.mission_submissions(id, workspace_id)
    on delete cascade,
  constraint mission_publication_proof_assets_workflow_workspace_fk
    foreign key (mission_workflow_id, workspace_id)
    references public.mission_workflows(id, workspace_id)
    on delete cascade,
  constraint mission_publication_proof_assets_work_item_workspace_fk
    foreign key (mission_work_item_id, workspace_id)
    references public.mission_work_items(id, workspace_id)
    on delete cascade,
  constraint mission_publication_proof_assets_creator_workspace_fk
    foreign key (creator_id, workspace_id)
    references public.creators(id, workspace_id) on delete cascade,
  constraint mission_publication_proof_assets_pending_attempt_check
    check (upload_state = 'pending' or mission_publication_proof_attempt_id is not null)
);

create table public.mission_publication_proof_decisions (
  id uuid primary key default gen_random_uuid(),
  mission_publication_proof_attempt_id uuid not null,
  mission_work_item_id uuid not null,
  mission_workflow_id uuid not null,
  mission_submission_id uuid not null,
  creator_id uuid not null,
  workspace_id uuid not null,
  actor_id uuid not null,
  decision text not null check (decision in ('verified','changes_requested')),
  message text,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  constraint mission_publication_proof_decisions_attempt_lineage_fk
    foreign key (mission_publication_proof_attempt_id, workspace_id)
    references public.mission_publication_proof_attempts(id, workspace_id)
    on delete cascade,
  constraint mission_publication_proof_decisions_item_lineage_fk
    foreign key (
      mission_work_item_id,
      mission_workflow_id,
      mission_submission_id,
      creator_id,
      workspace_id
    ) references public.mission_work_items(
      id,
      mission_workflow_id,
      mission_submission_id,
      creator_id,
      workspace_id
    ) on delete cascade
);

create table public.mission_publication_proof_events (
  id uuid primary key default gen_random_uuid(),
  mission_publication_proof_attempt_id uuid,
  mission_work_item_id uuid not null,
  mission_workflow_id uuid not null,
  mission_submission_id uuid not null,
  creator_id uuid not null,
  workspace_id uuid not null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  constraint mission_publication_proof_events_attempt_lineage_fk
    foreign key (mission_publication_proof_attempt_id, workspace_id)
    references public.mission_publication_proof_attempts(id, workspace_id)
    on delete cascade,
  constraint mission_publication_proof_events_item_lineage_fk
    foreign key (
      mission_work_item_id,
      mission_workflow_id,
      mission_submission_id,
      creator_id,
      workspace_id
    ) references public.mission_work_items(
      id,
      mission_workflow_id,
      mission_submission_id,
      creator_id,
      workspace_id
    ) on delete cascade
);

create index mission_publication_proof_attempts_owner_idx
  on public.mission_publication_proof_attempts (workspace_id, creator_id, mission_submission_id, mission_work_item_id);
create index mission_publication_proof_attempts_sequence_idx
  on public.mission_publication_proof_attempts (mission_work_item_id, sequence desc);
create index mission_publication_proof_assets_owner_idx
  on public.mission_publication_proof_assets (workspace_id, creator_id, mission_work_item_id, upload_state);
create index mission_publication_proof_decisions_owner_idx
  on public.mission_publication_proof_decisions (workspace_id, creator_id, mission_submission_id);
create index mission_publication_proof_events_owner_idx
  on public.mission_publication_proof_events (workspace_id, creator_id, mission_submission_id);

alter table public.mission_publication_proof_attempts enable row level security;
alter table public.mission_publication_proof_assets enable row level security;
alter table public.mission_publication_proof_decisions enable row level security;
alter table public.mission_publication_proof_events enable row level security;

create policy mission_publication_proof_attempts_creator_read
  on public.mission_publication_proof_attempts for select to authenticated
  using (creator_id = (select auth.uid()));
create policy mission_publication_proof_assets_creator_read
  on public.mission_publication_proof_assets for select to authenticated
  using (creator_id = (select auth.uid()) and creator_id is not null);
create policy mission_publication_proof_decisions_creator_read
  on public.mission_publication_proof_decisions for select to authenticated
  using (creator_id = (select auth.uid()));
create policy mission_publication_proof_events_creator_read
  on public.mission_publication_proof_events for select to authenticated
  using (creator_id = (select auth.uid()));

grant select on public.mission_publication_proof_attempts to authenticated;
grant select on public.mission_publication_proof_assets to authenticated;
grant select on public.mission_publication_proof_decisions to authenticated;
grant select on public.mission_publication_proof_events to authenticated;

revoke insert, update, delete on public.mission_publication_proof_attempts from anon, authenticated;
revoke insert, update, delete on public.mission_publication_proof_assets from anon, authenticated;
revoke insert, update, delete on public.mission_publication_proof_decisions from anon, authenticated;
revoke insert, update, delete on public.mission_publication_proof_events from anon, authenticated;

grant all on public.mission_publication_proof_attempts to service_role;
grant all on public.mission_publication_proof_assets to service_role;
grant all on public.mission_publication_proof_decisions to service_role;
grant all on public.mission_publication_proof_events to service_role;

create or replace function public.reject_creator_studio_publication_proof_immutable_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'publication_proof_immutable' using errcode = '55000';
end;
$$;

create trigger mission_publication_proof_attempts_append_only
  before update or delete or truncate on public.mission_publication_proof_attempts
  for each statement execute function public.reject_creator_studio_publication_proof_immutable_mutation();
create trigger mission_publication_proof_assets_append_only
  before update or delete or truncate on public.mission_publication_proof_assets
  for each statement execute function public.reject_creator_studio_publication_proof_immutable_mutation();
create trigger mission_publication_proof_decisions_append_only
  before update or delete or truncate on public.mission_publication_proof_decisions
  for each statement execute function public.reject_creator_studio_publication_proof_immutable_mutation();
create trigger mission_publication_proof_events_append_only
  before update or delete or truncate on public.mission_publication_proof_events
  for each statement execute function public.reject_creator_studio_publication_proof_immutable_mutation();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mission-publication-proof-assets',
  'mission-publication-proof-assets',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy mission_publication_proof_assets_storage_read
  on storage.objects for select to authenticated using (
    bucket_id = 'mission-publication-proof-assets'
    and exists (
      select 1
      from public.mission_publication_proof_assets asset
      join public.mission_publication_proof_attempts attempt
        on attempt.id = asset.mission_publication_proof_attempt_id
       and attempt.workspace_id = asset.workspace_id
      where asset.storage_object_path = name
        and asset.creator_id = (select auth.uid())
        and asset.upload_state = 'finalized'
        and attempt.mission_workflow_id = asset.mission_workflow_id
        and attempt.mission_work_item_id = asset.mission_work_item_id
    )
  );

create policy mission_publication_proof_assets_storage_pending_read
  on storage.objects for select to authenticated using (
    bucket_id = 'mission-publication-proof-assets'
    and owner_id = (select auth.uid()::text)
    and exists (
      select 1
      from public.mission_publication_proof_assets asset
      where asset.storage_object_path = name
        and asset.creator_id = (select auth.uid())
        and asset.upload_state = 'pending'
        and asset.upload_grant_expires_at > now()
    )
  );

create policy mission_publication_proof_assets_storage_insert
  on storage.objects for insert to authenticated with check (
    bucket_id = 'mission-publication-proof-assets'
    and exists (
      select 1
      from public.mission_publication_proof_assets asset
      where asset.storage_object_path = name
        and asset.creator_id = (select auth.uid())
        and asset.upload_state = 'pending'
        and asset.upload_grant_expires_at > now()
    )
  );

create policy mission_publication_proof_assets_storage_update
  on storage.objects for update to authenticated using (
    bucket_id = 'mission-publication-proof-assets'
    and owner_id = (select auth.uid()::text)
    and exists (
      select 1
      from public.mission_publication_proof_assets asset
      where asset.storage_object_path = name
        and asset.creator_id = (select auth.uid())
        and asset.upload_state = 'pending'
        and asset.upload_grant_expires_at > now()
    )
  ) with check (
    bucket_id = 'mission-publication-proof-assets'
    and owner_id = (select auth.uid()::text)
    and exists (
      select 1
      from public.mission_publication_proof_assets asset
      where asset.storage_object_path = name
        and asset.creator_id = (select auth.uid())
        and asset.upload_state = 'pending'
        and asset.upload_grant_expires_at > now()
    )
  );

create or replace function public.initialize_creator_studio_workflow(p_mission_submission_id uuid)
returns public.mission_workflows
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_submission public.mission_submissions;
  v_mission public.missions;
  v_workflow public.mission_workflows;
  v_deliverable text;
  v_spec jsonb;
  v_position integer;
begin
  select * into v_submission
  from public.mission_submissions
  where id = p_mission_submission_id
  for update;

  if v_submission.id is null then raise exception 'submission_not_found'; end if;
  if v_submission.status <> 'joined' then raise exception 'invalid_submission_status'; end if;

  select * into v_mission
  from public.missions
  where id = v_submission.mission_id
    and workspace_id = v_submission.workspace_id;

  if v_mission.id is null then raise exception 'mission_not_found'; end if;

  insert into public.mission_workflows (mission_submission_id, creator_id, workspace_id)
  values (v_submission.id, v_submission.creator_id, v_submission.workspace_id)
  on conflict (mission_submission_id, workspace_id)
  do update set updated_at = public.mission_workflows.updated_at
  returning * into v_workflow;

  if exists (select 1 from public.mission_work_items where mission_workflow_id = v_workflow.id) then return v_workflow; end if;

  if jsonb_typeof(v_mission.deliverable_specs) = 'array'
     and jsonb_array_length(v_mission.deliverable_specs) > 0 then
    for v_spec, v_position in
      select value, ordinal::integer
      from jsonb_array_elements(v_mission.deliverable_specs)
        with ordinality as source(value, ordinal)
    loop
      insert into public.mission_work_items (
        mission_workflow_id,
        mission_submission_id,
        creator_id,
        workspace_id,
        position,
        title,
        instructions,
        requirements,
        requires_asset,
        proof_requirement
      )
      values (
        v_workflow.id,
        v_submission.id,
        v_submission.creator_id,
        v_submission.workspace_id,
        v_position,
        coalesce(nullif(btrim(v_spec ->> 'title'), ''), v_mission.title),
        coalesce(v_spec ->> 'instructions', ''),
        case
          when jsonb_typeof(v_spec -> 'requirements') = 'object' then v_spec -> 'requirements'
          else jsonb_build_object(
            'caption', false,
            'externalUrl', false,
            'checklist', '[]'::jsonb
          )
        end,
        case
          when jsonb_typeof(v_spec -> 'requiresAsset') = 'boolean'
            then (v_spec ->> 'requiresAsset')::boolean
          else false
        end,
        case
          when jsonb_typeof(v_spec -> 'proofRequirement') = 'object'
            then v_spec -> 'proofRequirement'
          else null
        end
      );
    end loop;
  elsif coalesce(array_length(v_mission.deliverables, 1), 0) = 0 then
    insert into public.mission_work_items (
      mission_workflow_id,
      mission_submission_id,
      creator_id,
      workspace_id,
      position,
      title,
      requirements,
      requires_asset,
      proof_requirement
    )
    values (
      v_workflow.id,
      v_submission.id,
      v_submission.creator_id,
      v_submission.workspace_id,
      1,
      v_mission.title,
      jsonb_build_object(
        'requirements', to_jsonb(v_mission.requirements),
        'platforms', to_jsonb(v_mission.platforms)
      ),
      false,
      null
    );
  else
    for v_deliverable, v_position in
      select deliverable, ordinal::integer
      from unnest(v_mission.deliverables)
        with ordinality as source(deliverable, ordinal)
    loop
      insert into public.mission_work_items (
        mission_workflow_id,
        mission_submission_id,
        creator_id,
        workspace_id,
        position,
        title,
        requirements,
        requires_asset,
        proof_requirement
      )
      values (
        v_workflow.id,
        v_submission.id,
        v_submission.creator_id,
        v_submission.workspace_id,
        v_position,
        v_deliverable,
        jsonb_build_object(
          'requirements', to_jsonb(v_mission.requirements),
          'platforms', to_jsonb(v_mission.platforms)
        ),
        false,
        null
      );
    end loop;
  end if;

  return public.refresh_creator_studio_state(v_workflow.id);
end;
$$;

revoke all on function public.initialize_creator_studio_workflow(uuid) from public, anon, authenticated;
grant execute on function public.initialize_creator_studio_workflow(uuid) to service_role;
