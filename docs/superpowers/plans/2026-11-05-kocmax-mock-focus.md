# Mock keyboard and focus recovery

Bounded continuation on same branch: move focus to conversion-error text, to stopped notice after simulated revoke, and back to the scenario selector after explicit reset/edit/restart. Initial mount and owner remount must not steal focus. Late conversion must not focus an obsolete error/preview. No change to live/native authority, persistence, SQL, deployment or connections. No commits.

Use React refs and a user-action focus request applied after the render. Alert/status containers get programmatic-only tabindex=-1. Keep native buttons/links and existing field labels/DOM order; do not add positive tabindex or intercept Tab.

TDD existing recovery tests gain focus assertions and late-completion stability check. Verify keyboard activation and resulting focus on desktop and mobile viewport. Run relevant regressions, production exclusion, type/lint and one independent review. This is targeted keyboard/focus acceptance, not a full screen-reader or accessibility conformance audit.

Completed locally: 92 tests, type/lint/build boundary and independent review pass; actual mobile and desktop Enter/Tab flows verified. Evidence in `docs/review/kocmax-stage-5/mock-focus.md`. No commits or external mutations.
