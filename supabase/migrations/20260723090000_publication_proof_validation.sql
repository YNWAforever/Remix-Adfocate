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
  constraint mission_publication_proof_attempts_workspace_fk
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint mission_publication_proof_attempts_work_item_workspace_fk
    foreign key (mission_work_item_id, workspace_id)
    references public.mission_work_items(id, workspace_id) on delete cascade,
  constraint mission_publication_proof_attempts_submitter_workspace_fk
    foreign key (submitted_by, workspace_id)
    references public.creators(id, workspace_id),
  unique (workspace_id, mission_work_item_id, attempt_number),
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
  decision text not null check (decision in ('verified', 'rejected')),
  reviewer_id uuid not null,
  reviewed_at timestamptz not null default now(),
  summary text not null check (btrim(summary) <> ''),
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
  unique (id, workspace_id)
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
