# KOCmax Instagram Publishing Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a default-off, auditable single-image Instagram publishing path tied to the creator's exact authorized account and approved content, then run a separately approved test-account pilot without double publishing or altering the original reward workflow.

**Architecture:** Use Instagram API with Instagram Login as the sole identity and write authority. Pure policy validates the draft/account/mission/disclosure before a server-only publishing service records one intent; a provider adapter runs only against a reviewed Instagram Login protocol manifest. Mock providers and memory persistence allow full offline UI/API verification before exact SQL, real account and processor approval.

**Tech Stack:** TypeScript, Hono, Supabase Auth/Postgres/Storage, existing encrypted integration vault, React/TanStack Query, Vitest/PGlite/Playwright; Meta Instagram Login only after approved pilot.

**Spec:** [Approved Instagram growth Studio design](../specs/2026-11-03-kocmax-instagram-growth-studio-design.md), §§4, 6–10. Depends on [UI/session reliability](2026-11-04-kocmax-ui-session-reliability.md) and [offline image/skills](2026-11-04-kocmax-image-growth-offline.md).

## Current execution boundary — 2026-11-04

The current session instruction supersedes the commit steps below: all work after `e491e2d` remains unstaged and uncommitted on the existing branch. No deployment, real connection, provider/model call, public media hosting or application of either new migration is authorized. The numbered steps remain the original plan; the authoritative completed-versus-blocked ledger is [Stage5 status](../../review/kocmax-stage-5/STATUS.md).

Tasks2–5 and8 have accepted offline implementations and independent reviews, including durable publish-claim history, current-session confirmation, original mission proof delegation and the client/application transport correction. Nine synthetic personas were checked at390/1440; this is not nine live accounts. Tasks1,6,7 preserve their proven offline checks while the actual Instagram protocol, image supplier rights and vision processor remain blocked. Task9 has a [blocked readiness record](../../review/kocmax-stage-5/instagram-pilot-approval.md) and a [NOT RUN execution record](../../review/kocmax-stage-5/instagram-pilot-execution.md); neither is approval to execute. Current sample publication receipts cannot submit mission proof or award rewards.

## Global Constraints

- Same branch; preserve D1/Auth/RLS fixes and all visitor/creator/brand/operator functions. Record the dirty baseline; stage only new task hunks, especially in already modified files such as `server/app.ts`. Audit every staged diff before commit. No deploy or real Instagram/Drive connection from plan approval.
- First native write is one immediate static-image feed post. Reels, Stories, carousels, scheduled posts, DMs and comments remain unavailable; creator uploads the image.
- Personal, non-mission, non-sponsored post may publish after per-post confirmation and earns no points/XP. Active mission post requires `approved_to_publish` for the exact caption and asset checksum; legacy mission publication/proof stays as-is.
- Official `instagram_business_basic`/Insights scopes are distinct from `instagram_business_content_publish`. Username, BioCode and RapidAPI never grant publication authority. Account subject, grant generation and app identity must be proven.
- If a sponsored post requires a paid-partnership label/tag that the verified Instagram Login API cannot set, native publishing is blocked and the existing manual publication/proof path remains available. Do not declare caption-only disclosure sufficient by default.
- SQL application, provider registration/token exchange, real vision processing, real image fetch, temporary public media serving, real publishing and deployment require concrete approval that names the covered actions and a verified restore/cleanup path. One explicit approval may cover several listed actions; do not ask again for an already approved boundary.

## Review Focus

1. A creator approves `@A`, then reconnects `@B` or changes the image/caption: old approval cannot publish to either account (Tasks 2, 4 tests).
2. A brand-sponsored mission requires a platform partnership label unsupported by the verified adapter: block native publish and show manual-proof route (Task 2 test).
3. Two tabs submit the same draft, or Meta times out after accepting it: one intent, no blind second publish, `outcome_unknown` until exact reconciliation (Tasks 3–4 tests).
4. A media fetch URL leaks, expires or is requested after revoke: URL returns no image; tokens and private paths never appear in it (Task 4 test).
5. A provider notice maps ambiguously between app/subject/connection: no cross-grant revocation or false deletion-complete status (Task 1 test).

---

## File structure and order

