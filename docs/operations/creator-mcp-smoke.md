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

## Verified 2026-11-09 22:49 SGT (human pass)

- A real creator granted live consent for `workspace_missions` at 22:42 SGT (not revoked) — the human consent card path works.
- The same creator then asked in `/studio`: 「請用 workspace_missions 技能列出呢個工作區所有公開任務標題」.
- The request saved at 22:49 SGT and the assistant replied “已用 **workspace_missions** 技能查詢…” with the mission table (unverified framing preserved).
- `mcp_call_audit` row: `workspace_missions.list_open_missions`, outcome **ok**, 1098 ms, correct creator/workspace.
- `assistant_tool_traces` row for the conversation: `["mcp__workspace_missions__list_open_missions"]` — the MCP chip path is confirmed by a human.
- Earlier 19:02 SGT attempt on a different account had no consent, so the assistant correctly used built-in tools; that is expected behaviour, not a fault.

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
