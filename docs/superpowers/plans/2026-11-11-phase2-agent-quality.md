# Phase 2 ??agent quality & trust (started 2026-11-11)

Goal: make skill answers trustworthy, cheap and fast enough for daily creator use.

## Shipped

- [x] **Provider source links**: connected-skill answers include up to 3 markdown links to original items, name the skill, label the data public/unverified.
- [x] **Larger skill result budget**: MCP tool text 6k ??12k chars.
- [x] **Per-turn tool-result reuse**: identical read-only calls (same name + args) reuse the first result; failures are not cached.
- [x] **Per-turn tool-call budget**: at most 8 read-only calls (`MAX_STUDIO_TOOL_CALLS`); over-budget turns stop with `tool_budget_exceeded` instead of burning latency/credits.
- [x] **Streaming answers (verified in production)**: `chatComplete` streams provider deltas; `POST /assistant/chat/stream` emits `progress` + `delta` + `done` SSE events; `/assistant/chat` keeps the JSON contract; the studio composer types the answer into the pending bubble, resets on tool steps, and falls back to JSON if streaming is unavailable. Confirmed by the creator: text grows live; HasData turns show the skill step first, then stream.
- [x] **Deterministic eval suites**:
  - duplicate skill call ??one dispatch,
  - skill failure reaches the model as unavailable data,
  - unconfigured skill tool ??`tool_request_denied`, never dispatched,
  - injected provider text stays in a `tool` message while the prompt says untrusted,
  - tool-call budget stops before dispatch,
  - provider-shaped HasData payload forwards post URLs/counts as untrusted data,
  - MySocial plan-limit error and `mcp_timeout` are forwarded as unavailable data, never as zero results,
  - SSE route emits delta + done.
- [x] Soft-deadline partial answer + confirm-first proposal execution (Phase 1; A3.2 scoped to two canary creators).

## Next

1. **Admin canary telemetry** ??failures-by-code per server in `/admin/skills` (audit has outcomes; add breakdown).
2. **Cost visibility** ??workspace-level skill-call counters / provider credit estimate.
3. **Canary decision** ??after a few more confirms, keep scoped or widen A3.2; watch `assistant_proposal_audit` failures.

## Limits today

- Streaming starts when the provider starts the final answer; tool lookups still show progress, not token-level reasoning.
- `assistant_requests.state=unknown` can still happen on provider failure (soft stop reduces it).
- HasData calls cost credits and take 5??0 s; caching only within one turn.
