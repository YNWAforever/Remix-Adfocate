# Local recovery and release repair closeout — 2026-11-06

Status: **local visible-row recovery, release checks and mock browser acceptance passed; production release HOLD**. This document does not authorize remote SQL, provider connections, deployment or publication.

Workspace: `C:/Users/laich/.codex/worktrees/kocmax-studio/Adfocate`.
Branch verified: `codex/kocmax-studio-stages-1-2`.
HEAD verified: `e491e2dd30f42090458eacb82777d45b67275627`.
`git diff --cached --name-status` returned no entries. The existing dirty working tree was retained; nothing was staged or committed.

## Preservation verification

DIRECTLY_VERIFIED by filesystem reads and SHA-256 hashing in this closeout pass:

| Scope | Result | Evidence boundary |
| --- | --- | --- |
| Original `.superpowers/controlled-pilot-local-v2-db` | **1,704 / 1,704 hashes match** `index-original-hashes.json`; zero missing, changed or additional files | Recursive file inventory and raw-byte hash comparison; no database was opened |
| SQL paths in `baseline-hashes.json` | **155 / 155 raw-byte hashes match**, zero missing or changed | Covers the ledger's SQL entries, including the three newer auth/growth/publishing migrations; not a claim that every untracked SQL file has a baseline |
| Tracked SQL against HEAD | **93 / 93 match after CRLF-to-LF normalization** | Five also match raw bytes; 88 differ only in line endings. Do not describe this comparison as 93 byte-identical files |

Private evidence directory: `.superpowers/sdd/2026-11-06-kocmax-controlled-instagram-pilot/`. Hash ledgers and row exports remain there; private row contents are not reproduced in this report. The source SQL checks above did not execute SQL.

## Recovery accounting and limitations

Read and cross-checked `recovered-visible-result.json`, `recovered-visible-export.json`, `recover-visible.ts` and `recover-visible-v6.log`:

- The exported snapshot contains **118 tables and 81 exported rows**, with `sampleOnly: true`.
- The import result records **2 quarantined rows** and **`stopped: true`**. **81 is the exported input count, not the active-row count.** Subtracting quarantine gives 79 non-quarantined imported rows; this arithmetic is not a fresh post-reopen database census. The separate quarantine table retains the two original JSON records.
- The v6 runner uses a fresh `.superpowers/controlled-pilot-visible-recovered-v6-db` target and a separate source copy. It opens the source through shared directory ownership, and imports through the seeded runtime's owned database before closing it.
- The v6 log includes a subsequent runtime reopen/read result: `stopped: true`, `liveReady: false`, `sampleOnly: true`, `providerRevocation: unverified`. The original journey remains `approved_to_publish`, the recovered current intent is `creator_approved`, proof submission is disabled, and the reported reward ledger is zero. This is recorded v6 execution evidence, not a database read performed by this verifier.
- Source-copy export uses `-P` and disables user index scans. It exports rows visible to PostgreSQL, rather than asserting that every physical tuple is committed.

The retained `index-page-evidence.json` shows snapshot/current XID 892 alongside heap tuple XIDs extending to 944. The prior diagnosis also reported in-progress CLOG state and a broken system index. Physical remnants of later activity do **not** establish committed publication. The old future-XID outcome remains **unknown/unproven**; no publication receipt, proof or reward was fabricated from it. Original physical evidence is preserved byte-for-byte as verified above.

## Ownership review follow-up

The earlier independent review identified direct recovery opens bypassing ownership and directory creation before junction containment checks. Current source inspection shows:

- `localDatabase.ts` acquires the shared owner lock before PGlite creation and releases it after close; recovery and runtime use this boundary.
- The recovery runner keeps target ownership during seeding and import.
- `localDirectoryLock.ts` checks existing path components for symlinks/junctions before creating descendants.

The recorded `junction-ownership-green.log` reports two passing focused tests, including recovery/runtime mutual exclusion. These are inspected prior-run results, not tests rerun during this closeout. No stale lock was removed or bypassed.

## Vite restart lifecycle repair

