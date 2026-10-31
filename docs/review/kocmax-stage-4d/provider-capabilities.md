# Stage 4D provider adapter contracts (D0)

Status: D0 offline adapter implementation on base `3fcdda17dee4a349ed791f305d44f5765d7924ff`, shared branch `codex/kocmax-studio-stages-1-2`. The scoped counts below describe the adapter checkpoint; final combined verification is in [verification.md](verification.md). No provider account/API calls, deployment or live acceptance.

## Integration contract

- `ProviderHttp(fetchImpl, { transportKind?: "fixture" | "live", timeoutMs?, maxReadRetries? })` exports `json<T>(request)` and `bytes(request): Promise<Uint8Array>`. No default global fetch. Transport kind defaults to `live`: an unclassified injected fetch can perform network I/O and must be rejected by D0. Offline composition must explicitly pass `transportKind: "fixture"`.
- `ProviderHttpPort` requires readonly `transportKind`, `json<T>` and `bytes`.
- `GoogleDriveLiveProvider({ http, clientId, clientSecret, grantProject, verifyIdentity?, isSelected? })`. `verifyIdentity(idToken: string, nonce: string): Promise<{ subject: string }>` is injected by OAuth orchestration and must validate signature/issuer/audience/expiry/nonce. Missing verifier fails closed. `isSelected(connection, externalId)` is a server-owned selection-authority callback, default deny; `files()` returns `[]` without listing Drive. Main owns Picker and this authorization callback.
- `InstagramLiveProvider({ http, clientId, clientSecret, apiVersion, grantProject? })`. `apiVersion` must equal exported `INSTAGRAM_API_VERSION = "v26.0"`; other/missing values fail closed. `grant.subject` is the verified professional `user_id`; the code-exchange Instagram-scoped ID is checked against the profile's `id` where provided. Single-object and documented single-row `data` profile responses are accepted.
- Both expose `mode = "live_pilot"`, `sampleOnly = http.transportKind !== "live"`. Offline fixtures remain samples even when protocol responses match live shapes.
- `authorize(code, actor, now, { redirectUri, codeVerifier?, nonce? })`. Google requires verifier + nonce. Grant includes `issuedAt` and `grantProject`; Instagram does not invent a Google-style refresh token.
- Request: `{ url, method: "GET" | "POST" | "DELETE", headers?, body?, signal?, operation: "read" | "oauth" | "refresh" | "revoke", maxBytes? }`.

The shared worktree implementation is limited to the assigned adapter/HTTP/content/manifest paths. Main owns root types, policy, OAuth, credentials, runtime and UI.

`isSelected` must cover the authenticated actor, workspace, connection and generation, using persisted selected resources. It must not simply return true for any file that Google allows. The callback is checked before and after reading; it is independent of provider ACL checks. A missing callback denies normal `.file()` reads. Google grant-project mismatch fails before requesting provider data.

Initial registration bridge: `GoogleDriveLiveProvider.selectedFiles(connection, grant, ids): Promise<ProviderFile[]>` validates 1–5 unique bounded IDs, copies/freezes the connection and ID list, captures the grant, and constructs a temporary reader with an immutable request-local closure matching `creatorId + workspaceId + connection.id + provider + generation + ids`. It performs ordinary metadata/download/parse/recheck for each candidate. No shared or global allowset is modified, and the normal durable reader stays unchanged. This method is for main's authenticated, explicitly consented Picker registration command; it is not exposed as a model or public arbitrary-file tool. Main must revalidate owner/generation before committing selections. `withSelection(callback)` is the underlying new-instance factory; it never mutates the original adapter.

JWKS composition export in `providers/googleDriveLive.ts`: `createGoogleSigningKeyResolver(http): (kid: string) => Promise<JsonWebKey | null>`. It uses only `https://www.googleapis.com/oauth2/v3/certs`, caps the body to 64 KiB and set to ten keys, rejects duplicates/malformed RSA signing metadata, strips non-public/URL properties and returns null for an unknown key. It does not implement token verification; compose it with main's `verifyGoogleIdentityToken(token, { clientId, nonce }, resolver, now)`. There is no token-derived key URL or ambient HTTP client. Key lookup is request-bound (no stale key cache); the shared HTTP read bounds apply.

`ProviderGrant.issuedAt` and `grantProject` remain server-only. Google's returned refresh token is retained if rotation is omitted, replaced if returned, and its actual reduced scope list is preserved. An initial response without a refresh token remains an expiring access grant; later refresh fails closed. Main owns single-use OAuth state, nonce/PKCE creation, callback/session binding, JWKS identity verification, persistent encrypted credentials, refresh leases, deauthorization callbacks, local generation changes and grant-wide revoke coordination.

