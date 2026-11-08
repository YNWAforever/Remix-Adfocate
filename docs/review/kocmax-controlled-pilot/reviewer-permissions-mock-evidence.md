# Reviewer permissions and evidence validation — offline mock

2026-11-07. Native work on the existing branch. DEV - Ads integrations are unchanged. No settings edits, connections, SQL, deployment or posting.

## Implemented service boundary

`createMockReviewerService` wraps the existing durable journal without changing its format or replay behavior. The service exposes review, correction and history operations. The raw journal is an internal trusted storage/harness capability; it must not be handed to an untrusted caller or exposed by a route. No route is mounted by this work.

Reviewer identity comes from an injected mock session resolver, not a request field. Each operation resolves current active status and an explicit grant for the exact App, event key, notice/consumer-inventory fingerprint and consumer ID. Read, review and correction are separate actions. Missing or mismatched grants deny before journal access. Revocation is checked on subsequent calls, including reads and repeated writes. History records are checked against the authorized target before returning a copy; a mismatched stored fingerprint is denied.

The injected evidence registry resolves the requested digest. The service recomputes a canonical SHA-256 digest over fixture provenance, target, decision, evidence body, observed/expiry times and revocation state. Evidence must match the requested target and decision, be nonempty and at most 8 KiB, have safe-integer times, not be future-dated or expired, and not be revoked. Registry/session failures return generic errors rather than private diagnostics. Raw evidence and additional request fields are not forwarded to the journal.

Corrections pass the same checks and require a separate correction grant, valid predecessor digest and nonempty reason of at most 2 KiB. Only the reason digest is persisted. Original review records, audit history and unknown delivery outcomes remain unchanged; no decision authorizes a retry or proves provider completion.

## Trust and remaining blockers

These are trusted injected fixture sessions, grants and evidence records, not real authentication or provider-signed evidence. A checksum verifies consistency with the mock registry, not factual truth. The reason is a bounded reviewer statement, not independently verified evidence. Production still requires authenticated sessions, authoritative grants and revocation, independently collected provider evidence, account/workspace mapping, secure composition preventing raw journal access, privacy/retention rules, and separately approved live operations. No mock result closes these gates.

Existing filesystem durability/recovery limitations remain, including stale-lock handling and no power-loss or coordinated-rollback guarantee. The service is synchronous; converting resolvers to asynchronous real services would require renewed authorization checks before mutation and a concurrency review. The existing low-level journal remains available to trusted tests for compatibility, so this wrapper is not a repository-wide security boundary.

## Verification and package inventory

Initial RED: missing new service module. Initial focused GREEN: 18 tests. An additional history-fingerprint denial test failed before its fix; final targeted regression: 96 PASS / 11 files, including 20 permission/evidence cases. These cover session-derived identity, inactive/revoked reviewer, wrong App/event/fingerprint/consumer, absent action, separate correction authority, tampered/expired/future/revoked/mismatched/oversized/missing evidence, resolver errors, reason bounds, returned-history binding, and authorized review/correction through an actual local journal and reopen. Changed-file lint passed.

No UI changed and mobile/desktop browser checks were not rerun. No full-suite or live acceptance claim. Status HOLD; execution disabled.

The existing artifact inspector has a 100-entry limit. Preserve that limit and all prior inventory: add only the new source, test and this evidence document (97 to 100 entries). Log paths and byte hashes are recorded below rather than added as separate top-level entries. These nested hashes are recorded evidence and are verified separately; the existing inspector does not traverse this document.

Final TypeScript --noEmit PASS (exit 0). Independent scoped review found no Important findings within the trusted offline scope.

