# Creator Studio Publication-Proof Evidence Lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Add a publication-proof evidence lane to the existing Creator Studio focused workbench, from structured mission authoring through creator submission, metadata fallback, immutable correction attempts, and atomic Creator Case operator decisions.

**Architecture:** Keep the existing \`SubmissionWorkspace\` as the read model and extend \`CreatorStudioRepository\` with a distinct proof-lane command surface. Store structured deliverable requirements beside legacy mission columns, copy the proof requirement onto each work item at workflow initialization, and keep proof attempts/evidence separate from ordinary draft assets. Creator-side commands are owned by Creator Studio; the operator verification command is owned by Creator Case and persists its decision, lineage state, workflow event, and command replay record through one repository adapter transaction.

**Tech Stack:** TypeScript, Hono, React, TanStack Query, Supabase Postgres/RPC, Supabase Storage, Vitest, Testing Library, existing ESM/type-check/build scripts.

## Global Constraints

- Preserve existing \`missions.deliverables text[]\`, \`requirements text[]\`, and \`platforms text[]\` behavior for legacy callers; structured authoring is additive.
- Do not mix publication-proof evidence with ordinary draft assets or make client state authoritative.
- Submitted proof attempts and operator decisions are immutable. A correction creates a linked new draft attempt; it never edits the submitted attempt.
- Every mutating command requires a caller-supplied command ID, derives its replay hash on the server, and treats same-ID/different-payload as a conflict.
- Creator Studio owns creator commands. Creator Case owns operator verification and correction decisions. Neither route may bypass its repository adapter.
- Unsupported, unavailable, or failed metadata must remain manually reviewable; it must never auto-verify a proof attempt.
- Keep the phase free of rewards, payouts, production seeding, live migration execution, deployment, credential changes, and provider-specific secrets.
- Preserve unrelated tracked and untracked work. Stage only the files named by each commit step; never use \`git add -A\`.
- Use the existing repository contracts and Supabase RPC pattern for all writes. Direct client inserts/updates to proof tables are prohibited.
- Run focused tests after each task and report missing dependencies, credentials, or database access as environment gates rather than source regressions.

---

## Current Source Map

- Mission authoring: \`server/lib/missionAuthoring.ts\`, \`server/routes/adminMissions.ts\`, \`server/test/missionAuthoring.test.ts\`, \`server/test/mission-authoring-schema.test.ts\`.
- Creator Studio contracts and adapter: \`server/lib/creatorStudio/types.ts\`, \`errors.ts\`, \`repository.ts\`, \`inMemoryRepository.ts\`, \`supabaseRepository.ts\`.
- Creator Studio HTTP/client/UI: \`server/routes/creatorStudio.ts\`, \`src/lib/queries/creatorStudio.ts\`, \`src/components/creator-studio/CreatorStudioWorkbench.tsx\`, \`NextActionPanel.tsx\`.
- Creator Case operator boundary: \`server/lib/creatorCase/types.ts\`, \`errors.ts\`, \`repository.ts\`, \`inMemoryRepository.ts\`, \`supabaseRepository.ts\`, \`server/routes/adminOperatorCrm.ts\`.
- Existing schema/RPC conventions: \`supabase/migrations/20260809100000_creator_studio_mission_workspace.sql\`, \`supabase/migrations/20260809103000_creator_studio_command_rpc.sql\`.
- Focused verification: \`server/test/creator-studio-repository.test.ts\`, \`server/test/creator-studio-mutations.test.ts\`, \`server/test/creator-studio-schema.test.ts\`, \`server/test/creator-studio-route.test.ts\`, \`src/components/creator-studio/CreatorStudioWorkbench.test.tsx\`, and Creator Case contract/route tests.

---

## Task 1: Add structured proof requirements to mission authoring

**Files**

- Modify \`server/lib/missionAuthoring.ts\`.
- Modify \`server/routes/adminMissions.ts\`.
- Modify \`server/test/missionAuthoring.test.ts\`.
- Modify \`server/test/mission-authoring-schema.test.ts\`.

- [ ] Write failing unit tests for legacy and structured deliverable normalization.

Add these cases before implementation:

~~~ts
it("keeps legacy string deliverables valid and emits no proof requirement", () => {
  const result = normalizeDeliverableSpecs({
    deliverables: ["Publish one review"],
  });

  expect(result).toEqual([{
    title: "Publish one review",
    instructions: "",
    requirements: { caption: false, externalUrl: false, checklist: [] },
    requiresAsset: false,
    proofRequirement: null,
  }]);
});

it("accepts a publication URL proof requirement with optional evidence", () => {
  expect(validateDeliverableSpecs([{
    title: "Publish one review",
    instructions: "Publish on an allowed platform.",
    requirements: { caption: true, externalUrl: true, checklist: ["Use the campaign tag"] },
    requiresAsset: false,
    proofRequirement: {
      kind: "publication_url",
      allowedPlatforms: ["instagram", "youtube"],
      evidence: "optional",
    },
  }])).toEqual([]);
});
~~~

Also assert that a proof requirement with an empty title, an unsupported \`kind\`, or an empty \`allowedPlatforms\` list returns a stable validation error code.

- [ ] Extend the authoring types with \`PublicationProofRequirementInput\` and \`DeliverableSpecInput\`.

Use this contract:

~~~ts
export type PublicationProofRequirementInput = {
  kind: "publication_url";
  allowedPlatforms: string[];
  evidence: "optional";
};

export type DeliverableSpecInput = {
  title: string;
  instructions: string;
  requirements: {
    caption: boolean;
    externalUrl: boolean;
    checklist: string[];
  };
  requiresAsset: boolean;
  proofRequirement: PublicationProofRequirementInput | null;
};
~~~

Add \`deliverableSpecs?: DeliverableSpecInput[]\` to \`MissionInput\`, normalize missing structured input from the existing \`deliverables?: string[]\`, and reject a request that supplies both forms with different item counts.

- [ ] Implement pure normalization and validation.

Add \`normalizeDeliverableSpecs\` and \`validateDeliverableSpecs\` beside the existing brief validation. Normalize platform names to trimmed lowercase strings, trim titles/instructions/checklist entries, remove duplicate checklist entries while retaining order, and return \`proofRequirement: null\` when no proof is declared. Reject blank titles, blank checklist entries, unknown proof kinds, empty platform lists, and platforms longer than 64 characters. Keep validation deterministic and free of database/provider calls.

- [ ] Add the structured field to the admin mission command without removing legacy persistence.

Parse \`body.deliverable_specs\` in \`server/routes/adminMissions.ts\`, pass it through the pure authoring validator, and persist it to a new \`deliverable_specs\` column while continuing to write \`body.deliverables ?? []\` to the legacy column. Return the normalized structured specs in the command result. The route must return the existing validation error envelope for malformed JSON or invalid specs.

- [ ] Run the focused authoring tests and commit the contract.

Run:

~~~text
npm.cmd test -- server/test/missionAuthoring.test.ts server/test/mission-authoring-schema.test.ts
~~~

Expected result: the new normalization/validation cases pass and the pre-existing legacy cases remain green. If the suite cannot start because the local package manager or dependencies are unavailable, record that as an environment gate and do not broaden this task.

Then stage and commit only:

~~~text
git add server/lib/missionAuthoring.ts server/routes/adminMissions.ts server/test/missionAuthoring.test.ts server/test/mission-authoring-schema.test.ts
git commit -m "feat: add structured mission deliverable requirements"
~~~

---

## Task 2: Define the proof-lane domain contract and database schema

**Files**

- Add \`supabase/migrations/20260809110000_creator_studio_publication_proof.sql\`.
- Add \`server/lib/creatorStudio/publicationProof.ts\`.
- Modify \`server/lib/creatorStudio/types.ts\`.
- Modify \`server/lib/creatorStudio/errors.ts\`.
- Modify \`server/lib/creatorStudio/repository.ts\`.
- Modify \`server/test/creator-studio-schema.test.ts\`.

- [ ] Write schema and contract tests before adding implementation types.

Assert the required discriminated values and immutable transitions:

~~~ts
expect(PROOF_ATTEMPT_STATES).toEqual(["draft", "submitted", "verified", "changes_requested"]);
expect(PROOF_METADATA_STATES).toEqual(["pending", "available", "unavailable", "failed"]);
expect(canEditProofAttempt("draft")).toBe(true);
expect(canEditProofAttempt("submitted")).toBe(false);
expect(canCreateCorrection("changes_requested")).toBe(true);
~~~

Add a fixture with \`proofRequirement: null\` and verify the workspace contract keeps the existing work-item fields unchanged.

- [ ] Add the proof contract and deterministic validation helpers.

Create \`server/lib/creatorStudio/publicationProof.ts\` with exact types for:

~~~ts
export type ProofAttemptState = "draft" | "submitted" | "verified" | "changes_requested";
export type ProofMetadataState = "pending" | "available" | "unavailable" | "failed";

export type PublicationProofRequirement = {
  kind: "publication_url";
  allowedPlatforms: string[];
  evidence: "optional";
};

export type PublicationProofAttempt = {
  id: string;
  workItemId: string;
  parentAttemptId: string | null;
  sequence: number;
  publishedUrl: string;
  platform: string | null;
  state: ProofAttemptState;
  metadataState: ProofMetadataState;
  metadata: { title: string | null; author: string | null; publishedAt: string | null } | null;
  operatorMessage: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  evidence: PublicationProofEvidence[];
};

export type PublicationProofEvidence = {
  id: string;
  attemptId: string;
  storagePath: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
  byteSize: number;
  status: "pending" | "finalized";
};
~~~

Export URL/platform validation, \`canEditProofAttempt\`, \`canCreateCorrection\`, and a function that maps \`ProofMetadataState\` to a non-verifying manual-review message. These helpers must not perform I/O.

- [ ] Extend \`WorkItem\`, validation, and repository contracts.

Add \`proofRequirement: PublicationProofRequirement | null\`, \`publicationProof: { required: boolean; currentAttempt: PublicationProofAttempt | null; history: PublicationProofAttempt[] }\`, and \`publicationProof: boolean\` to the relevant work-item/workspace validation shapes. Add these command inputs to \`CreatorStudioRepository\`:

~~~ts
createPublicationProofAttempt(context, workItemId, input): Promise<CommandResult<PublicationProofAttempt>>;
createProofEvidenceGrant(context, workItemId, attemptId, input): Promise<CommandResult<UploadGrant>>;
finalizeProofEvidence(context, workItemId, attemptId, evidenceId, input): Promise<CommandResult<PublicationProofEvidence>>;
submitPublicationProof(context, workItemId, attemptId, input): Promise<CommandResult<PublicationProofAttempt>>;
refreshProofMetadata(context, workItemId, attemptId, input): Promise<CommandResult<PublicationProofAttempt>>;
~~~

Each input includes \`commandId\`; URL/platform/evidence validation is performed by the adapter and its RPC.

- [ ] Add additive schema objects and initialization rules.

The migration must:

- Add \`missions.deliverable_specs jsonb not null default '[]'::jsonb\`.
- Add \`mission_work_items.proof_requirement jsonb\`.
- Add \`mission_publication_proof_attempts\` keyed by workflow, work item, creator, and workspace, with \`parent_attempt_id\`, monotonic \`sequence\`, URL/platform, state, metadata state/payload, operator message, timestamps, and immutable lineage constraints.
- Add \`mission_publication_proof_assets\` keyed by attempt and evidence ID, with storage metadata and pending/finalized status.
- Add indexes for \`workspace_id, creator_id, mission_submission_id\` and \`work_item_id, sequence\`.
- Enable RLS with creator read policies and service-role writes; revoke direct insert/update/delete from authenticated clients.
- Add the private \`mission-publication-proof-assets\` storage bucket and policies that limit paths to the authenticated creator’s workflow/work-item lineage.
- Replace \`initialize_creator_studio_workflow(uuid)\` so it reads each structured spec when present, falls back to the legacy string deliverable, and copies \`proofRequirement\` into \`mission_work_items.proof_requirement\`. Existing workflows must remain idempotent.
- Add append-only triggers for proof attempts, proof evidence, and their decision/event records.

- [ ] Run schema contract checks and commit the domain boundary.

Run:

~~~text
npm.cmd test -- server/test/creator-studio-schema.test.ts
npm.cmd run check:esm
~~~

Expected result: contract tests and ESM import checks pass. A database migration apply is not part of this task; do not seed or mutate any live database.

Then stage and commit only the files in this task:

~~~text
git add supabase/migrations/20260809110000_creator_studio_publication_proof.sql server/lib/creatorStudio/publicationProof.ts server/lib/creatorStudio/types.ts server/lib/creatorStudio/errors.ts server/lib/creatorStudio/repository.ts server/test/creator-studio-schema.test.ts
git commit -m "feat: define creator studio proof lane contract"
~~~

---

## Task 3: Implement and test the in-memory Creator Studio proof lifecycle

**Files**

- Modify \`server/lib/creatorStudio/inMemoryRepository.ts\`.
- Modify \`server/test/creator-studio-repository.test.ts\`.
- Modify \`server/test/creator-studio-mutations.test.ts\` only if shared command fixtures need proof fields.

- [ ] Add failing lifecycle tests for the creator command surface.

Cover these transitions in order:

~~~ts
const draft = await repository.createPublicationProofAttempt(context, "item-1", {
  commandId: "proof-create-1",
  publishedUrl: "https://www.youtube.com/watch?v=abc",
  platform: "youtube",
});
expect(draft.data.state).toBe("draft");

const submitted = await repository.submitPublicationProof(context, "item-1", draft.data.id, {
  commandId: "proof-submit-1",
});
expect(submitted.data.state).toBe("submitted");

await expect(repository.saveDraft(context, "item-1", existingDraftCommand))
  .resolves.toMatchObject({ ok: true });
await expect(repository.submitPublicationProof(context, "item-1", draft.data.id, {
  commandId: "proof-submit-2",
})).rejects.toMatchObject({ code: "proof_attempt_immutable" });
~~~

Also test optional evidence, metadata states \`available\`, \`unavailable\`, and \`failed\`, owner/workspace isolation, same-command replay, and same-ID/different-payload conflict.

- [ ] Implement draft resume and correction lineage.

A create-attempt command returns the existing editable draft for the same work item when one exists. If the latest attempt is submitted, verified, or changes-requested, it creates sequence N+1 with \`parentAttemptId\` pointing to the latest attempt. A submitted attempt is copied into history but its URL, metadata, evidence list, and decision fields cannot be mutated. A correction command must retain the parent link and require a non-empty operator message when the correction is created by the operator path.

- [ ] Implement in-memory evidence and metadata behavior.

Use the existing command result/error pattern. Evidence grants must produce a proof-specific storage path under \`<creator>/<workflow>/<work-item>/proof-evidence/<evidence-id>.<extension>\`, finalization must validate the declared MIME/size and mark evidence finalized, and submit must permit a URL without evidence when \`evidence: "optional"\`. Metadata refresh must call an injected resolver; unsupported platform and resolver-unavailable results become \`unavailable\`, resolver exceptions become \`failed\`, and neither result changes the attempt to verified.

- [ ] Run the repository lifecycle tests and commit.

Run:

~~~text
npm.cmd test -- server/test/creator-studio-repository.test.ts server/test/creator-studio-mutations.test.ts
~~~

Expected result: existing draft/upload/submit tests and all new proof lifecycle cases pass.

Then:

~~~text
git add server/lib/creatorStudio/inMemoryRepository.ts server/test/creator-studio-repository.test.ts server/test/creator-studio-mutations.test.ts
git commit -m "feat: implement creator studio proof lifecycle"
~~~

---

## Task 4: Add Supabase proof reads and atomic creator RPCs

**Files**

- Add \`supabase/migrations/20260809113000_creator_studio_publication_proof_rpc.sql\`.
- Modify \`server/lib/creatorStudio/supabaseRepository.ts\`.
- Modify \`server/test/creator-studio-integration.test.ts\`.
- Modify \`server/test/creator-studio-repository.test.ts\` for RPC mapping fixtures.

- [ ] Add failing adapter tests for RPC names, arguments, and result validation.

Assert that the adapter invokes exactly these RPCs and maps invalid responses to \`db_error\`:

~~~text
creator_studio_create_publication_proof_attempt
creator_studio_create_proof_evidence_grant
creator_studio_finalize_proof_evidence
creator_studio_submit_publication_proof
creator_studio_refresh_proof_metadata
~~~

Assert that the workspace read selects \`deliverable_specs\`/proof requirements, current attempt, attempt history, and proof evidence without changing the ordinary \`mission_draft_assets\` projection.

- [ ] Implement proof projections in \`getWorkspace\`.

Extend the existing mission/work-item select and joins with \`mission_work_items.proof_requirement\`, attempts ordered by \`sequence desc\`, and evidence ordered by creation time. Map nullable JSON safely through the proof contract, compute \`validation.publicationProof\` from the required proof attempt state, and update \`nextActionFor\` so a required unsubmitted/correctable proof is the next action while an awaiting operator decision remains an await action.

- [ ] Add the creator proof RPCs in one migration.

Each RPC must accept the existing lineage identifiers, \`p_command_id\`, and the command payload. Within one transaction it must:

1. Verify the authenticated creator/workspace/submission/work-item lineage.
2. Lock the work item and relevant attempt lineage.
3. Look up the command ID and replay the stored result for an identical server-derived payload hash.
4. Raise the existing conflict code for a different payload.
5. Enforce draft-only edits, sequence/parent rules, allowed platform rules, and evidence metadata.
6. Write the domain row, append a workflow event, append the immutable command row, refresh workflow state, and return the full proof snapshot before commit.
7. Roll back all writes on any validation/storage-metadata failure.

The evidence RPC must validate the stored object’s bucket, path prefix, MIME type, and byte size before finalization. The metadata RPC must preserve \`pending\`/available/unavailable/failed and never set \`verified\`.

- [ ] Add integration assertions without live execution.

Extend the opt-in integration test to assert the migration function names, proof table columns, RLS/grant/revoke statements, storage bucket name, and transactional RPC signatures. Keep the test skipped when the repository’s database environment gate is absent.

- [ ] Run adapter and migration checks and commit.

Run:

~~~text
npm.cmd test -- server/test/creator-studio-repository.test.ts server/test/creator-studio-integration.test.ts
npm.cmd run check:esm
~~~

Expected result: local adapter tests pass; integration tests either pass against the configured isolated database or report their existing environment skip. No production database command is authorized.

Then:

~~~text
git add supabase/migrations/20260809113000_creator_studio_publication_proof_rpc.sql server/lib/creatorStudio/supabaseRepository.ts server/test/creator-studio-integration.test.ts server/test/creator-studio-repository.test.ts
git commit -m "feat: persist creator studio proof commands atomically"
~~~

---

## Task 5: Expose Creator Studio commands and Creator Case decisions

**Files**

- Modify \`server/routes/creatorStudio.ts\`.
- Modify \`server/lib/creatorCase/types.ts\`.
- Modify \`server/lib/creatorCase/errors.ts\`.
- Modify \`server/lib/creatorCase/repository.ts\`.
- Modify \`server/lib/creatorCase/inMemoryRepository.ts\`.
- Modify \`server/lib/creatorCase/supabaseRepository.ts\`.
- Modify \`server/routes/adminOperatorCrm.ts\`.
- Add/update \`server/test/creator-studio-route.test.ts\`.
- Add/update Creator Case contract and route tests.

- [ ] Add route tests before route implementation.

Define these creator endpoints and request envelopes:

~~~text
POST /:submissionId/work-items/:workItemId/publication-proof/attempts
POST /:submissionId/work-items/:workItemId/publication-proof/:attemptId/evidence/upload-grant
POST /:submissionId/work-items/:workItemId/publication-proof/:attemptId/evidence/:evidenceId/finalize
POST /:submissionId/work-items/:workItemId/publication-proof/:attemptId/submit
POST /:submissionId/work-items/:workItemId/publication-proof/:attemptId/metadata-refresh
~~~

Every request must require \`command_id\`; the attempt request accepts \`published_url\` and \`platform\`; evidence requests accept the existing upload/finalize metadata; submit and refresh accept no client-owned state beyond the command ID. Assert error-code mapping, workspace/creator context, replay behavior, and workspace-query invalidation response behavior.

- [ ] Implement the Creator Studio routes through \`runCommand\`.

Follow the existing draft/upload/finalize/submit route pattern. Parse and validate body values at the boundary, pass the authenticated \`CreatorStudioContext\` to the repository, return the repository command result, and use \`errorResponse\` for proof-specific errors. Do not call Supabase directly from the route.

- [ ] Add the Creator Case operator contract and tests.

Add:

~~~ts
export type ReviewPublicationProofCommand = {
  creatorId: string;
  submissionId: string;
  workItemId: string;
  attemptId: string;
  decision: "verified" | "changes_requested";
  message: string | null;
};
~~~

Extend \`CreatorCaseRepository\` with \`reviewPublicationProof(context, command)\`. Require a non-empty message for \`changes_requested\`, verify the attempt/work-item/creator lineage, reject decisions against non-submitted attempts, and make repeated command IDs replay the original Creator Case snapshot. Test that verification does not award rewards, alter payout state, or mutate unrelated Creator Case review fields.

- [ ] Persist operator decisions atomically through the Creator Case adapter.

Add a \`creator_case_review_publication_proof\` RPC in the proof RPC migration or a follow-up migration owned by Creator Case. The adapter must send the command ID and all lineage/decision fields once. The RPC must lock the attempt, update only the decision columns and linked work-item/workflow state, append the operator event, append the command replay record, and return the Creator Case snapshot in one transaction. A correction must leave the submitted attempt immutable and create the next draft attempt linked to it. Add the proof decision summary to the Creator Case read model without making Creator Case responsible for creator draft editing.

- [ ] Add the admin route and run route/contract tests.

Expose:

~~~text
POST /creators/:id/publication-proof/review
~~~

The body is \`{ command_id, submission_id, work_item_id, attempt_id, decision, message }\`. Route it through \`creatorCaseCommandContext\`, return the updated proof decision summary, and preserve the existing admin error envelope.

Run:

~~~text
npm.cmd test -- server/test/creator-studio-route.test.ts server/lib/creatorCase/repository.contract.test.ts server/test/admin-operator-crm-route.test.ts
~~~

Expected result: creator routes, Creator Case repository contracts, and operator route cases pass. Then stage and commit only the files changed in this task:

~~~text
git add server/routes/creatorStudio.ts server/lib/creatorCase/types.ts server/lib/creatorCase/errors.ts server/lib/creatorCase/repository.ts server/lib/creatorCase/inMemoryRepository.ts server/lib/creatorCase/supabaseRepository.ts server/routes/adminOperatorCrm.ts server/test/creator-studio-route.test.ts server/lib/creatorCase/repository.contract.test.ts server/test/admin-operator-crm-route.test.ts supabase/migrations/20260809113000_creator_studio_publication_proof_rpc.sql
git commit -m "feat: add proof submission and operator review commands"
~~~

If the migration file was already committed in Task 4, stage only its changes from this task and keep the single migration history coherent.

---

## Task 6: Add the focused workbench proof panel

**Files**

- Add \`src/components/creator-studio/PublicationProofPanel.tsx\`.
- Add \`src/components/creator-studio/PublicationProofPanel.test.tsx\`.
- Modify \`src/components/creator-studio/CreatorStudioWorkbench.tsx\`.
- Modify \`src/components/creator-studio/NextActionPanel.tsx\`.
- Modify \`src/lib/queries/creatorStudio.ts\`.
- Modify \`src/components/creator-studio/CreatorStudioWorkbench.test.tsx\`.

- [ ] Add client query/mutation tests for the proof command hooks.

Extend \`creatorStudioKeys.workspace\` invalidation and add hooks named:

~~~text
useCreatePublicationProofAttempt
useCreateProofEvidenceGrant
useFinalizeProofEvidence
useSubmitPublicationProof
useRefreshProofMetadata
~~~

Assert that each mutation generates one stable command ID for a logical retry, sends only the command payload, invalidates the current workspace on success, and preserves the existing query key when the submission ID changes.

- [ ] Implement \`PublicationProofPanel\` as a separate proof lane.

Render the panel only when \`workItem.proofRequirement?.kind === "publication_url"\`. It must include:

- published URL and allowed-platform selection;
- metadata state with available details or an explicit manual-review fallback for unavailable/failed metadata;
- optional evidence upload using the proof-specific grant/finalize hooks;
- current attempt state and immutable attempt history;
- operator correction message and a clear action to create the linked next attempt;
- labels, descriptions, keyboard focus order, error summaries, and no reliance on color alone.

Do not render ordinary \`AssetUploadPanel\` assets inside this panel. Do not add reward/payout UI.

- [ ] Integrate the panel and next-action copy into the workbench.

Place the panel inside the existing focused workbench near the selected deliverable’s draft/editor content. Keep \`WorkspaceHeader\`, navigator, ordinary asset panel, review feedback, and existing draft save behavior intact. Extend the next action model with proof-specific labels for \`Submit proof\`, \`Awaiting operator verification\`, and \`Create corrected proof attempt\`. Reset local proof state when the workspace query key changes to another submission.

- [ ] Add UI tests for the required interaction states.

Cover: no panel for legacy deliverables; draft URL entry; optional evidence upload; metadata unavailable fallback; submitted immutable history; changes-requested correction; success/error feedback; context switch; keyboard-accessible controls. Use the existing test render/query helpers and assert user-visible text and button states rather than implementation details.

- [ ] Run the focused UI/query tests and commit.

Run:

~~~text
npm.cmd test -- src/components/creator-studio/PublicationProofPanel.test.tsx src/components/creator-studio/CreatorStudioWorkbench.test.tsx
npm.cmd run check:esm
~~~

Expected result: new proof panel cases and existing workbench cases pass.

Then:

~~~text
git add src/components/creator-studio/PublicationProofPanel.tsx src/components/creator-studio/PublicationProofPanel.test.tsx src/components/creator-studio/CreatorStudioWorkbench.tsx src/components/creator-studio/NextActionPanel.tsx src/lib/queries/creatorStudio.ts src/components/creator-studio/CreatorStudioWorkbench.test.tsx
git commit -m "feat: add creator studio publication proof workbench"
~~~

---

## Task 7: Run the complete acceptance gate

**Files**

- No new application files. Review the task commits and preserve unrelated workspace changes.

- [ ] Run the complete focused server/client suite.

Run:

~~~text
npm.cmd test -- server/test/missionAuthoring.test.ts server/test/mission-authoring-schema.test.ts server/test/creator-studio-schema.test.ts server/test/creator-studio-repository.test.ts server/test/creator-studio-mutations.test.ts server/test/creator-studio-route.test.ts server/lib/creatorCase/repository.contract.test.ts src/components/creator-studio/PublicationProofPanel.test.tsx src/components/creator-studio/CreatorStudioWorkbench.test.tsx
~~~

Expected result: all named tests pass.

- [ ] Run static checks and production build.

Run:

~~~text
npm.cmd run check:esm
npm.cmd run type-check
npm.cmd run lint
npm.cmd run build
~~~

Expected result: each command exits zero. If a command fails because of missing dependencies, missing environment variables, provider credentials, or unavailable database, capture the exact blocker and separate it from source failures.

- [ ] Review the diff and migration safety.

Run:

~~~text
git diff --check HEAD~7..HEAD
git status --short
rg -n "mission-publication-proof-assets|deliverable_specs|proof_requirement|publication-proof|creator_case_review_publication_proof" server src supabase
~~~

Expected result: no whitespace errors; only intended task files are committed; unrelated work remains unmodified; all public names are referenced by a route, adapter, migration/RPC, and test.

- [ ] Produce the handoff evidence.

Report the commit IDs, focused test output, static/build output, any opt-in integration skip reason, and explicit negative evidence that no production seed, reward/payout mutation, deployment, credential change, or live database write was performed. Do not claim publication verification without an operator decision record.

---

## Completion Criteria

- Legacy mission authoring and Creator Studio behavior remain compatible.
- Structured deliverables declare proof requirements without changing legacy columns.
- Creator Studio reads proof requirements in the focused \`SubmissionWorkspace\`.
- Creator URL/evidence commands are authorized, replay-safe, and atomically persisted through the repository adapter.
- Proof attempts are immutable after submission; corrections are linked new attempts.
- Metadata availability never auto-verifies a proof.
- Creator Case operator verification/correction is a separate atomic repository command.
- The workbench clearly separates ordinary assets from publication-proof evidence.
- Tests and static/build checks pass, with environment-gated integration results reported separately.
