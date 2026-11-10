# Phase 1 — pilot hardening (started 2026-11-10)

Status: in progress. Goal: a creator can connect a data skill and get a successful answer without support.

## Shipped

- [x] **Skill onboarding polish**: expired OAuth tokens report `connected:false, expired:true`; `/connections` shows “Reconnect needed” + Reconnect; OAuth callback notice (`mcp=connected|error`) with URL cleanup; `#data-skills` deep link; actionable error messages.
- [x] **HasData real smoke**: human creator asked “用 hasdata 搜尋 TikTok #skincare 熱門短影片”; `hasdata_tiktok_search_getTikTokSearch` **ok 10.2 s**, saved reply lists real TikTok results, trace `["mcp__hasdata__hasdata_tiktok_search_getTikTokSearch", "get_open_missions"]`.
- [x] **HasData allowlist expanded** to 12 read-only tools (added TikTok comments + YouTube transcript).
- [x] **Admin skill health**: `/admin/skills` now shows per-server health (calls, ok, errors, avg duration, last ok) over the latest 200 audit rows.
- [x] **Timeouts for slow skills**: MCP per-call 15 s, provider turn deadline 45 s; failure copy tells the creator to press Send again (idempotent request id).
- [x] **Unconnected-skill hint**: assistant tells the creator to connect at `/connections` instead of suggesting manual scraping.

## Staged / awaiting approval

- **A3.2 confirmed writes canary**: `PROPOSAL_SIGNING_KEY` (base64 32 bytes) is stored as a Vercel Secret. Execution remains dark:
  - `STUDIO_ASSISTANT_PROPOSALS` off,
  - `STUDIO_ASSISTANT_PROPOSAL_EXECUTION` off.
  - **Canary verified 2026-11-10 19:43 UTC**: the pilot creator pressed Confirm; `assistant_proposal_audit` shows outcome `executed` (request `7e37da85-…`, 925 ms), the thread revision went 0 → 1, and `studio_briefs` gained version 1 with 3 sections. Flags stay scoped to `936b9de1…` + `006c749f…` for now; roll back by removing the flags / allowlist.

## Known limits

- Mysocial `search_tiktok` may return “Creator Universe is not available for this connection” (plan/entitlement).
- HasData calls consume HasData credits (each TikTok/IG search ~1 credit; 8–10 s latency).
- Answer generation is still one-shot (no token streaming); progress steps are polled.
- 24h outcome watch for both providers not yet formally done.

## Next

1. Keep the canary scoped; collect a few more confirms and watch `assistant_proposal_audit` for failures.
2. Run the 24h provider watch (audit outcome mix, latency, credits) and record results.
3. Phase 2: streaming answers, provider-specific eval suites, source-link quality (started: link/unverified rule + larger skill result budget).