The controller reproduced `LOCAL_PILOT_IN_USE` on keyboard restart. Installed Vite source confirms that replacement `configureServer` runs before the old server is closed, so old `closeBundle` cleanup alone is too late.

The authorized follow-up changed only `vite.config.ts` and `scripts/vite-pilot-lifecycle.test.ts` as code changes. Cleanup is scoped to each config instance. Fixture restart awaits its owner's memoized close before invoking native Vite restart, rejects restart if close fails, and returns 503 for pilot requests once closing begins. The old close hook cannot close the replacement runtime. Filesystem ownership remains enforced; no lock deletion, forced reuse or database opening was used in this repair pass.

Focused regression evidence from this pass:

```text
node node_modules/vitest/vitest.mjs run scripts/vite-pilot-lifecycle.test.ts --maxWorkers=1 --minWorkers=1 --reporter=dot
```

Before repair: both tests failed, including `LOCAL_PILOT_IN_USE` on replacement setup. After repair and request-boundary assertions: **1 file / 2 tests passed**, 21:02:34 local start, 1.28 seconds. Tests use a simulated exclusive runtime and Vite's observed replacement-before-close ordering; they open no database. They cover awaited release, old/new cleanup ownership, repeated close, retiring-request rejection and abort on close failure. Scoped ESLint and `git diff --check` passed. The controller subsequently verified two actual keyboard restarts and browser readback; see the final acceptance section below.

## Release repair evidence

`release-repair-report.md` and `release-repair-final-unsandboxed.log` document resolution of the eight original failures:

1. Five failures: two migrations lacked explicit classification; reviewed inventory/dependencies were added.
2. One failure: capability accounting omitted the pre-existing 13-capability auth boundary; explicit group assertions preserve the residual baseline counts.
3. Two failures: sandbox atomic-rename `EPERM`; unchanged rename behavior passed outside the sandbox. No non-atomic workaround was added.

The additionally exposed host-Node fixture mismatch was made deterministic with a supported Node fixture and an explicit Node 26 rejection assertion; runtime support policy was not widened.

Recorded final release/package result: **16 files / 138 tests passed**, no failures or skips, 23.17 seconds. This verifier inspected the log and did not rerun those tests. The two lifecycle tests above are a separate focused run, not an expanded or combined full-suite result.

## Remaining acceptance and boundaries

- **PASS:** broad repository run:412 files passed,44 skipped;4534 tests passed,363 skipped (`release-recovery-full-suite.log`, exit0). External integration tests were disabled. This run began before the final lifecycle/junction refinements; it is not a claim that all tests ran again after those refinements.
- **PASS:** final affected regression run after the fixes:5 files /19 tests (`verification-final-focused.log`), covering recovery/quarantine, shared ownership, junction rejection, durable runtime, Vite lifecycle and readiness UI.
- **PASS:** actual cold start and two keyboard restarts, retained receipt/400 mock points/one ledger record, five responsive widths, private-source redaction, peer denial and stopped recovered-copy operator UI. See [browser acceptance](release-recovery-browser.md). Desktop invitation overlap was corrected in the development-only wrapper.
- **PASS:** TypeScript and both production builds (Studio default-off and opt-in, fixture false). Both asset scans contain zero matches for all9 controlled-pilot/mock markers and all63 existing boundary markers (`verification-final-default-scan.json`, `verification-final-optin-scan.json`). No build was deployed.
- **PASS with warnings:** scoped lint:0 errors,4 existing effect-ref cleanup warnings; `git diff --check` passes. The final verification source ledger checked218 files with no code changes during verification and no staged files.
- The independent review did not run builds; the final verification pass ran the two builds sequentially after the full suite completed.
- No original or recovered database was opened by this verifier. Only filesystem hashing, source/log inspection, mocked lifecycle tests and scoped static checks were performed.
- No remote SQL, external service/provider connection, deployment, Git staging or commit occurred. Provider revocation remains unverified and live readiness remains false.

This closeout records bounded preservation, recovery and release evidence. It does not restore or certify the old unproven committed publication, or clear production acceptance.
