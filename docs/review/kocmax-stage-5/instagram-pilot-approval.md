# Instagram pilot readiness and approval packet

Prepared 2026-11-04 on `codex/kocmax-studio-stages-1-2`, base HEAD `e491e2d`.

**BLOCKED — preparation only; not ready for live approval or execution.** This record assembles the offline work and identifies the exact missing inputs. It grants no permission. The reviewed design and offline implementation approval do not authorize new database changes, OAuth, external processing, public media hosting, publication or deployment. Google Drive remains outside scope.

## Proposed first live test

After the gates below are resolved and the completed packet is explicitly approved, the smallest proposed test is one immediate, unsponsored, non-mission, static JPEG feed post to one consented professional Instagram test account A. A separate professional test account B is the non-target control. The creator supplies or approves the exact image and caption. The final converted JPEG bytes, caption, target account and disclosure must be previewed and fingerprinted before confirmation. No points, XP or badges arise from this test.

The first post does not require RapidAPI or an external vision model. Keep both disabled and use the creator's self-upload/manual description. Their separate rights/processor records remain BLOCKED; they would require a separate named processing scope if later included. Username and BioCode verification are not permission to publish.

The existing Remix-Adfocate project `mhkoayftiuojxlrkollf` is the user's previously selected database. It is a shared existing database, not an isolated database. Any future use must be identified as a bounded test in that shared resource, with separate disposable identities, owner-scoped rows, private object paths and an isolated runtime. Its previous SQL approvals do not cover the two new growth/publication migrations below. No fresh connection, backup inspection or database read was performed for this record.

## Readiness register

| Input | Current state | Required completion |
|---|---|---|
| Exact code artifact | Local uncommitted branch; offline checks in the verification report | Freeze reviewed source fingerprint and exact runtime artifact before approval; do not substitute an older commit for current uncommitted bytes |
| Meta App / product | Unknown; protocol `contract: null` | Actual owner, App ID, Instagram Login product, access level, API version, role/tester access, exact callback origin/path |
| Identity and notices, IG-02 | BLOCKED | Proven mapping of App, token subject, professional profile subject and signed notice identity; ambiguous mappings must fail closed |
| Revoke, IG-01 | BLOCKED | Product-specific host/method/path/token/subject, success and retry rules; local-stop/provider-pending distinction |
| Authorization, IG-03/04 | BLOCKED | Reviewed product-specific authorization/token endpoints, actual grants and token lifecycle; no Facebook Login example substitution |
| Two professional test accounts | Not selected or connected | Consenting participants, private alias-to-subject mapping, A intended target and B non-target; credentials stay outside Git/chat |
| Actual granted permissions | None verified | `instagram_business_basic` plus `instagram_business_content_publish` for publication; `instagram_business_manage_insights` only if the separately named analysis test needs it; record actual granted/declined scopes |
| Native adapter and composition | Unimplemented/disabled | Reviewed Instagram Login transport, canonical grant vault/resolvers, bounded provider errors/timeouts, exact-ID reconciliation and isolated worker registration; mocks cannot be switched into real transport by a flag |
| Image preparation | No real decoder/converter enabled | Reviewed MIME/size/dimension/JPEG validation and conversion before final hash/preview; exact versioned provider limits and image rights |
| Native mission evidence | Unwired | Trusted official receipt resolver and durable immutable original mission/instruction snapshot before enabling proof handoff; current sample receipts always denied |
| Temporary media hosting | None | Exact isolated host, route, network reachability and expiry; opaque holder-readable URL, rate/size limits, no token or private path; expiry/revoke readback; no production deployment inferred |
| Database restore | Not reverified | Current usable backup/restore identity, successful disposable restore and pre-apply fingerprint for the exact shared target; historical backup reports are not a current restore proof |
| Real Auth / RLS / concurrent workers | Not verified in this phase | Disposable nine-persona accounts, native independent-session reserve/CAS/revoke tests, actual role/grant readback and approved cleanup |
| First image / caption | Not selected | Exact local asset, final JPEG SHA-256, caption and disclosure hash, approved account subject; no synthetic UI receipt or screenshot as real evidence |
| Window / budget / cleanup owner | Not selected | Start/end time, bounded cost and request budget, named operator and creator handling public-post cleanup |
| RapidAPI / vision / Drive | Disabled | Excluded from this first test; see separate rights and processor records |

Current observations and unresolved protocol facts are in [the protocol manifest](instagram-protocol-manifest.md). That record links the primary documentation reviewed on 2026-11-04. No new platform capability is asserted by this packet.

## Exact prepared SQL and rollback boundary

| Order | Unapplied migration | SHA-256 |
|---|---|---|
| 1, after verifying its existing prerequisites | `20261103215321_kocmax_creator_growth_private.sql` | `bfe4fab81bb23198a2f57c804a521b03b83c2a41815acc86f8966ac49b2d0e43` |
| 2, after growth | `20261104134202_kocmax_publish_intents.sql` | `d740d13d59e722548d4396639b62f9423ba1b287e42c639032c0f0de09a45eb7` |

The controller read both hashes from disk. The growth proposal adds11 private tables and66 catalogued indexes; the publication proposal adds4 private tables and20 indexes. Existing source-lifecycle triggers receive additive hooks. The index/FK/grant checks and publication's exact rollback check run only in disposable PGlite. This is not live PostgreSQL concurrency, database advisor, backup-restore or Auth/RLS acceptance.