| Log path | SHA-256 |
| --- | --- |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/permissions-red.log | 471a88b57cde1ecaac0a3aeb8f8703039b1d698e9c6665dbcafbf87feeb59fdc |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/permissions-green.log | c874e610148d8780825ff98d76136a3052320b041bc41d7ba92f05122f2e353f |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/permissions-history-red.log | 9e2219133b21b512175d68a63d3a3fbdbc8ca04b5bc47bb37784bac434d3972e |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/permissions-regression.log | 5f0fcf0a5734b91ffde7e3bf888d84eb5c40ee705717f45ee9e8ed4607d395ef |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/permissions-types.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/permissions-lint.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |

## Mock reviewer session and revocation follow-up — 2026-11-07

The mock reviewer now requires a session alias, issue time, expiry time and explicit revocation state. Every action checks the current active reviewer, current exact-target grants and a valid unrevoked session. Missing/malformed/future/expired sessions fail closed; the expiry boundary itself is denied. Signed-out resolvers return no reviewer. This models local access checks only, not an Auth login, cookie, bearer token or refresh-token protocol.

The service captures reviewer/session identity and rechecks access immediately before review/correction persistence and after history retrieval before returning it. Session replacement, account switch, grant removal, expiry or revocation during injected resolver work denies the operation. Fresh sessions receive no inherited permission: current grants still apply. Repeated requests after revocation are checked before idempotent journal access. Existing audit history remains intact; revocation cannot retract data already returned or undo completed effects.

Tests-first RED:11 failures/21 passes; initial GREEN32/32. Final targeted regression110PASS/11files including34 reviewer permission/session cases. New checks cover all-action expiry/future/revocation/missing/invalid times, signed-out sessions, repeated replay after revocation, mid-operation changes, new-session least privilege, correction session switch and history reviewer switch. The durable integration verifies that revoked access is denied while reopening still shows the two original audit records and unknown delivery outcome. Lint PASS. No frontend changes or new mobile/desktop browser verification. This is not real refresh-token replay or distributed revocation acceptance.

Remaining live requirements: authoritative session store, secure credentials/session transport, authenticated reviewer mapping, persistent revocation/expiry across processes, async transaction/race analysis, independent provider evidence and operational approval. A stale or malicious trusted mock resolver is outside these guarantees. No live route, DEV - Ads setting/integration, SQL, connection, deployment or post changed. HOLD; execution disabled.

Final session-phase TypeScript --noEmit PASS (exit 0). Scoped review found no Important findings in the offline scope.

| Log path | SHA-256 |
| --- | --- |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/sessions-red.log | 7895ac51ad57baa76221d9c823253e9e7a283f73f1e8f2bc9ac655f9f2dfa6ff |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/sessions-green.log | b7dd53d1369b5a03d9125cb41ddab4e3f9f419f6377e1ed4af53e83708c89046 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/sessions-regression.log | eb156f9e6b8d4d8de244f98123655284b041bbfd6dcb2cefaa0940648a157c69 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/sessions-types.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/sessions-lint.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |

## Mock session persistence across restarts — 2026-11-07

Added `reviewerSessionStoreMock.ts`, a private local fixture store under `.superpowers`, using the existing exclusive directory lock. It persists only reviewer/session aliases, issued/expiry times and irreversible revocation tombstones, bounded to1000 sessions and1MiB. No grants, credentials, cookie, bearer token or provider data are stored. Session aliases are not authentication secrets. Issued IDs cannot be reused, including after revocation and reopening. Resolve checks the current trusted clock and calls the injected reviewer directory afresh for active status and grants; returned values are copied.

Snapshots are fsynced before rename and paired with a separately written checksum marker. Interrupted `.pending` writes, missing/mismatched markers, corrupt snapshots, duplicate records and wrong App binding fail closed on reopen. A failed write poisons that instance. No automatic repair, stale-lock stealing or tombstone deletion occurs. Preserve snapshot, marker, pending files and lock evidence together before investigation. A failure before any disk mutation cannot guarantee a persisted revocation; only a successful revoke return acknowledges it. File/directory power-loss durability, simultaneous multi-host access, malicious local writers and coordinated rollback of both snapshot and marker remain unproven. This is controlled close/reopen testing, not real Auth or OS-kill acceptance.

