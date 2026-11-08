# KOCmax Controlled Instagram Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Native execution is already selected: inline implementation, one independent scoped final review, no repeated execution-method questions. Steps use checkbox syntax. Do not start implementation until this plan is reviewed.

**Goal:** Prepare the complete creator → brand approval → official Instagram publication → proof → verification → original settlement journey for a separately approved, small controlled pilot.

**Architecture:** Extend existing Active mission, integration and creatorGrowth modules; conversation remains orchestration, existing mission/reward records remain authoritative. Preserve mock services while adding product-specific, dependency-injected protocol boundaries and durable recovery. Offline readiness, live technical verification and actual brand-task completion are separate evidence layers.

**Tech Stack:** Existing React 19, TypeScript, TanStack Router/Query, Hono, Supabase repository abstractions, Vitest and PGlite; existing image conversion and Native adapters. No new provider SDK or third-party publishing platform by default.

**Spec:** `docs/superpowers/specs/2026-11-06-kocmax-controlled-instagram-pilot-design.md` — user approved whole-stage design, including proposed controlled scope and candidate login route; real actions remain separately gated.

## Global Constraints

- Same worktree and branch: `C:/Users/laich/.codex/worktrees/kocmax-studio/Adfocate`, `codex/kocmax-studio-stages-1-2`. No staging, commits, reset, checkout replacement, deployment, applied SQL or real connections.
- Preserve existing functions, fixes and unrelated dirty baseline. Capture file hashes and scoped diffs before implementation; never regenerate or discard unrelated evidence.
- One cohesive plan and final acceptance. Tasks are engineering boundaries, not requests for the user to choose the next tiny feature.
- 3–5 invited creators, one brand, one single-image deliverable each; first creator completes and is checked before expanding.
- Native official API only. Candidate Facebook Login is separate from existing Instagram Login, not a silent identity/token migration. No Google Drive, RapidAPI, vision processor, Insights, advertising, scheduling, Reels, Stories or carousels in this pilot.
- Final JPEG conversion precedes brand approval. Preserve original private sources; only approved final media can be temporarily exposed after separate approval.
- Brand approval is not creator publish consent. Session-bound nonce, exact version/account/disclosure binding and per-post creator confirmation are mandatory.
- Unknown results never authorize blind retry. Local revoke cannot undo a provider-accepted post. Mock receipts never authorize real proofs or rewards.
- Points/XP/badges only follow existing authoritative rules. No new XP rule; zero supported XP is not replaced with invented XP. Missing social data remains 未連接／未驗證, never fabricated zero or other-region substitution.
- Responsive targets: 320/390/430/1024/1440px, 44px controls, keyboard/focus support, restrained game styling. No punitive streaks or countdown pressure.
- Proposed real-media lease: 15 minutes, hard cap 1 hour, close on completion. Existing mock service's 60-second cap stays unchanged. Diagnostics7 days; test-only cleanup within7 days of close; real mission/financial records follow approved existing retention.

## Review Focus

1. Two devices confirm different previews of the same approved version: Task4 tests enforce one durable reservation, not merely per-request idempotency.
2. Worker dies after provider accepts publish but before receipt persists: Task5 must retain unknown and never resend automatically.
3. Same numeric subject appears under different login products/apps: Task2 binds product+app+subject+grant generation; no inherited authority.
4. Brand changes disclosures while media is being prepared: Tasks5/7 revalidate before every external write and invalidate stale confirmation.
5. Cleanup or revocation races with an in-flight accepted request: Tasks3/5/9 preserve reconciliation evidence, close access and never claim external deletion.

## Verified starting map / reuse decisions

Read at planning time; no product edits. Graph discovery did not include some recent creatorGrowth definitions, so exact-file inspection was used. Recheck at task start for concurrent changes.

