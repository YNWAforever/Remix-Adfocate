# Instagram controlled-pilot launch approval package — HOLD

Prepared 2026-11-06 for the existing branch. **Not ready for execution approval.** P1–P4 offline implementation is authorized; P5/P6 are not. No approval in this document can be inferred from a PASS in a mock test.

2026-11-07 authorization update: **P5.0 offline preparation only is now authorized.** P5.1 onward, future action packets A–D and P6 remain NOT_AUTHORIZED. The previous P5/P6 restriction above is superseded only for this offline preparation scope. Use `p5-0-owner-intake.md` for nonsecret owner inputs and `p5-0-readiness.md` for current evidence gaps. The concrete sequence is `../../superpowers/plans/2026-11-07-kocmax-p5-controlled-pilot-launch.md`. Default P5 posting budget is zero; any technical post needs separate exact-content approval. No launch approval is requested while owner/resource fields remain unfilled.

Continuation: native routes, durable media/receipt storage, private collection and original proof/settlement wiring are now implemented and tested with mocks. See `native-offline-wiring.md` for exact endpoints, composition, retention behavior and evidence boundaries. This closes the previously missing backend implementations; it does not close App-specific protocol or hosted acceptance gates.

## Exact candidate and allowed scope

Branch: `codex/kocmax-studio-stages-1-2`; base HEAD: `e491e2dd30f42090458eacb82777d45b67275627`. Work is unstaged. The accompanying `offline-artifacts.json` lists byte hashes for this review's implemented boundaries and SQL documents. It is not a hash of an approved deployable release or a real image/roster. Recompute after any change and obtain a final candidate review.

Proposed target remains existing Supabase Remix-Adfocate, `mhkoayftiuojxlrkollf`. This is shared infrastructure, not physical isolation. Protected application URL, worker environment, media origin, callback/deletion URLs, secret-storage/key owner, exact pilot workspace/run and named operators: **not supplied**. Do not provision or deploy placeholders.

Proposed business scope: one brand; C1 first; at most C2–C5 after C1 acceptance; one approved JPEG per creator in a proposed seven-day attended window. Any technical post is separately counted/approved. No scheduling, advertising, messaging, Insights, scraping or Google Drive. Basic/manual tasks remain available without Instagram. Real points come exclusively from the original approved reward contract.

## Proposed technical account designation — 2026-11-07

The user has designated **T-IG** as the proposed existing Facebook Page/Instagram pair. The verified asset names/IDs, ownership and user-access evidence are recorded in the local Git-ignored owner intake; the repository keeps the alias only. This closes the T-IG selection question, not OAuth or publishing readiness. The completed private roster is not included in the offline artifact manifest.

Current authority: document the selection only. Provider connections, settings/permission changes, public media exposure and posting remain NOT_AUTHORIZED; technical post budget is ZERO. DEV - Ads is now the user-designated proposed pilot App (2026-11-07); this is selection only, not live-operation approval. T-negative, application identity binding, actual product/version/eligibility, sponsor and environment gates remain open. The existing T-IG Page/Instagram accounts are not disposable; no default cleanup may delete or disconnect them. Future grant/test-data cleanup requires exact separately approved scope. Package disposition remains HOLD.
## Gate register

