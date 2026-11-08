-- Optional A2.2 OAuth connections for provider-hosted MCP servers.
-- Applied manually in the Supabase SQL editor (out of band), like mcp-registry.sql.
-- Without these objects nothing changes: OAuth-mode servers are simply never exposed.

alter table public.mcp_servers
  add column if not exists auth_mode text not null default 'none'
    check (auth_mode in ('none', 'oauth')),
  add column if not exists oauth_provider text,
  add column if not exists oauth_scopes text[] not null default '{}';

-- Short-lived PKCE handshakes; one row per authorization attempt.
create table if not exists public.mcp_oauth_pending (
  state text primary key,
  creator_id uuid not null,
  workspace_id uuid not null,
  server_id uuid not null references public.mcp_servers(id) on delete cascade,
  provider text not null,
  code_verifier_encrypted text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);
create index if not exists mcp_oauth_pending_expiry_idx on public.mcp_oauth_pending (expires_at);

-- Creator-owned provider connections; tokens are encrypted with the server vault key.
create table if not exists public.mcp_oauth_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  server_id uuid not null references public.mcp_servers(id) on delete cascade,
  creator_id uuid not null,
  provider text not null,
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  token_type text not null default 'Bearer',
  scopes text[] not null default '{}',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (server_id, creator_id)
);
create index if not exists mcp_oauth_connections_live_idx
  on public.mcp_oauth_connections (creator_id, workspace_id, server_id) where revoked_at is null;

alter table public.mcp_oauth_pending enable row level security;
alter table public.mcp_oauth_connections enable row level security;

revoke all on public.mcp_oauth_pending, public.mcp_oauth_connections from public, anon, authenticated;
grant all on public.mcp_oauth_pending, public.mcp_oauth_connections to service_role;

-- Rollback:
-- drop table if exists public.mcp_oauth_pending;
-- drop table if exists public.mcp_oauth_connections;
-- alter table public.mcp_servers drop column if exists oauth_scopes, drop column if exists oauth_provider, drop column if exists auth_mode;
