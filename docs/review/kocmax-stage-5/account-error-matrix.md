# Account command delayed-error matrix

2026-11-05. Same codex/kocmax-studio-stages-1-2 branch. Only test and evidence changes; no deployment, SQL, real provider calls, commits or production source modifications.

Expanded creator A-to-B delayed-error coverage from start-only to start, complete, sync, revoke and purge, each with401 and503 (8 additional cases). Tests wait for each operation before switching identity, reject the old request, wait for mutation settlement, then assert B remains usable with an empty account list, no login redirect notice, private error/account leakage, dialog or false deletion success. POST count prevents replay; complete legitimately has start plus complete requests.

Selected integration, StudioHome and StudioWorkspace suite:131/131 across7 files passed; account suite42 tests. Focused ESLint passed. Log: .superpowers/sdd/account-error-matrix.log. Existing implementation passed; no RED-to-GREEN fix claimed.

Fresh in-app browser localhost8770: source401 login notice at390x844 and1440x1000, scroll widths384 and1434. Normal fixture plus reload restored Instagram mock connection control; no connection created. Viewport reset and tab retained. Screenshot: account-error-matrix-mobile.png.

Browser evidence is UI recovery, not operation-level race testing or real authorization. All operation races use injected mocks. No claim of full-repository coverage, real Auth/RLS or platform acceptance. This round was author-reviewed, not independently reviewed.
