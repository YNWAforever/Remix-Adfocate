# Offline publish-policy acceptance

Updated 2026-11-04. Same branch; source remains uncommitted. This is a pure server-side decision module, not an enabled publishing integration.

## Current behavior

`server/lib/creatorGrowth/publishPolicy.ts` validates an exact proposed static-image post against a trusted server-resolved grant, protocol contract and original mission approval. It produces an eligibility result and SHA-256 fingerprint. It does not send a request, store an intent, publish, approve mission proof or award points/XP.

| Input or change | Result |
| --- | --- |
| Unsponsored personal draft with confirmed image rights and a valid synthetic grant/contract | Eligible synthetic preview; `sampleOnly: true` |
| Missing App/identity/revoke/notice contract | Denied; current live contract is `null` |
| Matching username/BioCode without a numeric authorized subject | Denied |
| Revoked, expired, wrong-App, wrong-account or missing-publish-scope grant | Denied |
| Non-JPEG, unvalidated final bytes, invalid dimensions/size or excessive caption length | Denied according to the supplied versioned limits |
| Active mission's owner, work item, approved version, instruction revision, caption, single image hash or account differs | Denied; original manual/review route remains available |
| Required disclosure or platform label/tag is missing or unsupported | Denied; manual proof remains available |
| Legacy mission or personal sponsorship | Manual proof; no native publication |
| Native protocol/grant is unavailable for a mission or sponsored draft | Still exposes manual fallback while keeping `allowed: false` and `fingerprint: null` |

The fingerprint binds the draft revision, creator/workspace, account subject, grant generation/App/scopes, exact final JPEG metadata/checksum, caption, disclosure, mission approval/instructions and versioned protocol limits. A later service must additionally bind the current session, nonce, expiry and durable intent, revalidate current authority before execution, and never interpret this fingerprint alone as permission to publish.

## Verification

- Initial test run failed because the policy was absent, before implementation.
- Independent review found that early protocol/grant failures hid manual fallback. Five targeted cases reproduced the failure; the fix preserved the existing manual path without enabling native publishing.
- Final focused run: **56 policy tests + 85 Active mission tests passed; 8 existing integration tests skipped**.
- Scoped independent re-review: the finding is addressed, with no additional Critical, Important or Minor findings.
- The synthetic image/caption limits in tests are deliberately examples, not claimed Meta limits. See the [blocked protocol manifest](instagram-protocol-manifest.md).

The module is not imported by any route, service or UI. Durable intents, session-bound confirmation, worker execution and real-provider acceptance remain subsequent tasks. No real connection or publication was made.
