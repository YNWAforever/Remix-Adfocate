# Task 7 report: exact-attempt operator review lifecycle

Status: DONE_WITH_CONCERNS

## Scope

- Added guarded `start_publication_proof_review`, `request_publication_proof_correction`, and `verify_publication_proof` private implementations plus service-role-only public wrappers.
- Added publication review claim/decision timestamps, checklist, response deadline, and claim/decision idempotency fields and indexes.
- Replaced blanket review immutability with a transition guard that permits only unclaimed-to-claimed and claimed-to-terminal transitions.
- Extended work-item/workflow state constraints and replaced aggregate refresh logic with Phase 3 publication states.
- Corrected review-item categories to the approved eight-category contract.
- Kept operator queue/read-model/routes out of scope because the approved plan assigns those to Task 8.

## TDD evidence

Initial focused run:

`npm.cmd test -- server/test/active-mission-schema.test.ts server/test/active-missions.test.ts --reporter=dot`

- RED: 4 failures specifically reporting the three missing review RPC definitions.

Additional red/green regressions:

- Missing correction category was initially accepted; added a failing assertion, then required `coalesce(..., '')`.
- Unsupported/unsafe JSONB validation was covered with failing assertions, then replaced `jsonb_object_length` and added null/type-safe validation.

## Verification

- Focused: 81 passed, 16 integration-gated skipped.
- Type-check: passed. Existing TanStack warning remains for `src/routes/_site.smoke.test.tsx`.
- Full suite: 144 files passed, 33 skipped; 983 tests passed, 270 skipped.
- `git diff --check`: passed.

## Security and correctness notes

- All privileged functions use `SECURITY DEFINER SET search_path = ''`, schema-qualified relations, explicit service-role guards, workspace-active operator checks, and revoked default execution.
- Canonical lock order is workflow, work item, instruction snapshot, exact attempt, then review.
- Correction deadlines are always decision time plus snapshotted `revision_response_hours`; publication deadlines do not force a deadline into the past.
- Verification updates no submission, rewards, points, XP, earnings, or budgets.

## Concerns

- Supabase CLI/PostgreSQL runtime is unavailable locally, and live database integration tests are gated by missing test credentials. Verification is therefore static contract coverage plus the repository test suite; migration replay remains for the final environment-backed verification task.
- The task-brief helper could not be executed because the sandbox reviewer rejected running that local script outside the broken helper. The exact Task 7 plan/spec sections were read directly instead.

## Review fixes

- Kept the all-required-verified aggregate branch first, then included
  `proof_verified` in the required publication-stage progress branch. Mixed
  required items such as `proof_verified` plus `approved_to_publish` now remain
  `publication_in_progress` instead of falling back to `drafting`.
- Added a live-gated end-to-end fixture for the exact-attempt operator lifecycle:
  tenant/role denial, concurrent claim, claim ownership, exact retry, correction
  validation, response SLA, exact-attempt verification, required aggregate
  completion, and reward neutrality.
- Review-fix focused verification: 23 passed, 10 live-gated skipped.
- Type-check passed with the existing TanStack route-file warning.
- Review-fix full suite: 144 files passed, 34 skipped; 984 tests passed,
  272 skipped.
