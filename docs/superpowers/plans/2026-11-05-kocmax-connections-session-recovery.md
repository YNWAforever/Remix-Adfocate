# Account management session recovery

Same branch, mock-only verification; no commit/deploy/SQL/connections. Account list401 or provider command401 should hide account labels/scopes and controls, and latch an explicit login notice. Preserve lifecycle fencing and do not claim server/provider revoke or purge success. Retain normal non401 behavior. Invalidate late consent/success callbacks after unmount/recovery.

Reuse source401 development fixture; no mock account setup needed in browser. Test cached list, transient replacement and command errors with injected mock accounts. Verify existing integration suites, type/lint/build isolation and mobile/desktop `/connections` recovery. Independent review required. Real Auth/provider acceptance remains blocked.

Completed: 5 new tests, broad233 PASS, type/lint and browser checks; independent review no actionable findings with67 tests rerun. Cleanup-only ref alias removed lint warning and account suite rerun. Evidence: `docs/review/kocmax-stage-5/connections-session-recovery.md`.