| Unit | Files | Responsibility |
| --- | --- | --- |
| Instagram contract | Modify `server/lib/integrations/providers/instagramLive.ts`, `policy.ts`, `metaNotice.ts`, `oauth.ts` only after a reviewed protocol diff; extend their tests; create `docs/review/kocmax-stage-5/instagram-protocol-manifest.md` | Document correct Instagram Login host/token/subject/permissions/revoke/notice contract; fail closed when unknown |
| Publish policy | Create `server/lib/creatorGrowth/publishPolicy.ts`, `.test.ts` | Personal vs Active mission eligibility, approved version, disclosure and exact preview fingerprint |
| Intent store | Create `server/lib/creatorGrowth/publishRepo.ts`, `publishRepo.test.ts`, CLI-allocated migration `supabase/migrations/20261104134202_kocmax_publish_intents.sql`, schema test and SQL review packet | One durable intent per content version; owner isolation, idempotency, state transitions |
| Provider and service | Create `server/lib/creatorGrowth/instagramPublisher.ts`, `publishService.ts`, `mediaLease.ts` and tests | Mock-first container/status/publish/reconcile and optional short-lived media fetch |
| API and UI | Create `server/routes/creatorGrowthPublish.ts`, `src/components/studio/PublishPreview.tsx`, `PublishStatus.tsx`, `src/lib/creatorGrowth/publishQueries.ts` with tests; modify `server/app.ts` and Studio workspace | Human preview/confirm and honest receipt/unknown state |
| Public image provider | Extend `server/lib/creatorGrowth/publicImageProvider.ts` and tests after rights review | Bounded, own-account RapidAPI image retrieval with separate provenance |
| Vision processor | Extend `server/lib/creatorGrowth/imageAnalysis.ts` and tests after processor review | Real visual understanding only for consented image and approved processor |
| Pilot/mission | Create `docs/review/kocmax-stage-5/instagram-pilot-approval.md`, `instagram-pilot-execution.md`; test existing Active mission/proof boundary | Separately approved real test, cleanup and original reward reconciliation |

### Task 1: Resolve Instagram Login identity/revoke contract in a reviewable manifest

**Files:** Create `docs/review/kocmax-stage-5/instagram-protocol-manifest.md`; modify only if evidence supports it: `server/lib/integrations/providers/instagramLive.ts`, `server/lib/integrations/policy.ts`, `server/lib/integrations/oauth.ts`, `server/lib/integrations/metaNotice.ts`; tests in corresponding `.test.ts` files and `server/test/integration-oauth-routes.test.ts`.

**Interfaces:** `InstagramLoginContract = {appId: string; apiVersion: string; authorizeHost: string; graphHost: string; tokenSubjectKind: string; profileSubjectKind: string; publishScope: "instagram_business_content_publish"; supportsPaidPartnershipLabel: boolean | null; supportsBrandTag: boolean | null; revoke: {method: string; path: string; tokenKind: string; successRule: string} | null; noticeIdentityRule: string | null; sourceUrls: string[]; checkedAt: string}` exists only once the app/product facts are verified; otherwise the manifest stores `contract: null` and a BLOCKED reason. A `null` capability means BLOCKED, not a guess. Existing `IntegrationService.revokeConnection` keeps local-stop-first semantics.

- [ ] **Step 1: Add failing fixture tests** for wrong app/subject, old Instagram vs Facebook Login host/token mix, missing publish scope, late callback and ambiguous signed deletion notice. Assert local stop survives failed provider revoke, but provider status remains pending/manual action.
- [ ] **Step 2: Run focused protocol tests.** `npx vitest run server/lib/integrations/providers/instagramLive.test.ts server/lib/integrations/oauth.test.ts server/lib/integrations/metaNotice.test.ts server/test/integration-oauth-routes.test.ts` → expected new assertions fail.
- [ ] **Step 3: Verify IG-01–04 from current primary Meta material and the specific test App configuration, then document each identifier/host/token/result rule.** If evidence remains missing, keep the corresponding live path disabled and mark the manifest BLOCKED; do not change the candidate revoke endpoint into an asserted fact.
- [ ] **Step 4: Implement only proven contract changes and re-run tests.** Existing read-only mocks and deletion notice fixtures still pass; no live OAuth call or token exchange.
- [ ] **Step 5: Commit exact manifest, proven adapter changes and tests.** `git commit -m 'fix: pin Instagram Login identity and revoke contract'` after exact staging. A BLOCKED manifest can be committed without enabling the provider.

### Task 2: Pure pre-publish policy tied to the original approval

**Files:** Create `server/lib/creatorGrowth/publishPolicy.ts`, `publishPolicy.test.ts`.