| Gate | Current status | Closure evidence / accountable role |
|---|---|---|
| B1 App/product/version | BLOCKED | Actual App owner, pinned supported product/version, endpoint/expiry matrix, external-user eligibility; Meta owner |
| B2 Partnership label | BLOCKED | Actual sponsor/creator eligibility and rendered platform label; brand + reviewer |
| B3 Identity/OAuth/revoke | BLOCKED | Exact product subject mapping, token lifecycle, signed callback/deletion contract and test evidence; security owner |
| B4 Runtime composition | OFFLINE_WIRED | Registered default-disabled native routes, explicit runtime factory, durable collection/proof wiring and original settlement tested with mocks; exact environment/session/client wiring and hosted UI acceptance remain NOT_RUN; engineer |
| B5 Schema/cleanup | OFFLINE_TESTED | Full atomic review bundle and empty-only rollback, original cleanup/account deletion and duplicate-index review pass in PGlite; remote application unauthorized; DB reviewer |
| B6 Recovery | NOT_RUN | Current exact-target backup, checksum/inventory and successful isolated restore; DB operator |
| B7 Real Auth/RLS | NOT_RUN | Named disposable accounts, refresh/concurrency/peer checks, exact cleanup readback; QA/security |
| B8 Media host | LOCAL_BACKEND_READY | SQL final-JPEG backend and unmounted no-store origin route tested with mocks; actual origin/Meta fetch/TTL/cache behavior NOT_RUN; engineer/privacy owner |
| B9 Operations | BLOCKED | Private roster, named owners, exact dates, monetary caps, retention periods and cleanup manifest; pilot owner |
| B10 Live authorization | NOT_AUTHORIZED | User approval of exact resources/actions/hashes after the offline prerequisites for that action close; live evidence is required before progression, not before permission to perform the bounded test |

All named people, evidence timestamps and expiries must be completed before signoff. Any App/version/permission/target/content/candidate change invalidates relevant evidence. Protocol/restore/permission checks must be refreshed immediately before the authorized attended run; stale historical backups and local mock recovery cannot substitute.

## Future approval items — not requested yet

1. **P5 environment:** exact protected URL and immutable application artifact; worker identity; allowlisted run/owners; callback/deletion/media origins; secret-storage owner; resource costs and hard limits. Preview deployment counts as deployment.
2. **P5 database:** exact target, `native-offline-bundle.sql` and `native-offline-rollback.sql` hashes, before/after schema/ACL/index inventory, current restore evidence and explicit shared-target impact. The attachment guard repair affects normal original upload submission, not only pilot rows; it permits owner-consistent one-time attachment while keeping approved bytes immutable. New parent-delete hooks preserve original terminal cleanup and erase receipt/media payloads; unknown attempts remain held and reservation fences survive. No script is approved for execution by this document.
3. **P5 accounts/OAuth:** aliases mapped privately to consenting actual identities; requested/granted/denied scopes; App roles/access approval; confirmed Page→Instagram selection. At most baseline scopes from the protocol contract; broader Business Manager/branded-content access needs an amended approval.
4. **P5 nonposting acceptance:** exact login/refresh/revoke/notice/permission cases and disposable data manifest, with zero publishing budget. Any technical publication is a separately named exception, not included automatically.
5. **P6 C1 post:** immutable mission/work item/version, exact account, final JPEG bytes/hash and dimensions, caption/hash, disclosure/sponsor hashes and partnership label, creator per-post consent. None of these real content artifacts is selected yet. No placeholder/mock image is approved.
6. **P6 expansion:** one independently verified C1 outcome through explicit proof, original reviewer and original settlement, plus clean privacy/revoke/unknown-outcome status. C2–C5 remain off until separate expansion signoff.
7. **Cleanup:** exact resource/row/Auth/object IDs and counts, held business evidence, retention deadline and responsible operator. Dry-run, authorized deletion and independent readback are separate recorded steps. Public Instagram deletion is a separate creator decision.

## Required acceptance record

Record candidate hash, run ID, environment, exact scenario/question, role/alias, browser/platform, timestamp, source reference and PASS/FAIL/BLOCKED/NOT_RUN. Include five widths (320,390,430,1024,1440), keyboard confirmation, refresh/back/reload, peer/cross-workspace denial, private-source redaction, changed version/account/instructions, pending/revoked grants, lost response and restart, duplicate attempts, media cleanup. P5 has zero real reward mutations: exactly-once original settlement remains offline evidence during P5. Real creator proof/review/settlement and real ledger acceptance belong exclusively to separately approved P6. Real account tests cannot be replaced by local fixture roles.

