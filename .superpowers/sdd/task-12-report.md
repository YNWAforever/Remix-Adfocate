# Task 12 report: Operator active mission review

## Changed files

- `src/lib/admin.ts` — added typed active-mission queue/workflow contracts and all seven Task 7 client methods with the required workspace header.
- `src/components/admin/ActiveMissionQueue.tsx` — added the canonical-order queue, SLA/state/reviewer/mission filters, and complete queue metadata.
- `src/components/admin/ActiveMissionReview.tsx` — added accessible desktop split/mobile stack review, exact work-item claiming, structured revision, grant, approval, and shipping actions.
- `src/components/admin/ActiveMissionReview.test.tsx` — covered responsive content, exact claim context, revision validation, reward-neutral approval, and exhausted-limit grants.
- `src/routes/admin.active-missions.tsx` — added the authenticated workspace queue route.
- `src/routes/admin.active-missions.$workflowId.tsx` — added the detail route and exact Task 7 transition bindings.
- `src/routes/-admin.active-missions.test.tsx` — covered canonical order, required card metadata, filters, and workspace queue loading.
- `src/components/admin/adminNavItems.ts` — added Active mission review to the Review queue navigation group.
- `src/lib/i18n.dict.ts` — added English and Cantonese navigation labels.
- `server/routes/adminActiveMissions.ts` — minimally extended the Task 7 queue read model with exact `missionId` and `deliverableTitle`; no new endpoint was introduced.
- `server/test/active-missions.test.ts` — locked the extended queue projection.

## TDD evidence

### Initial queue and decision RED

Command:

`npx.cmd vitest run src/components/admin/ActiveMissionReview.test.tsx src/routes/-admin.active-missions.test.tsx`

Result: RED — 2 suites failed at import resolution because `ActiveMissionReview.tsx` and `admin.active-missions.tsx` did not exist.

GREEN: the same command passed 2 files and 8 tests after the initial implementation.

### Canonical queue identity RED

Task 7 already returned creator, mission title, reviewer ID, SLA, deadlines, and submission age inputs, but did not return the exact deliverable title or mission ID required by the Task 12 cards and mission filter.

Command:

`npx.cmd vitest run server/test/active-missions.test.ts -t "projects exact mission and deliverable identity"`

Result: RED — expected `missionId` and `deliverableTitle`; the received queue item omitted both.

GREEN: the controlled test passed after selecting and mapping the two fields in the existing queue endpoint.

### Exhausted-limit grant RED

Command:

`npx.cmd vitest run src/components/admin/ActiveMissionReview.test.tsx -t "requires a grant reason"`

Result: RED — the optimistic grant remained available after a revision request, leaving Request revision enabled.

GREEN: 1 focused test passed after consuming the local grant allowance on request submission.

## Verification

- `npx.cmd vitest run src/components/admin/ActiveMissionReview.test.tsx src/routes/-admin.active-missions.test.tsx server/test/active-missions.test.ts` — 3 files passed; 39 tests passed; 2 live-integration tests skipped by the normal config.
- `npx.cmd vitest run src/lib/admin.test.ts src/components/admin/AdminSideNav.test.tsx src/routes/-admin.test.tsx src/components/admin/ActiveMissionReview.test.tsx src/routes/-admin.active-missions.test.tsx server/test/active-missions.test.ts` — 6 files passed; 55 tests passed; 2 live-integration tests skipped.
- `npm.cmd run type-check` — passed (`tsr generate && tsc --noEmit`); emitted the existing warning that `_site.smoke.test.tsx` is not a route.
- `npx.cmd eslint server/routes/adminActiveMissions.ts server/test/active-missions.test.ts src/lib/admin.ts src/lib/i18n.dict.ts src/components/admin/adminNavItems.ts src/components/admin/ActiveMissionQueue.tsx src/components/admin/ActiveMissionReview.tsx src/components/admin/ActiveMissionReview.test.tsx src/routes/admin.active-missions.tsx 'src/routes/admin.active-missions.$workflowId.tsx' src/routes/-admin.active-missions.test.tsx` — passed with zero errors and warnings.
- `git diff --check` — passed.
- Normal Vitest configuration completed with output; no temporary config was needed.

## Commit

`feat: build operator active mission review`

## Concerns

None. The server change is a controlled read-model extension required to render real deliverable and mission identity while preserving the Task 7 paths and canonical server order.

## Review-fix TDD evidence

### Review regression RED

Command:

`npx.cmd vitest run src/components/admin/ActiveMissionReview.test.tsx src/routes/-admin.active-missions.test.tsx src/lib/admin.test.ts`

Result: RED — the admin client contract suite passed 13 tests, while five regressions failed across the review component and detail route. The failures proved that unversioned assets leaked into a submitted version, `revision_requested` and `received` states exposed invalid actions, rejected actions produced no accessible alert and an unhandled rejection, deliverable A state leaked into deliverable B, and the detail route lacked a testable auth-error binding.

### Review regression GREEN

The same command passed 3 files and 27 tests after the fixes:

- `src/lib/admin.test.ts`: 13 passed.
- `src/components/admin/ActiveMissionReview.test.tsx`: 10 passed.
- `src/routes/-admin.active-missions.test.tsx`: 4 passed.

### Final review-fix verification

- `npx.cmd vitest run src/components/admin/ActiveMissionReview.test.tsx src/routes/-admin.active-missions.test.tsx src/lib/admin.test.ts src/components/admin/AdminSideNav.test.tsx src/components/admin/StaffAuthGate.test.tsx src/routes/-admin.test.tsx server/test/active-missions.test.ts` — 7 files passed; 66 tests passed; 2 live-integration tests skipped by the normal config.
- `npm.cmd run type-check` — passed (`tsr generate && tsc --noEmit`); emitted only the existing warning that `_site.smoke.test.tsx` is not a route.
- `npx.cmd eslint src/components/admin/ActiveMissionReview.tsx src/components/admin/ActiveMissionReview.test.tsx src/routes/admin.active-missions.'$workflowId'.tsx src/routes/-admin.active-missions.test.tsx src/lib/admin.test.ts` — passed with zero errors and warnings.
- `git diff --check` — passed.

## Review-fix commit

`38f1c8200b5d80cd518378de5a36e81d90fdb0ab` — `fix: harden operator active mission review`.