**Interfaces:** `type PublishDraft = {owner: {workspaceId: string; creatorId: string}; accountSubject: string; imageSha256: string; rightsConfirmed: boolean; caption: string; disclosure: {sponsored: boolean; captionText?: string; platformLabelRequired: boolean; brandTagRequired: boolean}; mission?: {submissionId: string; workItemId: string}}`; `type PublishGrant = {subject: string; generation: number; scopes: string[]; status: "active" | "revoked" | "reauth_required"}`; `type MissionPublishBasis = {state: string; approvedVersionId: string | null; approvedCaption: string; approvedAssetHashes: string[]; expectedAccount: string | null; requiredDisclosures: string[]; instructionRevision: number}`; `validatePublishDraft(draft: PublishDraft, grant: PublishGrant, basis: MissionPublishBasis | null, capabilities: InstagramLoginContract): {fingerprint: string; allowed: boolean; reason?: string; fallback?: "manual_proof"}`. Fetch `basis` through the current owned Active mission workspace/publication projection, not client-supplied data.

- [ ] **Step 1: Write failing policy tests.** Personal unsponsored post with self-declared image rights can proceed; personal sponsored post without checked policy cannot. Active mission mismatched version/caption/asset/account/instructions/revoked grant fails; only exact approved version proceeds. Legacy mission returns `manual_proof`. Required label/tag unsupported returns `manual_proof`, not caption-only success. Username match alone fails.
- [ ] **Step 2: Run the focused test.** `npx vitest run server/lib/creatorGrowth/publishPolicy.test.ts` → expected missing policy/failing cases.
- [ ] **Step 3: Implement pure validation and fingerprint.** Include exact account subject, grant generation, image hash, caption, disclosure, mission approved version and instruction revision. No provider call, points write or new reviewer state.
- [ ] **Step 4: Re-run policy and Active mission regressions.** `npx vitest run server/lib/creatorGrowth/publishPolicy.test.ts server/test/active-missions.test.ts` → PASS.
- [ ] **Step 5: Commit Task 2 files.** `git commit -m 'feat: bind Instagram preview to approved content'` after exact staging.

### Task 3: Durable intent and owner-scoped status, SQL prepared only

**Files:** Create `server/lib/creatorGrowth/publishRepo.ts`, `publishRepo.test.ts`, CLI-allocated `supabase/migrations/20261104134202_kocmax_publish_intents.sql`, `server/test/creator-growth-publish-schema.test.ts`, `docs/review/kocmax-stage-5/instagram-publish-sql-review.md`.

**Interfaces:** `type PublishState = "private_draft" | "asset_validated" | "preview_ready" | "creator_approved" | "container_preparing" | "provider_processing" | "publish_requested" | "published" | "failed" | "outcome_unknown" | "cancelled" | "invalidated"`; `type PublishIntent = {id: string; owner: {workspaceId: string; creatorId: string}; connectionId: string; grantGeneration: number; requestId: string; fingerprint: string; state: PublishState; providerContainerId?: string; providerMediaId?: string; sanitizedReceipt?: Record<string, unknown>}`. `PublishRepository.reserve(actor, draft, fingerprint, requestId): Promise<PublishIntent>` returns the same intent for the same request/content, conflict for different content; `transition(intentId, expectedState, nextState, receipt?): Promise<PublishIntent>`; `getOwned(actor, intentId): Promise<PublishIntent>`; `stopByConnection(connectionId, generation): Promise<void>`.

- [ ] **Step 1: Write failing repository and PGlite schema tests.** Unique `(owner, request_id)` and one active intent for exact draft revision; owner/workspace RLS; concurrent reserve returns one intent; invalid transitions and late old-generation result are rejected; minimal receipt excludes tokens/temporary URLs; no points/XP tables changed.
- [ ] **Step 2: Run tests.** `npx vitest run server/lib/creatorGrowth/publishRepo.test.ts server/test/creator-growth-publish-schema.test.ts` → expected failure.
- [ ] **Step 3: Implement memory/Supabase repository and additive migration.** No edits to applied migrations. Include indexes, constraints, private schema/Storage references, rollback SQL, exact test-fixture and restore-point checklist in review packet. Default server flag `CREATOR_PUBLISH_ENABLED=false` cannot be overridden by a browser query.
- [ ] **Step 4: Re-run offline tests and review SQL checksum.** PASS in PGlite; **do not apply the migration to existing Remix-Adfocate DB without a separate explicit approval**.
- [ ] **Step 5: Commit only reviewed SQL/source/test/doc files.** `git commit -m 'feat: prepare idempotent creator publish intents'` after exact staging.

