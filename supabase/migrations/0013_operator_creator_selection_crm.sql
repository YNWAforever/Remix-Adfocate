-- Operator Creator Selection CRM: internal review, notes, mission shortlists,
-- and append-only audit events. These tables are service-role only in v1.

create table public.creator_review_statuses (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  status text not null default 'needs_review'
    check (status in ('needs_review', 'approved', 'flagged')),
  risk_level text not null default 'unknown'
    check (risk_level in ('low', 'medium', 'high', 'unknown')),
  summary text,
  reviewed_by text,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, creator_id)
);

create index creator_review_statuses_status_idx
  on public.creator_review_statuses (workspace_id, status, risk_level);

create table public.creator_review_notes (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  operator_id text not null,
  category text not null
    check (category in ('quality', 'brand_safety', 'fit', 'social', 'other')),
  body text not null,
  created_at timestamptz not null default now()
);

create index creator_review_notes_creator_idx
  on public.creator_review_notes (workspace_id, creator_id, created_at desc);

create table public.mission_shortlists (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  creator_id uuid not null references public.creators(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  status text not null default 'shortlisted'
    check (status in ('shortlisted', 'invited', 'dismissed', 'accepted', 'declined')),
  source text not null default 'manual'
    check (source in ('manual', 'applicant', 'match', 'review_queue')),
  notes text,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mission_id, creator_id)
);

create index mission_shortlists_mission_idx
  on public.mission_shortlists (workspace_id, mission_id, status);
create index mission_shortlists_creator_idx
  on public.mission_shortlists (workspace_id, creator_id, updated_at desc);

create table public.operator_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  operator_id text not null,
  actor_label text not null,
  event_type text not null,
  target_type text not null,
  target_id text not null,
  creator_id uuid references public.creators(id) on delete set null,
  mission_id uuid references public.missions(id) on delete set null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index operator_audit_events_creator_idx
  on public.operator_audit_events (workspace_id, creator_id, created_at desc);
create index operator_audit_events_mission_idx
  on public.operator_audit_events (workspace_id, mission_id, created_at desc);

create or replace function private.touch_operator_crm_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger creator_review_statuses_set_updated_at
  before update on public.creator_review_statuses
  for each row execute function private.touch_operator_crm_updated_at();

create trigger mission_shortlists_set_updated_at
  before update on public.mission_shortlists
  for each row execute function private.touch_operator_crm_updated_at();

alter table public.creator_review_statuses enable row level security;
alter table public.creator_review_notes enable row level security;
alter table public.mission_shortlists enable row level security;
alter table public.operator_audit_events enable row level security;

grant all on public.creator_review_statuses to service_role;
grant all on public.creator_review_notes to service_role;
grant all on public.mission_shortlists to service_role;
grant all on public.operator_audit_events to service_role;