| Existing file/module | Current evidence | Planned use |
|---|---|---|
| `server/lib/creatorGrowth/instagramPublisher.ts` | `InstagramPublisher.mode` permits disabled/mock only | Preserve; introduce an explicit checked pilot capability boundary, not a blanket mode widening |
| `instagramNativeAdapter.ts` | `MockNativeInstagramAdapter` wraps mock, no transport | Keep mock unchanged; separate product-specific contract-tested adapter |
| `publishRepo.ts` | owner/session, issuePreview/reserve/transition/getOwned/lateReceipt/cleanup | Extend existing transaction/persistence model and migrations, do not invent second intent store |
| `publishService.ts` | mock-only enabled guard, 60s max mock lease, sample-only DTOs | Preserve defaults; factor common policy/orchestration only where needed for checked pilot path |
| `mediaLease.ts` | synthetic bytes and handles | Separate real-media contract; never relabel synthetic lease as public URL |
| `missionProofHandoff.ts` | existing handoff module and tests | Reuse original proof command and receipt constraints |
| `server/routes/creatorGrowthPublish.ts` | strict command shape and safe DTOs | Extend with explicit provenance; existing projection assumptions require tests |
| `server/lib/integrations/{oauth,oauthStore,refreshLease,pilotPolicy,pilotRuntime}.ts` | existing auth/pilot boundaries | Product-discriminated grants, notice/revoke verification, retain D1 fixes |
| `src/components/active-mission/MissionPublishEntry*.tsx`, `MissionPublishMock.tsx` | DEV fixture entry only | Keep mock path, add separately gated owner-only server-backed entry |
| `src/components/studio/{PublishPreview,PublishStatus,SavedOutputCards}.tsx` | preview/status/private collections | Reuse, retain sample labels and private defaults |
| `src/routes/_app.my.$submissionId.tsx` | original instructions/proof form | Minimal insertion only; no route rewrite |

New cohesive files live under `server/lib/creatorGrowth/pilot/`, with adjacent tests. UI pieces under `src/components/active-mission/pilot/`. Existing files change only to expose verified seams. No global rename/refactor of large routes.

## Task 1: Baseline, capability ledger and closed execution gate

**Files:** Create `docs/review/kocmax-controlled-pilot/baseline.md`, `protocol-matrix.md`; create `server/lib/creatorGrowth/pilot/readiness.ts` and `readiness.test.ts`; inspect existing `pilotEvidenceChecklist.ts`, release manifest and current test helpers.

**Interfaces:** `PilotGateId = "protocol"|"identity"|"disclosure"|"revoke"|"persistence"|"privacy"|"journeys"|"environment"|"launch_approval"`; `PilotGate = {id:PilotGateId; status:"PASS"|"BLOCKED"|"NOT_RUN"; evidenceRef:string|null; verifiedAt:string|null}`. `evaluatePilotReadiness(rows:readonly PilotGate[]):{offlineReady:boolean; liveReady:boolean; blockers:PilotGateId[]}`. Offline readiness requires persistence/privacy/journeys; live requires every gate. PASS requires nonempty evidence/time, unique complete gate IDs; malformed input fails closed.

- [ ] Capture branch/HEAD, dirty paths, hashes of changed baseline files, existing test commands and explicit shared DB restrictions. Read any nested AGENTS instructions. No cleanup/reset.
- [ ] Write `readiness.test.ts`: missing protocol, duplicated gates, forged PASS without evidence all block; offline PASS alone yields `liveReady === false`; complete evidence yields true only as readiness metadata, never an execution capability.
- [ ] Run `node node_modules/vitest/vitest.mjs run server/lib/creatorGrowth/pilot/readiness.test.ts --reporter=dot`; expect RED on missing implementation.
- [ ] Implement evaluator and ledger. Record exact candidate product/version/host/scopes from official documentation; unresolved App entitlement, callbacks and signed notice rules stay BLOCKED. Do not guess endpoints to make tests pass.
- [ ] Rerun command; expect PASS. Baseline selected suite failures classified by existing/new before later tasks. No commit.

## Task 2: Product-bound identity and offline official protocol adapter

