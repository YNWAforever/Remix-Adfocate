# Mock conversion failure and preview expiry

Continue same branch with mock-only scenarios, preserving accepted flows and fixes. No deployment, SQL, real connections, posts or commits.

Add explicit restrictive fixture options to MockNativeJourney: simulate image failure before any codec/provider call, and issue an already-expired preview. Existing publish validation must reject the expired confirmation independently of UI. Options cannot enable live transport or weaken validation.

Expose two labelled scenarios in the dev-only panel. Failure stays blocked until reset; show an explicit return-to-normal-scenario action with no automatic processing. Expired preview uses existing PublishPreview expiry handling and cannot publish, hand off or export. Keep receipt, timeout, review, export and revoke paths intact. Label deliberate fixture failures so they are not mistaken for actual file errors.

TDD for no-provider effects, expiry denial and safe reset; focused regressions, type/lint, production marker scan, mobile/desktop browser and one final review. These fixtures do not prove real decoder/provider failures or elapsed live authorization behavior.

Completed locally: 166 tests plus type/lint and independent review pass. Mobile and desktop each recover to fresh explicit confirmation; evidence in `docs/review/kocmax-stage-5/mock-failures.md`. No external mutation or commit.
