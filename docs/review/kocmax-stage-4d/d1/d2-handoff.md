# D2 handoff: not authorized or ready

> **Status update, 2026-11-03:** The October 31 dependency table below is a historical planning snapshot. The user subsequently approved the reviewed SQL against the existing Remix-Adfocate database; the restore point, migration application, nine-account Auth/API/RLS checks at mobile and desktop sizes, and scoped cleanup are recorded in [D1 closeout](D1-CLOSEOUT-20261103.md). The original isolated hosted DB/Auth/Storage requirement was changed to a shared-DB test scope, so those hosted isolation gates remain open. Real Instagram/Google Drive grants, provider smoke tests, deployment, and the eight-day soak remain unrun and require separate authorization. Do not interpret the old “no SQL applied / no accounts” rows as current state.

D1 user approval explicitly keeps real Instagram/Google Drive connections and production deployment disabled. Local code/tests do not authorize D2. No real account token, platform content or external AI has been used.

2026-10-31 continuation: user approved preparing exact SQL/test data/rollback for the existing DB, explicitly prohibited application/deployment/connections. The [shared-database review packet](shared-database/README.md) is prepared with read-only preflight evidence and in-memory regression results. Its complete SQL defaults to ROLLBACK; no remote changes, persistent fixtures, history registration or runtime-gate changes occurred. This does not complete D1 or authorize D2.

## Inputs still needed

| Dependency | Current state |
| --- | --- |
| Approved target and spend limit | User selected existing Remix-Adfocate and approved SQL preparation only; exact review packet ready, no DB writes or branch quote approved |
| Fixed preview origin, hosted region and actual IDs | Not assigned |
| Original isolated DB/Auth/Storage requirement and exact migration receipt | Not created/applied; existing DB proposal needs a separately scoped execution and acceptance plan |
| Google Cloud project / Web OAuth client / restricted Picker key | Not registered |
| Meta / Instagram app IDs and access-level proof | Not registered/verified |
| Two internal participants and role mapping | Unnamed; no invitations sent |
| Persistent keyring, tombstones, retention/cleanup owner | Not installed/assigned |
| Target control-plane observer and live Auth/application composition | Prepared interfaces; not installed |
| Hosted callback/protection/log canary and PDF worker | Not run |
| Ordinary JWT/direct API and two real DB connections | Not run |
| Hourly scheduler and quarantine/restore drill | Not installed/run |

Use two workspaces and three creator sessions: A/C1/W1, B/C2/W1, A/C3/W2. A and B must name accounts they own or manage; do not infer that adding a tester grants Instagram eligibility. Role tests also cover visitor, brand, reviewer, operator and finance without private-source access. The repeated A identity tests Google grant scope across workspaces; app source records and cache remain separate.

After the environment gates pass, a D2 request must specify each participant, exact provider/app/scope, selected local test documents uploaded by their owner, purpose, expiry and cleanup. Google permissions remain `drive.file` + `openid`; Instagram remains blocked until [IG-01–04](instagram-blockers.md) have product-specific evidence. D2 can be Google-only, but requires its own approval.

The first real Instagram action after approval is identity/revoke smoke before media reads. The Google soak covers at least eight natural days starting at the first real grant, with cancellation, denial, partial scopes, expiry, revoke, account/workspace switching, stale requests and selected-file permission changes. Test actual system browsers on mobile and desktop; the current in-app browser checks cover only local UI.

Prepare text files and text PDF examples locally with no customer data: a Traditional Chinese filming brief, a small Hong Kong audience-question note, unknown rights, stale/deleted/not-downloadable versions, a sixth selection, oversized file and unsupported PDF examples. Do not create real Drive files during D1.

Acceptance must retain raw-test questions, platform/API version, actual time window, missing/partial coverage and safe citations. No inferred Hong Kong/language coverage, connection points/XP, real redemption or brand delivery. External AI remains a separate D3 approval.