**Files:** Create `pilot/protocol.ts`, `pilot/facebookLoginAdapter.ts`, `pilot/protocol.test.ts`, `pilot/facebookLoginAdapter.test.ts`; modify `publishPolicy.ts`, `instagramPublisher.ts` only via explicit compatibility seam. Modify `server/lib/integrations/oauth.ts`, `oauthStore.ts`, `pilotPolicy.ts` only where product discrimination is missing; adjacent tests.

**Interfaces:** In `protocol.ts`, define `PilotAccount = {product:"facebook_login"; appId:string; accountSubject:string; connectionId:string; grantGeneration:number}` and `ProtocolEvidence = {version:string; host:string; scopes:readonly string[]; identityEvidence:string; labelEvidence:string; revokeEvidence:string; status:"verified"|"unverified"}`. `PilotTransport.request(input:{operation:"create"|"status"|"publish"|"media"; account:PilotAccount; payload:Readonly<Record<string,unknown>>}):Promise<unknown>` is an injected server-only boundary with sanitized exceptions. `FacebookLoginPilotAdapter` implements the existing publisher operations behind a distinct `mode:"pilot_contract"`; construction requires verified protocol evidence and dependency injection, never reads env credentials or global fetch. Its return envelopes distinguish `provenance:"fixture"|"provider"`; the fixture transport cannot emit provider provenance.

- [ ] Write tests: identical subject in different app/product rejected; Instagram Login token never accepted as Facebook Login; missing permissions/label eligibility blocked; malformed ID/permalink or wrong returned owner rejected; fixture never returns a provider receipt. Credential/log redaction asserted.
- [ ] Run `node node_modules/vitest/vitest.mjs run server/lib/creatorGrowth/pilot/protocol.test.ts server/lib/creatorGrowth/pilot/facebookLoginAdapter.test.ts server/lib/integrations/oauth.test.ts --reporter=dot`; new cases RED.
- [ ] Implement schema/operation mapping using official documented versioned contracts. Keep unverified operations disabled; add static request/response fixtures with source citations and collection date, no real credentials. Do not ship a default HTTP transport. Extend `PublishGrant`/policy through explicit product branch; preserve old contract tests.
- [ ] Run same tests plus `instagramNativeAdapter.test.ts`, `instagramPublisher.test.ts`, `publishPolicy.test.ts`; expect PASS and zero external requests. Record exact real protocol work still blocked, not merely checklist green.

## Task 3: Revocation, token rotation and account readiness

**Files:** Create `pilot/grantLifecycle.ts`, `pilot/grantLifecycle.test.ts`; extend `server/lib/integrations/refreshLease.ts`, `server/routes/integrationNotices.ts`, `integrationOAuth.ts` and focused existing tests; extend `src/components/integrations/{Connections,ConnectionCard,ConnectionConsent,IntegrationDeletionStatus}.tsx` and tests.

**Interfaces:** `PilotGrantStatus = {account:PilotAccount; local:"active"|"stopped"; providerRevocation:"not_requested"|"pending"|"confirmed"|"unverified"; grantedScopes:readonly string[]; lastVerifiedAt:string|null}`. `stopPilotGrant(actor:PublishActor, connectionId:string):Promise<PilotGrantStatus>` uses existing owned integration repository; `applyVerifiedNotice(input:{appId:string; subject:string; noticeId:string; verifiedSignature:true}):Promise<void>` is INTERNAL only after existing verifier, never a client JSON assertion.

- [ ] Write tests for OAuth state replay/session swap, refresh CAS replay and two workers, wrong product notice, duplicate notice, local stop during pending publish, revoke timeout. Local stopped must not render provider confirmed; tokens absent in all DTOs/logs.
- [ ] Run new lifecycle tests plus `oauth.test.ts`, `refreshLease.test.ts`, `server/test/integration-oauth-routes.test.ts`, `server/test/integrations-pilot-notices.test.ts`; observe RED for missing cases.
- [ ] Implement owner checks and local generation increment; use existing encryption/secret interfaces. No real notices/refresh/revoke calls. UI shows actual scopes, last verification or 未驗證, and separate local/provider states; basic tasks remain available without connection.
- [ ] Rerun suite and connection component tests; expect PASS. Signed notice or revoke contract without evidence stays blocked in Task1; don't infer from another product.

