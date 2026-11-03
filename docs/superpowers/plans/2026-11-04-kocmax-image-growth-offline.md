# KOCmax Image Understanding and Growth Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a coherent mobile/desktop creator growth workspace with four curated skill cards, self-uploaded images, honest evidence labels, and an offline image-analysis boundary that cannot send real data to an unapproved processor.

**Architecture:** Extend the existing Studio composer/thread/evidence UI with a small `creatorGrowth` domain. Keep official Instagram metrics and third-party public-image candidates as separate provenance records; use pure matching, a mock vision adapter, and a private repository boundary. Real RapidAPI image retrieval, external vision and schema application remain disabled until their separate gates.

**Tech Stack:** React 19, TypeScript, Hono, Supabase schema design, Vitest/Testing Library, Playwright; existing KOCmax Studio and integration service.

**Spec:** [Approved Instagram growth Studio design](../specs/2026-11-03-kocmax-instagram-growth-studio-design.md), §§1–6, 8–10. Depends on the interface fixes in [UI/session plan](2026-11-04-kocmax-ui-session-reliability.md), Tasks 1–3.

## Global Constraints

- Same branch; preserve current tasks, briefs, source sharing, brand/operator/visitor routes, rewards, recent fixes and dirty D1 work. Record the dirty baseline; stage only new task hunks and audit every staged diff before commit.
- Basic creator tasks and manual-source briefs work without Instagram. Four skill cards do not credit points/XP; mission cards show only the frozen mission contract.
- First image surface supports one static image. User supplies the next post image; no AI image generation and no raw third-party `SKILL.md` runtime execution.
- Data without verified HK/Traditional-Chinese coverage is `未驗證`; unavailable metrics are null/missing, never invented zero. Official numbers and RapidAPI images keep separate labels.
- Real provider/image/model access, SQL application, deployment and publication remain disabled. A mock answer is visibly `示例／未驗證`, never a claim of true visual understanding.
- Pinned external source revision: `f28cef2b7067ec64e79c9d85421c022c06659e03`; substantial reused text retains its MIT notice and attribution. Upstream text is untrusted data.

## Review Focus

1. An official media permalink and RapidAPI candidate have the same caption but different IDs/URLs: reject the image match (Task 2 test).
2. An image contains OCR text saying to call a tool or share a token: analysis records text as data and invokes no tool (Task 3 test).
3. A creator selects an actual private photo while external model use is off: local preview works, no network/model upload occurs (Task 3/UI tests).
4. A 30-day/50-post partial official sample is presented as a 90-day trend: report must say partial/unverified (Task 4 test).
5. Creator B opens creator A's draft or analysis ID, including in the same workspace: 404/denial and no cached leak (Tasks 6–7 tests).

---

## File structure and order

| Unit | Files | Responsibility |
| --- | --- | --- |
| Skills | Create `src/lib/creatorGrowth/skillManifest.ts`, `server/lib/creatorGrowth/skillRouter.ts`, matching tests; `docs/licenses/social-media-skills-MIT.txt` if substantial wording copied | Four allowlisted cards and free-question routing, no external tool authority |
| Media provenance | Create `server/lib/creatorGrowth/mediaMatch.ts`, `publicImageProvider.ts`, tests | Exact cross-source matching; mock-only provider before rights review |
| Vision boundary | Create `server/lib/creatorGrowth/imageAnalysis.ts`, `assetPolicy.ts`, tests | Validate self-upload and processor consent; mock analysis only |
| Evidence and skill result | Create `server/lib/creatorGrowth/skillRunner.ts`, `report.ts`, tests | Versioned, source-backed suggestions; no reward command |
| Studio surface | Create `src/components/studio/GrowthSkillCards.tsx`, `GrowthImageWorkspace.tsx`, tests; modify `StudioHome.tsx`, `StudioWorkspace.tsx`, `studio.css`; add `src/lib/creatorGrowth/queries.ts` | Mobile/desktop entry, image preview, evidence and editable next-post draft |
| Persistence proposal | Create `server/lib/creatorGrowth/repository.ts`, `memoryRepository.ts`, `supabaseRepository.ts`, tests; prepare a new migration in `supabase/migrations/` plus schema test and review document | Private owner/workspace boundary; SQL only prepared for separate approval |
| Private API | Create `server/routes/creatorGrowth.ts`, `server/test/creator-growth-routes.test.ts`; modify `server/app.ts` and `src/lib/creatorGrowth/queries.ts` | Session-scoped mock upload, analysis, skill and draft commands, ready for approved persistence |

