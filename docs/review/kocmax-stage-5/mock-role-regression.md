# Original workflow and private-thread role regression

2026-11-05. Branch: `codex/kocmax-studio-stages-1-2`. This continuation completes an additional offline portion of publishing plan Task 8. No application code was changed, no commits were made, and no deployment, SQL, real account or provider connection was used.

## Automated result

```powershell
$env:RUN_INTEGRATION='0'
node node_modules/vitest/vitest.mjs run server/lib/creatorGrowth/missionProofHandoff.test.ts server/test/active-missions.test.ts server/test/reward-handoffs.test.ts server/test/studio-integrations.test.ts src/components/active-mission/active-mission.test.tsx src/test/studioPreviewOwnership.test.ts --maxWorkers=4 --minWorkers=1 --reporter=dot
```

**185 passed, 21 skipped, 6 files passed.** The skipped cases are live integration cases and remain unverified. Raw local log: `.superpowers/sdd/mock-role-regression.log`.

The selected regression protects original mission state transitions, proof handoff, reward distinctions, private integration consent and fixture ownership. It does not assert live atomicity, actual Auth/RLS or settled rewards. The earlier 796-test milestone remains separate; overlapping tests are not counted as additional unique coverage.

## Browser matrix

In-app browser, local synthetic fixture only. Tested the known owner-A private thread by direct URL after each role switch. Each row was checked at **390×844 and 1440×1000**.

| Fixture identity | Private thread and composer |
| --- | --- |
| Creator A (owner) | Available |
| Same-workspace other creator | Unavailable |
| Other-workspace creator | Unavailable |
| Brand owner | Unavailable |
| Brand member | Unavailable |
| Operator | Unavailable |
| Reviewer | Unavailable |
| Finance viewer | Unavailable |
| Workspace admin | Unavailable |

All 18 checks matched the private-owner boundary. Nonowners saw the existing neutral read-failure/retry state rather than private content or an editable composer. This is a direct-route privacy matrix, **not** acceptance of every administrative journey or a real nine-account login test. Role transitions were allowed to finish before checking the direct route; the first immediate snapshot can show the outgoing page while navigation completes.

All nine desktop states had scroll width 1434 within a 1440 viewport. Mobile Reviewer, Finance and Admin denial states had scroll width 384 within 390; no claim of a fresh per-role overflow measurement for the other mobile states.

Evidence: [structured observations](mock-role-matrix.json), [mobile denial screenshot](mock-role-mobile.png), [desktop owner restored screenshot](mock-role-desktop.png). The fixture was returned to Creator A, viewport reset and the local preview left available. No persistent test records were created, so no database cleanup was necessary.

## Next boundary

This closes the missing synthetic private-thread role evidence noted in the historical [mission handoff report](mission-publish-regression.md). It does not unblock native transport, identity/revocation, real login/refresh replay, database application or publishing. Those remain governed by the concrete pilot approval packet. No further mock feature is required by this result.
