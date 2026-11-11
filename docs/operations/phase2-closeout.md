# Phase 2 closeout — agent quality, streaming and telemetry

Window: 2026-11-09 → 2026-11-12 (Asia/Singapore). Production: `adfocate-2.vercel.app`.

## Shipped

| Area | What shipped | Evidence |
| --- | --- | --- |
| Streaming | `POST /assistant/chat/stream` SSE (`progress` + `delta` + `done`); studio composer types the answer into the pending bubble; JSON endpoint unchanged as fallback | Creator confirmed live typing; HasData turns show the skill step first, then stream |
| Answer quality | Skill answers include up to 3 original-item markdown links, labelled public/unverified; MCP result budget 12k chars | Eval `assistant-evals` link rule test |
| Cost/latency | Same-name/args read-only tool reuse; 8-call per-turn budget (`tool_budget_exceeded`); pre-tool soft stop (slow skills) with a 30 s soft budget | Eval suites; CI green |
| Reliability | Slow turns return a saved partial answer instead of aborting at the 45 s provider deadline | `unknown` rows all predate the soft-stop deploy (2026-11-11 15:09 UTC); no production activity since, so the fix is not yet exercised live |
| Evals | Loop, MCP, and provider-shaped evals (HasData URL/counts, MySocial plan limit, timeout, injection, dedupe, budgets, SSE) | `assistant-evals`, `assistant-provider-evals`, `llm.assistant`, `assistant.test` |
| Operator telemetry | `/admin/skills`: failure codes per server, 24 h/7 d call usage (credit proxy), avg + p95 latency; `/admin/mcp/audit` carries the maps | Admin tests |
| Creator transparency | Saved replies carry `tool_details` (tool → MCP server → audit outcome/duration, no payloads); "Why this answer?" shows it | `toolTraces` unit tests; studio suite |
| A3.2 canary | Confirm-first proposal execution (thread-bound token, UUIDv5 command request id, save_brief section schema) | 1 `executed` audit row (925 ms), thread revision 0 → 1, brief v1 with 3 sections |

## Watch snapshot (last 24 h at closeout)

- Requests: **6 saved / 1 unknown**; the unknown is `2026-11-11 04:22 UTC`, before the soft-stop deploy.
- MCP audit 24 h: `mysocial` 4 ok (avg 806 ms, max 1410 ms), `workspace_missions` 1 ok; no HasData calls, no failures.
- Proposal audit: 1 `executed`, 3 `failed` — all failures are the pre-fix thread/UUID/section bugs; none after the fix.

## Remaining

1. **Canary decision** — A3.2 stays scoped to `936b9de1…` + `006c749f…` until several more clean confirms; widen only after that.
2. **HasData `936b…`** — connection is revoked provider-side; reconnect from `/connections#data-skills` before using it again.
3. **Reliability verification** — re-check `assistant_requests.state='unknown'` after real slow-skill traffic; expect a saved partial answer and `soft_deadline` instead of unknown.
4. **Optional next phase** — creator-facing retry affordance for partial answers, OAuth provider expansion, or migration-tracker policy (owner decision).

## Rollback

- Proposals/execution: remove `STUDIO_ASSISTANT_PROPOSALS` / `STUDIO_ASSISTANT_PROPOSAL_EXECUTION` (or clear `STUDIO_ASSISTANT_PROPOSAL_EXECUTION_CREATORS`) and redeploy.
- Streaming is client-side fallback-safe; old clients keep using `/assistant/chat`.
- MCP skills: `STUDIO_MCP_ENABLED=false` or clear registry allowlists.