## Task 4: Durable intent identity, reservation, recovery and draft SQL

**Files:** Modify `publishRepo.ts`, `publishRepo.test.ts`, `server/test/creator-growth-publish-schema.test.ts`; create `pilot/jobStore.ts`, `pilot/jobStore.test.ts`; create review-only `docs/review/kocmax-controlled-pilot/changes.sql`, `rollback.sql`, `schema-review.md`. Inspect existing publish migration before writing additive draft; never apply SQL or rewrite previously applied files.

**Interfaces:** Extend `PublishBinding` with product/app and Active mission basis (submissionId, workItemId, approvedVersionId, instructionRevision); mock compatibility through explicit discriminated binding. Retain existing `PublishRepository` methods and CAS `version`. `PilotJobStore.claim(input:{workerId:string; now:string; leaseUntil:string}):Promise<{intent:PublishIntent; fence:number}|null>`; `checkpoint(input:{intentId:string; workerId:string; fence:number; stage:"before_create"|"container_known"|"before_publish"|"receipt_known"; containerId?:string; mediaId?:string}):Promise<void>`. Client cannot choose fence or actor.

- [ ] Write PGlite tests: two distinct preview/request IDs for same owner+product+account+item+approvedVersion reserve one intent; changed instructions invalidate old preview; owner-consistent FK, RLS for colleague/crossworkspace/staff, nonce replay/expiry, stale worker fence and unique-index coverage. Reopen persisted intent after process reconstruction.
- [ ] Run `node node_modules/vitest/vitest.mjs run server/lib/creatorGrowth/publishRepo.test.ts server/lib/creatorGrowth/pilot/jobStore.test.ts server/test/creator-growth-publish-schema.test.ts --reporter=dot`; expect RED on new contract.
- [ ] Implement memory+RPC parity using existing repo pattern. Store stage before irreversible call, append sanitized evidence, preserve unknown tombstones. Draft additive SQL with minimal grants and owner-consistent foreign keys; exclude existing equivalent indexes. Rollback only new pilot objects after data export/hold checks, never drop original task/reward tables.
- [ ] Rerun tests against local PGlite only; expect PASS. Document upgrade/backfill compatibility for existing mock rows (no invented provider provenance), index inventory and exact rollback preconditions. Migration registration/application belongs to later separately approved packet.

## Task 5: Durable worker, reconciliation and kill switch

**Files:** Create `pilot/worker.ts`, `pilot/worker.test.ts`, `pilot/runtime.ts`, `pilot/runtime.test.ts`; modify `publishService.ts`, `publishService.test.ts` only to share validated logic without weakening existing mock guard.

**Interfaces:** `PilotWorker.runOne(input:{workerId:string}):Promise<"idle"|"processed"|"held_unknown"|"blocked">`; consumes Task4 job store/repo, Task2 publisher, Task3 grant lookup and Task6 lease boundary. `reconcilePilotIntent(actor:PublishActor,intentId:string):Promise<PublishIntent>` performs reads only. `PilotRuntimePolicy = {enabled:boolean; runId:string; allowedCreators:readonly string[]; allowedMissionIds:readonly string[]; stopRequested:boolean}` loaded server-side per write; checked product/actor/mission/approval gates cannot come from browser flags. Runtime defaults disabled and offline fixture transport only in this phase.

- [ ] Write fake-transport crash matrix: before/after create, after container readiness, before publish, accepted publish before persisted receipt, late response, duplicate workers, 429, timeout, kill switch, revoked grant and changed disclosure at await boundaries. Assert `publish calls <= 1`, unknown retained after restart, status check sends no publish.
- [ ] Run worker/runtime and existing service tests; expect RED. Use injected clock and effects; no sleeping or external calls.
- [ ] Implement fenced transitions with write intent checkpoint, known-container reconciliation, bounded reads (max5 attempts, at least60 seconds apart; provider contract can impose stricter schedule), no automatic publish retry after ambiguity. In-flight accepted operations are not falsely cancelled by local stop. Safe definitive rejection permits explicit new preview only after verified not-published evidence.
- [ ] Rerun; expect PASS, zero proof/reward side effects. Keep existing `PublishService` mock expiry/service semantics intact. No executable scheduler or production cron is enabled.

