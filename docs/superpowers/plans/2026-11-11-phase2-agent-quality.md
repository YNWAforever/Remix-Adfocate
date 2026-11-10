# Phase 2 — agent quality & trust (started 2026-11-11)

Goal: make skill answers trustworthy, cheap and fast enough for daily creator use.

## Shipped

- [x] **Provider source links**: connected-skill answers include up to 3 markdown links to original items, name the skill, label the data public/unverified.
- [x] **Larger skill result budget**: MCP tool text 6k → 12k chars (one TikTok/IG search can expose more than two items).
- [x] **Per-turn tool-result reuse**: identical read-only tool calls (same name + arguments) within one turn reuse the first result; skill calls are not repeated, saving HasData credits and seconds.
- [x] **Eval suite expansion** (`server/test/assistant-evals.test.ts`):
  - duplicate skill call → one dispatch,
  - skill failure (`error: mcp_timeout`) reaches the model as unavailable data,
  - unconfigured skill tool → `tool_request_denied`, no dispatch,
  - injected tool text stays in a `tool` message, system prompt still says untrusted data.
- [x] Soft-deadline partial answer + confirm-first proposal execution (Phase 1; now live for two canary creators).

## Next

1. **Streaming answers** — provider `stream:true`, SSE response, progressive UI with polling fallback; tool calls assembled from streamed deltas.
2. **Provider-specific golden evals** — recorded HasData/MySocial tool fixtures, answer-grounding and citation checks.
3. **Cost/latency budgets** — per-turn tool budget, per-workspace credit counters, alert on repeated `mcp_timeout`.
4. **Canary telemetry** — keep A3.2 scoped; add failures-by-code to `/admin/skills` (audit already records outcomes).

## Limits today

- Answers are still delivered as one JSON response; progress steps are polled at 800 ms.
- `assistant_requests.state=unknown` can still happen on provider failure (soft stop reduces it).
- HasData calls cost credits and take 5–10 s; result caching only applies within a turn.
