# Home and starter login-required recovery

2026-11-05. Same branch `codex/kocmax-studio-stages-1-2`. No commit, deployment, SQL, real connections, credential entry or original workflow/reward writes.

## Implemented

- Home hides cached level, balance, recent private thread titles and creation controls if its profile, balance or enabled Studio history query reports 401. Threads remain disabled when their rollout flag is off; the added history observer uses the existing key and respects that flag.
- A create-thread 401 clears the starter's replay intent, hides its controls and informs its home/workspace parent to hide surrounding private data. No automatic command replay or navigation occurs.
- The login-required notice is shared with the existing workspace. Non-auth transient failures still retain input and the request UUID for explicit retry. The original 403/404 recovery remains unchanged.
- Unauthorized state remains latched for the mounted home/workspace. Later background failures or successful query results cannot uncover cached private data. Explicit navigation away and re-entry resets that UI state; existing session checks remain authoritative. This does not claim cross-tab logout or global cache erasure, and unsaved work is not newly persisted/restored.

## Independent review and fix

One P2 finding identified that replacing a 401 with a transient refetch error could expose cached home data again. Four added cases reproduced it (RED), covering home 401→503/network/null and workspace 401→503. Both surfaces now latch the recovery state. The final suite is GREEN. No additional findings were reported; no second review was claimed after the fix.

## Verification

- Initial TDD: 6 expected failures and 1 preexisting transient-retry pass; initial focused suite then passed 49 tests.
- Final selected suite: **147/147 tests across 10 files**, including all Studio component suites, fixture ownership and the production mock-exclusion build (47 markers).
- After the fix, TypeScript and focused ESLint exited 0; scoped whitespace checks passed (only existing Git line-ending normalization warnings).
- No full-repository or real Auth/RLS acceptance claim. The current source supersedes the historical milestone manifest; that historical artifact was not overwritten.

```powershell
node node_modules/vitest/vitest.mjs run src/components/studio src/test/studioPreviewOwnership.test.ts scripts/creator-growth-bundle-boundary.test.ts --maxWorkers=4 --minWorkers=1 --reporter=dot
```

Local logs: `.superpowers/sdd/home-session-red.log`, `home-session-review-red.log`, `home-session-final.log`, `home-session-types.log`.

## Browser checks

Existing local fixture scenario `工作室需要登入（模擬）`; no new real identities or data.

| Observation | 390×844 | 1440×1000 |
| --- | --- | --- |
| Home 401 hides recent private titles and composer | PASS | PASS |
| Explicit login link reaches existing email sign-in form | PASS | PASS |
| 401 followed by injected read failure stays contained | PASS | PASS |
| Switching fixture back to normal does not automatically uncover content | PASS | PASS |
| Leaving for login, restoring normal fixture and explicitly re-entering home restores composer | PASS | PASS |
| Initial recovered layout has no horizontal overflow | 384 ≤ 390 | 1434 ≤ 1440 |

No login form was filled or submitted. Normal creator home was restored and the viewport reset. Screenshots: [mobile](home-session-mobile.png), [desktop](home-session-desktop.png).

Mutation-only 401 and feature-disabled behavior were component-tested; the browser scenario returns 401 for both read and write endpoints, so no separate mutation-only browser acceptance is claimed.
