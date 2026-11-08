# MCP client for the studio assistant — D0 design (phase 1, dark launch)

Status: implementation scope for review, 2026-11-09. Phase 1 is dark by default and connects only to
explicitly allowlisted read-only tools; it does **not** authorize real provider connections.

## 1. What this phase is

The studio chat already calls a fixed read-only allowlist of Adfocate account tools (points, missions,
requirements, earnings, redemptions, notifications). Phase 1 adds an **MCP client** so a workspace can
expose a few additional read-only tools to the same bounded loop.

It is the plumbing, not the product launch: no Instagram/Drive OAuth, no marketplace UI, no writes, no
automatic publication, no external model processing of provider data.

## 2. Scope

In scope:
- A minimal MCP client over **Streamable HTTP** JSON-RPC: `initialize`, `tools/list`, `tools/call`.
- Static, env-driven server registry (`STUDIO_MCP_SERVERS`) with explicit per-tool allowlists.
- Studio integration through the existing bounded tool loop (`tools: [...]`, max 4 iterations) with
  the existing refusal path for any tool that is not allowlisted.
- Bounded outputs, timeouts, abort propagation, and an audit line for every call.
- Tool names surfaced to the creator (`tools_used` → persisted traces) and to the model as untrusted data.
- Hermetic tests with an in-process fixture MCP server.

Out of scope (phase 2+): OAuth/consent UX, real Instagram/Drive MCP servers, remote MCP marketplaces,
writes/actions, per-workspace DB configuration, streaming transports (SSE), retries with side effects.

## 3. Contract

`STUDIO_MCP_ENABLED=true` is required. Off means no discovery, no tool defs, no network calls.

```jsonc
// STUDIO_MCP_SERVERS
[
  {
    "name": "creator_notes",           // [a-z0-9_]{1,32}, becomes mcp__creator_notes__<tool>
    "url": "https://mcp.example.test/rpc",
    "enabled": true,
    "readOnly": true,                  // required; false is rejected
    "timeoutMs": 8000,                 // capped at 15000
    "headers": { "Authorization": "Bearer ..." }, // server-side only, never shipped to the browser
    "tools": [
      {
        "name": "lookup_note",
        "description": "Read one published note by id.",
        "inputSchema": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] }
      }
    ]
  }
]
```

Rules enforced in `server/lib/mcp/policy.ts`:
- `STUDIO_MCP_ENABLED !== "true"` → empty registry.
- server must be `enabled === true` and `readOnly === true`;
- URL must be `https:` (or `http://127.0.0.1` / `http://localhost` for the local fixture);
- tool names/descriptions/schemas are copied only from the allowlist — `tools/list` is not trusted to
  widen the allowlist;
- tool names are namespaced `mcp__<server>__<tool>` and must not collide with built-in studio tools;
- tools are finally passed through the studio loop's allowlist, so an unknown name is still rejected
  before execution.

## 3a. Tool metadata and discovery

An allowlist entry may be an object with `description` + `inputSchema`, or just a tool **name**:

```jsonc
{ "name": "fixture", "...": "...", "tools": ["lookup_note", "get_trend_brief"] }
```

Name-only entries are resolved through the server's `tools/list` on first use (cached 5 minutes per
server), and the remote metadata cannot add tools outside the names in the allowlist. If discovery
fails, declared tools stay available and pending names are skipped. Cached discovery is bounded to 50
remote tools and never carries payloads.

## 4. Failure behaviour

| Case | Behaviour |
|---|---|
| flag off / no config | no MCP tools, no calls |
| invalid config | that server skipped; config errors logged without secrets |
| transport error / timeout / abort | tool result `error: mcp_unavailable`; model told the data is unavailable |
| oversized response | bounded at 64 KB before JSON parse; tool result reports truncation |
| non-read-only tool requested by the model | rejected by allowlist (`tool_request_denied` path) |
| tool error payload | returned as bounded text; never treated as instructions |

All output is treated as untrusted data in the prompt (same rule as mission/source text).

## 5. Observability

- Structured `console.info` line per call: server, tool, duration, ok/error class, request id — no
  payloads, no headers.
- `tools_used` includes the namespaced name, so the existing persisted-trace feature records MCP usage
  when the SQL is applied.
- No new database table in phase 1.

## 6. Rollout

1. Merge dark (flag absent in every environment).
2. Enable only for a local fixture server in tests/dev.
3. A real MCP server is a separate approval: named server, URL, tool allowlist, data classes, retention,
   audit owner. Provider data rules from the pilot docs still apply.

## 7. Test plan (hermetic)

- client: initialize handshake, `tools/call`, JSON-RPC error, HTTP error, timeout/abort, size cap.
- policy: flag off, disabled server, non-read-only rejection, insecure URL rejection, name collision,
  namespacing, bounded config.
- studio loop: allowlisted MCP tool executes and returns its bounded result; non-allowlisted MCP name is
  denied without execution; built-in tools keep working when MCP is present.
- existing suites: assistant/studio tests unchanged with no config.

## 8. Open questions for phase 2

- Per-workspace DB registry vs env-only config.
- OAuth for Instagram/Drive MCP servers and which grants are separate from reading.
- Consent UI: reuse the studio evidence/connection consent surfaces?
- Audit retention: `assistant_tool_traces` extension vs a dedicated audit table.