### Task 4: Mock-first publisher and unknown-result reconciliation

**Files:** Create `server/lib/creatorGrowth/instagramPublisher.ts`, `instagramPublisher.test.ts`, `publishService.ts`, `publishService.test.ts`, `mediaLease.ts`, `mediaLease.test.ts`.

**Interfaces:** `InstagramPublisher.createImageContainer(input): Promise<{containerId: string}>`, `getContainerStatus(containerId): Promise<"ready" | "processing" | "failed" | "unknown">`, `publishContainer(containerId): Promise<{mediaId: string}>`, `getPublishedMedia(mediaId): Promise<{permalink: string | null; accountSubject: string}>`. `type PublishPreview = {fingerprint: string; accountSubject: string; imageSha256: string; caption: string; disclosure: PublishDraft["disclosure"]; missionBasisVersionId: string | null; expiresAt: string; eligible: boolean; fallback?: "manual_proof"}`. `PublishService.prepare(actor, draftId): Promise<PublishPreview>`, `approve(actor, previewFingerprint, requestId): Promise<PublishIntent>`, `execute(intentId): Promise<PublishIntent>`, `reconcile(intentId): Promise<PublishIntent>`; `execute` is server-worker-only, never a model tool. `MediaLease.open(assetId, intentId, expiresAt)` only exists if Task 1 proves Meta requires a public fetch URL. If a timed-out provider response gives no media ID and cannot be verified by the provider, `reconcile` leaves `outcome_unknown` for human review.

- [ ] **Step 1: Write failing mock tests.** One approval → one container/publish; double click/two tabs share the same intent; changed image/caption/account/consent or revoked generation invalidates approval; Meta timeout after publish → `outcome_unknown` and no second POST; lookup mismatch stays unknown; expired/revoked lease returns no bytes; mock adapter never performs a network call.
- [ ] **Step 2: Run focused tests.** `npx vitest run server/lib/creatorGrowth/instagramPublisher.test.ts server/lib/creatorGrowth/publishService.test.ts server/lib/creatorGrowth/mediaLease.test.ts` → expected failure.
- [ ] **Step 3: Implement state machine over Task 3 repository and Task 2 policy.** Use the Task 1 verified Instagram Login manifest; if any host/token/response rule is unverified, return `PUBLISH_PROTOCOL_UNVERIFIED` with the real adapter disabled. If Meta must fetch an image, issue a short-lived opaque, bearer-style media URL that exposes neither storage path nor token, disclose its holder-readable nature, and close it after processing/expiry.
- [ ] **Step 4: Re-run focused tests and existing integration regressions.** Add `server/lib/integrations/service.test.ts` and `server/test/integrations-pilot-regression.test.ts`; all PASS. Late provider replies cannot resurrect a revoked grant.
- [ ] **Step 5: Commit only Task 4 files.** `git commit -m 'feat: add guarded mock Instagram publisher'` after exact staging.

### Task 5: Exact preview, confirmation and status in the creator UI

**Files:** Create `server/routes/creatorGrowthPublish.ts`, `server/test/creator-growth-publish-routes.test.ts`, `src/components/studio/PublishPreview.tsx`, `PublishPreview.test.tsx`, `PublishStatus.tsx`, `PublishStatus.test.tsx`, `src/lib/creatorGrowth/publishQueries.ts`; modify `server/app.ts`, `src/components/studio/StudioWorkspace.tsx`, `src/components/integrations/Connections.tsx` only for approved scope/status copy.

**Interfaces:** Guarded API under `/api/creator-growth/publish`: `POST /preview` (current server-owned account/mission basis), `POST /approve` (exact fingerprint + request ID), `GET /:intentId` (owner-only status), `POST /:intentId/reconcile` (status check only). `PublishPreview` receives immutable image/caption/account/disclosure/instruction summary and `onConfirm(fingerprint)`; it never receives a provider token.

