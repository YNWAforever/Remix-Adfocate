# Mission-page Instagram Publishing Mock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the preserved Native execution method. Steps use checkboxes for tracking.

**Goal:** Let a creator rehearse publishing one approved brand-mission image from its original task page, explicitly confirm the exact content/account, and return to proof review without any real publication or proof write.

**Architecture:** Add a development-only entry beside existing publication instructions. A pure eligibility/context projection binds the selected work item, approved version, publication instructions and explicit mock rights; a small controller composes the existing MockNativeJourney and PublishPreview. Original task, manual proof, approval and reward flows remain authoritative and unchanged.

**Tech Stack:** Existing React/TypeScript, TanStack Router/Query, Vitest, synthetic browser image preparation and mock native adapter. No dependencies or schema additions.

**Spec:** `docs/superpowers/specs/2026-11-06-kocmax-mission-publish-entry-design.md` (approved 2026-11-06).

## Global Constraints

- Same branch `codex/kocmax-studio-stages-1-2`; preserve dirty baseline and fixes. No stage/commit, deployment, applied SQL, real connections, publication or external image calls.
- Only Active mission, Instagram, one static image, exact `approved_to_publish` version. No Reels, Stories, carousel, scheduling or automatic publish.
- Creator confirms after brand approval; only final approved image/caption/disclosures are proposed. Never send private Brief/source text.
- Username/bio/RapidAPI do not grant publication authority. Rights and provider support are explicit synthetic inputs, never inferred from mission approval or account text.
- Mock receipts stay sample-only with no real permalink, no proof submission, no rewards. Return-to-proof is navigation/focus only.
- DEV plus `VITE_STUDIO_FIXTURE === "true"` guards the lazy mock import. No new production publisher composition or enabled live route.
- Keep existing source/private permission rules and manual proof path; unsupported/unknown platform labels block native rehearsal eligibility.
- Mobile390×844 and desktop1440×1000; minimum44px actions, no horizontal overflow, no punitive or urgency copy.

## Review Focus

1. Switch selected deliverable/account while image preparation or confirmation is pending: stale completion must not populate or publish the new context (Tasks1/2/3).
2. The approved-version id stays equal but caption, asset checksum, instructions revision or rights changes: old confirmation must fail (Tasks1/2).
3. Two clicks/two mounted previews and an ambiguous publish result: keep one request per page-session context, query it without another publish (Task2).
4. A mock receipt resembles real proof: return button must not fill proof fields, call submit hooks or affect reward state (Tasks3/4).
5. Missing/ambiguous source rights, official grant or required disclosure support: no permissive defaults, no production fixture import (Tasks1/4).

## File Map

| File | Role |
| --- | --- |
| `src/lib/creatorGrowth/missionPublishContext.ts` + `.test.ts` | Pure approved-context eligibility and immutable signature |
| `src/lib/creatorGrowth/mockMissionPublish.ts` + `.test.ts` | Task-specific wrapper around existing `MockNativeJourney`; no duplicate provider state machine |
| `src/components/active-mission/MissionPublishEntry.tsx` + `.test.tsx` | DEV/fixture-only lazy entry; no live composition |
| `src/components/active-mission/MissionPublishMock.tsx` + `.test.tsx` | Preview/confirmation/mock receipt UI; reuse `PublishPreview` |
| `src/routes/_app.my.$submissionId.tsx` and `src/routes/-_app.my.$submissionId.test.tsx` | Mount entry beside `PublicationInstructions`, proof-form focus target |
| `src/test/studioPreview.ts`, new `src/test/missionPublishPreview.ts` + `.test.ts` | Dedicated owner-only static-image task fixture and scenario controls |
| `scripts/creator-growth-bundle-boundary.test.ts` | Exclude new mock markers and modules from production |
| `docs/review/kocmax-stage-5/mission-publish-entry-mock.md` | Evidence, limitations, screenshots and independent review |

## Task 1: Bind the exact approved task context

**Consumes:** `MissionWorkItemView`, `MissionPublicationView` from `src/lib/activeMission.ts`. `approvedVersionId` resolves a member of `item.versions`; use that version's `caption`, `contentChecksum` and `assets`, never `item.draft` or a StudioBrief.

**Produces** in `missionPublishContext.ts`:

```ts
type MissionMockRights = {
  sampleOnly: true; ownerKey: string;
  accountSubject: string; username: string; grantGeneration: number;
  grant: "valid" | "missing" | "revoked";
  sources: "shareable" | "private" | "revoked" | "unknown";
  platformLabel: "supported" | "unsupported" | "unverified";
  brandTag: "supported" | "unsupported" | "unverified" | "not_required";
};
type MissionPublishContext = {
  ownerKey: string; submissionId: string; item: MissionWorkItemView;
  publication: MissionPublicationView; rights: MissionMockRights;
};
type MissionPublishEligibility =
  | { eligible: false; reason: "approval" | "asset" | "account" | "rights" | "disclosure" }
  | { eligible: true; signature: string; approvedVersionId: string;
      caption: string; assetId: string; imageSha256: string; accountSubject: string };
function inspectMissionPublish(context: MissionPublishContext): MissionPublishEligibility;
```