The new module is unmounted and composes with the mock reviewer service through its currentReviewer resolver. Tests cover persisted active sessions and repeated revoked reopen, expiry boundary, current directory status/grants, returned-copy isolation, denied service access after restart, concurrent owner refusal, closed-store fencing, truncated/missing evidence, wrong App, snapshot-only rollback, snapshot/marker flush failures and invalid issuance/provenance. Audit and callback journal formats are unchanged. Live identity/session transport, distributed authoritative revocation and persistent grant management remain blockers.

No Meta settings, DEV - Ads integrations, SQL, connections, deployment or posting changed. No UI change or new mobile/desktop browser acceptance. HOLD, execution disabled. The top-level artifact inventory remains100; this existing evidence document records and separately verifies nested source/test/log hashes for the new module, without changing the inspector limit or discarding prior artifacts.

Final persistence regression:122 PASS/12files, including12 session-store cases. Review found a revocation-during-lookup race; a RED regression reproduced it, and re-reading store/session/expiry after lookup fixed it. Follow-up scoped review reports the finding resolved with no new Important findings. Lint PASS. Initial module RED and8-case GREEN remain historical logs.


Final persistence-phase TypeScript --noEmit PASS (exit 0).

| Nested artifact path | SHA-256 |
| --- | --- |
| server/lib/creatorGrowth/pilot/reviewerSessionStoreMock.ts | c33408491521e91f64a6bc64761b6e125bf8e72ff25ca3239d1b8d8ac5004450 |
| server/lib/creatorGrowth/pilot/reviewerSessionStoreMock.test.ts | a472c8c843e0ccf32a1fef3e6653b687ec7ccfdfb1cc158fde2c14df4af43f21 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/session-store-red.log | 00f9fd9dca0bb970a5ab9c229045c4b64582f8803d9d1fe36b33feb90e61b3b0 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/session-store-green.log | d3ceb30448673640d2f00cdd12f53017d194f7052e7e8ab8b93fbeb72c05a075 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/session-store-race-red.log | ad63232336e9cd2e6ffc69150cb206b451fc8f759f961cf58bfb52c54e45e7c6 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/session-store-regression.log | 9d6cfcc489703a382d9a92f7fe5b2c73bae1468a0127f156ad1de6aafe15fc40 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/session-store-types.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/session-store-lint.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |

## Mock recovery and rollback acceptance — 2026-11-07

Ruling: recovery opens a preserved copy only when it matches a separately retained latest committed checkpoint. The new optional expectedCheckpoint binds App and exact snapshot SHA-256. It is checked before returning a usable store; a missing recovery snapshot cannot initialize an empty store. checkpoint() returns a copied App/checksum pair only while the store is usable, after successful persistence. Poisoned or closed stores cannot export a checkpoint. Checkpoints are copied before directory acquisition, so subsequent caller mutation cannot alter an in-flight recovery check.

Offline runbook: stop the original owner; preserve snapshot, marker, pending files and lock evidence; retrieve the latest trusted checkpoint from outside the suspected rollback set; copy a known consistent snapshot/marker pair into a new isolated directory; open that copy with expectedCheckpoint; verify revoked sessions remain denied and cannot be reissued. Preserve the damaged originals byte-for-byte. Never clear pending files or remove tombstones to force recovery. Missing checkpoints, mismatches or incomplete evidence remain blocked. New committed mutations produce a new checkpoint which must be retained before relying on it for later rollback detection.

The synthetic test rolls back both snapshot and matching marker to an earlier active-session state and confirms rejection against the retained revoked-state checkpoint. A second test restores the matching revoked-state pair to a separate directory and confirms denial while the damaged original stays unchanged. Additional tests reject wrong-App checkpoints, empty recovery targets and checkpoint export after failed writes. Initial RED4 failures/12 passes; focused GREEN16/16. Existing runtime/default open behavior remains compatible: opens without expectedCheckpoint do NOT detect coordinated rollback of both files. A stale or rolled-back checkpoint likewise cannot establish latest-state freshness. No trusted checkpoint service, real disaster recovery, power-loss test or live Auth acceptance is implemented.

