# MCP phase 2 — workspace registry, consent and OAuth (scope, not yet built)

Status: scope for approval, 2026-11-09. Phase 1 (dark-launch client, env allowlist) is merged; this
document scopes the next slice. No schema change is applied by this document.

**Defaults adopted for the server-side slice (owner can override):**
1. Workspace **owner** enables a server; staff with `submission.review` may view but not enable.
2. Consent is **per server** (one consent row covers its enabled read-only tools).
3. First pilot is the **local fixture server**, then one provider-hosted read-only server with an
   owner-signed approval packet.
4. MCP call audit retention: **90 days** (trim job in phase 2 completion).

**Implemented so far (server-side, dark):** registry loading with consent filtering and read-only /
https checks (`server/lib/mcp/registry.ts`), env fallback when tables are absent, per-call audit insert,
and `STUDIO_MCP_REGISTRY=true` to make the workspace registry authoritative. Creator consent API
(`GET /mcp/skills`, `POST|DELETE /mcp/skills/:id/consent`, same-origin mutations) and a `/connections`
"資料技能" section that lists servers/tools, grants or revokes consent, and renders nothing while the
feature is dark. Workspace-admin registry API (`GET|POST /mcp/registry`, `PATCH|DELETE /mcp/registry/:id`,
gated by the `access.manage` capability) manages servers and allowlists without SQL; the admin UI is
still pending. The SQL lives in [`docs/operations/mcp-registry.sql`](../../operations/mcp-registry.sql)
and is applied manually.

Still to build: admin UI for the registry API, OAuth/PKCE against provider-hosted servers with the token
vault, consent-revocation fencing of in-flight chats, and the 90-day audit retention job.

## 1. Problem

Phase 1 works but every server, tool and header lives in two env vars on the deployment. That is fine
for a fixture, not for real workspaces: owners need to turn skills on per workspace, creators need to
see and consent to what data a skill reads, and real Instagram/Drive MCP servers need OAuth plus
revocation — with an audit trail.

## 2. Scope

In scope (phase 2):
- Per-workspace server registry (which MCP server, which tools, who enabled it).
- Per-creator consent per server/tool before the first call, revocable, with existing "consent change
  fences in-flight responses" behaviour.
- OAuth (PKCE) for provider-hosted MCP servers; tokens stay server-side in the existing credential vault.
- Read-only enforcement retained: a tool is callable only when (a) workspace registry allows it,
  (b) creator consent covers it, (c) the tool is marked read-only by both registry and remote metadata.
- Audit rows for every MCP call; reuse `assistant_tool_traces` plus a dedicated call audit table.
- UI: `/connections` gains a "skills" section with per-server cards, consent dialog, revoke action.

Out of scope: MCP server *hosting* by Adfocate, marketplace/discovery of third-party servers, writes or
mission actions through MCP, automatic publication, background sync without a user-turn.

## 3. Data model (proposal)

```sql
create table public.mcp_servers (           -- workspace-owned registry
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  name text not null, url text not null, transport text not null default 'http',
  oauth_provider text, enabled boolean not null default false,
  read_only boolean not null default true, created_by uuid not null, created_at timestamptz not null default now(),
  unique (workspace_id, name)
);
create table public.mcp_server_tools (     -- allowlist per server
  server_id uuid not null references public.mcp_servers(id) on delete cascade,
  tool_name text not null, enabled boolean not null default true,
  primary key (server_id, tool_name)
);
create table public.mcp_consents (         -- creator consent, revocable
  id uuid primary key default gen_random_uuid(), server_id uuid not null references public.mcp_servers(id),
  creator_id uuid not null, workspace_id uuid not null, scopes jsonb not null default '{}'::jsonb,
  granted_at timestamptz not null default now(), revoked_at timestamptz
);
create table public.mcp_call_audit (       -- one row per call, no payloads
  id uuid primary key default gen_random_uuid(), request_id uuid, server_id uuid, tool_name text,
  creator_id uuid, workspace_id uuid, outcome text not null, duration_ms int,
  created_at timestamptz not null default now()
);
```
RLS: registry readable by workspace staff/owner; tool list readable by workspace members; consent rows
owner-only (`creator_id = auth.uid()`); audit write service-role, read staff-only. Grants follow the
existing studio-table pattern (`grant:authenticated select`, no write grants).

## 4. Consent contract

- A tool call requires a live consent row covering `server_id` for the calling creator.
- Consent text names: server owner, data classes read, read-only promise, revocation path.
- Revocation: deleting/revoking consent increments a fencing epoch; any in-flight response from that
  server is discarded (reuse the integration `epoch`/`fence` pattern in `src/lib/integrations/queries.ts`).
- Consent changes invalidate the tool definitions on the next turn; the model is told the skill was
  removed instead of receiving stale output.
- No implied consent from account creation, workspace membership or previous provider OAuth grants.

## 5. OAuth

- Authorization Code + PKCE per provider-hosted MCP server; state bound to creator/workspace/server.
- Tokens encrypted in the existing server-side vault; never returned to the browser.
- Refresh failures surface as `error: mcp_auth_required` and the connection card asks the creator to
  reconnect; no silent retries with stale tokens.
- Provider scope selection must be explicit (minimum read scopes only) and shown before redirect.

## 6. Rollout

1. Schema + RLS review and manual SQL application (tracker is managed out of band, as with
   `assistant-tool-traces`).
2. Registry UI + consent behind `STUDIO_MCP_REGISTRY=true`; env phase-1 allowlist stays as the fallback.
3. One fixture MCP server end-to-end first; then a single provider-hosted read-only server with an
   owner-signed approval packet (same pattern as the Instagram pilot).
4. Kill switch: `STUDIO_MCP_ENABLED=false` disables the whole path in one env change.

## 7. Verification plan

- RLS tests: cross-workspace registry isolation, consent ownership, audit read restrictions.
- Consent lifecycle: grant → call → revoke → in-flight response discarded; no call after revoke.
- OAuth: PKCE state validation, token vault round-trip (no token in responses/logs), refresh failure path.
- Tool policy: remote metadata cannot widen the allowlist; writes rejected; size/timeout caps retained.
- E2E: fixture server through the full registry → consent → studio answer path.

## 8. Questions for the owner

1. Who can enable a server for a workspace: workspace owner only, or any staff with `submission.review`?
2. Consent granularity: per server, or per tool?
3. Which provider-hosted MCP server is the first pilot, and is its OAuth app already registered?
4. Retention: 90 days for MCP call audit rows, or match the existing chat retention?