Wrong account, unconfirmed/duplicate post, duplicate reward, private-data/token exposure, unresolved unknown, stale approval, failed revoke/cleanup or unauthorized SQL stops the pilot. Hold proof and settlement; no automatic resend. Read recovery only for known IDs, at most five checks with at least 60-second spacing unless the verified provider contract is stricter.

## Containment and rollback

Disable admission and new provider writes first; locally stop grant generations and drain/fence workers. Preserve accepted media IDs and unknown states even if the stop races with publication. Local stop cannot undo a Meta-accepted post.

Roll application back to the previous reviewed artifact with pilot disabled while keeping compatible new data. Prefer disabling over down-migration. `provider-rollback.sql` refuses retained provider records; it never deletes them to make rollback pass. Export/count/hash affected data, retain mission/proof/ledger records, and require a separate incident decision for any whole shared-database restore. Close media leases, verify origin/CDN denial, and independently confirm provider revoke where supported. Do not claim that local database rollback deletes a public post or reinstates remote permissions.

Current disposition: **HOLD. Native offline backend wiring is implemented; exact App protocol and hosted acceptance remain open. Do not enable P5/P6 from this package.**



## Read-only candidate configuration gaps — 2026-11-07

Private intake records the existing candidate App's configuration: API defaults v21.0 (not yet a validated pilot pin), outstanding advanced Page-list review requirement, existing redirect destinations for other integrations, and apparently empty deauthorization/data-deletion callback fields. No KOCmax login configuration entry was observed. Preserve existing consumers; do not repurpose or change shared App settings by implication. App selection is now recorded; protocol/access eligibility and live-operation approvals remain pending. These observations do not close B1/B3 or authorize any settings/connection change. No credential values are included in this package.

## Proposed App designation and preservation boundary — 2026-11-07

The user selected **DEV - Ads** as the proposed pilot App. Its exact verified ID, business mapping and evidence remain in the local private intake. T-IG remains the previously designated existing pair. No account is newly linked to this App by this document.

Preserve existing integrations, including current redirect destinations and login consumers. No removal/replacement of redirects, API-default upgrade, credential reset, role/permission change, webhook change or asset disconnection is authorized. Before any later proposal, identify affected consumers, document the smallest additive configuration change where possible, test their regression/rollback paths, and obtain exact action approval. A separate login configuration does not by itself isolate shared App-level changes.

Current status: selection recorded; HOLD. Connections, settings changes, public media exposure, posting, deployments and remote SQL remain NOT_AUTHORIZED. Post budget ZERO. App/version/eligibility, callbacks/revoke/deletion, T-negative, environment and other outstanding gates remain open. No credentials or private account roster are added to this package.

## P5.0 configuration review follow-up — 2026-11-07

See `p5-0-configuration-change-review.md` for proposed deltas, preserved settings, application-route design and exact-value blockers. App-wide deauthorization/deletion callbacks require coverage for existing consumers; a pilot-only handler is insufficient. No callback URL or config ID is approved or fabricated. Current API defaults are preserved, not automatically adopted as a verified pilot pin.

Fresh offline evidence: p5-0-config-checks.log reports 17 PASS / 6 files (route/native runtime/transport/composition/artifact/preflight). No code or SQL changes, no real providers. Status HOLD; exact environment URLs, consumer coverage, protocol/access eligibility and later action approvals remain open.

## Offline shared-callback compatibility — 2026-11-07

An unmounted fixture-only dispatcher and22 focused tests now model explicit subject-to-consumer fan-out, fail-closed coverage, concurrent replay, event collisions and per-consumer unknown outcomes. Final targeted regression42PASS/8files; TypeScript and changed-file lint PASS. See shared-callback-mock-evidence.md. This is not a live Meta signature verifier, OAuth callback or durable dispatcher; no shared App setting/consumer was modified. HOLD remains.