DEV - Ads integrations remain untouched. No Meta settings, connections, SQL, deployment or posting. No UI change or fresh browser acceptance. Status HOLD; execution disabled.

Final recovery-phase TypeScript --noEmit and changed-file ESLint PASS (exit 0). Scoped review found no Important findings under the separately trusted checkpoint guarantee.


Current nested source/test hashes above are refreshed for this phase; prior run logs retain their original hashes.

| Recovery log path | SHA-256 |
| --- | --- |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/session-recovery-red.log | dcb751e6c9b289046e564aac68439986390406c2a1e6b0d9f325dda7e8a25082 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/session-recovery-green.log | 367814396a768b79171fd6fbff2fbf069087169df9e6d4976b87f28b4d0881e2 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/session-recovery-regression.log | 97a2d2fe48c48d99607d2196dfdf9ecf0ec6bcd0c98148f521566e64b5a99404 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/session-recovery-types.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/session-recovery-lint.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
Final targeted recovery regression:126 PASS/12files. No whole-suite or live acceptance claim.

## Separate mock checkpoint ledger — 2026-11-07

Added checkpointStoreMock.ts with explicit create/open modes and separate local storage outside the bound session directory; both directories remain under the local mock root, with source overlap and existing symlink components rejected. The ledger binds fixture provenance, App, stream alias and original session source path. Up to1000 immutable sequential receipt files retain snapshot checksums and predecessor hashes. Recording requires the caller's expected latest receipt ID; exact current checksum repeats are idempotent, stale-head writes and promotion of previously recorded older checksums reject. This records a trusted harness assertion from a successful session checkpoint; it does not independently verify a provider or arbitrary caller-supplied snapshot.

Each receipt is fsynced before a temporary latest-head file is flushed and renamed. Interrupted writes poison the instance. On reopen, the exact file inventory, bounded regular files, receipt chain and latest head must agree; pending/orphaned/missing/corrupt records reject without repair. Open mode never initializes an absent ledger; create mode cannot reset existing storage. Exclusive local owner locks and closed-instance fencing are preserved. latest/history return copies. verify requires the latest snapshot checksum and receipt ID; old receipts cannot select an earlier recovery snapshot.

Mock recovery: record sessions.checkpoint() only after successful mutation; retain the returned receipt ID; close and reopen the ledger; verify the intended checkpoint against its latest receipt; pass the verified checkpoint to session-store recovery on a controlled copy. The integration test uses a revoked session and verifies it stays denied and cannot be reissued after recovery. The two stores are not a distributed transaction: if checkpoint recording fails, treat recovery readiness as blocked and reconcile preserved evidence. Do not silently use an earlier ledger entry or delete records to continue.

The ledger is still on the same local machine. Rolling back the entire ledger together with session files, tampering with all hashes, source-path replacement after opening, OS power-loss behavior and malicious trusted callers remain outside the guarantee. An independently protected latest anchor and real operational controls are still needed for live use. No cryptographic authentication, real Auth, Meta or provider verification is claimed.

Tests-first RED missing module, initial5-case GREEN. Expanded cases cover ordered restart verification, stale updates, known-checksum rollback, absent storage, directory overlap/root boundary, App/stream/source mismatch, altered/missing records, stale head, concurrency, interrupted receipt/head writes, recreation denial, copied reads, closed access and revoked-session recovery. The source-root denial test was observed RED before its fix. No frontend change or new browser acceptance. DEV - Ads integrations unchanged; no settings, connections, SQL, deployment or posts. HOLD; execution disabled.

Final checkpoint-ledger regression:135 PASS/13files, including9 checkpoint cases. TypeScript --noEmit and changed-file lint PASS (exit0). Scoped review found no Important findings in the local fixture scope. No whole-suite or live acceptance claim.

