# Mock local revocation acceptance

2026-11-05; branch `codex/kocmax-studio-stages-1-2`, HEAD `e491e2dd30f42090458eacb82777d45b67275627`. No commit, deployment, SQL application, provider connection, real revoke or post. Existing functions/fixes and prepared SQL hashes remain unchanged.

## Delivered

Owner-scoped, idempotent local mock revocation invalidates image preparation, preview confirmation, proof, review and export access. It records only a minimal prior outcome (not requested / published / unknown) and stops late work. No real provider revocation protocol is invented or enabled.

UI clears local image/summary URLs, caption/evidence and old confirmations; shows a stopped notice with no current progress step. Starting again requires the explicit fresh-example action and new confirmations. Published receipts are not described as deleted; unknown outcomes remain unknown with no automatic retry. Downloaded files already on the creator's device are explicitly retained.

## Verification

- Initial focused run: 129 tests PASS across 7 suites, including production boundary.
- Added delayed-receipt-after-acceptance regression: the adapter accepts once, receipt is held, revoke occurs, late receipt is rejected, no proof access returns and publish count remains one. Focused journey/UI run 27/27 PASS.
- Final regression run covers 129 tests across the 6 non-build suites; prior production boundary remains valid because the final changes are test-only.
- Production opt-in build: all 39 development markers absent. TypeScript and scoped ESLint pass after explicitly typing the delayed mock method's `this`. Diff whitespace check passes.
- Independent review: no actionable findings; noted missing delayed accepted-receipt coverage, now added and passing.
- 390×844 browser: before-publication revoke removes confirm button (0), disables preparation and displays not-requested notice. Explicit new example works. Scroll width 384; no horizontal overflow. [Mobile](mock-revoke-mobile.png).
- 1440×1000 browser: complete conversion → receipt → proof → simulated review → summary link count 1. Revoke then removes evidence and download links (both 0) and displays prior receipt / no deletion notice. Scroll width 1434. [Desktop](mock-revoke-desktop.png). Temporary viewport reset.
- During browser work the page returned to fresh state between checks; no cause asserted. The desktop full flow was rerun in one sequence and the final revoked state independently observed.

Logs: `.superpowers/sdd/mock-revoke-*.log`. No broad full-suite, real identity/revoke, native Auth/RLS or provider acceptance claimed. Existing true-provider blockers remain open. SQL migration/rollback hashes match those recorded in the preceding [summary phase](mock-summary.md).

Scope ruling: this is local page-state rehearsal only. A fresh mock run is not reauthorization of a real account, and revocation does not remove a previously accepted external post or downloaded file. All real mission, approval and reward operations remain authoritative in their existing workflows.