## Durable callback mock follow-up — 2026-11-07

Added optional file-based replay journal and fail-closed recovery on the same branch. Claims precede effects; interrupted consumers reopen as unknown without resend. Independent committed-tail metadata detects complete-line truncation. See docs/review/kocmax-controlled-pilot/durable-callback-mock-evidence.md for scope, recovery steps and remaining blockers. Existing DEV - Ads integrations untouched; no live route or Meta settings change. HOLD; no SQL, deployment, connection or posting authorized.


Current targeted verification: 53 PASS / 9 files; final durable module check 11 PASS. Scoped re-review resolved complete-record truncation and reports no Important findings. Production durability, actual callback protocol/consumer inventory and reconciliation remain blockers. No new browser acceptance is claimed.


## Unknown-outcome mock reconciliation — 2026-11-07

Added immutable fixture evidence reviews to the local durable callback journal. Reviews bind App, event fingerprint and consumer; preserve unknown delivery outcomes; survive reopening; and never resend effects. Exact repeated review is idempotent and conflicting review is rejected. Synthetic reviewer/evidence assertions are not live authentication or provider verification. See docs/review/kocmax-controlled-pilot/callback-reconciliation-mock-evidence.md for recovery acceptance and remaining blockers. Independent scoped review found no Important findings. No runtime route or existing DEV - Ads consumer changed; no settings, SQL, connection, deployment or posting. HOLD remains; live execution is not authorized.

Reconciliation verification: 68 PASS / 10 targeted files; changed-file lint PASS. Package remains HOLD. No new mobile/desktop browser evidence is claimed for this backend-only change.


## Mock review corrections and audit history — 2026-11-07

Added append-only corrections with predecessor/revision IDs and reason digests. Exact repeats are idempotent; stale competing changes reject. History survives restart; original reviews and unknown delivery outcomes remain intact, and no resend is enabled. Existing getReconciliations returns original reviews; getReviewHistory exposes ordered history/latest interpretation. See docs/review/kocmax-controlled-pilot/callback-corrections-mock-evidence.md. Targeted regression76PASS/10files; lint PASS. Synthetic assertions are not provider or reviewer verification. DEV - Ads integrations untouched; HOLD, live execution disabled. No UI changes or new browser acceptance. No Meta settings, SQL, connections, deployment or posting.

## Mock reviewer permissions and evidence validation — 2026-11-07

Added an unmounted fixture service around the existing journal: current active reviewer, exact App/event/fingerprint/consumer grants, separate read/review/correct actions, and digest/target/decision/time/revocation validation of mock registry evidence. Caller identity cannot override the injected session. Returned history is checked against authorized scope. Raw evidence/reason text is not persisted. Original unknown outcomes and no-retry behavior remain unchanged. See docs/review/kocmax-controlled-pilot/reviewer-permissions-mock-evidence.md.96 targeted tests PASS/11files; lint PASS. Raw journal remains trusted infrastructure, not an exposed API. Real Auth and independently verified provider evidence remain blockers. DEV - Ads integrations unchanged; HOLD, no settings/connection/SQL/deployment/posting. No new browser acceptance.

## Mock reviewer sessions and revocation — 2026-11-07

Added required session validity/revocation checks plus same-reviewer/session rechecks before writes and after history reads. Signed-out/expired/revoked sessions, stale session switches and removed grants deny access without changing audit history or retry behavior.110 targeted tests PASS/11files; lint PASS. See reviewer-permissions-mock-evidence.md for scope and nested log hashes. No real login/token or distributed revocation acceptance is claimed. DEV - Ads integrations unchanged; HOLD. No settings, connections, SQL, deployment or posting; no UI change or new browser acceptance.

## Local mock session persistence — 2026-11-07