| Checkpoint artifact path | SHA-256 |
| --- | --- |
| server/lib/creatorGrowth/pilot/checkpointStoreMock.ts | 1860d7bb22bbc4591124e9c8b23367c4952f8d648201f5efcaacb45f3bd4421e |
| server/lib/creatorGrowth/pilot/checkpointStoreMock.test.ts | 2ccdb30669be7a842f5080ac94a52604327f8aeac72f7bb273418ec8c82a313f |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/checkpoint-store-red.log | 7137fc31be12788f40d8403253a916f5c7f3171609cac7ae65add85b982ab9cf |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/checkpoint-store-green.log | 547e4e9a0a04cbc36dc2c2ecb2b2c34920bb6ff18e3e6586339cf19e9620bec5 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/checkpoint-path-red.log | d98dd7333fde107d471b78bbedfe2305c1e38ff03fe3eb92ba447914cc097c84 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/checkpoint-store-regression.log | 1916bfc0741075a8728ab293cd5ec58f47628728e36fad8c80b3189244ecb1f7 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/checkpoint-store-types.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/checkpoint-store-lint.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |

## Mock whole-ledger rollback protection — 2026-11-07

Added an optional independently held fixture anchor to checkpointStoreMock.ts. createMockCheckpointAnchor models an external authority in memory; it lives outside the ledger files under test and retains the latest per-binding sequence/receipt. Its compare-and-set operation only initializes sequence0 or advances exactly one step from the current state, rejects regressions/stale updates, and returns copies. The binding covers App, stream and source path. This authority is a test double, not an authenticated or durable production service.

Anchored ledgers persist an anchored marker and require the same authority on reopen; omission/reset cannot silently downgrade them. All reads, verification and writes compare current local state with the anchor. A complete rollback of head plus all retained receipt files is rejected when the surviving anchor remembers a newer commit. Missing/unavailable/mismatched authority blocks access. Existing unanchored ledgers retain their earlier behavior and do not gain this guarantee automatically.

Commit order: fsync local receipt and head, advance the independent anchor using its expected prior state, read back the new anchor, then expose success. Any failure poisons the open instance. If the anchor did not advance, the ahead-of-anchor local ledger remains blocked on reopen; do not roll either side backward automatically. If advancement succeeded but its acknowledgment was lost, reopen can reconcile matching states by readback without repeating the commit. An outage is not approval to use cached verification.

Tests restore an entire older ledger while retaining the newer mock anchor, reject absent/reset anchors, verify normal anchored reopening, block failed advancement and read outages, prohibit anchor regression and returned-object mutation, and reconcile ambiguous acknowledgment. Initial RED4 failures/9 passes; focused GREEN13/13 before added anchor-history/ack cases. No existing callback, review, session or grant flow is removed.

Limits: the mock anchor survives local ledger close/reopen only while that in-memory object survives. It does NOT survive process loss, and does not protect against coordinated rollback/reset of the authority itself or malicious replacement of injected dependencies. It is not a signature, trusted remote clock, real external CAS service or production disaster-recovery proof. The independently protected persistent anchor, authenticated transport, authorization and operational recovery controls remain live blockers. This narrows the prior whole-ledger limitation in the synthetic test only; no live gate is cleared.

DEV - Ads integrations unchanged. No Meta settings, connections, SQL, deployment or posts. No UI change/new browser acceptance. HOLD; execution disabled.

## Persistent mock anchor authority — 2026-11-07

The in-memory anchor remains available for compatibility, but `checkpointAnchorMock.ts` now adds an optional separately stored fixture authority with explicit `create` and `open` modes. It uses its own `acquireLocalPilotDirectory` ownership lock, a bounded (`<=128 KiB`, `<=1000` bindings) snapshot and a separately checksummed marker. Snapshot and marker are fsynced before atomic rename; pending files, missing halves, malformed records, duplicate bindings and marker mismatches fail closed without repair. A failed write poisons the handle, so callers cannot silently read the old in-memory state.

