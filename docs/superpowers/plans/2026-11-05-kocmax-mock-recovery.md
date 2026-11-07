# Mock journey recovery and progress

Continue the authorized mock-only branch. Add an explicit four-step progress display and page-only recovery notice. Make the native demo component itself remount on owner/thread key changes (the parent already does so), and prove late image completion after clear/owner switch cannot restore stale preview. Conversion failures can be cleared and retried with a new confirmation. No persistence, live providers, SQL, deployment or commits.

Scope decision: recovery means safe restart, not restoring an old publish approval. Page-local state is intentionally discarded on leave/reload/identity change; display that limitation. Original mission, upload, approval and reward code remains unchanged.

TDD: owner rerender, in-flight cancellation, failure/retry, progress semantics. Then focused existing tests, type/lint, production marker exclusion and mobile/desktop browser checks. One independent final review.

Implemented and verified locally: 88 tests pass; final review timeout-label finding fixed. Evidence in `docs/review/kocmax-stage-5/mock-recovery.md`. Browser pending-state reload remains explicitly unverified; clear/owner switch and automated unmount tests pass. No commit or external operation.
