# Account switch and unmount verification

2026-11-05. Same codex/kocmax-studio-stages-1-2 branch. Test-only mock phase, no commits, production source edits, deployment, SQL or external connections.

## Completed

Four new cases: delayed start, completion and sync after explicit creator A to creator B switch; delayed start settling successfully after ordinary unmount without a query epoch change. Account suite now 30 tests.

Independent static review found no confirmed production defect. Its coverage feedback prompted explicit creator-A seeding, an assertion that old responses finish with STALE_CONNECTION, and unchanged A/B list-cache assertions. Existing implementation passed; no production fix or RED-to-GREEN claim is made.

Final selected regression: **119/119 tests across 7 files passed** (integration components, StudioHome, StudioWorkspace). TypeScript, focused ESLint and diff whitespace check passed. Logs: `.superpowers/sdd/connections-owner-{races,regression,final}.log`.

## Browser

In-app browser with existing synthetic roles only. At 390x844 switched to same-workspace peer, then opened connections: no authorized accounts, no sync data, scroll384. At1440x1000 switched to other-workspace creator and opened connections: no authorized accounts, no sync data, scroll1434. Restored original creator, connections page and default viewport. No mock or real provider connection created.

Screenshots: connections-owner-mobile.png, connections-owner-desktop.png.

## Limits

Browser fixtures have no connected accounts: they verify role navigation and responsive empty account state, not live cross-account authorization. Injected tests exercise owner fencing; they do not independently prove each component alive/blocked guard. The ordinary-unmount test confirms successful settlement and no visible consent resurrection, not that a particular guard is indispensable. Resource invalidation, deferred revoke/complete after ordinary unmount and real Auth/RLS remain separate coverage. No live provider gate is cleared.