- [ ] Write failing tests: exact approved single-image context eligible; drafting/version missing or duplicated/id mismatch/wrong item or platform denied; missing checksum, multiple assets, non-image and unfinished upload denied. Private/revoked/unknown source rights, missing/revoked grant or mismatched expected account denied. Treat unspecified disclosure support as unverified.
- [ ] Assert signature changes when owner/submission/item, approved content/checksum, asset checksum, publication revision/instructions/disclosures, account or rights change. Use deterministic serialization, never image signed URL as identity. Assert output excludes private evidence and URLs.
- [ ] Run `node node_modules/vitest/vitest.mjs run src/lib/creatorGrowth/missionPublishContext.test.ts --reporter=dot`; expected missing-module RED.
- [ ] Implement projection with explicit denials; no network, token lookup or permission inference. Use current app upload-state values verified from fixtures, not a new enum. Required-label mapping belongs to explicit fixture policy, not NLP guesses from text.
- [ ] Rerun same test; expected PASS.

## Task 2: Compose the existing mock publication engine

**Consumes:** Task1 context/signature; `MockNativeJourney` in `src/lib/creatorGrowth/mockNativeJourney.ts`; `PreparedJpeg`/synthetic converter in `jpegPreparation.ts`. Existing journey is personal and has no mission validation: the wrapper must add that binding rather than relabel its `mission:null` display.

**Produces:** `MockMissionPublishSession` in `mockMissionPublish.ts`, with constructor `(readCurrent:()=>MissionPublishContext, prepareImage:()=>Promise<PreparedJpeg>, outcome:"published"|"timeout_after_accept")`; methods `prepare()`, `confirm({fingerprint,nonce})`, `status()`, `dispose()`. `prepare` returns the existing journey preview plus immutable approved context; `confirm` returns its sample receipt; `status` returns a clone of the last known receipt or null and never invokes a publish. `dispose` invalidates async completions and calls journey.stop.

Also export `MockMissionPublishRegistry` with `getOrCreate(signature:string, factory:()=>MockMissionPublishSession):MockMissionPublishSession` and `dispose():void`. Instantiate per authenticated owner in the development entry host, not per opened preview. Context changes invalidate the active preview but retain attempted-signature records until owner/session teardown. Do not persist private draft text to browser storage.

- [ ] Write tests: prepare consumes canonical approved caption; converted JPEG checksum must equal the preapproved fixture asset checksum before preview; mismatch fails. Context is re-read before and after async image preparation and before confirmation. Changed context invalidates preview and blocks reuse; revocation during async work cannot expose late success.
- [ ] Test double confirmation causes at most one adapter publish. A page-session registry keyed by owner/submission/item/approved-context signature retains attempted/unknown outcomes across closing/reopening panels and switching items; do not make another journey for an attempted signature. Owner change disposes the registry. Reload resets the visibly transient rehearsal with no automatic call or success claim; durable multi-tab guarantees remain outside mock acceptance.
- [ ] Run `node node_modules/vitest/vitest.mjs run src/lib/creatorGrowth/mockMissionPublish.test.ts --reporter=dot`; expect RED.
- [ ] Implement the wrapper, reusing existing adapter/nonce/state handling. Permit only fixed synthetic prepared assets and explicit sample accounts. Map mock account keys to the existing journey's primary/secondary targets; verify the returned subject equals the expected context, not just a username. No new live provider/lease/proof pathway.
- [ ] Rerun new tests plus `src/lib/creatorGrowth/mockNativeJourney.test.ts`; expect PASS. If its actual test filename differs, discover and record the exact existing filename before execution.

## Task 3: Task-page entry, confirmation and return-to-proof

**Consumes:** Task1/2, existing `PublishPreviewModel`, `PublishPreview`, current selected item/publication and identity. `MissionPublishEntry` props: `{context:MissionPublishContext|null; onReturnToProof:()=>void}`. `MissionPublishMock` adds injected page-session registry for testing. Keep fixture rights separate from production task DTOs; no fake rights added to `MissionWorkItemView`.

The entry host accepts current route data through a DEV-only bridge: export `MissionPublishEntryHost({ownerKey,submissionId,item,publication,onReturnToProof})` in the same entry file, with `item:MissionWorkItemView|null` and `publication:MissionPublicationView|null`. It dynamically resolves dedicated fixture rights only inside the guarded mock module; missing/nonfixture ids render nothing. The host passes a live context getter to the session so deferred operations read newest props, not the initial render closure. The production route never statically imports the fixture or mock engine.

