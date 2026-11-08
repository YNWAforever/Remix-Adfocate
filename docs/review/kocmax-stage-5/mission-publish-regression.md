# Task 8: offline mission proof handoff

Status: implemented and locally verified as a default-off, injected boundary. Runtime wiring and live acceptance remain **BLOCKED**. This is not provider, database, Auth/RLS, or nine-role browser acceptance.

Follow-up 2026-11-05: [synthetic private-thread role matrix](mock-role-regression.md) now verifies nine identities at mobile and desktop, plus fresh original-workflow tests. This adds narrowly scoped browser evidence; real login and full role journeys remain outside that result.

## Scope and original authority

Only `server/lib/creatorGrowth/missionProofHandoff.ts`, its test, this document, and Task 8 evidence artifacts were added. No original proof API, repository, client hook, state machine, reward contract, SQL, or runtime registration changed.

`prepare(actor, intentId)` reads trusted, owner-scoped publishing and original mission projections. It requires an explicitly non-sample, verified native `published` receipt and exact canonical Active approved caption, single image checksum, account subject, approved version, instruction revision, and immutable instructions. Caption whitespace is preserved. The receipt must also carry the original immutable mission/version binding: editing a draft to point at an otherwise matching mission cannot reuse an old receipt.

The current publish service is synthetic-only. Every current `sampleOnly` intent/receipt is denied, including a sample marked `published` with separately supplied native-shaped evidence. Native-shaped fixtures in the unit tests are not real receipts. The protocol manifest's null contract and disabled live execution are unchanged.

| Boundary | Behaviour |
| --- | --- |
| Default construction / missing explicit enablement | Denied before resolver or gateway calls |
| Owned exact Active approved native source | Frozen five-minute proposal; no submission during preparation |
| Changed draft, identity, caption, image, mission/version, or instructions | Original review; no new approval authority |
| Legacy, personal, or supplementary-evidence requirement | Original manual proof route remains authoritative |
| Non-published native source / unknown outcome | Status-check hint; no publishing capability or automatic retry |
| Client confirmation | Current actor/session, proposal ID, fingerprint, explicit confirmation, expiry, and canonical rereads required |
| Duplicate confirmation / ambiguous gateway failure | Consumed confirmation; no automatic resubmission or claim that nothing was submitted |
| Receipt already present in original attempts | Return existing attempt reference; no gateway call |
| Concurrent boundary instances | Same durable publish-intent UUID is the original idempotency key |

`confirm` supplies the existing `ActiveMissionRepository.submitProof` shape: owned submission/work item plus `primaryUrl`, empty additional URLs/evidence, expected state, existing publication-instruction revision, and the intent UUID as `idempotencyKey`. It uses the original proof input validator and state-transition validator. Media ID remains proposal metadata; no media/reward field was added to the original API. Client URL/content/owner overrides are not accepted. Only HTTPS Instagram post permalinks without credentials, query strings, fragments, or non-default ports are accepted; this module never fetches them.

The original proof gateway remains responsible for authorization, current state/revision, URL/evidence validation, and durable atomic idempotency. Its existing client hook retains `retry: false`. The in-memory proposal map is a human-confirmation guard, not durable mission state. Original attempt/reviewer/pending reward/points/XP/badge state is not duplicated or mutated by this module. A submitted proof is still awaiting original review; it is not an accepted proof or settled reward.

## Verification on 2026-11-04

| Evidence | Result |
| --- | --- |
| New handoff unit tests | 57 passed |
| Prescribed `active-missions`, `reward-handoffs`, `studio-integrations`, and Active mission component suites | 109 passed, 21 live integration cases skipped |
| Original publication-proof validator, state, and RewardPendingCard suites | 37 passed, including existing XP 0 and pending reward display |
| ESLint on the two new TypeScript files | Exit 0 |
| Focused TypeScript program using the two new roots and their imports | 0 diagnostics; no whole-project type-check claim |

TDD evidence includes the initial 41 failing boundary cases and two later failing immutable mission/version-retargeting cases, followed by the final 57 passing cases. Tests cover exact proposal/payload, no automatic submission, provenance and ownership rejection, changed canonical inputs, expiry and session changes, async races, duplicate confirmations, stable original idempotency, and ambiguous failures without raw error leakage. The duplicate-instance test uses an injected original-interface gateway fixture; it does not prove live database atomicity or actual reward issuance.

Commands (using the installed local tools):

```powershell
node node_modules/vitest/vitest.mjs run server/lib/creatorGrowth/missionProofHandoff.test.ts --reporter=dot
node node_modules/vitest/vitest.mjs run server/test/active-missions.test.ts server/test/reward-handoffs.test.ts server/test/studio-integrations.test.ts src/components/active-mission/active-mission.test.tsx --reporter=dot
node node_modules/vitest/vitest.mjs run src/components/active-mission/RewardPendingCard.test.tsx server/lib/activeMission/publicationProof.test.ts server/lib/activeMission/state.test.ts --reporter=dot
node node_modules/eslint/bin/eslint.js server/lib/creatorGrowth/missionProofHandoff.ts server/lib/creatorGrowth/missionProofHandoff.test.ts
```

Test processes used `RUN_INTEGRATION=0` and the Task 8 network guard via `NODE_OPTIONS=--require=<absolute task-8-offline-network-guard.cjs path>`. The guard rejects fetch, HTTP/TLS/socket connections and external DNS; it returns a fixed local loopback answer solely for Vite startup. No forbidden-network markers occurred in the successful logs. An earlier guard startup rejection of Vite's localhost lookup is retained separately as harness evidence, not a product failure.

## Remaining acceptance gates

- Runtime wiring is absent. A future trusted native receipt resolver must provide verified official evidence, durable immutable mission/instruction snapshots, canonical approved content, and a verified account-subject mapping. Supplying a browser/model assertion is insufficient.
- The original gateway must retain its owned transaction, validation and idempotency guarantees when wired. Offline fixtures do not establish live Auth/RLS, provider correctness, concurrent database behaviour, or reward settlement.
- Controller owns synthetic browser-role coverage separately. No live accounts were created, and no nine-live-role acceptance is claimed.
- No staging, commit, deployment, network/provider execution, or database execution was performed for this handoff.

Review evidence is in `.superpowers/sdd/2026-11-04-kocmax-instagram-publishing-pilot/task-8-report.md`, with exact LF-normalized `task-8-review.patch`, test logs, and preservation hashes. Task 5's stalled-confirmation navigation fix is documented and patched separately.
