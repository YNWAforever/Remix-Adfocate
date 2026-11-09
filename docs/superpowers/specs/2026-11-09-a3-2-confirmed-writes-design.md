# A3.2 confirmed writes — design (implementation next phase)

Status: design 2026-11-09. Today only **proposals** exist: `propose_brief` records a proposal, the UI can
apply it to the editor, and nothing is written server-side. This document scopes the server-side execution
step behind the explicit confirmation UI and its safety properties.

## Goal

A model-proposed action may be executed **only** after the creator explicitly confirms it in the UI, with
the exact content the model proposed, exactly once, attributed to the caller, and auditable.

## Proposal lifecycle

1. Model calls a proposal tool (e.g. `propose_brief`). The server validates and stores nothing.
2. The chat response returns the proposal **plus a signed proposal token**:
   `token = base64url(payload) + "." + base64url(HMAC-SHA256(payload))` where payload is
   `{v:1, kind, threadId, creatorId, workspaceId, requestId, contentHash, expiresAt}` and
   `contentHash = sha256(JSON(normalised proposal content))`.
   HMAC key: `PROPOSAL_SIGNING_KEY` (server-only, base64, rotated like other secrets).
3. UI shows the confirm card with the content and the token, plus a clear "this will save/execute X" state.
4. On confirm, the client calls `POST /studio/proposals/execute` (creator auth, same-origin enforced) with
   `{ token, payload }`.
5. Server verifies: HMAC, `v`, expiry (≤10 min), `creatorId`/`workspaceId` match the caller, `threadId`
   exists for the caller, recomputed `contentHash` equals the payload, and the action kind is allowlisted.
6. Server executes through the **user-scoped client** (RLS), using the action's existing command path
   (e.g. `studio_command` `save_brief`) with the proposal `requestId` for idempotency; it never uses the
   service role for the write.
7. Server records an audit row (kind, requestId, outcome, duration; no payload) and returns the action
   result. A replay with the same requestId hits the existing idempotency contract (no second write).

## Safety rules

- Allowlist: only `kind: "brief"` executes initially; publish/reward/mission-state actions are out of
  scope by policy, not just by allowlist.
- The token is bound to the content hash: editing the proposal content after generation invalidates it.
- One-time by requestId + audit uniqueness; expired/forged/tampered tokens → `PROPOSAL_INVALID` (400/403).
- Kill switch `STUDIO_ASSISTANT_PROPOSAL_EXECUTION=true` (default off): endpoint 404s when off; chat can
  still show proposals for manual copy.
- No autonomous execution from the model: the endpoint requires the signed token that only the UI
  received, and the caller's own auth.
- UI must say "not saved" until the execution response confirms success; failures keep the editor content.

## Audit

Optional table (out-of-band SQL + contract-test entry):
```sql
create table public.assistant_proposal_audit (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique,
  creator_id uuid not null,
  workspace_id uuid not null,
  thread_id uuid not null,
  kind text not null,
  outcome text not null,          -- executed | rejected | expired | invalid
  duration_ms int,
  created_at timestamptz not null default now()
);
```
Service-role only, 90-day retention alongside the MCP audit cron.

## Tests (implementation)

- token signature/tamper/expiry/replay/content-hash mismatch;
- caller mismatch (another creator/workspace) rejected;
- flag off → 404; allowlist rejects other kinds;
- execution uses the user client and produces exactly one write for two identical confirms;
- UI: confirm → success updates state; failure keeps content and shows a retryable error.
