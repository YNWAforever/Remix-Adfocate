# MCP provider pilot — approval packet

Status: **configured 2026-11-09**, awaiting creator connection + sign-off. Provider selected: **Mysocial**.

## 1. Provider and transport

- Provider / product: Mysocial (social-media intelligence; GoldenGlow AB, Sweden) — https://mysocial.io/mcp/
- MCP endpoint: `https://app.mysocial.io/mcp` (Streamable HTTP; also a narrower `/mcp/universe`)
- Protocol: MCP JSON-RPC over streamable HTTP; health `GET /mcp` → `{"name":"mysocial-mcp","status":"ok"}`
- OAuth: OAuth 2.1 + PKCE (S256) + **dynamic client registration**; no manual app console.
- OAuth client registered via DCR on **2026-11-09**:
  - redirect URI: `https://adfocate-2.vercel.app/api/mcp-oauth/callback` (production Hono mount is `/api/mcp-oauth`)
  - token auth method: `client_secret_post`; client id/secret are stored only in the Vercel
    `MCP_OAUTH_PROVIDERS` Secret (not in the repo).
- Scopes requested: **`mcp:read` only** (provider also offers `mcp:write`/`mcp:research`; not requested).
- Metadata: `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` verified on
  the provider.

## 2. Tools exposed (read-only allowlist)

20 of the provider's read-only tools are allowlisted in the workspace registry; every write tool stays
unlisted and is never offered to the assistant:

`whoami`, `list_channels`, `list_workspaces`, `search_content`, `get_content`,
`get_strategy_context`, `get_playbook`, `get_channel_analytics`, `get_post_media`, `get_topics`,
`get_audience`, `search_universe`, `universe_content`, `get_universe_post`, `search_youtube`,
`search_tiktok`, `search_creators`, `list_tracked_creators`, `get_channel_posts`,
`list_brand_identities`.

No write/publish/delete tool is reachable through Adfocate; the assistant's tool list is the registry
allowlist, not the provider's full `tools/list`.

## 3. Privacy and consent

- Creator consent: `/connections → 資料技能 → Mysocial` — allow read-only, then connect via OAuth
  (provider sign-in). Both a consent row and a live connection are required before the skill is offered
  in chat; either can be revoked.
- Data classes read: the creator's own connected social content and derived metrics/transcripts/audience
  summaries, brand documents and Creator Universe public research (per provider docs).
- Not read: conversation history, assistant memory, files, any account other than the authorizing one.
- Provider-side retention: media/analysis while post + account exist; assistant request summaries
  90 days; revocation takes effect within 30 seconds (provider docs §9/§11).
- Adfocate-side retention: encrypted tokens until revoked/reconnected; `mcp_call_audit` 90 days without
  payloads; no tool arguments stored locally.
- Cross-border: provider processes on Google Cloud (EU + US under SCCs). Owner must accept.

## 4. Security review

- [x] HTTPS MCP endpoint + metadata verified.
- [x] DCR client is confidential (`client_secret_post`); secret only in Vercel Secret; PKCE + state enforced
      by our flow; callback identifies the creator from the pending state row.
- [x] Explicit read-only allowlist; no write tools.
- [x] Token refresh (2026-11-09): the registry loader refreshes an expired connection with the stored
      encrypted refresh token, persists the rotated pair, and fails closed (server skipped) if refresh fails.
      Fixture E2E covers the refresh path; a real provider refresh will be exercised when the current token expires.
- [x] Kill switches: `STUDIO_MCP_OAUTH=false` and/or `STUDIO_MCP_ENABLED=false` (env change + redeploy).
- [x] Audit: provider-side call record + our `mcp_call_audit` (creator/workspace/tool/outcome/duration).

## 5. Rollout

- [x] Vercel env: `STUDIO_MCP_OAUTH=true`, `MCP_OAUTH_ENCRYPTION_KEY` (Secret),
      `MCP_OAUTH_PROVIDERS` (Secret, MySocial client).
- [x] OAuth routes live and dark-checked (`/api/mcp-oauth/callback` unknown state → `/connections?mcp=error`).
- [ ] Registry row `mysocial` (enabled, read-only) created for the demo workspace.
- [ ] Creator allow + connect performed by a named human.
- [ ] One studio chat uses the skill; `mcp_call_audit` row inspected.
- [ ] 24h watch: outcome mix, errors, latency.
- [ ] Rollback rehearsed (flag off → 404 `mcp_disabled`).

## 6. Sign-off

- Owner (workspace): __________________ date:
- Privacy/data reviewer: __________________ date:
- Release owner: __________________ date:
