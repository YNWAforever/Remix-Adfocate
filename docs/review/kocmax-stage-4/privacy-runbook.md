# Stage 4 mock integration privacy runbook

Applies to this branch's local mock implementation. It is not evidence of production deployment, backup erasure, live provider revocation or regional data residency.

## Ownership and purpose

The server derives creator and workspace from the authenticated request. Integration records use both identifiers and composite references. Other creators in the same workspace, brands, reviewers and finance staff do not obtain private account credentials, filenames or excerpts through this feature. Existing staff and brand workflow projections remain authoritative.

Connection consent, file selection, processing rights, AI use and mission sharing are separate decisions. Source import is private. AI processing requires both its own consent and processing rights; unknown third-party rights fail closed. Without processing rights, the imported source contains a permission notice rather than a document excerpt. Re-importing the same active snapshot does not silently broaden previous consent; revoke the source and import again after reviewing its intended use.

Only selected sources enter that discussion's context. Save and share resolve canonical source and Brief records on the server. A short-lived permit binds the operation's content, source version, owner, generation and destination; SQL checks it again at persistence. Changed or revoked access blocks new derived output while retaining the user's editable text for review.

## Stop, revoke and reconnect

1. The local record is fenced first: generation changes, sources and permits become unavailable, in-flight work cannot land, cached answers cannot replay.
2. Mock provider revocation is recorded separately. A failed provider response means **pending**, not success.
3. The credentials retained for a pending revocation expire after at most 24 hours when cleanup runs. Unconfirmed provider revocation then requires manual action; credential deletion is not proof of remote revocation.
4. A delayed revocation result is bound to its own generation and cannot clear a newer connection.
5. Reconnect creates a new generation and fresh consent. It never restores old sources' AI or sharing permission.

If integration reading is disabled, the account-management list and local revoke/delete controls remain available. Keep the original manual sources and task routes enabled. Do not fall back to scraping or restore old credentials automatically.

## Delete, export and retention

| Data | Implemented local rule |
| --- | --- |
| OAuth state | Single use, session/owner/provider/generation bound, ten-minute expiry |
| Source-use permits | Sixty seconds, operation-bound, single consumption; content-free model lineage retained to prevent late-result bypass |
| Unreferenced snapshots | Thirty-day expiry; content-bearing result caches also invalidated |
| Revoked unreferenced snapshots | Expiry shortened to 24 hours |
| Saved private source / Brief | Remains owner-private until explicit purge or account deletion; revocation prevents new use and hides derived previews |
| Integration events | Minimal event data, ninety-day cleanup horizon |
| Provider credentials | Private schema, encrypted; no ordinary DTO, model, browser, export or log exposure |
| Purged source derivatives | Remove source and provider-derived Brief paragraphs; scrub assistant replies and cached results; independent creator paragraphs remain |
| Already-delivered task copies | Retained as canonical workflow records with minimal provenance receipt; the UI does not promise recall from recipients |

The account export uses pagination and includes the owner's safe integration records. Account deletion stops integrations before the original anonymization flow. The additive database deletion hook clears private integration data without replacing settlement or ledger functions.

Cleanup is an implemented command with local-clock tests, **not an active remote schedule**. Real operational retention needs an approved scheduler, monitoring and failed-cleanup retry evidence. The local preview resets data on reload; it does not demonstrate durable storage or backups.

## Failure handling and rollback

- An unknown sync result is reserved and never automatically duplicated. The UI keeps inputs and shows a retry/permission state rather than fabricated data.
- A permission denial clears private display caches; a later service error does not restore them.
- On refresh failure, require mock reauthorization. Never expose the underlying token, file text or provider error payload in user-facing errors.
- A deletion transaction failure remains incomplete and retryable. Preserve minimal identifiers needed to reconcile the request.
- Rollback disables new authorization, reading and synchronization; leave revoke, purge and the original mission flow available. Do not drop schema as a rollback action.

Before live use, document actual processors, processing region, retention contracts, backup restore/tombstone reconciliation, provider revocation/retry operation, key rotation and incident contacts. No zero-retention, Hong Kong hosting or completed provider review is claimed here.