The persistent authority stores only binding, monotonic sequence and receipt ID. It does not store tokens, grants, provider payloads or session secrets. Session grants remain resolved by the reviewer directory on every resolution. An anchored ledger records the anchored flag; reopening it requires the same authority and exact binding/state agreement. This makes a complete ledger rollback detectable when the independently stored authority survives and is not rolled back with it.

Restart tests close and reopen both the ledger and authority, then continue monotonic updates. They restore an old complete ledger while retaining the newer authority, reject a rolled-back authority against the newer ledger, fail on missing/corrupt/pending authority evidence, deny concurrent owners and accidental recreation, preserve copied state, reject malformed operations, and verify a failed atomic write cannot leave a readable cached authority. The recovery procedure remains: stop delivery, preserve both directories plus pending files/lock evidence, reopen the separately retained authority, and only use a ledger whose exact latest binding/state agrees. Never delete tombstones or pending evidence to make recovery succeed.

Final targeted regression: `150 PASS / 14 files`, including nine persistent-anchor tests. TypeScript `--noEmit` and changed-file ESLint pass with exit 0. Logs are `anchor-persistence-red.log`, `anchor-persistence-green.log`, `anchor-persistence-regression.log`, `anchor-persistence-types.log` and `anchor-persistence-lint.log`.

Limits: both stores are local files. A coordinated rollback of the anchor and ledger, replacement of the trusted authority by an injected dependency, malicious local filesystem access, directory fsync/power-loss behavior, and a genuinely remote/CAS authority are not proven. The fixture anchor is not authentication, a signature, a durable service or production disaster-recovery evidence. Live identity, provider, operational and deployment gates remain blocked.

| Persistent anchor artifact | SHA-256 |
| --- | --- |
| server/lib/creatorGrowth/pilot/checkpointAnchorMock.ts | 07ec51d91753d8b58d1ec01de8635d7bc7d4b983db691a0768bac70a32155cc5 |
| server/lib/creatorGrowth/pilot/checkpointAnchorMock.test.ts | 1592cec7819eaf19d3411d89d58ef5cc73d153cc21832f17a65788fcf69deb5e |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/anchor-persistence-red.log | f0721a290e93397cca61e161cc14ded8637c8a8bbe18b65ff15998c5a56224da |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/anchor-persistence-green.log | b6e5611690b55d144eeeb8a98e8a14c1ff8be84a6635386b2b6a794e1893cd11 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/anchor-persistence-regression.log | 656e1958433c1971bd771adbc66d873abfea0508bf4d1aa201ba0cbd7e4df55f |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/anchor-persistence-types.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/anchor-persistence-lint.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |

## Simulated remote checkpoint authority — 2026-11-07

`remoteAnchorMock.ts` adds an unmounted, in-memory remote-CAS simulation for coordinated rollback testing. It is intentionally separate from all `.superpowers` ledger and anchor files: rolling the entire local ledger back to an older head and receipt set is rejected when this surviving authority has the newer binding sequence. The mock records ordered audit events, returns copied state, rejects stale or malformed compare-and-set transitions, and models an unavailable authority by failing reads. The checkpoint store treats that failure as a blocked recovery and does not fall back to cached state. `remoteAnchorMock.test.ts` exercises complete ledger rollback against the surviving remote mock, local restart continuity, outage recovery, stale transitions and immutable audit copies.

This is a remote-shape contract only. It performs no network request, authentication, TLS exchange, signature, durable write or provider operation. The simulated authority lives in process memory and is lost on process termination; it cannot prove a remote service restart, distributed consensus or protection against replacement of the injected authority. A production design still needs an authenticated remote CAS, availability/error semantics, durable audit, operational reconciliation and explicit approval. The local DEV - Ads integration and all other runtime paths remain untouched.