## Task 6: Final JPEG provenance and short-lived media lease

**Files:** Create `pilot/mediaLease.ts`, `pilot/mediaLease.test.ts`; extend existing conversion/mission asset tests only where final approval hash is not covered; preserve `server/lib/creatorGrowth/mediaLease.ts` and `src/lib/creatorGrowth/jpegPreparation.ts` mock behavior.

**Interfaces:** `PilotMediaLease = {leaseId:string; expiresAt:string; assetSha256:string; provenance:"fixture"|"provider"}`; server-only `PilotMediaLeaseStore.open(input:{owner:PublishOwner; intentId:string; approvedAssetId:string; sha256:string; ttlSeconds:900}):Promise<PilotMediaLease>` and `close(owner:PublishOwner,intentId:string):Promise<void>`. Store privately resolves fetch URL; no URL in client DTO. Hard ceiling3600 seconds; existing mock60-second ceiling unchanged.

- [ ] Test exact approved JPEG hash, conversion before approval, missing dimensions/rights, wrong owner, arbitrary URL/SSRF, expired lease, source revoke, close idempotency, stale cache/purge failure, no URL/token in reports. Prepared image change requires reapproval.
- [ ] Run new lease tests and existing mediaLease/jpeg conversion tests; expect RED for new behavior.
- [ ] Implement injected storage contract and fake purge receipt only. Real public serving, bucket policy or CDN change stays absent until explicit host/privacy approval. Store owner-generated paths, strip unnecessary metadata, retain approved version immutability.
- [ ] Rerun tests; expect PASS. Document public URL exposure even when unguessable, lease/copy limitations and stop/purge verification requirements.

## Task 7: Server-backed task preview, confirmation and recovery UI

**Files:** Modify `server/routes/creatorGrowthPublish.ts`, `server/test/creator-growth-publish-routes.test.ts`, `src/lib/creatorGrowth/publishQueries.ts`, `src/components/studio/{PublishPreview,PublishStatus}.tsx`; create `src/components/active-mission/pilot/PilotTaskPublish.tsx`, `PilotTaskPublish.test.tsx`; minimal modify `src/routes/_app.my.$submissionId.tsx` and route test. Keep existing DEV-only entry untouched as a rehearsal path.

**Interfaces:** Existing `/api/creator-growth/publish` prepare/approve/get/reconcile route contracts retained. Safe DTO is explicit union `{mode:"mock";sampleOnly:true;...existing}` or `{mode:"pilot";sampleOnly:false;intentId:string;state:PublishState;accountLabel:string;version:number;permalink:string|null;...verified preview fields}`; server producer cannot select pilot without Task5 gate. Strict schemas project known fields, exclude tokens/media URLs/private sources. UI receives this union, never casts mock to pilot. `PilotTaskPublish({submissionId,workItemId,onReviewProof})` consumes existing authenticated query/session provider.

- [ ] Write route/UI tests: allowlist denial, same-workspace peer, crossworkspace, missing session, forged DTO/provenance, changed version before consent, unchecked consent, exact caption/image/account/disclosure, nonce reuse, expired preview renewal only before attempt, back/reload/401 recovery, two tabs same intent and no auto-resubmit.
- [ ] Run new UI and route tests plus existing `PublishPreview.test.tsx`, `PublishStatus.test.tsx`, `mockMissionPublish.test.ts`, `'src/routes/-_app.my.$submissionId.test.tsx'`; observe RED for new integration.
- [ ] Implement authoritative status retrieval on mount/relogin, invalidation on account/workspace changes, version-aware final preview and manual fallback. Unknown offers only same-request status/support; label missing blocks direct publish. Existing handoff still only navigates until Task8's explicit proof confirmation.
- [ ] Rerun; expect PASS. Disabled production flag renders no pilot action; synthetic text/fixtures excluded from production. Product language concise Traditional Chinese, original navigation/manual forms preserved.

