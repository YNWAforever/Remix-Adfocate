# Private-thread recovery

2026-11-05. Same branch `codex/kocmax-studio-stages-1-2`; uncommitted. No deployment, SQL application, live connection or original mission/reward change.

## Change

The prior mock role matrix correctly denied nonowners but displayed a misleading transient retry prompt. `StudioWorkspace` now renders the same neutral unavailable message for API 403 and 404, plus a link back to `/home`. It does not reveal server text, owner identity or whether the requested thread exists. Other read errors retain the existing explicit retry. Successful reads, sharing, original permissions and unsaved draft protection are unchanged.

Only application files changed in this continuation: `src/components/studio/StudioWorkspace.tsx` and its test. The historical 83-file milestone manifest remains a snapshot before this change, not a current fingerprint.

## Evidence

- TDD: two new 403/404 cases failed against the previous retry message; after the change, all 38 tests passed across StudioWorkspace, StudioJourneys and studioPreviewOwnership. Four new cases cover both unavailable statuses and transient API/network retry, including suppression of cached private detail and raw error text.
- TypeScript `--noEmit --pretty false` and focused ESLint both exit 0; scoped `git diff --check` passes.
- Production mock-exclusion build test passed (1/1); mock marker isolation remains intact. This local build is not deployment acceptance.
- Independent read-only review found no issues in the scoped change. Existing unrelated dirty changes were excluded.
- In-app browser, 390×844: same-workspace nonowner sees neutral recovery, no retry and no private composer; return link reaches the home composer. Scroll width 384.
- In-app browser, 1440×1000: cross-workspace nonowner sees the same recovery and returns home; scroll width 1434. Owner access restores the private composer. Injected transient failure retains one retry button and no unavailable recovery link; returning to normal fixture restores owner access.
- Screenshots: [mobile](private-thread-recovery-mobile.png), [desktop](private-thread-recovery-desktop.png). Fixture restored to owner/normal, viewport reset.

Raw local logs: `.superpowers/sdd/private-thread-recovery-{red,green,types,build}.log`. No real Auth/RLS or native Instagram acceptance is claimed.

Reviewed source SHA-256:

- `StudioWorkspace.tsx`: `20fdf6e1729daccd3e2c4d50ef81978a897fa261f9dcd75aaa21ed0dd7449712`
- `StudioWorkspace.test.tsx`: `a7abf45b2d8c91c05217ce0844ef1093f1c58b6b6cc8f789b05d448da7e49844`
