-- Optional: coarse assistant progress for the pending bubble ("what is the agent doing").
-- Progress is transient operational data (no payloads), retained 24h by the cron; out of band.
create table if not exists public.assistant_progress (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  creator_id uuid not null,
  workspace_id uuid not null,
  step text not null,
  created_at timestamptz not null default now()
);

create index if not exists assistant_progress_request_idx
  on public.assistant_progress (request_id, created_at);

alter table public.assistant_progress enable row level security;
revoke all on public.assistant_progress from public, anon, authenticated;
grant all on public.assistant_progress to service_role;

-- Rollback: drop table if exists public.assistant_progress;
