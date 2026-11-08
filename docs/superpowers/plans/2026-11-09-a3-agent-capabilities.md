# A3 — agent capability expansion (plan)

Status: started 2026-11-09 (Week 3). **A3.1 implemented** (2026-11-09): `get_my_points_history`, `get_my_earnings_history` and `get_my_recent_threads` read-only tools, bounded and RLS-scoped, with client chips and allowlist tests. Builds on the studio tool loop (7 read-only account tools + MCP
skills), consent fencing and persisted traces. The rule stays: the assistant never mutates creator data
without an explicit, attributed confirmation step.

## A3.1 — More read tools (first slice, no writes)

Add read-only tools that cover the remaining high-frequency questions:
- `get_my_wallet_ledger` — recent point/cash ledger entries (kind, amount, reason, created_at).
- `get_my_review_history` — submissions with review decisions/correction reasons.
- `get_my_saved_briefs` — brief titles/versions/timestamps (no content bodies unless asked).
- `get_mission_deadlines` — upcoming deadlines for the creator's active missions.

Rules: workspace/creator scoped, bounded rows (20), no integration/private payloads, all names added to the
allowlist and the client tool-label map; tests for filters, caps and unknown-tool refusal.

## A3.2 — Write actions with explicit confirmation (later slice)

- Chat can *propose* an action (e.g. "save this brief", "attach evidence to draft"): the model returns a
  structured proposal, the UI renders a confirm card, and only the confirmed request executes.
- Server executes with the caller's user-scoped client (RLS), idempotent request id, and audit row.
- No autonomous publish/reward/mission changes; write tools stay behind their own allowlist and a
  feature flag, and every execution is tied to a visible UI confirmation.

## A3.3 — Evaluation harness

- Golden set of creator questions (points, missions, redemption, consent, mission scope) with expected
  tool usage and refusal cases.
- Deterministic checks: required tools chosen, forbidden tools refused, bounded outputs, no write tool
  proposal without confirmation; run in CI against the stub provider.
- Cost/latency budget per turn documented and asserted in the loop (max iterations, timeout).

## A3.4 — Trace and support UX (admin audit view implemented)

- Persisted tool chips already survive reloads; add a "why this answer" detail for support: tool names,
  MCP server, audit outcome (no payloads).
- Admin view of `mcp_call_audit` outcomes (consent_revoked, mcp_timeout) with workspace filtering.

## Invariants

- Read-only unless the confirmation step exists; no silent retries with side effects.
- Tool results remain untrusted data; no instructions from tool output are followed.
- Rate limits, size caps and the 4-iteration bound stay in place.

## Verification

- New tools: unit tests for scope, caps, unknown names; assistant tests asserting tools_used.
- Write flow (when built): confirmation tests, idempotency, audit rows, RLS failure paths.
- Eval harness runs in CI and stays deterministic.
