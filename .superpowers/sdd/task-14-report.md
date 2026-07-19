# Task 14 report: active mission workspace rollout

Status: **DONE_WITH_CONCERNS**

Starting HEAD: `e11c2d8`

The final task commit hash is returned in the handoff. A commit cannot contain
its own hash without changing that hash, so this report records the immutable
starting hash and the final handoff records the resulting commit hash.

## Delivered

- Added `npm run test:active-missions` with the nine required focused files.
- Replaced the Unix-only integration environment prefix with a dependency-free,
  cross-platform Node launcher that preserves the exact 35-file suite and sets
  `RUN_INTEGRATION=1` only for the child Vitest process.
- Added a forward-only, locked, service-role-only migration RPC for pristine
  joined legacy submissions. It rejects content, review markers, points, XP,
  and any prior workflow; delegates workflow creation to the existing private
  function; records `legacy_submission_migrated`; and does not update or delete
  the submission reward anchor or workflow history.
- Added source-contract and guarded live integration tests for pristine
  migration, all forbidden statuses, content/reward/prior-workflow rejection,
  unchanged reward snapshots, and legacy final approval rewards.
- Added `docs/operations/active-mission-workspace.md` covering enablement,
  private storage/policies, monitoring, rollback, and the locked migration
  procedure.
- Cleared branch-level lint/ESM release blockers with behavior-neutral omitted-
  field handling and runtime `.js` extensions.

## TDD evidence

### Rollout migration RED

Command:

`npm.cmd test -- server/test/active-mission-schema.test.ts --no-file-parallelism`

Exit `1`: 1 file failed; 1 failed, 5 passed, 6 skipped (12). The new contract
failed because the migration file was absent:

`expected '' to contain 'create or replace function public.migrate_pristine_joined_active_mission'`

After the minimal migration, the schema file passed. The final schema count is
7 passed and 6 guarded skips (13).

### Cross-platform integration launcher RED

The original `npm.cmd run test:integration` exited `1` before Vitest:

`'RUN_INTEGRATION' is not recognized as an internal or external command`

A launcher contract test then failed as intended because package.json still
contained `RUN_INTEGRATION=1 vitest ...` instead of
`node scripts/run-integration-tests.mjs`. After the Node launcher was added,
the contract passed and the official command executed on Windows.

### Release-gate RED/GREEN

Initial lint: exit `1`, 3 errors and 3 warnings. The errors were unused omitted
bindings in `server/routes/missions.ts` and `MissionEditor.tsx`. Final lint:
exit `0`, 0 errors and 3 existing hook warnings.

Initial build: exit `1`; ESM check found two extensionless imports in
`server/lib/activeMission/state.ts`. After adding `.js`, the final ESM check and
build passed.

## Final verification matrix

| Gate | Result | Evidence |
| --- | --- | --- |
| `git diff --check` | PASS | exit 0 |
| `npm.cmd run test:active-missions` | PASS | 9/9 files; 92 passed, 20 guarded skips (112); 95.52s |
| `npm.cmd run lint` | PASS with warnings | exit 0; 0 errors, 3 pre-existing hook warnings |
| `npm.cmd run type-check` | PASS with warning | route generation and TypeScript exit 0; existing `_site.smoke.test.tsx` route warning |
| `npm.cmd test` | PASS with warning | 140 files passed, 33 skipped (173); 846 passed, 265 skipped (1111); 202.93s; existing React `activeProps` stderr warning |
| `npm.cmd run test:integration` | GUARDED PASS | official cross-platform command exit 0; 5 files passed, 30 skipped (35); 27 passed, 217 skipped (244); 220.71s |
| `npm.cmd run build` | PASS with warnings | ESM, route generation, TypeScript, and Vite exit 0; 2465 modules; Vite built in 39.10s; existing route/chunk warnings |

Integration was not a live database pass. This worktree contains only
`.env.example`; no `SUPABASE_URL`, service key, anon key, or fresh local stack
was available. The guarded suites skipped their database cases. No hosted
Supabase project, production data, secret, migration history, or cloud resource
was touched.

## Browser acceptance

The local app started at `http://127.0.0.1:4173/`. Read-only HTTP evidence:

- `/` returned 200 and the Vite page contained `#root`.
- `/my/<fixture-id>` returned the SPA shell with status 200.
- `/api/my-missions/<fixture-id>/workspace` returned the same Vite index HTML;
  this dev command does not provide the app API locally.

The required real 390x844 and 1440x900 browser flows were not completed. The
in-app browser control runtime failed twice before connecting with:

`windows sandbox failed: helper_unknown_error: apply deny-read ACLs`

In addition, there was no local API/Supabase/auth fixture. I did not substitute
a production account or deployment.

Strongest non-browser evidence is the focused component/route suite, which
passed cases for:

- Home and My Missions active/legacy entry routing;
- fulfilment receipt API/repository behavior;
- debounced autosave, stale-conflict recovery, and live status announcements;
- invalid image/video rejection and per-file retry;
- immutable submit/version review contracts;
- canonical operator queue ordering and filtering;
- structured revision, revision-limit exhaustion, and explicit extra grant;
- exact-version approval and all-required-deliverable overall state;
- mobile sticky-action stacking and keyboard-addressable semantic controls;
- unchanged active-workspace submission/reward anchors and legacy submission
  approval behavior.

This evidence does not replace viewport, focus-ring, horizontal-overflow, or
keyboard-only end-to-end inspection; those remain concerns.

The Vite process was stopped, port 4173 was released, and Task 14 temporary
logs/patch artifacts were removed.

## Final acceptance self-review

- Direct join/accepted-application idempotency and snapshots: covered by prior
  Phase 2 integration/source contracts; live cases skipped without local DB.
- Product fulfilment gate and non-product drafting: covered by source/component
  tests; live cases skipped.
- Autosave conflict recovery: focused tests pass.
- Private assets and ownership-scoped signed URLs: schema/source tests pass;
  live storage cases skipped.
- Immutable/auditable submitted versions and decisions: schema/component tests
  pass; live DB cases skipped.
- Independent deliverables and all-required approval: state/component tests
  pass.
- Revision limits and grants: source/component tests pass.
- Operator queue deadline/SLA order: focused tests pass.
- Owner/deadline/blocker/next-action rendering: focused components pass.
- No Phase 2 mutation of submission status/reward ledgers: SQL source guards and
  reward-neutral tests pass; live DB cases skipped.
- Legacy final approval/rewards: guarded live regression added; skipped without
  DB, existing legacy unit/source behavior remains unchanged.
- Best-effort notification/analytics minimization: prior focused tests pass.
- Locales/accessibility/mobile recovery: component tests pass; real viewport and
  keyboard browser pass blocked as described above.

## Concerns

1. The new migration and legacy reward regressions were not executed against a
   fresh local Supabase; they were guarded skips.
2. Real browser acceptance at both required viewports was blocked by the
   browser runtime ACL failure and absent local API/auth fixtures.
3. Lint retains three non-failing hook warnings; build retains existing route
   classification and large-chunk warnings; full tests retain an existing
   `activeProps` React warning.