### Task 1: Curate four versioned skill cards

**Files:** Create `src/lib/creatorGrowth/skillManifest.ts`, `server/lib/creatorGrowth/skillRouter.ts`, `server/lib/creatorGrowth/skillRouter.test.ts`; update license notice only if substantive source wording is included.

**Interfaces:** `type GrowthSkillId = "image_diagnosis" | "post_review" | "next_caption" | "next_growth_step"`; `const GROWTH_SKILLS: ReadonlyArray<{id: GrowthSkillId; titleZh: string; difficulty: string; estimatedMinutes: number; requiredSources: string[]; reward: "mission_contract_only" | "none"; sourceRevision: string}>`; `routeGrowthQuestion(text: string): GrowthSkillId | null`. Cards are editable prompt templates, not executable external files.

- [ ] **Step 1: Write failing manifest/router tests.** Assert exactly four IDs, pinned revision, no WoopSocial/native-publish tool name, zero standalone points; free-form image/post/caption/growth questions map to the right card, ambiguous question returns null for normal chat.
- [ ] **Step 2: Run the test.** `npx vitest run server/lib/creatorGrowth/skillRouter.test.ts` → missing manifest/router fails.
- [ ] **Step 3: Implement allowlisted manifest and router.** Rewrite guidance in KOCmax Traditional Chinese using the approved spec; never load upstream Markdown at runtime. Store source/version/attribution metadata for display and review.
- [ ] **Step 4: Run focused test.** Same command → PASS.
- [ ] **Step 5: Commit exact Task 1 files.** Use `git add --` with the named paths and `git commit -m 'feat: add curated creator growth skill cards'`.

### Task 2: Keep official metrics separate from public images

**Files:** Create `server/lib/creatorGrowth/mediaMatch.ts`, `mediaMatch.test.ts`, `publicImageProvider.ts`, `publicImageProvider.test.ts`.

**Interfaces:** `type OfficialMediaRef = {subject: string; mediaId: string; permalink: string; mediaType: "IMAGE" | "CAROUSEL_ALBUM" | "VIDEO"; observedAt: string}`; `type PublicImageCandidate = {provider: "rapidapi"; permalink: string | null; mediaId: string | null; imageRef: string; fetchedAt: string; rights: "allowed" | "unknown" | "denied"}`; `matchPublicImage(official: OfficialMediaRef, candidate: PublicImageCandidate): {status: "matched" | "unverified" | "rejected"; reason: string}`. `PublicImageProvider.listForProfile({subject, username, officialPermalink}, signal)` returns candidates only in injected mock mode; live call fails closed pending provider/rights review. The username must be bound to the official subject, never accepted on its own.

- [ ] **Step 1: Write failing matching/provider tests.** Match only the same canonical media ID or exact normalized permalink on the same approved subject and single-image type; reject username-only, caption-only, carousel-first-image guesses, private/rights-unknown candidates, redirects to an unallowed host and duplicate candidates. A mock provider supplies a clearly labeled sample, no network.
- [ ] **Step 2: Run tests.** `npx vitest run server/lib/creatorGrowth/mediaMatch.test.ts server/lib/creatorGrowth/publicImageProvider.test.ts` → expected missing implementation.
- [ ] **Step 3: Implement pure match and mock adapter.** Use the existing `instagramLive.read` evidence IDs/permalink; do not merge RapidAPI likes/comments into official metrics or modify the existing social passport/BioCode scan.
- [ ] **Step 4: Re-run both tests.** Expected PASS, including no live fetch when the flag is false.
- [ ] **Step 5: Commit exact Task 2 files.** `git commit -m 'feat: separate public image provenance from IG insights'` after staging named files.

