# MCP provider pilots — approval packet

Status: two providers configured 2026-11-09. **MySocial** verified end-to-end (human consent → OAuth → chat → audit);
**HasData** configured, awaiting creator connection. Both are read-only.

## Providers

### A. MySocial — creator-owned social intelligence
- Endpoint `https://app.mysocial.io/mcp`; OAuth 2.1 PKCE + DCR; scope **`mcp:read`**.
- Client redirect `https://adfocate-2.vercel.app/api/mcp-oauth/callback`; client secret only in Vercel
  `MCP_OAUTH_PROVIDERS` Secret.
- 20 read-only tools (`whoami`, channels, content search/analytics, audience, research, brand reads).
- Data: the authorizing creator's own connected channels and derived analysis; no other accounts.
- Status: **verified** — human consent, chat used `mcp__mysocial__*`, audit `ok`, trace recorded, token refresh implemented. Note: `search_tiktok` can return “Creator Universe is not available for this connection” (plan/entitlement).

### B. HasData — public social/web scraping
- Endpoint `https://mcp.hasdata.com/api/mcp?apis=instagram,tiktok,youtube` (narrowed from the default 57 APIs
  to 3 providers / 10 tools).
- OAuth 2.1 PKCE + DCR; **public client** (`token_endpoint_auth_method: none`, no client secret); scopes
  **`mcp:tools offline_access`**. Refresh tokens supported by the provider and by our loader.
- 10-tool allowlist: `instagram_profile`, `instagram_posts`, `instagram_reels`, `instagram_comments`,
  `tiktok_profile`, `tiktok_posts`, `tiktok_search`, `youtube_channel`, `youtube_search`, `youtube_video`
  (namespaced by the provider as `hasdata_<api>_get…`).
- Data: **public** profiles/posts/comments/reels and search results — not the creator's private data.
  HasData bills per call in credits on the connected HasData account; see its pricing/retention docs.
- Status: **verified 2026-11-10** — human creator connected, `hasdata_tiktok_search_getTikTokSearch` ok 10.2 s, saved reply with real TikTok results, trace recorded; allowlist expanded to 12 tools (TikTok comments, YouTube transcript). Each call consumes HasData credits (8–10 s typical).

## Shared privacy/consent

- Creator consent (`/connections → 資料技能`) plus the provider OAuth connection are both required; either can
  be revoked/disconnected.
- Adfocate keeps no payloads: `mcp_call_audit` records tool/outcome/duration for 90 days; tokens are AES-GCM
  encrypted server-side and never returned to the browser.
- Refreshing tokens happens server-side; revoked/expired tokens fail closed.
- Every tool set is an explicit allowlist; remote `tools/list` cannot widen it. No write tool is reachable for
  either provider (MySocial has write tools, we do not list them; HasData's API is scraping/read).

## Rollout checklist

- [x] Vercel: `STUDIO_MCP_OAUTH=true`, `MCP_OAUTH_ENCRYPTION_KEY` + `MCP_OAUTH_PROVIDERS` Secrets (both providers).
- [x] MySocial registry row + 20 tools; human consent/connect/chat verified.
- [ ] HasData registry row + 10 tools; creator connect/chat to verify.
- [ ] 24h watch for both: outcome mix, errors, latency, credit usage.
- [ ] Rollback rehearsed (`STUDIO_MCP_OAUTH=false` / `STUDIO_MCP_ENABLED=false` → 404 `mcp_disabled`).
- [ ] Owner/privacy sign-off below.

## Sign-off

- Owner (workspace): __________________ date:
- Privacy/data reviewer: __________________ date:
- Release owner: __________________ date:
