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
- `npm.cmd run lint` reports the existing repository baseline: 8 errors and 5 warnings. Untouched errors are in `proofUrl.test.ts`, `publicationProof.test.ts`, and `server/routes/activeMissions.ts`; the two reported touched-file findings (`adminActiveMissions.ts:240` and `PublicationProofReview.tsx:530`) predate this task’s changed lines. No lint finding was introduced in the new Task 6 code.

## Commit

Commit subject: `feat: set up existing publication proof items`

The final commit hash is reported in the Task 6 handoff.