- [ ] Write component tests: default/fixture-off entry renders nothing and imports no mock; eligible mock item shows labelled entry; preview displays exact caption/image/account/version with unchecked consent. Cancel makes no publish; changed item/account/context closes stale confirmation. Unknown result only offers status; success exposes sample-only receipt and proof-navigation callback.
- [ ] Add route regression tests: original instructions, manual ProofSubmissionForm and history remain usable; unavailable/workspace401 does not show private mock content. `onReturnToProof` focuses existing proof heading/form without modifying values, creating evidence or invoking `useSubmitPublicationProof`. Preserve item query selection and existing proof conflict recovery. Test non-owner contexts denied.
- [ ] Run `node node_modules/vitest/vitest.mjs run src/components/active-mission/MissionPublishEntry.test.tsx src/components/active-mission/MissionPublishMock.test.tsx 'src/routes/-_app.my.$submissionId.test.tsx' --reporter=dot`; expect new tests RED.
- [ ] Implement entry with `import.meta.env.DEV && import.meta.env.VITE_STUDIO_FIXTURE === "true"` guarded dynamic import. Insert beside existing PublicationInstructions only when data is loaded; don't restructure the large route. Reuse PublishPreview with `mode:"synthetic"`, exact active-mission approvedVersionId, disclosure model and one-use confirmation. Use existing publish CSS/scoped task classes for wrapping and44px controls.
- [ ] Return path is focus/navigation only, not a sample permalink prefill. Missing native capability keeps original manual route. "Needs changes" routes back to original review workflow without inventing an approved→draft transition.
- [ ] Rerun above tests plus existing `PublishPreview.test.tsx`, `PublishStatus.test.tsx` and `src/components/active-mission`; expected PASS. Explicitly assert zero proof-submit/reward calls from all new actions.

## Task 4: Isolated fixture and integrated acceptance

**Consumes:** Existing `studioPreview.ts` principal/ownership handling; add dedicated sample submission and work item, not change the existing default video task into a static-image task. New seed ids: submission `...000931`, item `...000941`, approved version `...000951` (verify unused before writing; select alternate unused fixed ids if necessary and record). Marker `MISSION_PUBLISH_ENTRY_MOCK_ONLY`.

- [ ] Write `missionPublishPreview.test.ts` with owner/peer denial, separate caption/checksum approved seed, supported vs unsupported disclosure, missing/revoked grant, rights changes and unknown outcome. Generate synthetic JPEG once in development preparation and approve that exact hash before entering the task; never overwrite approved hash to fit a later conversion. In tests inject deterministic bytes/hash.
- [ ] Run fixture test; expect RED. Implement owner-scoped fixture data and route responses, history/navigation entry and development controls; all mutations remain in memory. Preserve original task, reward balance and proof attempts. Any unsupported direct fixture action must fail closed.
- [ ] Add marker and new mock-module/sample strings to `creator-growth-bundle-boundary.test.ts`. Run `node node_modules/vitest/vitest.mjs run src/lib/creatorGrowth/missionPublishContext.test.ts src/lib/creatorGrowth/mockMissionPublish.test.ts src/test/missionPublishPreview.test.ts src/test/studioPreviewOwnership.test.ts src/components/active-mission src/components/studio/PublishPreview.test.tsx src/components/studio/PublishStatus.test.tsx 'src/routes/-_app.my.$submissionId.test.tsx' scripts/creator-growth-bundle-boundary.test.ts --maxWorkers=4 --minWorkers=1 --reporter=dot`; expect PASS, including fixture-off build.
- [ ] Run `node node_modules/typescript/bin/tsc --noEmit --pretty false` and ESLint on every created/modified TS/TSX file; expect exit0. Run relevant original mission/proof query regressions; report unrelated baseline failures separately.
- [ ] In in-app browser390×844 and1440×1000 verify task→preview→confirm→receipt→proof focus; cancel/edit/unknown/disclosure blocking, owner switch/401, back/reload and no horizontal overflow. Record exact observed states, screenshots and that no real proof/reward actions occurred. Restore normal fixture/default viewport.
- [ ] Record results in `docs/review/kocmax-stage-5/mission-publish-entry-mock.md`; one independent read-only scoped review after Native implementation, resolve material findings with regressions. Do not claim real account, live publication or full-repository acceptance.

## Self-review / Handoff

Coverage: eligibility/source/approval→Task1; exact confirmation/async/replay→Task2; task entry/manual proof/privacy/UI→Task3; fixture/isolation/browser/regression→Task4. No dependencies, SQL or real provider integration. Context projection deliberately adds explicit fixture rights because current task DTO alone does not prove publication authority. Registry scope and reload limitations are stated to avoid pretending page-local rehearsal is a durable live intent store.

Native execution preference is preserved. Plan awaits user review before implementation; no product code changed by this planning step. No task commit steps under existing no-commit constraint.

## Execution outcome — 2026-11-06
Implemented locally after approval. Acceptance and exact verification exceptions: `docs/review/kocmax-stage-5/mission-publish-entry-mock.md`. Selected regression 346/346, production exclusion PASS; one expired-preview minor deferred. No commits or remote changes.
