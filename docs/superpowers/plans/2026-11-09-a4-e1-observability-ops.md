# A4 + E1 — observability and release/ops (Week 4)

Status: started 2026-11-09 (Week 4). B2/B3 are done; this stream covers the last week of the roadmap.

## A4 — observability

### A4.4 — MCP audit view (implemented, this slice)
- `GET /admin/mcp/audit` (staff workspace admin, `access.manage`): recent 50 `mcp_call_audit` rows for the
  workspace — server/tool/outcome/duration/time, **no payloads**.
- `/admin/skills` renders a "recent skill calls" section with outcome tags (ok vs error classes); the
  page stays harmless while MCP is dark (`mcp_disabled` → empty).
- Tests: capability mapping, workspace scoping, no-payload projection.

### Retention job (implemented, this slice)
- `GET /api/cron/mcp-audit-retention` (CRON_SECRET): deletes `mcp_call_audit` rows older than 90 days;
  skips with `mcp_disabled` when the feature is off; returns `{deleted, cutoff}`.
- Vercel cron: `30 3 * * *` daily. Tests cover auth, skip, and the 90-day cutoff.

### Still pending
- Creator-facing "why this answer" detail (tool names + MCP server + audit outcome, no payloads) beyond
  the existing persisted chips.
- Operator dashboards (outcome mix, latency) over `mcp_call_audit`.

## E1 — release/ops guard (implemented, this slice)

- `scripts/release/optional-schema-contract.test.ts` runs inside `test:release-foundation`:
  - optional SQL stays **out of** `supabase/migrations` (it must not perturb the pinned release
    manifest) and lives in `docs/operations/`;
  - the three optional files declare the expected tables/columns (`mcp_servers`, `mcp_server_tools`,
    `mcp_consents`, `mcp_call_audit`, `mcp_oauth_pending`, `mcp_oauth_connections`,
    `assistant_tool_traces`, `auth_mode`);
  - optional tables are granted to `service_role` only, never `anon`/`authenticated`.
- This catches the exact drift we hit manually earlier (SQL applied but not tracked).

### Still pending
- End-state migration-tracker policy (adopt a reviewed migration flow for optional SQL instead of
  out-of-band docs) — needs an owner decision.
- Canary deployment workflow and environment matrix documentation.

## Invariants

- Audit views never expose payloads, tokens or headers.
- Retention only touches `mcp_call_audit`; tool traces/chat history keep their own policy.
- Release guards are static (no production credentials in CI).

## Verification

- New tests: cron retention (auth/skip/cutoff), optional-schema contract (3 assertions), admin audit
  endpoint + capability mapping; studio/admin suites and build stay green.