- [ ] **Step 1: Write failing API/UI tests.** Wrong owner/workspace, model-authored request, expired/reused fingerprint, missing scope, private draft on brand/staff route, sponsored-label fallback, and reconnect before confirm are denied. Mobile/desktop preview shows exact `@account`, full image, caption, disclosure, immediate action and uncertain-result copy. Connections view shows actual granted scopes, last successful sync, and distinct local-stop/provider-revoke states. No reward animation or points when publish succeeds.
- [ ] **Step 2: Run focused tests.** `npx vitest run server/test/creator-growth-publish-routes.test.ts src/components/studio/PublishPreview.test.tsx src/components/studio/PublishStatus.test.tsx` → expected failure.
- [ ] **Step 3: Implement guarded routes and UI.** Bind actor to `workspaceAuth` in `server/app.ts`; pass only safe DTOs; preserve existing Studio thread/brief and connection screens. Approve endpoint reserves a command, but only the server worker may call the provider. Keep manual proof link visible for unsupported/blocked missions.
- [ ] **Step 4: Re-run focused tests and browser journeys.** At 320/390/430/1440px, verify personal draft → preview → mock receipt, Active approved version → preview → proof link, edited version → review required, sponsored fallback, cancel, back/reload and unknown outcome.
- [ ] **Step 5: Commit only Task 5 files.** `git commit -m 'feat: add creator-controlled Instagram publish preview'` after exact staging.

### Task 6: Bounded public-image retrieval after provider-rights review

**Files:** Modify `server/lib/creatorGrowth/publicImageProvider.ts`, `publicImageProvider.test.ts`; create `docs/review/kocmax-stage-5/rapidapi-image-rights.md`.

**Interfaces:** Extend `PublicImageProvider.listForProfile({subject, username, officialPermalink}, signal)` from the offline plan; return candidates with provider/version/fetchedAt/rights and no metric fields. Real adapter requires a server-side feature flag and an approved provider/endpoint/terms record. A missing record yields `PUBLIC_IMAGE_PROVIDER_UNVERIFIED`.

- [ ] **Step 1: Write failing adapter tests.** Own bound username/subject only; no private account, arbitrary URL, third-party media or redirect to unallowed host; 429/timeout returns unavailable, never a false zero or fallback scrape; image bytes are not persisted before rights and match checks.
- [ ] **Step 2: Run the focused test.** `npx vitest run server/lib/creatorGrowth/publicImageProvider.test.ts` → new live-adapter cases fail.
- [ ] **Step 3: Review the exact RapidAPI product/plan, endpoint response and image display/storage/analysis rights.** Record source/version/limits and any Instagram platform restriction. Only if permitted, implement a bounded one-profile adapter that still calls Task 2's exact match; otherwise leave the provider disabled and rely on the creator's self-upload.
- [ ] **Step 4: Re-run provider and provenance tests.** `npx vitest run server/lib/creatorGrowth/publicImageProvider.test.ts server/lib/creatorGrowth/mediaMatch.test.ts` → PASS; a local mock is not a rights or live-data PASS.
- [ ] **Step 5: Commit exact code/tests/rights record.** `git commit -m 'feat: gate public IG image retrieval by provenance and rights'` after exact-hunk staging.

### Task 7: Approved vision adapter and purpose-bound consent

**Files:** Modify `server/lib/creatorGrowth/imageAnalysis.ts`, `imageAnalysis.test.ts`; create `server/lib/creatorGrowth/visionConsent.ts`, `visionConsent.test.ts`, `docs/review/kocmax-stage-5/vision-processor-review.md`.

**Interfaces:** `VisionProcessingGrant = {ownerId: string; purpose: "image_diagnosis"; processorId: string; consentVersion: string; sourceHash: string; expiresAt: string}`; `authorizeVisionProcessing(grant, actor, asset, processorConfig): boolean`. `analyzeImage` from the offline plan receives a `VisionAdapter` only after this check; no arbitrary tool access or cross-thread source set.

- [ ] **Step 1: Write failing consent/adapter tests.** No consent, wrong asset/source hash, expired consent, revoked Instagram generation, unapproved processor, wrong owner and OCR prompt injection make zero external calls; approved consent sends only selected image plus minimum context; output separates observation from inference and uncertainty.
- [ ] **Step 2: Run focused tests.** `npx vitest run server/lib/creatorGrowth/visionConsent.test.ts server/lib/creatorGrowth/imageAnalysis.test.ts` → expected new cases fail.
- [ ] **Step 3: Review actual processor identity, region, retention, training and deletion terms, then implement a provider-specific adapter behind a default-off flag.** Do not assume the existing text-only AI gateway understands images. If contract/consent is absent, retain mock/manual description; no real image leaves KOCmax.
- [ ] **Step 4: Re-run focused tests and a synthetic data-flow check.** PASS; verify logs, analytics, chat history and exported reports contain no raw image bytes/token/temporary media URL.
- [ ] **Step 5: Commit only exact code/tests/review record.** `git commit -m 'feat: gate creator image analysis by explicit consent'` after exact-hunk staging.

