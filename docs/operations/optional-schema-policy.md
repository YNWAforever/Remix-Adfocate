# Optional-schema policy (decision record)

Status: **awaiting owner decision** (proposed 2026-11-09). Owner: release owner / workspace owner.
Related: `docs/operations/mcp-registry.sql`, `mcp-oauth.sql`, `assistant-tool-traces.sql`,
`docs/operations/production-release-foundation.md`.

## Why this decision exists

The release foundation requires every `supabase/migrations/*.sql` file to be classified in
`scripts/release/manifest.ts` with reviewed checksums and capability lists; CI (`release:check`) fails on
unclassified migrations. The MCP/OAuth/trace tables were therefore applied **out of band** (SQL editor /
direct DB with the stored credential), and a contract test keeps them from creeping into the migrations
directory. That was correct for pilot speed, but it leaves a manual step that can drift.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Keep out-of-band docs (current)** | No manifest churn; pilot speed; contract test catches drift of table/column/grant declarations. | Manual application is a runbook step; no checksum record of what was applied; needs periodic audit. |
| **B. Add to release manifest as reviewed optional migrations** | Checksum + capability review; CI catches edits; deployment can follow the standard flow. | Requires re-baselining `supabase_migrations.schema_migrations` for production (tracker drift) or a separate release path; more ceremony for small optional features. |
| **C. Hybrid: out-of-band now, reviewed migration at the next major release** | Keeps pilots fast; converts to the standard flow without an immediate re-baseline. | Deferred work; must not be forgotten; needs a named owner and deadline. |

## Recommendation

**Option C**, with strict conditions:

1. Keep the out-of-band docs + `optional-schema-contract.test.ts` guard for the current pilot features.
2. At the next major release window, consolidate `mcp-registry`, `mcp-oauth` and `assistant-tool-traces`
   into reviewed migrations, re-baselining the production tracker in a planned window (not via
   `supabase db push` on an ad-hoc basis).
3. Every new optional table requires: a docs/operations SQL file, a contract-test entry, and a runbook
   step (pre-flight + canary).
4. Quarterly audit: compare `docs/operations/*.sql` against `information_schema` and record the result
   in release notes.

## Decision log

- 2026-11-09: options + recommendation drafted; **owner decision pending**.
