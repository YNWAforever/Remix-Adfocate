# Account recovery race verification

2026-11-05. Branch: codex/kocmax-studio-stages-1-2. Test-only continuation; no production source changes, commits, SQL, deployment or real connections.

## Scope and outcome

Added four regression cases in Connections.test.tsx: completion401 dismisses consent and both providers' controls without replay; delayed start, sync and purge responses after list401 cannot restore account UI or show false completion. All passed against existing implementation; no RED-to-GREEN production fix is claimed.

- Focused account suite: 26/26 passed.
- Integration plus StudioHome/StudioWorkspace regression: 115/115 across 7 files passed.
- TypeScript and focused ESLint exited 0.
- Independent static review found no confirmed production bug. Corrected sync fixture status to `completed` and strengthened completion401 assertions; final account suite again passed 26/26.
- Logs: `.superpowers/sdd/connections-races.log`, `connections-races-regression.log`, `connections-races-final.log`.

## Browser observations

Fresh in-app-browser checks at 390x844 and 1440x1000 displayed the account-specific login notice with provider controls absent. Scroll widths were 384 and 1434 respectively. Normal fixture plus explicit reload restored the account page. Screenshots: connections-races-mobile.png and connections-races-desktop.png.

Changing viewport followed by changing the fixture to transient failure displayed the generic failure page rather than the latched login notice. This browser sequence therefore does not prove cross-viewport latch continuity; component tests cover same-mount latching. Desktop login recovery was checked again with a fresh401 scenario. No connected fixture account was created in the browser.

## Evidence limits

The deferred responses encounter the existing query epoch fence and become LocalStaleResponse before component success callbacks execute. These tests prove visible containment for that path, not every alive/blocked callback guard. Ordinary unmount without an epoch change, deferred complete/revoke and concurrent command401 remain separate coverage opportunities. Real Auth/RLS, provider identity/revocation and publishing acceptance remain unverified.
