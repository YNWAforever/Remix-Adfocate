# Thread command login recovery

2026-11-05. Same branch `codex/kocmax-studio-stages-1-2`, HEAD `e491e2d`, changes uncommitted. No deployment, SQL, real connections, credentials, posts or original mission/reward mutations.

## Change

Six manual Studio operation paths now pass API401 failures to the existing parent login-required latch: chat send, pending-chat status lookup, private Brief save, transfer to original mission draft, manual source creation and manual source revocation. Private content and controls unmount; no success is asserted and no request is automatically replayed. The brief confirmation/replay references are cleared on unauthorized failure. Existing non401 error handling remains in place, including retained input, saved-version checks and explicit retry.

The development-only `操作時需要登入（模擬）` scenario preserves thread reads and rejects Studio commands, assistant chat and status lookup before fixture dispatch. It does not simulate real token expiration. Provider integration controls remain outside this manual-command scope. The two added fixture strings are included in production exclusion (49 markers total).

## Tests and review

- Initial failing cases exposed missing login recovery and the absent command-only fixture. Test setup was corrected to isolate the unrelated provider panel and edit a Brief before clicking its intentionally disabled-until-dirty save button.
- Focused component/home/ownership suite: 55 passed.
- Final all-Studio, ownership and production-exclusion suite: **155 passed across 10 files**.
- TypeScript, focused ESLint and scoped `git diff --check`: exit 0.
- Independent read-only review: no severity findings. Coverage limitation: non401 preservation is not separately tested for every operation; explicit transient Brief retention and existing chat/home behavior remain covered. No fresh live Auth/RLS claim.

```powershell
node node_modules/vitest/vitest.mjs run src/components/studio src/test/studioPreviewOwnership.test.ts scripts/creator-growth-bundle-boundary.test.ts --maxWorkers=4 --minWorkers=1 --reporter=dot
```

Local logs: `.superpowers/sdd/thread-command-{red,green,types,final}.log`.

## Browser evidence

- Mobile 390×844: fixed synthetic owner thread remains readable under command-only failure. Sending synthetic text produces the login-required notice, removes the composer, and does not automatically recover when the fixture is returned to normal. Login link reaches the existing form; no form submission. Scroll width 384.
- Desktop 1440×1000: locally generated, unsaved synthetic Brief is rejected on save under command-only failure. Login notice replaces all editors; scroll width 1434. Explicit login navigation and normal fixture re-entry restore the owner view.
- Subsequent UI readback showed no rejected synthetic message and no saved Brief version. The fixture nonmutation test independently compares thread JSON before and after rejected commands.
- Source add/revoke, mission transfer and status lookup are component-tested, not claimed as additional browser journeys in this phase.

Screenshots: [mobile](thread-command-mobile.png), [desktop](thread-command-desktop.png). Normal fixture/owner view restored; viewport reset. No persistent test records were created, and no database cleanup was performed or required.

This completes the manual Studio command recovery scope. Native Instagram identity/revocation, real login/refresh replay and all provider/SQL execution gates remain unchanged.