## HTTP boundary

No module import or constructor starts HTTP. `ProviderHttp` requires an injected transport function and never chooses global fetch. Fixture transports are test/preview code supplied by the composition root; provenance labels are not a network firewall. Main's D0 composition must supply fixtures only and reject `sampleOnly !== true`.

The fixed allowlist is method + operation + endpoint, not just hostname:

| Operation | Allowed endpoint |
| --- | --- |
| Google code/refresh | POST `oauth2.googleapis.com/token` |
| Google revoke | POST `oauth2.googleapis.com/revoke` |
| Google identity keys | GET `www.googleapis.com/oauth2/v3/certs` (main's verifier may use the port) |
| Drive selected metadata/download | GET `www.googleapis.com/drive/v3/files/{id}` |
| Drive selected export | GET `www.googleapis.com/drive/v3/files/{id}/export` |
| Instagram code | POST `api.instagram.com/oauth/access_token` |
| Instagram long-lived/refresh | GET `graph.instagram.com/access_token` / `refresh_access_token`, tagged oauth/refresh, never retried |
| Instagram data | GET versioned `me`, numeric user/media ID and media/insights paths |
| Instagram revocation candidate | DELETE versioned `{user-id}/permissions`; reference confirmation remains a live-release blocker below |

HTTPS only, no userinfo/custom port/fragment, no path escapes, Graph method overrides or JSONP. Redirects use `error`; any returned redirect status/redirected response is rejected. Cookies, caching and referrer are disabled. Errors retain only a fixed code/status and bounded retry metadata; upstream messages, body, URLs and tokens are not logged or attached to errors. The documented Instagram token exchange/refresh protocol carries secrets in query parameters internally; transport instrumentation must not record request URLs.

Default deadline is 10 seconds for the complete request including body/retries (configurable 1–30 seconds). Streamed bytes are counted regardless of `Content-Length`; hard maximum 5 MiB, default JSON maximum 256 KiB. Abort-ignoring transports and stalled body reads are bounded. Error bodies are cancelled before backoff. Only idempotent read GETs retry, at most twice. `Retry-After` is honored; values exceeding the 2-second retry budget return a rate-limit error instead of retrying early. Three consecutive read failures open a 30-second local transport circuit. Lifecycle operations remain available. This circuit is not a distributed quota service; main's persisted 60-minute creator sync cooldown remains authoritative.

## Instagram capability matrix

Primary version/metric evidence: [Instagram Media Insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights), observed by the coordinating task on **2026-10-31**, page updated **2026-09-11**, explicitly identifying `v26.0`. No real app/account permission status was inspected.

| Media returned by own media edge | Requested provider metrics | Normalized keys | Measurement |
| --- | --- | --- | --- |
| IMAGE / FEED | reach, views, likes, saved | reach, views, likes, saves | lifetime |
| CAROUSEL_ALBUM / FEED, container only | reach, views, likes, saved | reach, views, likes, saves | lifetime |
| VIDEO / REELS | reach, views, likes, saved | reach, views, likes, saves | lifetime |

Stories, Live, carousel children, other feed videos, advertising aggregates and demographics are excluded. `total_likes`, `total_comments` and `total_views` are not requested. A single `values[0].value` or `total_value.value` is accepted, including both when they agree; multiple values, contradictory totals, duplicates or non-lifetime periods fail closed. Empty datasets stay null/missing, numeric zero stays zero, rejected metric combinations are unsupported/partial. The reference notes data may lag up to 48 hours. No reach aggregation or Hong Kong/language claim is inferred.

Media selection uses exact instants in the preceding 30 days, including UTC/HKT boundaries; it is not the measurement period. At most 50 eligible media and five pages are examined. Next URLs are checked against the exact version/subject/media path, but only their validated cursor is used to construct the next fixed request. Duplicate media/cursors are bounded. A later transient/rate-limit failure preserves earlier results with partial coverage; auth/cancellation/malformed data fail. Incomplete empty scans fail instead of claiming a complete empty result. `media_url` is neither required nor downloaded. Valid Instagram permalinks are retained without query parameters. `evidence` records API version, endpoint, lifetime, selection period and optional permalink; `period` remains null.

Lifecycle evidence directly read in the background browser on **2026-10-31**: [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login), page updated **2026-03-13**, and [Get Started](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started), page updated **2024-12-02**, showing versioned v26.0 examples. The code-exchange `permissions` field is the source of actual scopes, including partial grants. Code is exchanged once for a short-lived token, then once for a 60-day long-lived token. Refresh uses the long-lived token itself, requires basic scope, age at least 24 hours and an unexpired token; there is no invented refresh token. Provider `expires_in` governs the stored deadline.

**Remaining protocol release blocker:** the bounded DELETE permissions implementation is covered only by offline request/success/failure fixtures. This run could not establish an explicit current Instagram Login revocation reference. Confirm the exact DELETE path, supported subject ID and success response from primary documentation before permitting a live Instagram transport; then test the authorized app separately. The metric/API pin is verified and is not this blocker.

## Google Drive and content

[Google server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server) and [Drive downloads/exports](https://developers.google.com/workspace/drive/api/guides/manage-downloads) were read on 2026-10-31. Desired live scopes are `openid` + `drive.file`; the original mock scope remains unchanged. `drive.file` includes provider write capability. The adapter offers only selected-file content reads and lifecycle management; it never lists files, uploads, edits, deletes or shares content. Picker is a separate main/UI-owned channel.

Metadata must identify the selected ID, a supported MIME, version, non-trashed state and `canDownload=true`; Shared Drives and shortcuts/folders are rejected. Docs are exported as plain text; text/PDF bytes use `alt=media`. Declared binary sizes and actual bodies are bounded to 5 MiB; Docs without a byte size are still stream-bounded. Metadata is fetched again after parsing, and any name/MIME/version/size/permission change discards the content. Rights remain unknown even when `ownedByMe=true`; separate evidence must justify downstream processing/sharing. Main's existing normalizer retains the full content hash and caps excerpts to 8,000 Unicode code points; main's selection transaction enforces five files.

PDF extraction uses [Mozilla PDF.js](https://github.com/mozilla/pdf.js/releases/tag/v6.4.299), pinned `pdfjs-dist@6.4.299` with a lockfile. It runs in a separate Node worker, with no document URL, external resource paths, font/image rendering, eval or script actions; fetch is disabled inside that worker. Parser output is not forwarded to logs. Limits: 4 seconds, 100 pages, 5 MiB text, 64 MiB old heap / 16 MiB young heap / 4 MiB stack. These V8 budgets do not claim a total OS/native-memory limit. Encrypted, empty/scanned, corrupt and over-budget inputs fail with a generic unsupported-file result. No OCR. Workers are terminated and bytes are not saved to disk.

Runtime compatibility: dependency requires Node >=22.13.0 (tested on Node 24.18.0). The `.mjs` worker and dependency must be packaged with a future approved deployment. The application build passed in the combined D0 verification; that does not verify server-worker packaging on a target host.

## Offline verification and limitations

Meaningful assertions failed before implementation: HTTP 17/17, Google/content 20 failures, Instagram 11/11; further red checks covered circuit breaking, incomplete empty pagination, documented wrapped profile shapes and immediate error-body cancellation. Final scoped command:

```powershell
node node_modules/vitest/vitest.mjs run server/lib/integrations/providerHttp.test.ts server/lib/integrations/providers/googleDriveLive.test.ts server/lib/integrations/providers/instagramLive.test.ts server/lib/integrations/driveContent.test.ts server/lib/integrations/instagram.test.ts server/lib/integrations/googleDrive.test.ts --maxWorkers 2 --minWorkers 1 --reporter=dot
```

Result: **89 passed across six files**, including unchanged mock normalizer regression tests. Synthetic fixtures exercise token rotation/omission/expiry/partial scopes, malformed identities/data, redirect/host denial, streamed limits, Retry-After, cancellation, permission/version changes, real text and compressed/encrypted PDFs, page limits, immutable candidate selection, unknown/duplicate/oversized JWKS sets, zero/missing/unsupported metrics, agreeing/contradictory metric shapes, lifetime versus selection window and pagination bounds. Scoped TypeScript and ESLint checks cover only the owned implementation/tests. No broad suite or build was run.

These tests do not establish live OAuth, actual app scopes/revocation, real Picker, Auth/RLS, durable refresh coordination, hosting/bundle behavior, provider quotas or long-term token expiry. No remote database, OAuth app, secret store, provider/model account API, push, deploy or commit was used. The only downloaded dependency was the explicitly permitted pinned PDF parser and its lockfile dependencies.