### Task 8: Original Active mission and cross-role regression

**Files:** Test `server/test/active-missions.test.ts`, `server/test/reward-handoffs.test.ts`, `server/test/studio-integrations.test.ts`, `src/components/active-mission/active-mission.test.tsx`; add only focused tests needed for the new receipt link. Document `docs/review/kocmax-stage-5/mission-publish-regression.md`.

**Interfaces:** A verified `published` intent may supply the original publication proof URL/media ID; it cannot approve proof, settle `mission_pending_rewards`, insert points ledger entries or award badges. Approved draft version and frozen reward contract remain authoritative.

- [ ] **Step 1: Write failing boundary tests.** Exact Active approved caption/asset may create a proof proposal; edited asset/caption returns to original review; legacy still uses manual proof; one published receipt linked twice creates one proof attempt/award path; `pending` does not appear as settled balance; existing active contract XP may be 0.
- [ ] **Step 2: Run focused mission tests.** `npx vitest run server/test/active-missions.test.ts server/test/reward-handoffs.test.ts server/test/studio-integrations.test.ts src/components/active-mission/active-mission.test.tsx` → expected new boundary cases fail.
- [ ] **Step 3: Add only the receipt-to-proof handoff** through existing mission API and confirmation. Do not create a parallel reward command or change current legacy/Active approval semantics.
- [ ] **Step 4: Re-run tests and nine-role-style browser matrix** with new disposable accounts only if the live test has separately approved data; otherwise run offline synthetic roles. Check creator, same-workspace other creator, cross-workspace creator, brand member/owner, operator, reviewer, finance viewer, workspace admin at 390×844 and 1440×1000.
- [ ] **Step 5: Commit focused changes and sanitized regression report.** `git commit -m 'feat: link verified Instagram post to mission proof'` after exact staging. Production deployment remains a later decision.

### Task 9: Separate approval packet and real Instagram test pilot

**Files:** Create `docs/review/kocmax-stage-5/instagram-pilot-approval.md`, `instagram-pilot-execution.md`; private test tokens/images stay outside Git. This task is **blocked on a new explicit approval** for its actual provider/DB/media actions.

**Interfaces:** Consume Tasks 1–8. Produce exact Meta App/product/version/redirect/host/scope and subject map, two professional test-account aliases, processor and RapidAPI terms, migration/restore point, one test image/caption, temporary-media URL policy, test window, cleanup IDs and rollback receipt.

- [ ] **Step 1: Assemble the concrete pilot packet only after Task 8's offline mission and cross-role regressions pass.** Verify Meta App ownership/access level, `instagram_business_basic`, Insights and publish grant actually available, IG-01–05 status, provider revoke and signed notice contract, image/processor rights, host/public-fetch needs, separate non-target account, and exact SQL/rollback. Keep all live flags false.
- [ ] **Step 2: Obtain explicit approval for the concrete packet** before its SQL application, OAuth grant, external image/model processing, temporary public media hosting, first test publish or hosting change. The approval may cover several named actions; do not request it again for the same approved actions. No approval is inferred from this plan or the design.
- [ ] **Step 3: After approval, run the isolated test with consented professional accounts.** First publish exactly one unsponsored, non-mission single-image test post to the intended account; confirm the other account remains untouched. Observe provider media ID/permalink, unknown-result handling and revoke behavior. If the project uses the existing shared DB, verify its restore point and exact baseline first.
- [ ] **Step 4: Perform exact cleanup and independent readback.** Revoke/stop local grant, report provider revocation status honestly, purge test-only assets/consents/snapshots/intent data under approved policy, and confirm no unrelated row drift or secret in logs. Public Instagram post cleanup needs the creator's explicit action and a documented result; do not claim DB cleanup removed it.
- [ ] **Step 5: Report per-layer acceptance.** Separate offline mock, Auth/RLS, real Meta, vision/RapidAPI rights, browser, hosted and production statuses. A blocked revoke, missing paid-label support, unknown outcome or failed cleanup is not PASS.

## Final acceptance for this plan

Run focused tests, `npm run build`, integration regression gates, `git diff --check`, and verify the final branch diff against the approved spec and starting D1 dirty state. Verify visitor, creator, brand member/owner and operator navigation at 390×844 and 1440×1000, including direct routes and back/reload. A mock receipt is never Meta acceptance; a Meta receipt is never mission proof approval; a settled ledger event is the only points balance authority. Keep `CREATOR_PUBLISH_ENABLED=false` and the real provider disabled until a separately approved deployment review.
