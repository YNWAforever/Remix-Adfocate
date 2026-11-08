# Native offline wiring and launch boundary

Started 2026-11-06; continuation verified 2026-11-07 (Asia/Singapore). Branch `codex/kocmax-studio-stages-1-2`, base HEAD `e491e2dd30f42090458eacb82777d45b67275627`. Unstaged work; no deployment, remote SQL, real connection, real login or publication. P5/P6 remain unauthorized.

## Implemented composition

`createNativePilotRuntime` assembles the SQL job repository, SQL final-JPEG storage, lease controller, private receipt store, native worker and authenticated application services. Construction is inert. SQL, original repositories, verified-session resolver, creator authorization, immutable snapshot loader, protocol-gated publisher and media validation are explicit server dependencies. No secret lookup, client construction, worker loop or default provider fetch is added.

The original `createApp()` now registers `/api/creator-growth/pilot` behind `workspaceAuth`. Without explicit server dependencies every operation returns `PILOT_DISABLED`. Existing application entrypoints provide no dependencies. The old publication route and all original mission/reward routes remain unchanged.

| POST operation | Request | Behavior |
|---|---|---|
| `/preview` | submissionId, workItemId | Re-resolve original approval and issue session-bound preview |
| `/approve` | original IDs, approvalId, nonce, fingerprint, requestId, confirmed | Reserve once and enqueue; no automatic proof/reward |
| `/status` | intentId | Owner-only read; session checked again after repository await |
| `/collection` | intentId | Private approved content, original source references and durable receipt |
| `/prepare-proof` | intentId | Read durable receipt and original immutable instructions; propose explicit handoff |
| `/confirm-proof` | proposalId, fingerprint, confirmed | Consume session-bound confirmation and call original proof gateway |

Routes reject extra fields, over-limit bodies and cross-origin commands. Actor/workspace/session comes from verified middleware and is rechecked by the bound application resolver; browser actor/role fields are rejected. Responses use `no-store`. Proof confirmation does not publish again, review itself or award points. A process restart invalidates an outstanding in-memory proof proposal; the creator must prepare it again. Durable original proof idempotency survives restart.

## Persistent final-media origin

`SqlNativeMediaStorage` stores only the approved final JPEG in a private database row. It does not make an existing Storage bucket public. The separate, default-unmounted `/pilot/:workspace/:creator/:intent/:lease.jpg` route serves an exact lease capability with `image/jpeg`, `nosniff`, `no-referrer` and `no-store`. Do not put a CDN or caching proxy in front of this origin.

Reservation, put, close and fetch are database operations. A closed reservation blocks delayed writes and cannot be reused after reconstruction. Expired bytes cannot be fetched. Explicit cleanup removes expired bytes while retaining the reservation. The native lease layer still requires server-authorized ownership, validated JPEG metadata, rights and an exact byte hash before storage.

Reserve/write/read also join the original intent to an active creator in SQL. Only unstopped, non-sample pre-publication states may expose bytes. Published, unknown, cancelled, failed and invalidated intents deny origin reads immediately, even if the worker crashes before purge. This avoids relying on revocation triggers that intentionally do not stop already-published intents. Receipt reconciliation reads provider media IDs, not this temporary JPEG origin.

Actual origin reachability, Meta fetch, CDN behavior, secret/hosting configuration and timed purge observation remain P5/B8 acceptance. A local SQL test does not establish them. No origin was provisioned or made public.

## Private receipt and original proof

The native worker stores its exact target-bound accepted media ID first. After a verified media read, it persists the private immutable content/instruction/receipt snapshot before the final published transition. Recovery preserves the first observation timestamp; a lost storage response must not change the receipt hash or trigger a second publish.

Collection reads require a current authorized owner and a confirmed published intent. Unknown/stopped/sample/mismatched receipts cannot become proof candidates. Facebook-product receipts require the matching provider mission binding; original Instagram Login semantics remain separate. JSONB instruction comparison is structural, preserving array order.

