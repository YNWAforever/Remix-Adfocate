# Provider schema review — offline, incomplete launch bundle

Application order after a separate final review/approval: original pinned migrations (verify existing target history; do not blindly replay), `asset-attachment-changes.sql`, existing review `changes.sql` for jobs, then `provider-changes.sql`. None were applied remotely. The provider extension expects the original binding/authority functions and fails rather than silently applying twice.

## Authority and indexes

Provider sources reference creator/workspace, approved version/work item/workspace and connection/workspace/creator through composite foreign keys. The existing mission version triple unique key and connection/creator keys are reused. Source primary key is `(workspace_id, creator_id, version_id)`; revision tombstones add revision and remain after intent cleanup. Approval nonce has its own unique key. Existing intent revision uniqueness remains authoritative across repeated previews.

No new redundant index on intent ID, source PK or revision PK is added; no original index is dropped. The existing job PK covers intent lookup/FK prefix; its pending lease index is retained. Representative hosted production query plans are NOT_RUN; tiny memory fixtures do not establish production performance.

Browser roles cannot access private source/approval/tombstone tables or the provider command. Service role receives source attestation read/insert/update, job read/insert/update and provider command execution only. The pure JSON binding validator has fixed empty search_path and SECURITY DEFINER so its nested legacy validator can remain non-executable to service role. Actual PostgREST/private-schema exposure is not assumed; deployment wiring still needs review.

Every preview/reservation and original irreversible transition rechecks canonical mission/connection authority. The wrapper takes the existing integration advisory lock before owner locks. Source approval flags are trusted server attestations, never browser request fields. They do not replace App/label verification. Expiry, revoked/pending grants, restoration holds and tombstones block writes.

## Preservation and rollback

The binding-function rename preserves its OID, so the original intent CHECK is explicitly rebound to the new validator. Legacy no-mission bindings continue through the original validator/authority. The provider rollback restores the original names and CHECK only after proving provider evidence empty; it preserves original missions, ledgers and legacy intents. It refuses all missionBasis intent records, even an unexpected fixture row, rather than deleting evidence.

Source connection FK uses restrictive deletion. Before future account/connection cleanup, stop writes and produce an exact retained-evidence/erasure manifest; do not bypass this FK or cascade business evidence. The source cleanup/retention and private receipt bundle is still incomplete, hence remote application stays blocked.

The attachment repair is separately reversible through `asset-attachment-rollback.sql`; restoring the original guard also restores its inability to attach a ready unversioned asset. Do not treat that rollback as a desired normal operation or delete already approved assets.

Tests cover original upload and immutability, source provenance rejection, original SupabasePublishRepository RPC parity, repeat reservation, peer denial, grant pending, delayed processing, stop during accepted publication, RLS/ACL denial, and empty/nonempty rollback. No remote advisor or restore test was run because remote schema execution was prohibited.
