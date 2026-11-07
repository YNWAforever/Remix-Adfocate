# P0 evidence history

All entries below are offline unless explicitly described as a read-only catalog query.

- Initial bootstrap route regression: 7 tests, 3 failed / 4 passed. Reproduced cross-workspace balance creation, competing first-login workspace handling, and deleted-account bootstrap acceptance.
- Initial route fix: those 7 passed; auth-flow and existing staff boundary gave 36 passed in 3 files.
- Initial brand-route regression: 8 tests, 6 failed / 2 passed. Limited/revoked staff reached validation instead of being denied before lifecycle writes.
- Brand-route guard: 44 passed in 4 files, before the later atomic-bootstrap replacement.
- Initial local SQL projection: finance_viewer updated one draft mission through active brand membership. No hosted role or JWT was used.
- First candidate rehearsal stopped on SQL 42501 for DELETE: the harness had expected an empty result, but the existing table grant already denied DELETE. The harness now requires either zero deleted rows or 42501; it never accepts a mutation.
- Independent review found the remaining gap between the route's canonical read and balance upserts. Candidate 21 and the atomic RPC route replace that intermediate fix.
- Atomic candidate rehearsal passed 6 checks, including injected second-balance failure and absence of partial creator/point-balance residue.
- The initial join-function probe used the wrong private function name. It was corrected to the actual private.join_mission. Current static evidence confirms +10 XP; shared positive join remains excluded. The earlier missing-function result proves nothing about XP.
- Intermediate atomic route/UI regression: 67 passed in 5 files. A later empty-referral parity assertion adds one case; final results are recorded separately.
- Final TypeScript check caught the synthetic invalid-result error object's shape; it was changed to the existing dbError message contract before final checks.
- Targeted lint required explicit Node process/console imports in the new rehearsal script; imports were added without suppressing the rule.
- Read-only hosted metadata: original applied migration still present; candidate function absent; protected creator workspace/xp/level/status column updates denied; active staff/brand overlap count zero at observation.

No Auth account, persistent shared fixture, provider, deployment, index DDL, or cleanup operation occurred in these entries.