Final targeted regression: `154 PASS / 15 files`; focused remote-anchor test: `4 PASS`. TypeScript `--noEmit` and changed-file ESLint pass with exit 0. No frontend behavior changed, so no fresh mobile/desktop browser acceptance is claimed.

### Remote client restart and fault recovery — 2026-11-07

The remote mock now supports a shared simulated authority that issues independent client handles. Closing a client and creating another handle preserves bindings and audit order without a network call, allowing the ledger to be tested across remote-client and local restart boundaries. The authority audit remains copied and immutable.

One-shot fault simulation covers ambiguous CAS behavior. `commit_before_apply` fails before remote state changes; the local ledger may be ahead, so reopening remains blocked. `commit_after_apply` changes the authority but loses the acknowledgment; after opening a fresh remote client, matching local/remote state can be reconciled and the ledger reopens with exactly one receipt. This models readback reconciliation and deliberately avoids blind retry. The simulated authority is still in-memory and does not survive process termination; it is not a durable remote service.

Final restart/fault regression: `157 PASS / 15 files`, including seven remote-anchor tests. TypeScript and changed-file lint pass. No live network, provider, DEV - Ads setting or UI behavior changed.

### Remote audit persistence and authority failover — 2026-11-07

The remote simulation now has an opaque shared fixture store that can outlive individual authority and client instances. New authority handles over the same store retain binding state and ordered audit events, allowing primary-client failure and secondary-authority takeover to be tested without a network. Separate stores remain isolated; invalid store handles fail closed. Lost-acknowledgment recovery also works across authority failover: a fresh authority reads the committed remote state, the ledger reconciles it and no duplicate audit event or receipt is added.

Final failover regression: `160 PASS / 15 files`, including ten remote-anchor tests. TypeScript and changed-file lint pass. The shared store is still process-local memory. It does not prove remote persistence, replication, quorum, split-brain handling, authentication, durable audit or production failover. No Meta, provider, DEV - Ads integration, SQL, deployment or posting action occurred.

### Split-brain and stale-writer fencing — 2026-11-07

The simulated remote store now has an explicit writer epoch. Clients capture the epoch at creation; a deliberate promotion increments it, fencing all older clients for both reads and compare-and-set updates. New clients may continue only after promotion. Audit entries record the writer epoch so takeover history remains inspectable.

`forkMockRemoteCheckpointStore` creates an isolated fixture replica from the current state and audit. The test writes a newer checkpoint to the live authority, then attempts ledger recovery from the older fork while the local ledger contains the newer receipt. Recovery rejects the stale replica instead of silently choosing divergent history. A promoted authority can reopen the latest ledger, while the pre-promotion writer remains fenced. These are synthetic split-brain and takeover checks, not quorum or leader-election tests.

Final split-brain regression: `163 PASS / 15 files`, including thirteen remote-anchor tests. TypeScript and changed-file lint pass. The two replicas are process-local objects and do not prove durable replication, fencing-token authenticity, clock/lease behavior, quorum, conflict repair or production split-brain handling. No live Meta, provider, DEV - Ads integration, SQL, deployment or posting action occurred.

### Mock quorum and leader election — 2026-11-07

Added `quorumAnchorMock.ts`, an unmounted five-node simulation that wraps the existing checkpoint-anchor contract. It requires an odd cluster size, uses a majority threshold, elects a deterministic available leader, records terms and committer sets, and only commits a checkpoint when a majority acknowledges the expected state. A leader is not reported without a live majority. New leaders are elected after the current leader leaves; minority partitions remain blocked. Rejoining stale replicas do not become authoritative and are excluded from the next majority commit until reconciled.

The tests cover deterministic initial election, majority gating, leader replacement with exactly three of five nodes online, stale-replica rejoin, copied audit output and invalid topology/node changes. This is a synchronous synthetic consensus model, not Raft, not a network partition simulator, and not proof of durable replication, authenticated votes, lease/clock behavior, crash consistency or production leader election.