Added durable fixture session records and irreversible revocation tombstones with exclusive local ownership and fail-closed snapshot/marker recovery. Grants remain freshly resolved, not persisted in sessions. Reopening cannot reissue a revoked ID. See reviewer-permissions-mock-evidence.md for nested source/test/log hashes, recovery scope and limitations. No live authentication or distributed revocation claim. DEV - Ads integrations untouched; HOLD, no settings/SQL/connections/deploy/posts. No UI changes or fresh browser verification.

Persistence verification:122 targeted tests PASS/12files. Revocation race fixed and re-reviewed. Existing top-level100-artifact limit preserved; nested source/test/log integrity recorded in reviewer-permissions-mock-evidence.md. Live status remains HOLD.


## Mock session recovery and rollback — 2026-11-07

Added exact App/snapshot checkpoint validation for controlled recovery copies. Tests preserve damaged originals, retain revoked tombstones and reject coordinated snapshot/marker rollback against an independently retained checkpoint. Empty recovery targets and checkpoint export after failed writes are denied. See reviewer-permissions-mock-evidence.md for runbook and limits: default opens without a checkpoint, stale checkpoints and coordinated rollback of all evidence remain outside protection. No live recovery/Meta/Auth action. DEV - Ads integrations unchanged; HOLD; no settings/connection/SQL/deployment/posting.

Recovery verification:126 targeted tests PASS/12files; TypeScript/lint PASS. Scoped review no Important findings. No UI/browser rerun; live HOLD remains.


## Mock checkpoint storage and verification — 2026-11-07

Added a separate local ordered checkpoint ledger with App/stream/source binding, expected-head checks, latest-receipt verification and fail-closed restart validation. Revoked-session recovery consumes a verified stored checkpoint. Interrupted recording blocks recovery readiness; source and ledger are not an atomic transaction. Whole-ledger/coordinated rollback remains unprotected without an independent trusted anchor. See reviewer-permissions-mock-evidence.md for nested source/test/log hashes and limitations. DEV - Ads integrations unchanged; HOLD, no settings/connections/SQL/deployment/posting. No UI change or new browser acceptance.

Checkpoint verification:135 targeted tests PASS/13files; TypeScript/lint PASS. HOLD remains; no live-operation approval implied.


## Mock independent ledger anchor — 2026-11-07

Added a surviving in-memory authority to model whole-ledger rollback detection. Anchored ledger reopen and every operation require exact anchor agreement; missing/reset/unavailable authority denies access. Monotonic compare-and-set prevents anchor regression. Ambiguous updates reconcile by readback, not blind retry. See reviewer-permissions-mock-evidence.md for tests and nested hashes. This is not a durable external trust service: process-loss and authority rollback remain unresolved live blockers. Existing unanchored behavior is preserved. DEV - Ads integrations unchanged; HOLD; no settings/connections/SQL/deployment/posting or fresh UI acceptance.

Anchor verification:141 targeted tests PASS/13files; TypeScript/lint PASS. Scoped review no Important findings. Durable production trust remains unresolved; HOLD.

## Persistent mock anchor authority — 2026-11-07

Added a separately stored, process-restartable fixture anchor with create/open modes, exclusive local ownership, atomic snapshot/marker writes and monotonic binding-state updates. The ledger now detects a complete rollback when the retained anchor survives. Tests cover restart continuity, rollback of the ledger and anchor, missing/corrupt/pending evidence, malformed operations, concurrent owners and failed writes.

Verification: `150 PASS / 14 files`; TypeScript and changed-file lint pass. This remains local mock evidence, not a remote trusted authority or production disaster recovery. No DEV - Ads settings or integrations changed; no Meta connection, SQL, deployment, post or new browser acceptance. Status remains HOLD.

## Simulated remote checkpoint authority — 2026-11-07

Added an unmounted in-memory remote-CAS mock for coordinated rollback testing. A complete local ledger rollback is rejected when the surviving simulated remote authority remembers the newer state. The mock covers restart continuity, outage blocking, stale/malformed compare-and-set operations and copied audit history; it performs no network call.

