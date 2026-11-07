# Controlled pilot implementation status

Date: 2026-11-06. Branch: `codex/kocmax-studio-stages-1-2`.
Status: **IN PROGRESS — not whole-stage acceptance or live readiness**.

## Current offline work

- Readiness metadata separates nine evidence gates from execution authority.
- A Facebook Login fixture adapter keeps product/app/subject/generation explicit;
  no credential conversion, HTTP implementation or runtime registration exists.
- Local grant stop reuses the original revoke command and distinguishes local
  stop from unverified provider revocation.
- PGlite-tested worker checkpoints use owner-consistent foreign keys, leases and
  fences. Reconstructed worker/adapter instances preserve an ambiguous publish
  checkpoint instead of repeating publication.
- Fixture JPEG leases verify owner, hash, sharing rights and expiry, and remain
  closed if stop occurs during storage or final authorization. Failed purge is
  retained as pending, not success. Resolver diagnostics are sanitized.
- Offline worker checks server allowlists and stops, caption hash, unchanged
  account generation/disclosure/run, and exact fixture receipt ownership. It
  checkpoints before external fixture writes and records accepted outcomes even
  when local stop arrives during a call. Failure to record/clean up remains held.
- Review-only SQL/rollback/index inventory is available. Rollback refuses any
  nonempty job table and never deletes original task or intent data.

## Verification actually run

Selected regression command:

```text
node node_modules/vitest/vitest.mjs run server/lib/creatorGrowth/pilot server/lib/creatorGrowth/publishService.test.ts server/lib/creatorGrowth/publishRepo.test.ts server/lib/creatorGrowth/mediaLease.test.ts --reporter=dot
```

Result: **198/198 tests, 12 files PASS**, including local PGlite; not the entire
repository suite. Full output is retained in the local stage ledger directory as
`worker-foundation-tests.log`. New targeted failures were observed before fixes
for lease-close races, malformed expiry, diagnostics, nonhex account identifiers,
oversized hash strings, mismatched caption and missing rollback artifact.

ESLint for `server/lib/creatorGrowth/pilot` passed. TypeScript was checked
separately. A hash comparison confirmed **727/727 preexisting changed/untracked
baseline files unchanged**. New files are unstaged; no commits were made.

## Remaining integration and acceptance

Tasks 2–6 are partial foundations, not completed stage deliverables. The worker
uses injected authoritative projection/record ports; it is not wired to product
routes. Original PublishRepository authority still uses private growth drafts
and Instagram Login scopes. Do not weaken that authority or manufacture a draft
to treat these fixtures as approved Active mission content.

Outstanding: explicit product/app/Active mission approved-version binding and
semantic reservation; memory/RPC parity and full additive SQL; actual product
OAuth/notice composition; bounded durable read-only reconciliation; exact
receipt/proof handoff through original commands; readiness/roster/task/private
collection UI; cleanup manifest and concrete launch packet; full-role mobile and
desktop browser acceptance and independent final review. No browser acceptance
or production build result is claimed for this stage's new orchestration.

Actual Meta App/version/paid-partnership/revoke evidence remains blocked. No
remote SQL, deployment, actual connection, public media lease, publication or
reward has been performed or enabled. Task 11 remains separately approvable.


## Current checkpoint — 2026-11-06

See acceptance.md, final-review.md, launch-packet.md, cleanup-manifest.md, rollback-runbook.md and protocol-evidence.md for the superseding evidence and explicit incomplete scope. Whole-stage acceptance remains INCOMPLETE; real pilot BLOCKED. Latest scoped test result1439 passed/21 skipped; no remote effects.