No private brief or source image URL is added to the media origin. Collection remains private and does not grant reusable publication approval. Existing saved-result and copied-draft rules remain unchanged.

## Complete review-only SQL bundle

`native-offline-bundle.sql` combines these reviewed component scripts into one transaction:

1. `asset-attachment-changes.sql` — narrow one-time original approved-asset attachment repair.
2. `changes.sql` — durable job checkpoints.
3. `provider-changes.sql` — exact original source authority, one-use previews and lifetime version reservations.
4. `media-storage-changes.sql` — private final-JPEG leases.
5. `receipt-storage-changes.sql` — private immutable receipt snapshots.
6. `job-cleanup-changes.sql` — original terminal/unattempted retention compatibility; unknown attempts are held.
7. `provider-retention-changes.sql` — connection deletion makes sources unavailable and clears only the nullable historical FK, retaining version reservations.

`native-offline-rollback.sql` reverses that sequence in one transaction. It refuses retained source/receipt/media/job evidence rather than deleting rows to make rollback succeed. Empty apply/rollback passes against the full original schema in PGlite. New PK/unique/pending indexes were checked for duplicates; original indexes were not removed.

The bundle assumes the original publication/integration/mission schemas from this branch. It is not evidence that those prerequisite migrations are present in the shared remote database. P5 must inventory the actual target and separately approve every missing prerequisite before any execution.

Original retention cleanup and creator `status='deleted'` are exercised with media/receipts populated. Parent deletion erases bytes/snapshots and retains detached reservation fences. The job checkpoint is removed only with its authoritative terminal/unattempted parent. Unknown attempts remain held. No source migration file was modified and no remote migration history changed.

## Evidence interpretation

`native-journey-fixes.log`: 68 passing focused tests. `native-cleanup-parity-final.log`: 7 passing full-schema tests, including upload/finalize/submit/approve → fake native publish → persisted private receipt → creator proof confirmation → original proof RPC → reviewer → operator → original settlement. Repeated settlement leaves exactly one 400-point mock ledger entry. `receipt-recovery.log`: four passing worker cases including lost receipt-storage response, with one publish attempt. `native-bundle.log`: empty full-bundle apply/rollback passes.

Final frozen regression: `frozen-native-regression.log`, **212 PASS / 31 files**, no failures or skips. The strengthened success case now uses SQL JPEG storage and the native lease during the fake provider's image fetch, then calls the real native collection/prepare-proof/confirm-proof route handlers with explicitly mocked verified middleware. No network request or real account is involved. Original retention cleanup and creator deletion are tested with receipt/media rows present.

The earlier mixed whole-repository run (`continuation-full-suite.log`) was **4,580 PASS / 2 FAIL / 364 SKIP**, with one additional suite setup failure from a build timeout. It overlapped new RED tests and a test-harness parser correction. It is not a clean full-suite result. The frozen Native run verifies the final code and resolves both failed test cases; the separate bundle isolation rerun covers the timed-out suite. Do not add overlapping counts or relabel that historical run as PASS.

`continuation-preservation.json`: all 155 baseline SQL files and all 1,704 original local database files retained matching hashes. Original database files were not opened for recovery or mutation.

Browser verification covers the preserved local mock product at 320/390/430/1024/1440, reload, private-source redaction and colleague denial. It does not claim that the browser used a live/native provider service: the native backend path is exercised separately in process with mocked effects. Real nine-account sessions, App identity, OAuth/notice/revoke, sponsorship label and origin behavior remain unverified.

The exact App-specific OAuth/notice contract is still unavailable. No endpoint, permission or signature rule was invented to close P1/P3. The approval package stays HOLD until those external facts and the exact environment/roster/content/restore fields are supplied and verified. Passing this offline wiring does not authorize P5/P6.

Final isolated bundle check: `frozen-bundle-boundary.log` reports **1 PASS / 1 file**, 106.56 seconds. This resolves the earlier build-timeout verification gap without changing the historical whole-suite result.
