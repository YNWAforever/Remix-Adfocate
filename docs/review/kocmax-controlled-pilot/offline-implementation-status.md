# P1–P4 offline implementation status

2026-11-06. Same branch `codex/kocmax-studio-stages-1-2`; HEAD `e491e2dd30f42090458eacb82777d45b67275627`. Native implementation, unstaged. P5/P6 remain unauthorized. This is an implementation checkpoint, not a declaration that every P1–P4 integration gate is complete.

## Implemented and exercised

- Provider source projection uses original immutable approved mission versions and independent rights/account attestations. Fixture evidence cannot be promoted through the provider source resolver. Expiry uses the shorter attestation lifetime.
- Session/owner-bound service composition rechecks approval fingerprint and authority before enqueue. Native routes are registered default-disabled; the explicit runtime factory has no default clients or running scheduler.
- Review-only provider SQL extends the original intent repository: active creator, exact connection/product/App/generation, activated pilot binding, active grant, maintenance/tombstone denial, original mission/version/JPEG/instruction checks, one-use approval and lifetime reservation. Original connection FK permits existing revocation triggers to stop provider intents.
- Composite owner/version/work-item/connection FKs retain existing uniqueness indexes. No original index or migration was removed. Provider source, approval and revision tables have RLS and restricted grants. Empty-only rollback refuses retained evidence; no CASCADE.
- Original ready-JPEG attachment failure was reproduced as `immutable_record`. The separate review-only guard repair permits a single owner-consistent attachment during original submission, while preserving immutable bytes and approved version identity. Upload/finalize/submit/reviewer approval passed through original commands in memory.
- Fixed-host native HTTP transport, publisher and worker composition use injected fake effects. No global fetch, credentials, default provider client or scheduler is installed. Wrong owner, lost response, secret lookup failure and oversized/provider-error responses are denied/redacted.
- Native jobs cannot be claimed by fixture workers. Accepted response IDs are retained through the original claim/target-bound late-receipt path before checkpointing. A stopped or expired worker may preserve that exact evidence, but cannot publish again. Known-container processing supports bounded delayed polling after reconstruction.
- Native media lease and SQL byte-storage backend implement durable reservation, origin expiry, scoped purge and absence verification. Reconstruction can request exact owner/intent cleanup. Terminal/unknown/revoked/inactive ownership denies new origin reads. **The backend is implemented offline; actual hosting/provider fetch is not certified by these mock tests.**
- Artifact inspection independently hashes local bytes, rejects traversal/symlinks/missing or changed files, and always returns `executionAllowed: false`.

## Evidence and limits

Evidence root: `.superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/`.

`review-final.log`: 39 tests passed across 5 files, including SQL stop during fake publish and `IN_PROGRESS → FINISHED` across reconstructed workers. `source-green.log`: 16 tests passed. `upload-green-2.log`: original upload regression passed. These overlap other runs and must not be summed into a full-suite count.

`full-suite.log`: 4,571 passed, 363 skipped, 1 failed across 467 files. The failed test was the newly added pending-load/close race. This is NOT a clean full-suite result. Both second-round review findings were reproduced in `review-round2-red.log`, then fixed: cancellation now fences pending opens; accepted-response recovery counts the first read and permits at most five total reads. `review-round2-green.log`: 10 passed across 2 files. Independent reviewer reran the two selected regressions: 2 passed, 8 skipped by filter, no new actionable defect in these fixes. Actual storage must implement the documented durable fence; an interface contract is not hosting acceptance.

Final changed-file lint passed (`lint-round2.log`); TypeScript passed (`typescript-round2-corrected.log`). The first attempted TypeScript command referenced nonexistent `tsconfig.app.json`; it was corrected to the repository's `tsc --noEmit`, not reported as a passing attempt.

Both production builds passed (`build-default-off.log`, `build-studio.log`); Studio fixture flag was false and the nine-marker scan found zero matches. Later changes are server-only/SQL/tests; final TypeScript and affected regressions accompany the inventory. No claim is made that the full suite was rerun after the final fixes.

Browser readback at 320/390/430/1024/1440 showed no horizontal overflow, retained mock published receipt, private-source redaction and 400 mock points/one ledger entry. Direct peer access was denied at desktop/mobile sizes. An initial reload during Vite restart failed to import the router; a later reload recovered. These observations cover the existing mock UI, not a hosted real-account flow.

Final reload repeated the five-width check after the review fixes: rendered widths 320/390/430/1024/1440, document widths 314/384/424/1018/1434. Receipt `4cdadc1d`, revoked-source redaction and 400 mock points/one ledger entry persisted at every width. Temporary viewport overrides were reset. Complete new native end-to-end UI acceptance remains pending.

`preservation.json`: all 155 baseline SQL hashes and all 1,704 original local database file hashes matched. No original database was opened for recovery or changed by this work. No deployment, remote SQL, real connection or publication occurred.

## Continuation: native backend integrations implemented

The earlier boundary-only checkpoint is superseded for routes, storage and handoff by `native-offline-wiring.md`. The original application now mounts default-disabled native routes. An explicit inert factory assembles SQL jobs/media/receipts, lease, worker, private collection and proof services. Full-schema mock acceptance starts from original upload and ends in original reviewer/operator/admin settlement with one ledger effect. Original cleanup and creator deletion now pass with populated child rows. The full atomic review bundle and empty rollback pass; no migration was applied remotely.

Final frozen Native regression: **212 PASS /31 files** (`frozen-native-regression.log`). The continuation full-repository run recorded4,580 PASS /2 FAIL /364 SKIP plus a timed-out suite setup; it overlapped RED tests and is not reported as final all-green evidence. The final Native run covers the corrected failed test cases and Windows junction safety check with normal permissions. No timeout or safety guard was disabled.

Independent review found JSONB key-order comparison, unstable recovery timestamp and retention FK defects; all were reproduced and fixed. Follow-up review found no new actionable defect in these fixes or the factory. The browser remains the preserved mock product, while the native backend is tested separately with injected effects.

## Remaining launch gates and acceptance limits

1. Bind the implemented runtime to the exact future environment and server-owned actor/allowlist configuration only after approval. Native route/backend tests and existing mock-browser tests are separate evidence; hosted end-to-end UI acceptance is not claimed.
2. Facebook-product OAuth/token/notice adapter after the exact protocol is verified; existing Instagram Login semantics remain separate. Signed-notice/revoke endpoints have not been guessed.
3. Provider receipt/collection/proof persistence is now implemented; real receipt provenance, real-session ownership and live original workflow acceptance remain P5/P6.
4. Durable SQL media backend and cleanup are now implemented; actual hosting, provider fetch and no-cache expiry/purge acceptance remain B8/P5.
5. Complete atomic schema/cleanup/rollback artifacts now exist and pass locally. Exact-target restore and remote schema/role verification remain unauthorized, not substituted by PGlite.

App-specific protocol evidence and all external acceptance remain B1–B3/B6–B10 gates. Local infrastructure interfaces and tests do not clear those gates. The launch package must stay HOLD; no live approval is being requested prematurely.