## Task 8: Brand review, verified proof and original settlement integration

**Files:** Modify `server/lib/creatorGrowth/missionProofHandoff.ts`, its test; minimal extend `src/components/admin/ActiveMissionReview.tsx`, `MissionCompletionReview.tsx`, `src/components/active-mission/PublicationInstructions.tsx` and tests; use existing `server/lib/activeMission/publicationProof.ts` and original reward handoff handlers without parallel commands. Create `server/test/controlled-pilot-journey.test.ts`.

**Interfaces:** Reuse current handoff API after inspection; add a typed `PilotProofCandidate = {intentId:string; submissionId:string; workItemId:string; approvedVersionId:string; accountSubject:string; mediaId:string; permalink:string; observedAt:string}` projected ONLY from verified provider receipt. `resolvePilotProofCandidate(actor:PublishActor,intentId:string):Promise<PilotProofCandidate>` validates current owner/basis and receipt, never writes proof. Creator confirmation submits through original API with existing duplicate/conflict controls.

- [ ] Write tests for brand-visible allowed source subset, unauthorized member review, image/disclosure revision reapproval, fake receipt rejection, mismatched account/media/version, deleted/unverifiable post, double proof submission, proof accepted but not settled, duplicate settlement exactly one ledger effect. Brand approval alone cannot publish.
- [ ] Run handoff/new journey plus `server/test/active-missions.test.ts`, `reward-handoffs.test.ts`, `admin-reward-handoffs.test.ts`; ensure helpers are local PGlite and never live DB. New assertions RED.
- [ ] Implement receipt candidate + explicit creator proof confirmation, version comparison/disclosure review and original reviewer/operator handoff. Missing label proof remains unresolved, not inferred solely from payload. Preserve existing role capabilities, including member Delete/edit restrictions.
- [ ] Rerun; expect PASS. Report distinct published/submitted/verified/pending/settled states. No new reward/XP/badge rules, no automatic finance action from publication.

## Task 9: Invitations, operator readiness, private collections and cleanup

**Files:** Create `pilot/roster.ts`, `pilot/roster.test.ts`, `pilot/cleanup.ts`, `pilot/cleanup.test.ts`; create `src/components/active-mission/pilot/PilotReadinessCard.tsx`, its test, and `src/components/admin/PilotReadinessPanel.tsx`, its test; integrate as small cards in existing home/operator views after verifying current route owners. Modify `SavedOutputCards.tsx` and tests only for missing evidence links.

**Interfaces:** `PilotRosterEntry={runId:string;creatorId:string;missionId:string;wave:"first"|"later";status:"invited"|"ready"|"active"|"completed"|"withdrawn"|"blocked"}`. `canStartPilot(entry: PilotRosterEntry, gates:readonly PilotGate[], firstCreatorVerified:boolean):boolean`; later wave false until first completed and independently verified. `planPilotCleanup(runId:string,now:string):Promise<{deleteIds:readonly string[];holdIds:readonly string[];reasons:readonly string[]}>` is dry-run only; actual delete requires separately approved exact manifest and owner predicates.

- [ ] Tests: max5 roster, no general feature lock for nonparticipants, later wave held, operator cannot approve publish or arbitrary success, private collections denied to colleague/brand, cloned draft resets approval and publish authority, unchanged missing-data labels. Cleanup holds unknown intents and real mission/ledger rows; only explicit test IDs eligible.
- [ ] Run roster/cleanup/readiness/card tests and existing SavedOutputCards tests; new cases RED.
- [ ] Implement server-enforced allowlist and separate readiness/operational state cards; private outcome links retain provenance. Cleanup honors7-day test/diagnostic proposal, immediate lease close and preserved audit holds; policy/retention unknown blocks actual cleanup. Add operator kill-switch view wired to mock runtime only during this phase.
- [ ] Rerun; expect PASS. Include data-flow manifest: token, image, caption, private brief, proof and audit each with owner/readers/purpose/retention/delete owner. Public IG post deletion is separate creator action.

