# Account-management login recovery

2026-11-05. Same branch `codex/kocmax-studio-stages-1-2`; uncommitted. No SQL, deployment, real connections, credential entry, external sync or provider revocation performed.

## Behavior

The account page now hides cached account labels, scopes, provider controls and consent/deletion dialogs on list401 or provider-command401. Recovery is latched until explicit re-entry, including when a background refetch changes the error to a transient failure. Provider command errors notify the owner page. Late consent and operation-success callbacks are guarded after unmount or recovery.

The shared login notice has account-specific copy: sync/revocation/deletion results must be checked after signing in. It does not claim the platform revoked access or deleted anything. Existing lifecycle cache fencing, non401 feedback, permissions, mock-only gates and original creator workflows remain intact. No real authentication flow or provider adapter was enabled.

## Evidence

- Five new cases initially failed; the start-command test was corrected to wait until the existing loading-disabled button was enabled before clicking it.
- Account suite:22/22 passed. Tests cover cached list401→503, start, sync, revoke and purge401, no repeated POST, no private label/error leakage and no false completion.
- Broad selected Studio/integration/ownership/build suite: **233/233 tests across15 files passed**. Production mock exclusion remains51 markers.
- TypeScript passed. An ESLint cleanup warning was resolved by capturing the sequence-ref container inside the cleanup effect, preserving its current-counter invalidation behavior. Focused lint then passed without warnings; account tests were rerun after this small cleanup refactor. The broad build preceded that refactor.
- Independent read-only review found no actionable issues and independently ran67 tests in3 related suites, all passing. Complete-command401 and deferred callback races are not directly covered by the newly added tests; no broader coverage claim is made.

```powershell
node node_modules/vitest/vitest.mjs run src/components/studio src/components/integrations src/test/studioPreviewOwnership.test.ts scripts/creator-growth-bundle-boundary.test.ts --maxWorkers=4 --minWorkers=1 --reporter=dot
node node_modules/vitest/vitest.mjs run src/components/integrations/Connections.test.tsx --reporter=dot
```

Logs: `.superpowers/sdd/connections-session-{red,green,types,final,cleanup-check}.log`.

## Fresh browser verification

Used existing `來源需要登入（模擬）` on `/connections`, with no connected accounts and no mock connection creation.

| Check | 390×844 | 1440×1000 |
| --- | --- | --- |
| Account-specific401 notice | PASS | PASS |
| Instagram connect control absent | PASS | PASS |
| Recovery persists after transient error | PASS | PASS |
| Login link reaches existing email form | PASS | PASS |
| Explicit normal re-entry restores account page | PASS | PASS |
| Horizontal overflow | None:384≤390 | None:1434≤1440 |

Screenshots: [mobile](connections-session-mobile.png), [desktop](connections-session-desktop.png). No login form submission, provider action or deletion was performed in the browser. Normal fixture restored and viewport reset. Command failures used injected mock accounts in component tests, not browser or live account operations.

Real Auth/RLS, Instagram identity/revocation and provider acceptance remain blocked. Drive picker-specific failures are outside this phase; its existing functionality was regression-tested.
