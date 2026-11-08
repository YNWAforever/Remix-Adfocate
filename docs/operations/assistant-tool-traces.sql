-- Optional persistence for studio chat read-only tool traces.
-- Without this migration the assistant keeps working and traces stay per-turn only.
create table if not exists public.assistant_tool_traces (
  request_id uuid primary key,
  conversation_id uuid not null,
  answer_hash text not null,
  tools jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists assistant_tool_traces_conversation_idx
  on public.assistant_tool_traces (conversation_id, created_at desc);

alter table public.assistant_tool_traces enable row level security;
revoke all on public.assistant_tool_traces from public, anon, authenticated;
grant all on public.assistant_tool_traces to service_role;