## Task 10: Whole-stage offline acceptance and exact launch packet

**Files:** Create `docs/review/kocmax-controlled-pilot/{acceptance.md,launch-packet.md,cleanup-manifest.md,rollback-runbook.md,protocol-evidence.md}`; extend `scripts/creator-growth-bundle-boundary.test.ts`; create `scripts/integrations/controlled-pilot-preflight.ts`, adjacent test. Record screenshots locally, no publishing.

**Interfaces:** `validateControlledPilotPacket(packet:unknown):{readyForReview:boolean; blockers:readonly string[]}` checks versioned manifest and hashes, not grants execution. Packet includes exact app/product/version/scopes, subjects as private aliases, authority evidence, environment/hosts/callbacks/worker/secret storage/costs, approved JPEG+caption+disclosure hashes, DB SQL+rollback+restore evidence, named operator/reviewer, limits/window, cleanup IDs and remaining approval requirements. No passwords/token material in packet/Git.

- [ ] Write packet tests: missing restore evidence, owner/resource/cost/retention/label/revoke verification, stale hashes, unverified first post, or existing unknown outcome blocks ready. Readiness cannot be turned into authority by client boolean. Run new preflight test RED, implement pure validator, rerun PASS.
- [ ] Run `node node_modules/vitest/vitest.mjs run server/lib/creatorGrowth server/lib/integrations src/components/active-mission src/components/integrations src/components/studio/PublishPreview.test.tsx src/components/studio/PublishStatus.test.tsx src/components/studio/SavedOutputCards.test.tsx server/test/creator-growth-publish-routes.test.ts server/test/creator-growth-publish-schema.test.ts server/test/controlled-pilot-journey.test.ts scripts/integrations/controlled-pilot-preflight.test.ts scripts/creator-growth-bundle-boundary.test.ts --maxWorkers=4 --minWorkers=1 --reporter=dot`; expected scoped PASS. Inspect test helpers first; no env-loaded remote execution. Separately run original Active mission/query/race, session/role and reward regressions.
- [ ] Run `node node_modules/typescript/bin/tsc --noEmit`, ESLint on every changed TS/TSX file, `npm run build`, scoped `git diff --check`; expected PASS. Run production build with Studio opt-in/fixture false and default-off; assert synthetic markers absent and real provider default disabled. Record unrelated baseline failures honestly, never blanket full-suite PASS.
- [ ] In in-app browser at320/390/430/1024/1440 verify creator complete offline journey; brand authorized/unauthorized review; operator blocked/unknown/ready views; collections; visitors/nonparticipants; same-workspace and crossworkspace isolation. Test back/forward/reload, expired session, keyboard focus, exact final image/caption, no overflow. Keep role, viewport, scenario and screenshot evidence; missing runs are NOT_RUN.
- [ ] One independent review of phase diff and evidence after Native implementation; resolve Critical/Important via RED→GREEN, ledger remaining minors. Include full route and original function preservation matrix, schema/index review and safety gate status.
- [ ] Assemble one reviewable launch packet with per-action approval scope. If external App evidence or restore point unavailable, deliver packet as BLOCKED with exact missing artifact, not a fictional ready result. Stop before Task11; no silent deployment or SQL execution.

## Task 11: Separately approved real pilot runbook — NOT authorized by this plan

This section specifies the full stage endpoint, not permission to execute it. No user-approved launch packet currently exists. Every activity below requires its concrete scope in that packet; no credentials requested during offline work.

**Files:** Later create `docs/review/kocmax-controlled-pilot/live-execution.md`, sanitized acceptance evidence and cleanup readback. Private evidence stays outside Git.