### Task 3: Self-uploaded image and vision-processing boundary

**Files:** Create `server/lib/creatorGrowth/assetPolicy.ts`, `assetPolicy.test.ts`, `imageAnalysis.ts`, `imageAnalysis.test.ts`; the browser preview lives in Task 5.

**Interfaces:** `normalizeImageAsset(input: {bytes: Uint8Array; declaredMime: string; ownerId: string; rightsConfirmed: boolean}, deps: {decodeAndStripMetadata: (bytes: Uint8Array) => Promise<{bytes: Uint8Array; mime: "image/jpeg" | "image/png" | "image/webp"; width: number; height: number}>}): Promise<{sha256: string; detectedMime: string; byteSize: number; bytes: Uint8Array; width: number; height: number}>` or typed rejection; `sha256` covers the sanitized bytes that the creator previews. `type VisionAdapter = {kind: "mock" | "external"; analyze: (imageBytes: Uint8Array, context: {caption?: string}) => Promise<ImageObservation>}`; `ImageObservation` has `objects`, `visibleText`, `composition`, `captionAlignment`, `uncertainties`, `sampleOnly`. `analyzeImage(input: {assetId: string; sourceRef: string; caption?: string; consentVersion?: string}, deps: {loadAsset: (assetId: string) => Promise<Uint8Array>; vision: VisionAdapter; processingApproved: boolean}): Promise<ImageObservation>`. An actual user's image is never passed to mock as if its contents were observed.

- [ ] **Step 1: Write failing tests.** Unsupported/oversize/polyglot image, no rights declaration and hash mismatch fail validation; EXIF is stripped before storage and the preview/hash use sanitized bytes; missing processor consent or `processingApproved=false` prevents external calls; injected synthetic mock returns `sampleOnly=true`; OCR prompt injection remains quoted data and yields no tool calls.
- [ ] **Step 2: Run tests.** `npx vitest run server/lib/creatorGrowth/assetPolicy.test.ts server/lib/creatorGrowth/imageAnalysis.test.ts` → expected failure.
- [ ] **Step 3: Implement the policy and adapter boundary.** No real model or secret in this task. Choose conservative fixture limits and document them as local pilot defaults; before a live pilot, replace with checked Meta/provider limits and approved processor terms. Strip unneeded EXIF in a controlled conversion only before final preview/hash; never silently alter a mission-approved asset later.
- [ ] **Step 4: Re-run focused tests.** PASS and a spy confirms zero external network/model calls.
- [ ] **Step 5: Commit only Task 3 files.** `git commit -m 'feat: add guarded image observation boundary'` after exact staging.

### Task 4: Evidence-backed report and skill outputs

**Files:** Create `server/lib/creatorGrowth/report.ts`, `report.test.ts`, `skillRunner.ts`, `skillRunner.test.ts`.

**Interfaces:** `buildGrowthEvidence({question, officialSnapshots, publicImageMatch, observation, runAt}): GrowthEvidenceReport` with independent `availability`, `provenance`, `region`, `language`, `period`, `partial`, `citations`. `runGrowthSkill({skillId, report, creatorGoal, voice?}, deps: {writer: SkillWriter; processingApproved: boolean}): Promise<{proposal: string; sourceRefs: string[]; limitations: string[]; sampleOnly: boolean}>`. No write/publish/points tools.