The [growth SQL review](creator-growth-sql-review.md) now includes the exact [whole-growth rollback file](creator-growth.rollback.sql), SHA-256 `61c65aed95ca6ebb523bbf8ee91e01ab3543bc0c4b60d3e7524f0585b66d30cd`. Its13 disposable PGlite cases pass after correcting bucket preservation; independent review is tracked in the local verification report. The private bucket is always retained because the forward migration may have reused it. Any later bucket removal requires verified pre-migration provenance and a separate exact cleanup action; this script has no delete option. The [publication SQL review](instagram-publish-sql-review.md) also contains an exact rollback body exercised in PGlite. These are prepared scripts, not live backup restoration or permission to execute. Stop new work and capture unresolved original-target receipts before rollback. Remove publication objects before their growth prerequisites. The growth file refuses remaining publication dependencies, a nonempty private bucket or unfinished cleanup, uses bounded table-lock waiting, and never deletes Storage objects. Quiesce uploaders and workers separately: database locks cannot stop an external upload. Do not drop the shared `private` schema, use broad CASCADE, or edit previously applied migrations. Dropping metadata does not prove file deletion. Publication consumption markers cannot be discarded and then used to justify repeating an external post. An unknown result stays held for reconciliation or an approved privacy disposition.

Before application, regenerate a concrete target-specific apply/readback/cleanup script using the final fixture IDs and current catalog. Record backup ID/time, restored database evidence, baseline mission/approval/ledger/XP/badge rows, functions/triggers/grants, existing index definitions and exact scope of allowed new rows. They are intentionally absent now. The prior D1 execution/cleanup packet must not be repurposed.

## Test accounts and data

Use fresh disposable application identities, not historical D1 sessions: creator A; same-workspace creator B; other-workspace creator C; brand member; brand owner; operator; reviewer; finance viewer; workspace admin. Actual Auth IDs and workspace IDs remain unassigned. The Instagram aliases A and B are a separate two-account control set; nine application roles do not imply nine Instagram connections. Bind each actual professional subject explicitly to the intended application creator.

Fixture manifest fields must include run ID, exact target project, owner/workspace IDs, Auth IDs, connection IDs/generations, thread/asset/draft/consent/intent IDs, approved checksums, original mission/submission/proof IDs if subsequently in scope, object paths, container/media IDs, lease IDs, request IDs and retention deadline. Store secret tokens, session material, raw nonces and holder-readable media URLs only in the approved private runtime/evidence location; sanitized reports use aliases and bounded receipts.

The initial test uses no real brand mission. A later exact approved mission test must preserve its original reviewed content/instructions, confirmation, proof validation, review and ledger settlement. A proof proposal or provider success never awards points. Any testing of the original reward path needs an explicitly disposable mission and frozen reward contract in the same concrete approval packet.

## Required acceptance cases

1. At390×844 and1440×1000, A sees the full final image/caption/disclosure, intended @account and immediate action; decline, expiry, content changes and account/grant changes block stale confirmation. Keyboard and navigation recovery remain usable while confirmation is pending.
2. One confirmed intent produces at most one create claim and one publish claim. Independent workers/tabs cannot turn a replay into another POST. Ambiguous provider results become `outcome_unknown`, with no automatic second publication. Reconciliation needs the exact original target/container/media and a durable publish claim; a create/polling interruption cannot manufacture a published receipt.
3. Observe exactly one real media ID/permalink on A and no publication on B. Record provider time, API version, exact requests tested and source references; unavailable metrics/HK coverage remain unavailable or unverified, not zero.
4. Actual nine-persona JWT/RLS/API checks deny A's private content to peers and unrelated roles. Test direct routes, stale callbacks, sign-out, Back/Forward/Reload and native concurrency. The current synthetic browser matrix is preparation, not this acceptance.
5. Revocation immediately stops future local operations and media serving. Provider revocation is independently observed or remains pending/manual; it cannot retroactively cancel a post already accepted externally. Test changed-account reconnect and ambiguous/wrong-App notices without affecting another grant.
6. Sponsored labels/tags unsupported by the reviewed adapter retain the original manual proof path. Do not substitute caption disclosure for an unsupported required platform label.
7. Proof handoff, if separately included, rereads canonical approved version/instructions, requires a verified non-sample receipt and creator confirmation, and delegates to the original idempotent proof transaction. Duplicate proof submissions do not create another award path. Pending rewards remain pending; XP0 remains valid.
8. Cleanup verifies exact test rows, files, leases, tokens/sessions and grants; retained unknown audit is explicitly listed. Independent readback confirms no unrelated mission/approval/ledger/XP/badge drift and no secrets in logs. Failed cleanup or an unresolved external result is not PASS.

## Cleanup and stop conditions

Stop on wrong target/account, changed source hash, unexpected permission, missing restore proof, cross-owner access, uncertain publish result, unsupported disclosure, secret leakage or failed cleanup. Disable new work first, close media leases, retain minimal exact-target audit, and reconcile with read-only calls. Never retry a write merely because a UI or transport timed out.

Creator-owned public-post cleanup is a separate explicit action with a recorded result. Database or local object deletion does not remove an Instagram post. Account/grant cleanup likewise distinguishes local stop from provider revoke. Delete only the manifest's disposable test identities/objects; no production user, historical D1 evidence or unrelated rows may be touched. Preserve original idempotency/consumption evidence before re-enabling any native work after rollback.

## Approval still required

Once all required fields above are concrete and reviewed, present one bounded packet listing each requested action: exact SQL on the named target; disposable Auth data; scopes and OAuth to named accounts; isolated runtime/media-host changes; exact first JPEG/caption publication; test window/budget; and exact cleanup/public-post actions. One approval may cover those listed actions. No such approval is requested or inferred while the packet is incomplete. The [execution record](instagram-pilot-execution.md) remains NOT RUN.
