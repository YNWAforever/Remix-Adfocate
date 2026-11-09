# Canary runbook (dark-launch → limited enable → rollback)

Applies to studio/MCP/agent flags. The default posture is **dark**: merge and deploy with the flag off,
verify no behaviour changed, then enable for a limited scope and watch the audit surfaces.

## 0. Pre-flight (before enabling anything)

- [ ] `npm run release:check` green locally or in CI (`build-test` + `integration`).
- [ ] Optional schema applied and verified (after applying `docs/operations/*.sql`):
  - `mcp_servers`, `mcp_server_tools`, `mcp_consents`, `mcp_call_audit`
  - `mcp_oauth_pending`, `mcp_oauth_connections` (only if OAuth mode)
  - `assistant_tool_traces`
- [ ] `vercel env ls production` shows the intended flag set; `VITE_STUDIO_FIXTURE` absent.
- [ ] Kill switch known: `STUDIO_MCP_ENABLED=false` (MCP) / the relevant flag back to `false`.

## 1. Dark deploy

1. Merge with all new flags off (or absent).
2. Wait for Vercel Production **Ready** and the GitHub commit status `success`.
3. Smoke (no auth needed): `/home`, `/packages`, `/earn`, `/legal/terms` return 200; `/api/cron/mcp-audit-retention`
   without a secret returns 401; `/api/mcp-oauth/callback` returns 404 `mcp_disabled` while dark.
4. Studio (signed-in creator): chat still answers the account questions; `/connections` shows no data-skills
   section while the registry is off; `/admin/skills` shows the disabled state.

## 2. Limited enable

1. Enable only the flags required for the trial (e.g. `STUDIO_MCP_REGISTRY=true` with one server row) and
   redeploy.
2. Creator pass: `/connections → 資料技能` lists the server, consent grant/revoke works, chat lists the skill
   chips and the “why this answer?” detail.
3. Operator pass: `/admin/skills` lists the server and the recent-calls summary; `mcp_call_audit` has rows with
   `ok`/`consent_revoked` outcomes and no payloads.
4. Watch for 24h: `mcp_call_audit` outcome mix, 401/403s on `/mcp/skills`, cron logs, assistant latency
   (`tool_iteration_limit` should be rare).

## 3. Rollback (one env change)

1. Set the failing flag to `false` (e.g. `STUDIO_MCP_ENABLED=false`) and redeploy. Env-only changes need a
   new deployment to reach Node.
2. Verify: MCP endpoints return 404 `mcp_disabled`; chat still works with built-in read-only tools; no new
   audit rows.
3. Leave schema/tables in place (they are inert while flags are off); rotate `MCP_PILOT_TOKEN` if the
   pilot endpoint was the problem.
4. Record the rollback reason in the release notes and file the follow-up.

## 4. Never do

- Never enable a real provider or write-capable tool without an owner approval packet (data classes,
  retention, audit owner) and the confirmation UI.
- Never apply optional SQL through `supabase db push` (it is deliberately out of the reviewed migration
  manifest); use the SQL editor/ops procedure and the contract test.
- Never rotate `MCP_PILOT_TOKEN` without updating the registry URL rows.
