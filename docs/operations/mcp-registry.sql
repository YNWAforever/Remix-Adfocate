-- Optional MCP workspace registry, per-creator consent and call audit.
-- Applied manually in the Supabase SQL editor (out of band, like assistant-tool-traces).
-- Without these tables the server keeps using the STUDIO_MCP_SERVERS env allowlist.

create table if not exists public.mcp_servers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  name text not null,
  url text not null,
  enabled boolean not null default false,
  read_only boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists public.mcp_server_tools (
  server_id uuid not null references public.mcp_servers(id) on delete cascade,
  tool_name text not null,
  enabled boolean not null default true,
  primary key (server_id, tool_name)
);

create table if not exists public.mcp_consents (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.mcp_servers(id) on delete cascade,
  creator_id uuid not null,
  workspace_id uuid not null,
  scopes jsonb not null default '{}'::jsonb,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists mcp_consents_live_idx
  on public.mcp_consents (creator_id, workspace_id, server_id) where revoked_at is null;

create table if not exists public.mcp_call_audit (
  id uuid primary key default gen_random_uuid(),
  request_id uuid,
  server_name text not null,
  tool_name text not null,
  creator_id uuid not null,
  workspace_id uuid not null,
  outcome text not null,
  duration_ms int,
  created_at timestamptz not null default now()
);
create index if not exists mcp_call_audit_workspace_idx
  on public.mcp_call_audit (workspace_id, created_at desc);

alter table public.mcp_servers enable row level security;
alter table public.mcp_server_tools enable row level security;
alter table public.mcp_consents enable row level security;
alter table public.mcp_call_audit enable row level security;

revoke all on public.mcp_servers, public.mcp_server_tools, public.mcp_consents, public.mcp_call_audit
  from public, anon, authenticated;
grant all on public.mcp_servers, public.mcp_server_tools, public.mcp_consents, public.mcp_call_audit
  to service_role;

-- Phase 2 UI/API will add workspace-owner write paths and creator-consent insert/revoke paths;
-- until then the server reads registry rows and consent rows with the service role only.
