# MCP provider pilot — approval packet (template)

Status: draft for the first provider-hosted MCP skill (A2.3). Fill in with the chosen provider; this is
the owner-signed gate before anything is enabled in production.

## 1. Provider and transport

- Provider / product:
- MCP endpoint URL (https):
- Transport + protocol version:
- OAuth app (registered by): client id present? redirect URI registered?
- Minimum read scopes requested (explicit list):
- Token handling: encrypted with `MCP_OAUTH_ENCRYPTION_KEY`, stored in `mcp_oauth_connections`, never
  returned to the browser (`mcp_oauth_connections` is service-role only).

## 2. Tools to expose

| Tool | What it reads | Data classes | Read-only guaranteed? | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

Allowlist is explicit; remote `tools/list` metadata cannot widen it. Nothing write/publish-capable may be
listed.

## 3. Privacy and consent

- Creator consent: `/connections → 資料技能`, per server, revocable; revocation fences in-flight calls
  (`error: consent_revoked`, audited).
- Data classes / PII involved:
- Data leaving Adfocate: what is sent to the provider and under which scopes:
- Retention: provider-side retention; local retention is `mcp_call_audit` 90 days (no payloads), consent
  and token rows until revoked.
- Cross-border / region notes:

## 4. Security review

- [ ] Endpoint is https and hosts a well-defined read-only server.
- [ ] OAuth app reviewed; client secret stored server-side only; PKCE + state required.
- [ ] Tool allowlist reviewed; no write tools.
- [ ] Token refresh failure behaviour documented (`mcp_auth_required`).
- [ ] Kill switch: `STUDIO_MCP_ENABLED=false` (one env change, redeploy).
- [ ] Audit owner + on-call contact.

## 5. Rollout

- [ ] Registry row created via `/admin/skills` (disabled first).
- [ ] Creator consent tested by a named human (record who/when).
- [ ] One studio chat turn that uses the skill verified; `mcp_call_audit` row inspected.
- [ ] 24h watch: outcome mix, 401/403, latency.
- [ ] Rollback rehearsed (flag off → verify 404 `mcp_disabled`).

## 6. Sign-off

- Owner (workspace): __________________ date:
- Privacy/data reviewer: __________________ date:
- Release owner: __________________ date:

## Fixture E2E (pre-provider)

The OAuth + MCP path is already proven locally without a provider: `server/test/mcp-oauth-fixture-e2e.test.ts` runs a local OAuth provider and read-only MCP server through start → callback (real token exchange) → encrypted connection → registry gating → MCP call with the stored bearer token. Use it to validate the approval packet and rollout steps before registering a real provider.
