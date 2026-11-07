# Launch review packet — BLOCKED / NOT AUTHORIZED

**P1–P4 implementation checkpoint:** [offline implementation status](offline-implementation-status.md), [protocol contract](real-protocol-contract.md), [account matrix](real-account-matrix.md), [provider schema review](provider-schema-review.md). Native HTTP/source/job/worker boundaries and review-only SQL now have offline tests; remaining runtime/OAuth/receipt/media-backend integration is explicitly listed. Do not interpret this packet as whole-phase completion or permission for P5/P6.

No launch action is requested or authorized by this document. Local release/recovery, restart and final build evidence passed as recorded below. Real pilot approval must name each action and exact artifact. The complete next-stage plan is [real Instagram controlled pilot](../../superpowers/plans/2026-11-06-kocmax-real-instagram-controlled-pilot.md); its offline preparation and later live execution have separate approval boundaries.

## Proposed controlled scope

Instagram only; 1 first creator, then up to 4 more only after independent first-result verification. One already approved brand-task JPEG per creator; exact caption/disclosure/account/version confirmation. Basic tasks remain available to nonparticipants. No Google Drive. No automatic publication, proof submission, settlement or post deletion.

## Missing artifacts

- Production authenticated authority/OAuth composition and complete production SQL parity. Final local builds passed; runtime restart and the original proof/settlement path are verified for the local mock rehearsal only. The current SQL review is a partial draft, not a complete deployable pilot schema.
- Exact environment/workspace/App/account IDs, callbacks, immutable code/SQL/rollback/roster/image/caption/disclosure hashes.
- Actual supported official login product, Graph version, minimum granted permissions/access level, account/brand label eligibility, verified identity/revocation/signed-notice contract.
- Named owner/operator/reviewer, costs/caps, execution window and post/read limits.
- Current target-bound restore point plus tested recovery evidence; separate scoped SQL review/application approval.
- Private evidence retention and concrete cleanup manifest/readback; media-host TTL and purge verification.
- Explicit environment/deployment/account/OAuth/post authorization, with any extra technical test post separately listed.

`controlled-pilot-preflight.ts` validates packet shape, supplied hashes and references only. It does not verify referenced files exist, independently compute evidence truth, or enable execution. `executionAllowed` is always false.

`controlled-pilot-artifacts.ts` now additionally provides independent byte/hash inspection. It is a separate read-only utility; the existing preflight has not silently gained artifact-truth or live-authorization powers. Actual App/roster/post/restore evidence is still missing, regardless of local file hashes.

## Go/no-go

Unknown result, wrong account, stale approved content, private-source leakage, unsupported label, duplicate proof/reward, revoke or cleanup failure stops expansion. Query known media only; never blindly repost. Local stop cannot undo a platform-accepted publication. After explicit creator proof confirmation, original reviewer and settlement authorities remain required.

## Persistent mock update

See [persistent acceptance](persistent-acceptance.md): runtime restart and same-task original proof/settlement are verified locally. The subsequent private receipt update closes the local collection linkage. Production authenticated authority/OAuth composition, hosted/provider acceptance and all live approvals remain missing. No launch permission is requested.

## Private receipt / OAuth mock update

[Private mock acceptance](private-oauth-acceptance.md) closes the local collection linkage and explicit consent/session/replay/generation/revoke rehearsal. The new local database passed the complete task, private version and process-restart journey. The old database is retained separately; its recovery disposition below does not certify the historical publication. Production authenticated OAuth/authority, provider evidence, hosted acceptance and every live approval remain missing. This packet is still BLOCKED.

## Release/recovery and restart update — 2026-11-06

- **Eight release failures CLOSED:** `release-repair-report.md` and `release-repair-final-unsandboxed.log` record the fixes and scoped **16 files / 138 tests passed**. Atomic rename and runtime-support policies were preserved.
- **Recorded full-suite PASS:** `release-recovery-full-suite.log` reports **412 files passed / 44 skipped; 4,534 tests passed / 363 skipped**, zero failures, 1,062.66 seconds. This run started at 20:44:10 and is separate from the later Vite lifecycle fix and its two focused passing regressions; do not combine these into a claimed full-suite rerun after that fix.
- **Actual restart verified:** `vite-keyboard-restart.txt` records `server restarted. (x2)` at 21:07:29. The controller directly verified a successful fixed cold start, two keyboard `r` restarts, and browser readback retaining **400 mock points / 1 ledger entry**. These are local rehearsal continuity results, not proof of the old future-XID publication.
- **Recovery disposition:** v6 evidence records **118 tables / 81 exported rows / 2 quarantined rows**, with `stopped: true`, `sampleOnly: true`, `liveReady: false` and provider revocation unverified. **81 is not the active-row count.** The source was a copy and the target fresh; the original's **1,704/1,704 hashes** matched its ledger with no missing or extra files. All **155 baseline SQL hashes** matched. The old future-XID outcome remains **unknown/unproven**; no publication, proof or reward was fabricated.
- **Final builds PASS:** default-off and opt-in production builds pass, with zero matches for nine mock and63 existing boundary markers. TypeScript passes; scoped lint has zero errors and four existing warnings. Final affected regression run:5 files/19 tests pass. See [release/recovery closeout](release-recovery-closeout.md) and [browser acceptance](release-recovery-browser.md).

Evidence filenames above are under `.superpowers/sdd/2026-11-06-kocmax-controlled-instagram-pilot/`. Skipped tests are not passes or hosted/provider evidence. Release HOLD remains: no deployment, remote SQL, real connection, staging or commit is authorized by these results.
