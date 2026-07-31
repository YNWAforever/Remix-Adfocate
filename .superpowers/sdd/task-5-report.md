# Task 5 report: reward handoff notifications and metrics

## Status
IMPLEMENTED — commit `85e3a07` (`feat: notify and measure reward handoffs`).

## Delivered
- Added `20260731130000_reward_handoff_notifications.sql` with additive notification checks, event-trigger observation, per-decision semantic dedupe, bounded payload rebuilding, and failure-isolated notification insertion.
- Added exact `/my/:submissionId` rendering with explicit English and Traditional Chinese pending/cancellation copy that makes no paid, payout, credited, available, or issued promise.
- Added reward-handoff operational metrics with explicit zero-denominator behavior and invalid/non-finite input exclusion.
- Added all seven typed analytics events with UUID/categorical/boolean value validation and rejection of amounts, notes, URLs, handles, emails, paths, and raw errors.

## TDD evidence
- RED: focused command failed for the absent migration/types/copy/metrics/analytics contract: 18 failed, 60 passed, 10 live tests skipped.
- GREEN: focused command passed: 78 passed, 10 live tests skipped, 0 failed.

## Verification
- `npm.cmd run type-check` — passed; only the pre-existing `_site.smoke.test.tsx` route-file warning remained.
- Focused ESLint across all modified TypeScript files — passed with no findings.
- Full `npm.cmd test -- --run` — 152 files passed, 37 skipped; 1,230 tests passed, 301 skipped; 0 failed. Existing React `activeProps` stderr warning remained outside this scope.
- `git diff --cached --check` — passed before commit; staged scope was exactly the nine Task 5 files.

## Self-review
- SQL preserves every prior notification type, verifies event/entity/decision ownership on replay, and keys dedupe as `decision:<decision_id>` on the pending-reward entity.
- The dedupe claim and notification insert share one exception subtransaction, so insert failure rolls the claim back; the outer trigger always returns `NEW` on notification failure.
- Payload output is limited to `mission_title`, `mission_slug`, `submission_id`, `target_at`, `reward_components`, and `reason_category`; components are only `points`, `cash`, and `xp`, never amounts.
- Metric cancellation rate is cancellation decisions divided by valid approval plus cancellation decision timestamps; a zero decision denominator returns `0`. Invalid timestamps, non-finite values, and negative durations do not enter rate or median inputs.

## Remaining concern
- Live Supabase was unavailable, so migration runtime/integration coverage remains intentionally gated. Static SQL contract tests and every non-live suite pass.

## Review follow-up: canonical ownership and null-target copy
- RED: `npx.cmd vitest run server/test/notifications-triggers.test.ts src/lib/notifications.test.ts` failed as intended with 2 test files failed, 5 tests failed, 36 passed, and 11 skipped. The failures were the absent canonical ownership chain assertion plus missing, null, empty, and malformed `target_at` payloads rendering the broken English `Target: .` copy.
- GREEN: `npx.cmd vitest run server/test/notifications-triggers.test.ts server/lib/activeMission/metrics.test.ts src/lib/notifications.test.ts src/lib/activationAnalytics.test.ts` passed with 4 test files passed, 83 tests passed, 11 skipped, and 0 failed.
- Live integration status: the same-workspace mismatched reward-row adversarial test is present inside the existing gated suite. It was skipped with the other live tests because `RUN_INTEGRATION=1 is required`; `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and `SUPABASE_ANON_KEY` were also unset.
- `npm.cmd run type-check` passed; only the pre-existing `_site.smoke.test.tsx` route-file warning remained.
- Focused ESLint across all Task 5 TypeScript files passed with no findings.
- `git diff --check` passed after the review edits.

The follow-up preserves the six-key payload whitelist, decision-scoped dedupe and failure isolation, operational metrics, analytics validators, populated-target copy, cancellation copy, and exact `/my/:submissionId` href behavior.