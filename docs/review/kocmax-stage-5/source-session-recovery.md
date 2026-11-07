# Mock source panel login recovery

2026-11-05. Branch `codex/kocmax-studio-stages-1-2`; uncommitted. No deployment, SQL, account connections, credentials, provider/model calls or original mission/reward mutations.

## Implemented

The source panel handles API401 from its connection list, resource list, private import and mock Instagram insight-sync operations. It immediately hides cached sources and controls, latches the login-required state and notifies its parent once. The parent uses the existing workspace latch to hide the surrounding private discussion. A subsequent transient error does not expose cached data again. A late import success cannot show a success notice or invoke the imported callback after recovery.

Source identity, generation, rights, consent, private-by-default imports and sample-only checks are unchanged. No automatic reconnect, sign-out, retry, external fetch or sharing was added. Existing Drive fixtures are preserved for regression coverage; no Drive capability or real connection was introduced. Drive picker-specific errors and account management remain outside this Instagram source-panel continuation.

The dev-only `來源需要登入（模擬）` fixture returns401 for integration endpoints while leaving Studio reads available. It requires no mock connection setup and rejects requests before fixture dispatch. Its two markers are included in production isolation (51 markers total).

## Verification

- TDD: four source recovery cases and two wiring/fixture cases failed before implementation, then 62 focused cases passed. The Instagram fixture used the existing required basic/insights scopes; no permission rule was weakened.
- Broad selected suite: **227 tests across15 files passed**, covering Studio, integration UI, ownership and production bundle exclusion.
- Added the review-noted pending-import edge case: all16 source-panel tests passed, including resource401 followed by a late successful import response. This extra focused run is not added wholesale to the broad count.
- TypeScript, focused ESLint and scoped whitespace checks passed. Independent static review found no actionable issues; the late-import test was added afterward to close its stated coverage limitation. No second review is claimed.

```powershell
node node_modules/vitest/vitest.mjs run src/components/studio src/components/integrations src/test/studioPreviewOwnership.test.ts scripts/creator-growth-bundle-boundary.test.ts --maxWorkers=4 --minWorkers=1 --reporter=dot
node node_modules/vitest/vitest.mjs run src/components/integrations/IntegrationSourcePanel.test.tsx --reporter=dot
```

Local logs: `.superpowers/sdd/source-session-{red,wiring-red,green,final,late,types}.log`.

## Browser evidence

At390×844 and1440×1000, the original source panel was visible with no connected accounts. Selecting source-only401 produced the shared login-required notice across the entire private thread. Returning the fixture to normal left recovery latched. Explicitly following the login link showed the existing email form; no form was filled or submitted. Re-entering the normal fixture restored the owner evidence tab. No horizontal overflow:384≤390 and1434≤1440.

Screenshots: [mobile](source-session-mobile.png), [desktop](source-session-desktop.png). Owner/normal fixture restored and viewport reset. Import/sync failure and late completion were component-tested; browser checks cover list401 and parent recovery only. No real session, token replay, Auth/RLS or provider acceptance is claimed.
