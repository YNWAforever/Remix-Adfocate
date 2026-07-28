# Release Task 6 — Existing publication-proof setup

Status: implemented and focused verification passed.

## Scope delivered

- Added only `supabase/migrations/20260727130000_publication_proof_existing_setup.sql`; no earlier migration was edited.
- Added the private worker plus the public `setup_existing_publication_instructions` wrapper.
- Added an explicit repository method and `POST /admin/active-missions/:workflowId/work-items/:workItemId/publication-setup`.
- Added the client helper and explicit “Set up publication proof” control.
- Added a server-derived `publicationSetupRequired` detail flag, shown only for an approved work item with no publication instruction and no proof attempt.
- Preserved the normal `set_publication_instructions` flow; the compatibility path never falls back to it.

## TDD evidence

Initial RED:

- `npm.cmd test -- server/test/active-mission-schema.test.ts server/test/active-missions.test.ts`
  - Failed as expected: 13 failures, 84 passed, 16 skipped.
  - Covered the absent migration/RPC, repository method, route, validation, and derived setup flag.
- `npm.cmd test -- src/components/admin/ActiveMissionReview.test.tsx src/routes/-admin.active-missions.test.tsx`
  - Failed as expected: 3 failures, 34 passed.
  - Covered the absent explicit control, required confirmation, and separate setup callback.
- `npm.cmd test -- server/test/active-missions.test.ts -t "maps changed-payload setup replay to stable IDEMPOTENCY_CONFLICT"`
  - Failed as expected: HTTP 404 instead of 409 before the route existed.
- `npm.cmd test -- server/test/active-mission-schema.test.ts -t "requires a complete authored policy"`
  - Failed as expected after adding an array-shape safety assertion, then passed after guarding `jsonb_array_elements` with a JSON type check.

Final GREEN:

- `npm.cmd test -- server/test/active-mission-schema.test.ts server/test/active-missions.test.ts src/components/admin/ActiveMissionReview.test.tsx src/routes/-admin.active-missions.test.tsx`
  - 4 files passed.
  - 135 tests passed; 17 live-gated tests skipped because local Supabase is unavailable.
- `npm.cmd run type-check`
  - Passed.
  - Existing route-generator warning: `_site.smoke.test.tsx` does not export a route.
- `git diff --check`
  - Passed.

Repository note: the brief names `PublicationProofReview.test.tsx`, but that file does not exist in this checkout. The publication-proof component coverage is in `ActiveMissionReview.test.tsx`, which was updated and included in the final focused run.

## SQL/security proof

- Both functions are `SECURITY DEFINER` with `set search_path = ''`; all referenced objects are schema-qualified.
- The public wrapper validates the service-role JWT and reuses the existing active-operator assertion.
- The private worker requires active `brand_users` membership for the target workspace.
- Canonical workflow, work-item, instruction, and attempt rows are locked before mutation.
- The RPC requires the exact approved state/revision, a UUID idempotency key, no existing instruction/attempt, and all five operator-authored policy fields. It provides no inferred defaults.
- The snapshot is inserted once with `frozen_at` immediately set.
- Exact same-key/same-payload replay returns the frozen instruction. Same-key/changed-payload raises `idempotency_conflict`, mapped to stable `IDEMPOTENCY_CONFLICT` / HTTP 409. Stale revisions remain `WORKFLOW_STALE`.
- A second key, wrong state/workspace/operator, or prior setup history is rejected.
- Audit event `mission_publication_existing_instructions_setup` contains only revision and idempotency metadata; authored publication fields are not copied into event metadata.
- The migration does not mutate rewards or budget.
- Execute privileges are revoked from `PUBLIC`, `anon`, and `authenticated`; only `service_role` receives the public wrapper grant. The private worker is not granted externally.

## UI/route proof

- The compatibility setup button is controlled by server-derived eligibility, never inferred from a missing object alone.
- The operator must author the complete policy, enter a positive publication window, and check an explicit freeze confirmation.
- The setup form has no default publication window and sends no override/setup reason.
- The route uses a separate setup client helper and retains existing stale-state focus/retry handling.