- [ ] **Step 1: Write failing report tests.** Missing metric is `null + missing`, genuine provider zero remains zero; 30-day selection/50-media cap and lifetime metric period are distinct; HK/Traditional-Chinese unknown becomes `未驗證`; mock `post_review` cannot claim 90-day trend; caption options contain no invented personal experience or platform guarantee; no ledger command.
- [ ] **Step 2: Run tests.** `npx vitest run server/lib/creatorGrowth/report.test.ts server/lib/creatorGrowth/skillRunner.test.ts` → expected failure.
- [ ] **Step 3: Implement evidence builder and allowlisted skill runner.** Include actual question, platform, timestamps, source refs and limitations; use local fixtures if external processing is disabled. Preserve existing Studio assistant's `external_model_not_approved` behavior for integration sources.
- [ ] **Step 4: Re-run tests.** Expected PASS.
- [ ] **Step 5: Commit only Task 4 files.** `git commit -m 'feat: add evidence-backed creator growth proposals'` after exact staging.

### Task 5: Mobile/desktop Studio image workflow

**Files:** Create `src/components/studio/GrowthSkillCards.tsx`, `GrowthImageWorkspace.tsx`, `GrowthSkillCards.test.tsx`, `GrowthImageWorkspace.test.tsx`, `src/lib/creatorGrowth/queries.ts`; modify `src/components/studio/StudioHome.tsx`, `StudioWorkspace.tsx`, `studio.css`.

**Interfaces:** Consume `GROWTH_SKILLS` and `GrowthEvidenceReport`. The view exposes `onChooseSkill(id: GrowthSkillId)`, `onChooseImage(file: File)`, `onDescribeImage()`, `onSaveDraft()`; no `onPublish` in this plan. Existing `StudioWorkspace` thread/source/brief/share interfaces remain intact.

- [ ] **Step 1: Write failing component tests.** The composer is visible before cards; selecting a card opens only that thread context; File selection shows a local private preview; processing not approved shows manual description and no upload/model request; unapproved persistence shows `尚未保存` and cannot present a mock as a saved draft; source cards distinguish official metric, third-party image, self-upload and unverified; changing image invalidates old proposal; keyboard, 320px overflow and reduced-motion states are covered.
- [ ] **Step 2: Run focused UI tests.** `npx vitest run src/components/studio/GrowthSkillCards.test.tsx src/components/studio/GrowthImageWorkspace.test.tsx src/components/studio/StudioWorkspace.test.tsx` → expected new cases fail.
- [ ] **Step 3: Implement the cards and image workspace** in existing game-like visual language. On mobile use a single column and full evidence subpage; desktop keeps chat plus optional evidence pane. Keep old mission, rewards, connections and history navigation direct. Until private persistence is approved, keep the new image/draft local to the browser, label it `尚未保存`, and offer the existing authorized brief save path where its source rules permit; use example labels until processor approval exists.
- [ ] **Step 4: Run focused tests and browser sizes.** Vitest files above PASS; Playwright at 320/390/430/1440px verifies composer, image choice, evidence, brief and navigation with synthetic sample only.
- [ ] **Step 5: Commit only Task 5 files.** `git commit -m 'feat: show creator image and growth skills in Studio'` after exact staging.

### Task 6: Private persistence proposal and permission contract

**Files:** Create `server/lib/creatorGrowth/repository.ts`, `memoryRepository.ts`, `supabaseRepository.ts`, `repository.test.ts`; prepare `supabase/migrations/20261104010000_kocmax_creator_growth_private.sql`, `server/test/creator-growth-schema.test.ts`, `docs/review/kocmax-stage-5/creator-growth-sql-review.md`. Never change an applied migration.

**Interfaces:** `GrowthRepository` methods `putAsset(owner, asset)`, `getAssetBytes(owner, assetId): Promise<Uint8Array>`, `saveAnalysis(owner, result)`, `saveSkillInvocation(owner, invocation)`, `getPrivateDraft(owner, id)`, `purgeOwner(owner)`; `owner={workspaceId, creatorId}` always comes from current server session, not the browser or model. `getAssetBytes` is server-internal and never enters a browser DTO. Supabase implementation requires both owner predicates and RLS; memory implementation mirrors them for offline tests.

