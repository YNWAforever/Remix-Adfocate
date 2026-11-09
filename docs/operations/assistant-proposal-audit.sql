-- Optional A3.2 audit for confirmed proposal executions.
-- Applied manually (out of band), like the other optional tables; not a release migration.
create table if not exists public.assistant_proposal_audit (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique,
  creator_id uuid not null,
  workspace_id uuid not null,
  thread_id uuid,
  kind text not null,
  outcome text not null,
  duration_ms int,
  created_at timestamptz not null default now()
);

create index if not exists assistant_proposal_audit_workspace_idx
  on public.assistant_proposal_audit (workspace_id, created_at desc);

alter table public.assistant_proposal_audit enable row level security;
revoke all on public.assistant_proposal_audit from public, anon, authenticated;
grant all on public.assistant_proposal_audit to service_role;

-- Rollback: drop table if exists public.assistant_proposal_audit;