Final quorum regression: `168 PASS / 16 files`, including five quorum tests. TypeScript and changed-file lint pass. No live Meta, provider, DEV - Ads integration, SQL, deployment or posting action occurred.

| Remote-anchor artifact | SHA-256 |
| --- | --- |
| server/lib/creatorGrowth/pilot/remoteAnchorMock.ts | 84a160d95aa1be73575499fb498ef38fb49279aa46fe02aafd4794e3955f741b |
| server/lib/creatorGrowth/pilot/remoteAnchorMock.test.ts | 8b58bf33063149665624ce6eff33b5cb4a89f81dabf96de84357f5bc13f38c22 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/remote-anchor-green.log | bc7051e344e45a661f0e92f214c32aef0c059e0a4d4a90647e28a6c8c553785c |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/remote-anchor-regression.log | 58adc88bd5ecefb2f71c5adba4b43bc23199ce29eb7f9622641ed3a91daf21f4 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/remote-anchor-types.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/remote-anchor-lint.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/remote-restart-red.log | 093ddaad491215b9061f61896a0ca8912c2df2deb72171e00bb2ee7a2f83f331 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/remote-restart-regression.log | 3f7aae6a6478254eef69e77ac70906347850b29c06b5d59e44f7ebb1cd8f9215 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/remote-restart-types.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/remote-restart-lint.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/remote-failover-green.log | ea89fdb90a8e298ceed7a3a1cb5ff4c625c39f1dd596627cbdbdf44dec469489 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/remote-failover-regression.log | f9127a5e5d4095a97e8e00ea6bc37bcf774399dc9c920e43dba27040933ebc71 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/remote-failover-types.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/remote-failover-lint.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/split-brain-red.log | 19021bda077a5f8c104d229d5b0a0cd7a3540c7ca9111811630defbd77772bcb |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/split-brain-green.log | 62b062e65f5b5943cc1783b2940db1fc189d2d0ba1a3ba9f57b333ca664ffb05 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/split-brain-regression.log | ccde9002af5bde2e98709776db1620f7c1b02226b6b9422cfe6b89665747b737 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/split-brain-types.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/split-brain-lint.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| server/lib/creatorGrowth/pilot/quorumAnchorMock.ts | 4133aae0295adf3346d742da6ac2d5dfbfb17eb2cc23c32e89f73525281b643b |
| server/lib/creatorGrowth/pilot/quorumAnchorMock.test.ts | ad13cd60a8edae55ed5753b50825c265efd13172d86c1dce2c7b312ce4efbe75 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/quorum-red.log | bbdd7f3c6d3edc88ace4e0f2b00a4f9af421758b1fc7345b156c061403595b44 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/quorum-green.log | dfc2b85f0a22ffac54c9bc510a3550aa8760ff685c1564f0d10a5e74c6031957 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/quorum-regression.log | da342ecc89289f4c75e16e47795acf47dd34c7cdde56fe6c41419b2ff14be654 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/quorum-types.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/quorum-lint.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |

Final anchored-ledger regression:141 PASS/13files, including15 checkpoint cases. TypeScript --noEmit and changed-file lint PASS (exit0). Scoped review found no Important findings within surviving mock-authority scope. No whole-suite/live acceptance claim.


Checkpoint source/test hashes above now identify this phase; historical log hashes remain unchanged.

| Anchor log path | SHA-256 |
| --- | --- |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/ledger-anchor-red.log | 5887f214f4a5f46ff9bc8c4a48badf768f40a48a8a4f6349cb053e4ddd776625 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/ledger-anchor-green.log | fc06627c59f07433afab756956880636b116ec0566490857808b4a56c398b4a1 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/ledger-anchor-regression.log | 70c98af471338b1bc6e82706105be273245725b916e1535ebd654af26f4a5db3 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/ledger-anchor-types.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| .superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/ledger-anchor-lint.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