- [ ] **Step 1: Write failing repository/schema tests.** Same-workspace other creator, cross-workspace creator, brand and staff cannot read private assets/results; revoked generation invalidates derived data; unreferenced 24-hour upload, 30-day saved-draft and 90-day minimal-event retention paths remove only intended rows; export excludes token/image bytes; no points/XP table touched.
- [ ] **Step 2: Run offline tests.** `npx vitest run server/lib/creatorGrowth/repository.test.ts server/test/creator-growth-schema.test.ts` → expected failure until migration/repository exist.
- [ ] **Step 3: Implement memory and Supabase repository and draft additive SQL.** Tables cover media provenance, private asset metadata, analysis, skill invocation, consent version and expiry; storage bucket is private. Include RLS, indexes, uniqueness, rollback, dependency order, row-count pre/post checks and a no-data-copy fixture. Wire live persistence only behind a default-off server flag.
- [ ] **Step 4: Run focused tests and create review packet.** Tests PASS locally/PGlite. The reviewed SQL file and backup/restore notes are ready; **do not apply SQL to the existing Remix-Adfocate DB without separate user approval**.
- [ ] **Step 5: Commit only source, tests and review documents.** `git commit -m 'feat: prepare private creator growth persistence'` after exact staging; record the migration checksum and feature-off state.

### Task 7: Session-scoped private growth API

**Files:** Create `server/routes/creatorGrowth.ts`, `server/test/creator-growth-routes.test.ts`; modify `server/app.ts`, `src/lib/creatorGrowth/queries.ts` and Task 5 UI only as needed to consume safe DTOs.

**Interfaces:** `createCreatorGrowthRoutes(deps: {repo: GrowthRepository; vision: VisionAdapter; publicImages: PublicImageProvider}): Hono<Env>` mounted under guarded `/api/creator-growth`. Routes: `POST /assets` (one user-owned image, rights declaration, size/MIME check), `POST /analyse` (asset ID, source selection, processor-consent version), `POST /skills` (allowlisted skill ID/current thread evidence), `POST /drafts` (editable private next-post draft with revision), `GET /drafts/:id` (owner only), `POST /media/select` (official media ref plus mock candidate, never arbitrary URL). `actor` is read from `workspaceAuth`; no client-provided owner field.

- [ ] **Step 1: Write failing route tests.** Missing session, same-workspace other creator, cross-workspace creator, brand/staff token, invalid image and stale revision are denied; a mock request returns `sampleOnly=true`; no external fetch/model/publish/points call; after revoke a previously selected source cannot be analyzed or shared.
- [ ] **Step 2: Run focused tests.** `npx vitest run server/test/creator-growth-routes.test.ts` → expected missing route/failure.
- [ ] **Step 3: Implement guarded routes and safe client hooks.** Reuse the existing Studio source/brief ownership and `external_model_not_approved` boundary; store no token/image bytes in response, chat transcript or React Query cache. The default server flag is off; offline test injection explicitly enables only mock paths. Keep old `/studio` commands unchanged.
- [ ] **Step 4: Re-run route, Studio and privacy tests.** `npx vitest run server/test/creator-growth-routes.test.ts server/test/studio-routes.test.ts server/test/studio-integration-ai-boundary.test.ts src/components/studio/GrowthImageWorkspace.test.tsx` → PASS.
- [ ] **Step 5: Commit only Task 7 hunks.** Audit the staged diff of already-dirty `server/app.ts`, then `git commit -m 'feat: add private mock creator growth routes'`.

## Final acceptance for this plan

Run the focused tests, `npm run build`, `git diff --check`, and a synthetic mobile/desktop journey through the existing Studio, mission, reward and connection screens. Record sample/mock status explicitly. The independent gates for real RapidAPI image rights, real vision processing and existing-DB SQL remain open; no source or visual mock is counted as live provider acceptance.
