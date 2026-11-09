# Creator MCP smoke — human pass checklist

Purpose: a real creator confirms the live MCP path (consent → chat tool call → audit/trace) before we
claim the pilot is usable. The synthetic E2E already passed; this is the human check.

## Before you start

- Sign in as a creator in the demo workspace (the workspace that owns the `workspace_missions` registry
  row). Production has `STUDIO_MCP_ENABLED=true` and `STUDIO_MCP_REGISTRY=true`.
- The pilot skill only reads the workspace's active missions; it is read-only, no writes.

## Steps

1. Open **`/connections`**.
2. Find **資料技能** (Data skills). You should see `workspace_missions` with tool `list_open_missions`
   and state **未同意**.
3. Click **允許只讀使用** (Allow read-only). The tag must change to **已同意**; reload the page to confirm
   it persisted.
4. Open **`/studio`**. Start a new discussion (or open an existing one).
5. Ask explicitly, e.g. **「請用 workspace_missions 技能列出呢個工作區所有公開任務標題」** (the wording
   matters — it steers the model to the MCP skill rather than the built-in mission tools).
6. Confirm the reply:
   - lists the same 6 active missions you would see on `/mission`;
   - shows a tool chip **技能 · list_open_missions** and a “為什麼這個答案？” detail;
   - contains no invented metrics.
7. Optional negative check: go back to `/connections`, click **撤回同意** (revoke), then ask the same
   question in `/studio`. The reply must not use the skill (no MCP chip), and a revoked-mid-turn call is
   dropped/audited as `consent_revoked` if it was already running.

## What to send back

- Screenshot or text of the consent card state (allowed/revoked) and the studio reply with its chips.
- If anything fails: the exact step, page, and visible error; optionally the request id from the network
  response (`request_id`).

## Observed 2026-11-09 (partial smoke)

- A real creator in the demo workspace granted **live consent** for `workspace_missions` (not revoked), so the consent card path works for a human.
- One human studio chat used only built-in tools (missions/open-missions/recent-threads); **no MCP call was recorded**, so the MCP chip step is still unverified by a human.
- The studio prompt now prefers a connected skill over an equivalent built-in tool when one can answer the question (deployed after that chat). Re-run step 5 with the explicit wording to complete the smoke.

## Operator checks after the smoke

- `/admin/skills` → recent skill calls shows a row for `workspace_missions.list_open_missions` with
  outcome `ok` and a duration; the summary line counts it.
- `mcp_call_audit` (service role) contains the same row with `creator_id`/`workspace_id`, no payloads.
- If the reply used built-in tools instead of the skill, retry with the explicit wording above; if it still
  does not call the skill, note the model/provider response as a finding.

## Triage

| Symptom | Likely cause | Action |
|---|---|---|
| No 資料技能 section | flags off or registry tables empty | check `STUDIO_MCP_ENABLED/STUDIO_MCP_REGISTRY` and `mcp_servers` |
| Allow button fails | consent API error (401/403/503) | check auth session; `/api/mcp/skills` response |
| Skill chip never appears | model chose built-in tools | retry with explicit skill wording; note as eval finding |
| 401 from pilot | rotated `MCP_PILOT_TOKEN` without registry URL update | update `mcp_servers.url` row |
| Consent card says allowed but chat ignores it | connection/consent mismatch | check `mcp_consents` live row for the creator |