- [ ] Verify exact approved resources, costs, immutable hashes, current restore point and restoration procedure; run preflight with all blockers resolved. Any material mismatch returns to review, not improvisation.
- [ ] Only within approved deployment/SQL/account scope, provision the designated environment and apply reviewed additive changes. Keep public/general rollout disabled; verify allowlist and existing functions before connecting accounts.
- [ ] Obtain actual creator OAuth grants using approved official product; verify subject mapping, granted scopes, refresh behavior, revoke/signed notices and label eligibility with disposable professional accounts. Negative account untouched. Real Auth/RLS matrix and cleanup need named disposable accounts, not ordinary users.
- [ ] If technical validation needs a non-mission test post, include that additional post and cleanup explicitly in packet (it is NOT one of the approved brand deliverables). No disguised brand post to bypass disclosure requirements.
- [ ] Creator C1 submits actual rights-cleared JPEG/caption; brand approves exact version and required disclosure; creator confirms. Execute exactly one intent, capture provider evidence and independently inspect actual account/post/label. Unknown pauses rollout and only reconciles.
- [ ] Creator confirms real proof; authorized reviewer verifies; authorized existing settlement flow credits exactly once. Compare ledger/balance and retained private sources, confirm no cross-account changes. No automatic posting/deletion in the UI without the creator's relevant confirmation.
- [ ] After C1 checked, proceed with remaining invited creators within approved cap/window. Stop expansion on privacy, wrong-account, duplicate publication/reward, unresolved unknown or cleanup failure. Record every creator as completed/withdrawn/blocked; never hide failed cases.
- [ ] Disable pilot writes, revoke/stop per approved scope, expire media leases and verify purge; remove only listed test records/accounts and read back counts/hashes. Keep required real mission/financial/audit records. Public post removal follows separate explicit creator action; DB rollback is not post deletion.
- [ ] Final layered report: offline, hosted environment, SQL/Auth/RLS, official provider, disclosure/revoke, creator/brand/operator journeys, settlement and cleanup each PASS/BLOCKED/NOT_RUN. True stage completion requires at least C1 full direct-publish brand mission, no hard safety failures, and every participant outcome accounted for.

## Dependency order and delivery boundary

`1 → 2 → 3 → 4 → 6 → 5 → 7 → 8 → 9 → 10 → [separate approval] → 11`.
Task6 precedes worker implementation because the worker consumes its lease contract. Use this order even though task numbers group related responsibilities. Native execute tasks continuously; don't ask the user to approve each local fix. External operations remain a separate final approval gate.

## Self-review / specification coverage

- Original function preservation/baseline:1,7,8,10. Identity/product/label ambiguity:1–3. Private rights/media:3,6,8,9.
- Persistent reservation/crash/unknown recovery:4–5,7. Creator/brand/operator/mobile/desktop:7–10. Proof/settlement and collection:8–9.
- RLS/index/SQL/rollback:4,10–11. Retention/kill switch/cleanup:3,5,6,9–11. Official App evidence and real trial:1–3,10–11.
- All five Review Focus risks have named tests. `PublishActor`, `PublishIntent` retain their existing repository origin; `PilotAccount` comes from Task2; gates from Task1; worker/job/lease interfaces explicitly mapped. No parallel reward or mission state machine.
- State-language mapping: design's prepared/confirming are preview+reservation UI stages; existing creator_approved/container_preparing/provider_processing/publish_requested remain authoritative persisted names. Definitively_failed maps to existing failed only with explicit not-published evidence; expiration belongs to preview, not inferred publication failure.
- This is one dependent end-to-end stage, so one plan is retained per user request. The large dirty baseline and external protocol blockers make whole-repository or production acceptance inappropriate.
- No new library dependency planned. If the exact official contract cannot be implemented with verified evidence, preserve explicit blockers, complete independent offline work, and report the capability gap rather than guessing.

## Execution handoff

Native preference preserved. Review this complete plan once; after approval implement Tasks1–10 continuously within local/offline limits and deliver one complete readiness packet. Task11 remains separately approved. No commits unless user changes the standing instruction. Do not execute the old plan's commit/live steps merely because they exist in historical documents.