Verification: `154 PASS / 15 files`; focused remote-anchor tests `4 PASS`; TypeScript and changed-file lint pass. This does not establish a durable remote service, authentication, distributed consensus or a live provider connection. DEV - Ads integrations remain unchanged; no Meta settings, SQL, deployment or posts. Status remains HOLD.

The remote mock now also supports fresh client handles over a shared simulated authority. Restart continuity and lost-acknowledgment reconciliation are covered without duplicate receipt creation; pre-apply remote failure keeps reopening blocked. Verification is `157 PASS / 15 files`, including seven remote-anchor tests. The authority remains in-memory and is not a durable remote service or production network connection.

Audit persistence and failover continuation: an opaque shared fixture store now lets a secondary simulated authority resume state and ordered audit after primary-client failure. Lost-acknowledgment recovery survives that failover without duplicate receipts; independent stores remain isolated. Verification is `160 PASS / 15 files`, including ten remote-anchor tests. Split-brain, quorum, durable remote storage and real network failover remain unresolved.

Split-brain equivalence: the remote fixture now has explicit writer epochs, stale-writer fencing and forked-store tests. A stale replica cannot be selected during recovery, and a pre-promotion client is rejected. Verification is `163 PASS / 15 files`, including thirteen remote-anchor tests. This does not establish quorum, authentic fencing tokens, durable replication or production split-brain repair.

Quorum model: added an unmounted five-node mock with majority-gated reads/writes, deterministic leader election, term/committer audit and stale-replica handling. Minority partitions block commits; a majority can elect a new leader after the old leader leaves. Verification is `168 PASS / 16 files`, including five quorum tests. This is not a network consensus implementation and does not prove authenticated votes, durability, crash consistency or production leader election.

## Complete offline candidate freeze — 2026-11-07

Candidate `c14c2acc6a33b902913063dca87f3d1da0dba6462fe3997f70294f0e6785056c` binds 1,292 files. Evidence `d99a35830a6c90340bc8ba9f53f007806d7e52923438e8f53590fc7df55a0853` records 14 checks/reports. Offline verification is verified. P5 is still `HOLD_WITH_BLOCKERS`; P5.4 is separate and no action is authorized.

- Full offline Vitest run: **PASS** — 4,755 passed, 363 skipped. Live-only suites remained disabled.
- Candidate and socket-free HTTP checks: **PASS** — 33 passed. The same nine HTTP contracts also passed using a temporary listener on 127.0.0.1.
- Chrome synthetic fixtures: **PASS** — 30 role/width combinations at 320, 390, 430, 1024 and 1440 px; all six roles reloaded at 390 and 1440 px.
- TypeScript: **PASS** for the application and **PASS** for verification sources. Repository lint: **PASS** (0 errors, 8 warnings); diff check: **PASS**.
- Default-off build: **PASS**. Studio build with fixtures disabled: **PASS**. Synthetic marker scans: **PASS / PASS**. Bundle isolation: PASS — 1/1 in 46 seconds.
- PGlite schema and rollback inventory: **PASS** — 103 passed; no remote SQL executed.

Read the [approval packet](p5-live-run-approval-packet.md), [freeze evidence](p5-candidate-freeze-evidence.md) and [gate ledger](p5-gate-ledger.md). This freeze follows the isolated production bundle check repair. The previous freeze and approvals remain attached to their original fingerprint; its logs were not rebound.

A-R remains on hold. No source database session was opened and no backup or restore was run. B6 stays NOT_RUN. Before any future live action, resolve the [A-R preflight](p5-scope-a-r-preflight.md), confirm the DEV - Ads product, version, eligibility and existing consumers, and complete the operational roster, cost ceiling, retention and cleanup assignments. Each live action needs authorization bound to the exact candidate and scope. Hosted Auth/RLS, actual OAuth/revoke and media-host checks remain pending. DEV - Ads integrations were not accessed or changed.

