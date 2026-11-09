# A2 — OAuth provider skills, token vault and consent fencing (implementation plan)

Status: **real provider configured 2026-11-09** (Mysocial); awaiting creator connect 2026-11-09 (Week 2). **A2.1 implemented** (2026-11-09); **A2.2 implemented** (2026-11-09, dark): `docs/operations/mcp-oauth.sql` applied, `mcp_oauth_pending`/`mcp_oauth_connections` created, token encryption (`MCP_OAUTH_ENCRYPTION_KEY`), provider config (`MCP_OAUTH_PROVIDERS`), start/callback/disconnect routes behind `STUDIO_MCP_OAUTH`, and registry gating that only exposes OAuth servers with a live unexpired encrypted token (Authorization header injected into the MCP call). **A2.3 real provider configured 2026-11-09**: Mysocial MCP (https://app.mysocial.io/mcp) with OAuth 2.1 PKCE; DCR client registered (redirect `/api/mcp-oauth/callback`, scope `mcp:read` only); Vercel env `STUDIO_MCP_OAUTH=true` + `MCP_OAUTH_ENCRYPTION_KEY`/`MCP_OAUTH_PROVIDERS` Secrets; OAuth routes verified live. Registry row + creator connect verified; token refresh implemented in the registry loader (expired connection → refresh grant → encrypted token rotation; failure fails closed). **A2.3 fixture E2E verified** (2026-11-09); **A2.3 real-provider pilot paused by owner decision (2026-11-09)** pending a provider choice/OAuth app registration: server/test/mcp-oauth-fixture-e2e.test.ts runs a local OAuth provider + MCP server through the real start → callback → encrypted token → registry gating → MCP call (Authorization: Bearer) path; a real provider registration/approval is still required. The 90-day audit-retention cron is implemented (docs/superpowers/plans/2026-11-09-a4-e1-observability-ops.md). Token refresh and the first provider pilot remain: `serverIds` on the registry result plus `runFencedMcpTool`, which re-checks live consent after each MCP call and returns/audits `error: consent_revoked` when it was revoked mid-turn. A2.3 pending. Builds on the phase-1 MCP client (env allowlist), the workspace
registry/consent tables and the admin registry UI. This plan adds real provider-hosted read-only skills
and closes the consent lifecycle gaps. Schema is applied out of band, like the existing MCP tables.

## A2.1 — Consent revocation fencing (first slice, no OAuth needed)

Problem: a chat turn reads the registry once, then calls MCP tools over several seconds. If the creator
revokes consent mid-turn, a result produced after revocation must not be used or persisted.

Design:
- `mcp_consents` already has `revoked_at`; reads filter `revoked_at is null`.
- The studio MCP runtime wrapper re-checks the server's live consent immediately **after** each tool
  call and before returning the result. If it is gone, return `error: consent_revoked`, record the
  audit row as `consent_revoked`, and do not include the payload in the answer.
- Registry loader exposes `serverIds` (server name → id) so the wrapper can check without another
  lookup; one indexed `select id ... where revoked_at is null` per call is acceptable (bounded).
- Env-allowlist mode (no DB rows) keeps today's behaviour; fencing only applies to registry mode.
- Also discard the streamed/partial early? Today answers are single-shot, so per-call fencing is enough.

Tests: registry loader returns ids; live-consent helper true/false; wrapper returns
`error: consent_revoked` and audits it for a revoked server; in-flight normal call unchanged.

## A2.2 — OAuth connections for provider-hosted MCP servers

New out-of-band schema (proposal):
```sql
create table public.mcp_oauth_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  server_id uuid not null references public.mcp_servers(id) on delete cascade,
  creator_id uuid not null,
  provider text not null,
  access_token_encrypted bytea not null,   -- encrypted with the server vault key
  refresh_token_encrypted bytea,
  scopes text[] not null default '{}',
  expires_at timestamptz,
  token_type text not null default 'Bearer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (server_id, creator_id)
);
```
- Tokens encrypted at rest via the existing server-side vault pattern (key from env, never in the
  browser, never in logs). One row per creator+server.
- `mcp_servers` gains `auth_mode` (`none` | `oauth`) and `oauth_provider`/`oauth_scopes` metadata.

Endpoints:
- `GET /mcp/oauth/:serverId/start` (creator auth) → provider authorization URL with `state` bound to
  creator/workspace/server, PKCE `code_challenge`, minimum read scopes only.
- `GET /integration-oauth/mcp/:provider` callback (unguarded, like existing integration callbacks) →
  validate state, exchange code+verifier, encrypt and upsert tokens, redirect back to `/connections`.
- `DELETE /mcp/oauth/:serverId` (creator auth) → revoke connection + clear tokens; provider revocation
  is attempted best-effort and its status recorded.
- Token refresh happens inside the MCP client request path when `expires_at` is near; refresh failure
  surfaces as `error: mcp_auth_required` and the consent card asks the creator to reconnect.
- The registry loader only exposes a server when both consent **and** (if `auth_mode = oauth`) a live
  token connection exist; otherwise the skill stays hidden/disabled.

## A2.3 — First provider pilot

- One provider-hosted read-only MCP server, owner-signed approval packet (same pattern as the Instagram
  pilot): data classes, retention, audit owner, kill switch.
- `/connections` consent card shows provider, scopes and connection state; disconnect clears consent
  and tokens.
- Kill switch: `STUDIO_MCP_ENABLED=false` disables everything in one env change.

## Rollout

1. A2.1 fencing (dark: only affects registry mode; ships with tests).
2. A2.2 schema + endpoints behind `STUDIO_MCP_OAUTH=true`; no provider enabled yet.
3. A2.3 single provider with owner approval; monitor `mcp_call_audit` and 90-day retention job.

## Verification

- Fencing: revoked mid-turn → payload dropped + audited.
- OAuth: state mismatch/PKCE failure rejected; tokens never in API responses/logs; refresh failure path.
- Registry: OAuth server without a token connection is never exposed.
- E2E: fixture OAuth provider (local stub) → connect → consent → chat calls the skill → audit row.