## Known verification boundary

- The live Supabase integration cases are present but skipped in this checkout because the local Supabase stack/CLI is unavailable. They cover first setup, exact replay, changed-payload conflict, stale revision, second setup, unauthorized operator, frozen instruction contents, no proof-attempt creation, privacy-safe event metadata, and reward/budget neutrality. Clean live migration replay remains the release-train Task 8 gate.
- `npm.cmd run lint` reports 13 baseline findings: 8 errors and 5 warnings. Untouched-file errors are in `proofUrl.test.ts`, `publicationProof.test.ts`, and `server/routes/activeMissions.ts`. Three findings are in files touched by Task 6: the pre-existing `prefer-const` error in `adminActiveMissions.ts`, plus a pre-existing hook warning and accessibility error in `PublicationProofReview.tsx`; none intersects the review-wave changed lines.

## Commit

Commit subject: `feat: set up existing publication proof items`

The final commit hash is reported in the Task 6 handoff.

## Changes-required review wave

Root causes:

- SQL `<>` comparisons let a NULL expected state evaluate to unknown instead of rejecting it.
- Replay trusted `mission_publication_instructions.idempotency_keys` and current item state, without proving the key belonged to this compatibility action and operator.
- JSON number parsing allowed an oversized digit string to reach an integer cast and did not impose an operational deadline bound.
- Detail eligibility considered only current instruction/attempt rows, so a history-only rewind could re-expose setup.
- UI recovery refreshed only `WORKFLOW_STALE`, not a setup race returned as `WRONG_STATE`.

Review RED:

- `npm.cmd test -- server/test/active-mission-schema.test.ts server/test/active-missions.test.ts`
  - Failed as expected: 5 failures, 100 passed, 17 skipped.
  - Failures proved NULL-safe state/event correlation was absent, history-only eligibility was true, and 8,761/oversized windows reached the repository.
- `npm.cmd test -- src/components/admin/ActiveMissionReview.test.tsx src/routes/-admin.active-missions.test.tsx`
  - Failed as expected: 1 failure, 37 passed.
  - The `WRONG_STATE` race did not refetch detail; the stale setup control remained visible.

Review GREEN:

- `npm.cmd test -- server/test/active-mission-schema.test.ts server/test/active-missions.test.ts src/components/admin/ActiveMissionReview.test.tsx src/routes/-admin.active-missions.test.tsx`
  - 4 files passed.
  - 143 tests passed; 17 live-gated tests skipped.
- `npm.cmd run type-check`
  - Passed with the existing `_site.smoke.test.tsx` route-generator warning.
- `git diff --check`
  - Passed.
- `npm.cmd run lint`
  - Exit 1 with the unchanged baseline count: 13 findings (8 errors, 5 warnings), categorized above.

Review contract evidence:

- Expected and current state checks use NULL-safe `IS DISTINCT FROM`.
- Exact replay now requires an event correlated by workspace, workflow, item, setup event type, operator actor type/id, instruction entity id, and metadata idempotency key.
- A correlated replay compares the stored event revision and every authored immutable instruction field; it does not depend on the work item’s later state.
- An instruction key without the correlated Task 6 event/actor, or a setup event without its instruction, is rejected as prior history.
- Publication windows must be JSON integers from 1 through 8,760 hours. The four-digit shape is proven before integer conversion, preventing cast and timestamp overflow; the same 8,760-hour ceiling is enforced at the HTTP boundary.
- Live-gated coverage now includes NULL/wrong state, wrong workspace, pre-existing attempt, history-only rewind, replay after progression, same-key changed payload, normal-setter/other-operator key collision, and anon/authenticated execute denial.
- Server-derived setup eligibility excludes prior setup events, and `WRONG_STATE` now follows the same refetch/recovery path as stale state.

Review-fix commit subject: `fix: harden existing publication proof setup`

The review-fix commit hash is reported in the Task 6 handoff.
