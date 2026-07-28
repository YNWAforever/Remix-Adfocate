# Adfocate Publication Proof Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend active missions from `approved_to_publish` through immutable creator proof submission and exact-attempt operator verification, stopping at `proof_verified`.

**Architecture:** Keep `mission_workflows` and `mission_work_items` as the Phase 2 aggregate and state anchors, then add tenant-bound instruction, proof-attempt, evidence, and proof-review records. PostgreSQL RPCs own every state transition and idempotency decision; focused TypeScript services perform URL safety and bounded metadata inspection before persistence; the existing creator and operator routes expose stable camel-case read models.

**Tech Stack:** PostgreSQL/Supabase migrations and RLS, Supabase Storage, TypeScript 5.8, Hono 4, React 19, TanStack Router/Query, Vitest, Testing Library, Tailwind CSS.

## Global Constraints

- `mission_submissions` remains the ownership and later reward anchor; Phase 3 never changes its status.
- Phase 3 ends at `proof_verified`; it does not create `reward_pending`, points, XP, earnings, wallet entries, budget changes, or payout records.
- Proof validation is operator-led; platform OAuth and automatic platform API verification remain out of scope.
- Each proof attempt requires one normalized HTTPS primary URL and permits normalized additional URLs plus policy-compliant private evidence.
- Proof attempts and terminal reviews are immutable; a correction creates the next numbered attempt.
- Publication instructions are copied from template policy, may be overridden only before freeze, and freeze when the exact draft version is approved to publish.
- Existing `approved_to_publish` work items receive no fabricated defaults and remain blocked with `PUBLICATION_SETUP_REQUIRED` until an operator explicitly creates and freezes instructions.
- Late proof remains submittable, is persisted as late, and sorts ahead of non-overdue proof work.
- Metadata retrieval is best-effort and SSRF-safe; failure preserves a reviewable proof attempt.
- Every mutation requires expected state/revision plus an idempotency key.
- Every tenant-owned relation is bound by `workspace_id` composite keys and RLS; cross-creator and cross-workspace access returns `404 NOT_FOUND`.
- Analytics and audit metadata never contain URLs, captions, account handles, filenames, evidence contents, notes, or creator identifiers.
- Preserve English and Traditional Chinese coverage for every visible string.
- Keep legacy `content_urls`, legacy approval, and all Phase 2 draft/review transitions behaviorally unchanged.

---

## File Structure

### Database and server

- Create `supabase/migrations/20260723090000_publication_proof_validation.sql`: template publication policy, instruction/proof/review tables, tenant constraints, RLS, indexes, guarded RPCs, audit events, notification calls, and reward-neutral lifecycle.
- Create `supabase/migrations/20260723170000_publication_proof_rollout.sql`: explicit setup RPC for already-approved work items plus replay-safe rollout guards.
- Modify `server/test/active-mission-schema.test.ts`: static and live schema, RLS, immutability, idempotency, evidence, exact-attempt, and reward-boundary coverage.
- Modify `server/test/helpers.ts`: Phase 3 template/workflow/proof fixtures.
- Modify `server/lib/activeMission/types.ts`: publication states, checklist, request, metadata, and queue types.
- Modify `server/lib/activeMission/errors.ts`: `UNSAFE_PROOF_URL` and `PUBLICATION_SETUP_REQUIRED` HTTP mappings.
- Modify `server/lib/activeMission/state.ts`: aggregate publication state, transition matrix, proof input validation, and queue ordering.
- Modify `server/lib/activeMission/state.test.ts`: pure state, validation, and ordering tests.
- Create `server/lib/activeMission/proofUrl.ts`: URL normalization, platform-host policy, DNS/IP classification, redirect validation, and bounded metadata extraction.
- Create `server/lib/activeMission/proofUrl.test.ts`: scheme, host, address, redirect, timeout, content, and fallback tests.
- Create `server/lib/activeMission/publicationProof.ts`: evidence grants/finalization, metadata inspection, proof submit, and refresh orchestration.
- Create `server/lib/activeMission/publicationProof.test.ts`: service-level ownership, idempotency arguments, metadata fallback, and upload-recovery tests.
- Modify `server/lib/activeMission/repo.ts`: creator publication read model and Phase 3 RPC wrappers.
- Modify `server/routes/activeMissions.ts`: creator publication read, evidence, and proof endpoints.
- Modify `server/routes/adminActiveMissions.ts`: instruction override/setup, proof claim/correction/verify/refresh, and proof queue/detail projection.
- Modify `server/test/active-missions.test.ts`: creator/operator route contracts and live lifecycle integration.
- Modify `server/test/notifications-triggers.test.ts`: publication notification best-effort coverage.

### Client

- Modify `src/lib/activeMission.ts`: publication read-model types, state labels, next-action derivation, and correction history.
- Modify `src/lib/activeMission.test.ts` and `src/lib/activeMission.mixed.test.ts`: publication states and mixed required/optional workflow coverage.
- Modify `src/lib/queries/activeMission.ts`: creator publication queries, evidence mutations, proof submit, and stale recovery.
- Modify `src/lib/queries/activeMission.test.tsx` and `src/lib/queries/activeMission.race.test.tsx`: exact endpoint, cache, and conflict behavior.
- Modify `src/lib/admin.ts`: proof filters/read models and operator Phase 3 mutations.
- Create `src/components/active-mission/PublicationInstructions.tsx`: frozen instructions, deadline, disclosures, and approved-version context.
- Create `src/components/active-mission/ProofSubmissionForm.tsx`: URLs, evidence, confirmation, validation, metadata warning, and accessible status.
- Create `src/components/active-mission/ProofAttemptHistory.tsx`: immutable attempts, metadata snapshots, decisions, and corrections.
- Modify `src/routes/_app.my.$submissionId.tsx`: publication states and proof actions in the existing work-item page.
- Modify `src/routes/-_app.my.$submissionId.test.tsx`: creator publication flow, focus, mobile, and reward-boundary tests.
- Create `src/components/admin/PublicationProofReview.tsx`: exact-attempt comparison, checklist, correction, and verify actions.
- Modify `src/components/admin/ActiveMissionQueue.tsx`: proof filters, lateness/metadata badges, and canonical-order rendering.
- Modify `src/routes/admin.active-missions.tsx` and `src/routes/admin.active-missions.$workflowId.tsx`: proof queue/detail actions.
- Modify `src/components/admin/ActiveMissionReview.test.tsx` and `src/routes/-admin.active-missions.test.tsx`: operator proof workflow and no-reward confirmation.
- Modify `src/components/admin/MissionEditor.tsx`: deliverable publication defaults.
- Modify `src/lib/activationAnalytics.ts`, `src/lib/notifications.ts`, and `src/lib/i18n.dict.ts`: privacy-limited events, publication notifications, and bilingual copy.
- Modify `docs/operations/active-mission-workspace.md`: setup, queue, rollback, and verification runbook.

---

### Task 1: Publication schema and tenant invariants

**Files:**
- Create: `supabase/migrations/20260723090000_publication_proof_validation.sql`
- Modify: `server/test/active-mission-schema.test.ts`
- Modify: `server/test/helpers.ts`

**Interfaces:**
- Produces template fields `publication_instructions`, `publication_window_hours`, `required_disclosures`, `expected_account`, and `proof_evidence_policy`.
- Produces `mission_publication_instructions`, `mission_publication_proof_attempts`, `mission_publication_proof_assets`, `mission_publication_proof_reviews`, and `mission_publication_proof_review_items`.
- Produces work-item pointers `current_proof_attempt_id` and `verified_proof_attempt_id`.

- [ ] **Step 1: Write failing static schema tests**

Add assertions that load the new migration and require all five tables, workspace-composite foreign keys, unique `(workspace_id, mission_work_item_id, attempt_number)`, one instruction per work item, one terminal proof decision per attempt, RLS enablement, creator-read policies, service-only mutation functions, and append-only triggers.

```ts
expect(sql).toContain("create table public.mission_publication_proof_attempts");
expect(sql).toContain("unique (workspace_id, mission_work_item_id, attempt_number)");
expect(sql).toContain("current_proof_attempt_id uuid");
expect(sql).toContain("verified_proof_attempt_id uuid");
expect(sql).not.toMatch(/update\s+public\.mission_submissions\s+set\s+status/i);
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run: `npm.cmd test -- server/test/active-mission-schema.test.ts`

Expected: FAIL because `20260723090000_publication_proof_validation.sql` does not exist.

- [ ] **Step 3: Add the additive schema**

Create the migration with checked text/JSON fields, tenant-composite unique keys and foreign keys, proof state constraints, RLS, immutable-row triggers, private evidence bucket policies, and indexes for current attempt, reviewer, due date, lateness, and metadata status.

```sql
alter table public.mission_work_items
  add column current_proof_attempt_id uuid,
  add column verified_proof_attempt_id uuid;

create table public.mission_publication_proof_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  mission_work_item_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  primary_url text not null check (primary_url ~ '^https://'),
  additional_urls jsonb not null default '[]'::jsonb check (jsonb_typeof(additional_urls) = 'array'),
  submitted_by uuid not null,
  submitted_at timestamptz not null default now(),
  submitted_late boolean not null,
  metadata_status text not null check (metadata_status in ('available','unavailable','unsafe')),
  metadata_snapshot jsonb not null default '{}'::jsonb,
  metadata_error_category text,
  content_checksum text not null,
  unique (workspace_id, mission_work_item_id, attempt_number),
  unique (workspace_id, id)
);
```

- [ ] **Step 4: Add live tenant and immutability tests**

Seed two workspaces and creators, then prove cross-workspace child links fail, creator reads are owner-scoped, attempts/reviews cannot be updated or deleted through authenticated clients, evidence remains private, and PostgREST sees unambiguous relationships.

- [ ] **Step 5: Run schema tests**

Run: `npm.cmd test -- server/test/active-mission-schema.test.ts`

Expected: PASS for static tests; live cases report the repository’s intentional skip unless `RUN_INTEGRATION=1`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260723090000_publication_proof_validation.sql server/test/active-mission-schema.test.ts server/test/helpers.ts
git commit -m "feat: add publication proof schema"
```

### Task 2: Domain states, validation, errors, and queue precedence

**Files:**
- Modify: `server/lib/activeMission/types.ts`
- Modify: `server/lib/activeMission/errors.ts`
- Modify: `server/lib/activeMission/state.ts`
- Modify: `server/lib/activeMission/state.test.ts`

**Interfaces:**
- Produces `ProofChecklist`, `ProofReviewItemInput`, `ProofMetadataSnapshot`, and the four new work-item states.
- Produces `normalizeProofInput(input)` for structural validation only; network safety remains in Task 4.
- Produces canonical `deriveWorkflowState` and `compareQueueItems` behavior consumed by SQL-contract tests and routes.

- [ ] **Step 1: Write failing state and validation tests**

Cover the transition chain, correction resubmission, required-item aggregate precedence, optional-item non-blocking behavior, six-key checklist completeness, URL-count bounds, and late-first queue ordering.

```ts
expect(deriveWorkflowState({
  fulfillment: null,
  items: [{ required: true, state: "proof_verified" }],
})).toBe("proof_verified");
expect(() => assertTransition("proof_under_review", "proof_correction_requested")).not.toThrow();
expect(() => validateProofChecklist({ publicly_accessible: true })).toThrow("VALIDATION_FAILED");
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm.cmd test -- server/lib/activeMission/state.test.ts`

Expected: FAIL on unknown publication states and missing proof validators.

- [ ] **Step 3: Implement exact domain contracts**

Extend unions and transition maps, make `proof_verified` win only when every required item is verified, make any required publication-stage item produce `publication_in_progress`, add exact checklist keys/categories, and map `UNSAFE_PROOF_URL` to 422 and `PUBLICATION_SETUP_REQUIRED` to 409.

- [ ] **Step 4: Run the focused tests**

Run: `npm.cmd test -- server/lib/activeMission/state.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/activeMission/types.ts server/lib/activeMission/errors.ts server/lib/activeMission/state.ts server/lib/activeMission/state.test.ts
git commit -m "feat: extend active mission publication states"
```

### Task 3: Template policy, instruction snapshot, override, and freeze

**Files:**
- Modify: `supabase/migrations/20260723090000_publication_proof_validation.sql`
- Modify: `server/test/active-mission-schema.test.ts`
- Modify: `server/test/active-missions.test.ts`
- Modify: `server/routes/adminActiveMissions.ts`
- Modify: `src/components/admin/MissionEditor.tsx`

**Interfaces:**
- Produces `public.set_publication_instructions(p_workspace uuid, p_workflow uuid, p_work_item uuid, p_operator uuid, p_expected_state text, p_expected_revision integer, p_idempotency_key uuid, p_instructions jsonb)`.
- Extends the existing `public.approve_active_mission_version` contract to freeze complete instructions atomically without changing its current callers.
- Operator route: `PUT /api/admin/active-missions/:workflowId/work-items/:workItemId/publication-instructions`.

- [ ] **Step 1: Write failing policy and freeze tests**

Prove active-workspace templates reject incomplete publication policy, override requires a reason when changing defaults, frozen instructions cannot change, approval calculates `publish_due_at` from the earlier of the policy window and workflow deadline, and missing policy returns `PUBLICATION_SETUP_REQUIRED`.

- [ ] **Step 2: Verify the tests fail**

Run: `npm.cmd test -- server/test/active-mission-schema.test.ts server/test/active-missions.test.ts`

Expected: FAIL because instruction RPCs and route are absent.

- [ ] **Step 3: Implement snapshot and freeze SQL**

Create the instruction at work-item creation, permit pre-freeze updates with expected state/revision and idempotency, and add this guard to approval:

```sql
if v_instruction.id is null
   or nullif(btrim(v_instruction.instruction_text), '') is null
   or v_instruction.publish_due_at is null then
  return jsonb_build_object('code', 'PUBLICATION_SETUP_REQUIRED');
end if;

update public.mission_publication_instructions
set frozen_at = coalesce(frozen_at, v_now)
where id = v_instruction.id and frozen_at is null;
```

- [ ] **Step 4: Add route validation and authoring fields**

Validate positive window hours, ordered non-blank disclosures, evidence policy, expected state/revision, idempotency key, and non-blank override reason. Add matching fields to each active-workspace deliverable editor without changing legacy mission forms.

- [ ] **Step 5: Run focused server tests**

Run: `npm.cmd test -- server/test/active-mission-schema.test.ts server/test/active-missions.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260723090000_publication_proof_validation.sql server/test/active-mission-schema.test.ts server/test/active-missions.test.ts server/routes/adminActiveMissions.ts src/components/admin/MissionEditor.tsx
git commit -m "feat: freeze publication instructions on approval"
```

### Task 4: SSRF-safe URL policy and bounded metadata

**Files:**
- Create: `server/lib/activeMission/proofUrl.ts`
- Create: `server/lib/activeMission/proofUrl.test.ts`

**Interfaces:**
- Produces `inspectProofUrl(input, deps): Promise<ProofUrlInspection>`.
- `deps` contains injected `resolve(hostname)`, `fetch(url, init)`, and `now()` for deterministic tests.
- Returns normalized URL plus `available`, `unavailable`, or `unsafe` bounded metadata; unsafe creator input throws `ActiveMissionError("UNSAFE_PROOF_URL")`.

- [ ] **Step 1: Write the URL safety matrix**

Test HTTPS-only, no credentials, standard port, platform host allowlist, IPv4/IPv6 private/loopback/link-local/reserved/multicast/metadata rejection, safe redirect success, unsafe redirect rejection, rebinding re-resolution, three-second timeout, three redirects, 256 KB response cap, HTML-only extraction, malformed metadata, and platform-blocked fallback.

- [ ] **Step 2: Verify the tests fail**

Run: `npm.cmd test -- server/lib/activeMission/proofUrl.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement pure URL and address validation**

Use `URL`, `node:dns/promises`, and `node:net`; reject before fetch when scheme, credentials, host, port, platform, or resolved address is unsafe. Keep the platform map explicit:

```ts
export const PLATFORM_HOSTS = {
  instagram: ["instagram.com", "www.instagram.com"],
  tiktok: ["tiktok.com", "www.tiktok.com"],
  youtube: ["youtube.com", "www.youtube.com", "youtu.be"],
  facebook: ["facebook.com", "www.facebook.com"],
} as const;
```

- [ ] **Step 4: Implement bounded redirect and metadata extraction**

Fetch with `redirect: "manual"`, no cookies/auth headers, `AbortSignal.timeout(3000)`, revalidate DNS on each hop, stop after three redirects or 256 KB, and retain only canonical URL, status category, title, Open Graph type, declared publication time, and fetch time.

- [ ] **Step 5: Run the safety suite**

Run: `npm.cmd test -- server/lib/activeMission/proofUrl.test.ts`

Expected: PASS with no real network access.

- [ ] **Step 6: Commit**

```bash
git add server/lib/activeMission/proofUrl.ts server/lib/activeMission/proofUrl.test.ts
git commit -m "feat: validate public proof URLs safely"
```

### Task 5: Private proof evidence lifecycle

**Files:**
- Create: `server/lib/activeMission/publicationProof.ts`
- Create: `server/lib/activeMission/publicationProof.test.ts`
- Modify: `server/routes/activeMissions.ts`
- Modify: `server/test/active-missions.test.ts`

**Interfaces:**
- Produces `createProofEvidenceUploadGrant`, `finalizeProofEvidence`, and canonical object path `creator/workflow/work-item/proof-evidence/asset`.
- Creator routes: `POST /publication/:workItemId/assets/upload-grant` and `POST /publication/:workItemId/assets/:assetId/finalize`.

- [ ] **Step 1: Write failing evidence tests**

Require creator/workspace/work-item ownership, existing Phase 2 MIME/20 MB policy, ten-minute grant, finalized checksum, retry-safe finalize, abandoned pending asset cleanup after signing failure, and rejection of finalized, assigned, or cross-item evidence.

- [ ] **Step 2: Verify the tests fail**

Run: `npm.cmd test -- server/lib/activeMission/publicationProof.test.ts server/test/active-missions.test.ts`

Expected: FAIL on missing evidence service and routes.

- [ ] **Step 3: Implement evidence service and routes**

Reuse the Phase 2 upload validation primitives while using a distinct storage path and table. Do not attach an asset to an attempt during upload/finalize.

- [ ] **Step 4: Run evidence tests**

Run: `npm.cmd test -- server/lib/activeMission/publicationProof.test.ts server/test/active-missions.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/activeMission/publicationProof.ts server/lib/activeMission/publicationProof.test.ts server/routes/activeMissions.ts server/test/active-missions.test.ts
git commit -m "feat: add private publication evidence uploads"
```

### Task 6: Immutable proof submit transaction and creator API

**Files:**
- Modify: `supabase/migrations/20260723090000_publication_proof_validation.sql`
- Modify: `server/lib/activeMission/publicationProof.ts`
- Modify: `server/lib/activeMission/repo.ts`
- Modify: `server/routes/activeMissions.ts`
- Modify: `server/test/active-missions.test.ts`

**Interfaces:**
- Produces `public.submit_mission_publication_proof(p_submission uuid, p_creator uuid, p_workspace uuid, p_work_item uuid, p_expected_state text, p_expected_revision integer, p_idempotency_key uuid, p_proof jsonb, p_evidence_asset_ids uuid[])`.
- Extends `ActiveMissionRepository` with `getPublication(owner, workItemId)` and `submitProof(owner, workItemId, input)`.
- Creator routes: `GET /publication/:workItemId` and `POST /publication/:workItemId/proofs`.

- [ ] **Step 1: Write failing transaction and route tests**

Cover normalized primary/additional URLs, metadata fallback success, required evidence, finalized/unassigned ownership, server-derived late flag, monotonic attempt number, checksum idempotency, differing concurrent submit returning `WORKFLOW_STALE` plus current summary, correction resubmission, immutable prior attempts, and zero legacy/reward mutations.

- [ ] **Step 2: Verify the tests fail**

Run: `npm.cmd test -- server/test/active-missions.test.ts server/test/active-mission-schema.test.ts`

Expected: FAIL because submit RPC/read model are absent.

- [ ] **Step 3: Implement atomic submission**

Inspect URLs before the transaction, then call one RPC that locks workflow, work item, and instruction; validates expected state/revision and evidence; computes attempt/checksum/lateness; inserts attempt and open review; binds evidence; updates pointers/state; refreshes aggregate state; and emits one privacy-safe event.

```ts
const inspection = await inspectProofUrls(input, deps);
return client.rpc("submit_mission_publication_proof", {
  p_submission: owner.submissionId,
  p_creator: owner.creatorId,
  p_workspace: owner.workspaceId,
  p_work_item: owner.workItemId,
  p_expected_state: input.expectedState,
  p_expected_revision: input.expectedRevision,
  p_idempotency_key: input.idempotencyKey,
  p_proof: inspection,
  p_evidence_asset_ids: input.evidenceAssetIds,
});
```

- [ ] **Step 4: Project a safe creator read model**

Return frozen instructions, current state/revision, immutable attempts, bounded metadata, corrections, accepted attempt, and short-lived evidence URLs owned by the creator. Never return storage paths or fetch diagnostics.

- [ ] **Step 5: Run creator lifecycle tests**

Run: `npm.cmd test -- server/test/active-missions.test.ts server/test/active-mission-schema.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260723090000_publication_proof_validation.sql server/lib/activeMission/publicationProof.ts server/lib/activeMission/repo.ts server/routes/activeMissions.ts server/test/active-missions.test.ts server/test/active-mission-schema.test.ts
git commit -m "feat: submit immutable publication proof"
```

### Task 7: Exact-attempt operator review lifecycle

**Files:**
- Modify: `supabase/migrations/20260723090000_publication_proof_validation.sql`
- Modify: `server/test/active-mission-schema.test.ts`
- Modify: `server/test/active-missions.test.ts`

**Interfaces:**
- Produces `start_publication_proof_review`, `request_publication_proof_correction`, and `verify_publication_proof`.
- All RPCs accept workspace, workflow, work item, exact attempt, expected state/revision, operator, and idempotency key.

- [ ] **Step 1: Write failing lifecycle tests**

Test concurrent claim, claim ownership, stale attempt, complete six-key checklist, at least one categorized non-blank correction, response deadline calculated from snapshotted `revision_response_hours`, passed publication deadline still yielding a future response deadline, exact-attempt verification, required-item aggregate completion, and reward neutrality.

- [ ] **Step 2: Verify the tests fail**

Run: `npm.cmd test -- server/test/active-missions.test.ts server/test/active-mission-schema.test.ts`

Expected: FAIL on missing review RPCs.

- [ ] **Step 3: Implement guarded review RPCs**

Use canonical lock order, require the current attempt and claimed operator, persist terminal checklist/decision timestamps, set `creator_response_deadline = decision_time + revision_response_hours`, move corrections to `proof_correction_requested`, and set both verified pointer and `proof_verified` on success.

- [ ] **Step 4: Run lifecycle tests**

Run: `npm.cmd test -- server/test/active-missions.test.ts server/test/active-mission-schema.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260723090000_publication_proof_validation.sql server/test/active-mission-schema.test.ts server/test/active-missions.test.ts
git commit -m "feat: add publication proof review lifecycle"
```

### Task 8: Operator routes, metadata refresh, and proof queue

**Files:**
- Modify: `server/routes/adminActiveMissions.ts`
- Modify: `server/lib/activeMission/publicationProof.ts`
- Modify: `server/lib/activeMission/state.ts`
- Modify: `server/test/active-missions.test.ts`

**Interfaces:**
- Produces the five operator endpoints specified in the design.
- Extends queue filters with proof state, late, metadata status, platform, publication deadline, mission, and reviewer.
- Metadata refresh mutates metadata fields only and emits requested/completed events.

- [ ] **Step 1: Write failing route and ordering tests**

Require malformed UUID/body rejection before repository access, authenticated workspace/operator context, exact RPC arguments, stale summary mapping, late/overdue canonical order, signed evidence URLs only after detail authorization, bounded refresh, and no reward action in the response.

- [ ] **Step 2: Verify the tests fail**

Run: `npm.cmd test -- server/test/active-missions.test.ts`

Expected: FAIL on missing proof-review routes and filters.

- [ ] **Step 3: Implement operator endpoints and queue projection**

Validate expected state/revision, idempotency key, exact attempt, checklist, corrections, and refresh ownership. Sort overdue publication/review SLA first, then nearest deadline, oldest attempt, and stable ID.

- [ ] **Step 4: Implement metadata refresh**

Re-run Task 4 inspection against the immutable submitted URL, update only metadata status/snapshot/error category/fetch time, and leave attempt URLs, checksum, review state, and decisions unchanged.

- [ ] **Step 5: Run operator route tests**

Run: `npm.cmd test -- server/test/active-missions.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routes/adminActiveMissions.ts server/lib/activeMission/publicationProof.ts server/lib/activeMission/state.ts server/test/active-missions.test.ts
git commit -m "feat: expose publication proof operator workflow"
```

### Task 9: Client domain and React Query recovery

**Files:**
- Modify: `src/lib/activeMission.ts`
- Modify: `src/lib/activeMission.test.ts`
- Modify: `src/lib/activeMission.mixed.test.ts`
- Modify: `src/lib/queries/activeMission.ts`
- Modify: `src/lib/queries/activeMission.test.tsx`
- Modify: `src/lib/queries/activeMission.race.test.tsx`
- Modify: `src/lib/admin.ts`

**Interfaces:**
- Produces `MissionPublicationView`, `PublicationProofAttemptView`, `PublicationProofReviewView`, and proof mutations.
- Stale creator mutation replaces cached server state while returning unsent form values to the caller.

- [ ] **Step 1: Write failing client tests**

Test all new state labels/owners/actions, exact creator/operator URLs and bodies, collection invalidation without invalidating `me`, immutable history, and `WORKFLOW_STALE` cache replacement while preserving draft form input.

- [ ] **Step 2: Verify the tests fail**

Run: `npm.cmd test -- src/lib/activeMission.test.ts src/lib/activeMission.mixed.test.ts src/lib/queries/activeMission.test.tsx src/lib/queries/activeMission.race.test.tsx`

Expected: FAIL on missing publication types and hooks.

- [ ] **Step 3: Add client types and query functions**

Add camel-case read models and hooks `useMissionPublication`, `useProofEvidenceUpload`, `useSubmitPublicationProof`, `useStartProofReview`, `useRequestProofCorrection`, `useVerifyProof`, and `useRefreshProofMetadata`.

- [ ] **Step 4: Implement recoverable stale handling**

On a structured stale error, replace the publication cache with `details.currentPublication`, do not retry automatically, and return the submitted form snapshot so the route can ask the creator to review before resubmission.

- [ ] **Step 5: Run client tests**

Run: `npm.cmd test -- src/lib/activeMission.test.ts src/lib/activeMission.mixed.test.ts src/lib/queries/activeMission.test.tsx src/lib/queries/activeMission.race.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/activeMission.ts src/lib/activeMission.test.ts src/lib/activeMission.mixed.test.ts src/lib/queries/activeMission.ts src/lib/queries/activeMission.test.tsx src/lib/queries/activeMission.race.test.tsx src/lib/admin.ts
git commit -m "feat: add publication proof client contracts"
```

### Task 10: Creator publication experience

**Files:**
- Create: `src/components/active-mission/PublicationInstructions.tsx`
- Create: `src/components/active-mission/ProofSubmissionForm.tsx`
- Create: `src/components/active-mission/ProofAttemptHistory.tsx`
- Modify: `src/routes/_app.my.$submissionId.tsx`
- Modify: `src/routes/-_app.my.$submissionId.test.tsx`
- Modify: `src/components/active-mission/active-mission.test.tsx`

**Interfaces:**
- Consumes Task 9 hooks and read models.
- Produces the creator states for publish, submit, correction, metadata warning, and verified proof.

- [ ] **Step 1: Write failing creator UI tests**

Cover frozen platform/account/instructions/disclosures/deadline, one required URL, add/remove additional URLs, evidence required/optional, confirmation that validation issues no reward, metadata warning, categorized corrections and response deadline, read-only attempt history, verified message, first-invalid-field focus, live-region state change, 390 px stacking, and sticky primary action.

- [ ] **Step 2: Verify the tests fail**

Run: `npm.cmd test -- src/components/active-mission/active-mission.test.tsx src/routes/-_app.my.$submissionId.test.tsx`

Expected: FAIL because publication components do not exist.

- [ ] **Step 3: Build focused publication components**

Use semantic headings, labeled URL inputs, external links with `rel="noreferrer"`, an evidence upload status list, an explicit confirmation panel, and immutable history cards. Preserve form values after recoverable errors.

- [ ] **Step 4: Wire states into the existing route**

For `approved_to_publish` and `proof_correction_requested`, select **Publish and submit proof** as the primary action; for submitted/review states show operator ownership; for `proof_verified` focus the accepted-state heading and state exactly that reward processing is later.

- [ ] **Step 5: Run creator UI tests**

Run: `npm.cmd test -- src/components/active-mission/active-mission.test.tsx src/routes/-_app.my.$submissionId.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/active-mission/PublicationInstructions.tsx src/components/active-mission/ProofSubmissionForm.tsx src/components/active-mission/ProofAttemptHistory.tsx src/routes/_app.my.$submissionId.tsx src/routes/-_app.my.$submissionId.test.tsx src/components/active-mission/active-mission.test.tsx
git commit -m "feat: add creator publication proof experience"
```

### Task 11: Operator proof review experience

**Files:**
- Create: `src/components/admin/PublicationProofReview.tsx`
- Modify: `src/components/admin/ActiveMissionQueue.tsx`
- Modify: `src/routes/admin.active-missions.tsx`
- Modify: `src/routes/admin.active-missions.$workflowId.tsx`
- Modify: `src/components/admin/ActiveMissionReview.test.tsx`
- Modify: `src/routes/-admin.active-missions.test.tsx`

**Interfaces:**
- Consumes Task 9 admin functions and proof read models.
- Produces queue filtering and exact-attempt checklist/correction/verification UI.

- [ ] **Step 1: Write failing operator UI tests**

Cover server-order preservation; proof state/lateness/metadata/platform/deadline/mission/reviewer filters; approved draft and assets; instructions; safe URLs; bounded metadata; signed evidence; prior attempts; all six checklist keys; correction item validation; exact-attempt verify confirmation; stale navigation to current attempt; mobile sticky actions; and absence of reward controls.

- [ ] **Step 2: Verify the tests fail**

Run: `npm.cmd test -- src/components/admin/ActiveMissionReview.test.tsx src/routes/-admin.active-missions.test.tsx`

Expected: FAIL on missing proof review UI.

- [ ] **Step 3: Implement queue additions and review component**

Keep sorting on the server, apply filters only after explicit Apply, render late/metadata badges, and require the exact attempt number in verification confirmation. Disable decisions until review is claimed and checklist/correction contracts are valid.

- [ ] **Step 4: Wire route actions and stale recovery**

Bind claim, corrections, verification, instruction setup, and metadata refresh; send auth errors through `AdminAuthContext`; on stale conflict reload and select `currentProofAttemptId`.

- [ ] **Step 5: Run operator UI tests**

Run: `npm.cmd test -- src/components/admin/ActiveMissionReview.test.tsx src/routes/-admin.active-missions.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/PublicationProofReview.tsx src/components/admin/ActiveMissionQueue.tsx src/routes/admin.active-missions.tsx src/routes/admin.active-missions.$workflowId.tsx src/components/admin/ActiveMissionReview.test.tsx src/routes/-admin.active-missions.test.tsx
git commit -m "feat: add operator publication proof review"
```

### Task 12: Notifications, analytics, metrics, and bilingual copy

**Files:**
- Modify: `supabase/migrations/20260723090000_publication_proof_validation.sql`
- Modify: `server/test/notifications-triggers.test.ts`
- Modify: `server/lib/activeMission/metrics.ts`
- Modify: `server/lib/activeMission/metrics.test.ts`
- Modify: `src/lib/activationAnalytics.ts`
- Modify: `src/lib/notifications.ts`
- Modify: `src/lib/i18n.dict.ts`
- Modify: `src/components/active-mission/active-mission.i18n.test.tsx`

**Interfaces:**
- Produces publication-ready, approaching, overdue, correction, and verified in-app notifications.
- Produces the eight approved operational metrics without treating optional items or verification as reward completion.
- Produces the nine privacy-limited analytics events from the design.

- [ ] **Step 1: Write failing notification, metric, privacy, and locale tests**

Assert notification insertion failure does not roll back transitions; allowed analytics properties exclude authored content/identifiers; metrics calculate conversion, on-time, first-attempt, correction, attempts, median review time, metadata failure, and recovery rates; and every new English key has Traditional Chinese copy.

- [ ] **Step 2: Verify the tests fail**

Run: `npm.cmd test -- server/test/notifications-triggers.test.ts server/lib/activeMission/metrics.test.ts src/components/active-mission/active-mission.i18n.test.tsx`

Expected: FAIL on missing publication events, metrics, and keys.

- [ ] **Step 3: Implement best-effort notifications and privacy-safe analytics**

Emit only locale, mission type, platform, state, timing bucket, attempt/review number, evidence/URL counts, lateness, metadata status, checklist failure categories, and recovery category.

- [ ] **Step 4: Implement metrics and both locales**

Exclude optional items from completion denominators and never map `proof_verified` to reward completion. Add creator/operator error, status, checklist, correction, metadata, and confirmation strings to both dictionaries.

- [ ] **Step 5: Run focused tests**

Run: `npm.cmd test -- server/test/notifications-triggers.test.ts server/lib/activeMission/metrics.test.ts src/components/active-mission/active-mission.i18n.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260723090000_publication_proof_validation.sql server/test/notifications-triggers.test.ts server/lib/activeMission/metrics.ts server/lib/activeMission/metrics.test.ts src/lib/activationAnalytics.ts src/lib/notifications.ts src/lib/i18n.dict.ts src/components/active-mission/active-mission.i18n.test.tsx
git commit -m "feat: instrument publication proof operations"
```

### Task 13: Existing-approved setup and compatibility rollout

**Files:**
- Create: `supabase/migrations/20260723170000_publication_proof_rollout.sql`
- Modify: `server/routes/adminActiveMissions.ts`
- Modify: `server/test/active-mission-schema.test.ts`
- Modify: `server/test/active-missions.test.ts`
- Modify: `docs/operations/active-mission-workspace.md`

**Interfaces:**
- Produces `public.setup_existing_publication_instructions(p_workspace uuid, p_workflow uuid, p_work_item uuid, p_operator uuid, p_expected_state text, p_expected_revision integer, p_idempotency_key uuid, p_instructions jsonb)`.
- Only an existing `approved_to_publish` item without an attempt may use this one-time setup path.
- Produces a documented feature-disable rollback that preserves every Phase 3 record.

- [ ] **Step 1: Write failing rollout and regression tests**

Prove existing approved items expose `PUBLICATION_SETUP_REQUIRED`, no defaults are inferred, explicit instructions freeze immediately, setup is idempotent, items with attempts cannot rewind, legacy `content_urls` and reward approval still work, and all Phase 2 transitions retain their original contracts.

- [ ] **Step 2: Verify the tests fail**

Run: `npm.cmd test -- server/test/active-mission-schema.test.ts server/test/active-missions.test.ts`

Expected: FAIL because the explicit setup RPC is absent.

- [ ] **Step 3: Implement one-time setup and rollback guards**

Lock the workflow/item, require `approved_to_publish`, require no instruction or attempt, validate explicit operator-authored policy, freeze immediately, emit an audit event without sensitive fields, and reject all other states.

- [ ] **Step 4: Document operations**

Document how to find blocked approved items, apply explicit setup, prioritize overdue proof, retry metadata, disable proof mutations/queue actions, preserve verified records, and confirm reward/status neutrality.

- [ ] **Step 5: Run rollout and Phase 2 regression tests**

Run: `npm.cmd run test:active-missions`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260723170000_publication_proof_rollout.sql server/routes/adminActiveMissions.ts server/test/active-mission-schema.test.ts server/test/active-missions.test.ts docs/operations/active-mission-workspace.md
git commit -m "feat: add publication proof rollout controls"
```

### Task 14: Clean integration, static, build, and browser acceptance

**Files:**
- Modify only files implicated by failures in this task; keep each correction in its owning task’s file.

**Interfaces:**
- Produces the release evidence required by the approved design.

- [ ] **Step 1: Replay and run the live integration suite**

Start a clean local Supabase stack, reset migrations/seeds, then run with the exact environment variable:

```powershell
$env:RUN_INTEGRATION='1'
$env:SUPABASE_SERVICE_KEY=(supabase status -o env | Select-String '^SERVICE_ROLE_KEY=').ToString().Split('=',2)[1].Trim('"')
npm.cmd run test:integration
```

Expected: output confirms `RUN_INTEGRATION=1`, live Phase 3 cases execute rather than skip, and all integration tests pass.

- [ ] **Step 2: Run focused and full repository verification**

Run:

```powershell
npm.cmd run test:active-missions
npm.cmd test
npm.cmd run lint
npm.cmd run type-check
npm.cmd run build
```

Expected: every command exits 0; the production build completes without ESM-extension, generated-route, TypeScript, or Vite errors.

- [ ] **Step 3: Run creator browser acceptance at 390x844**

Verify approved instructions, URL/evidence validation, submission, metadata-unavailable warning, correction resubmission, immutable history, verified message, keyboard completion, visible focus, live announcements, sticky action, and no horizontal page overflow.

- [ ] **Step 4: Run operator browser acceptance at 1440x900**

Verify filters and canonical ordering, explicit setup for an existing approved item, exact-attempt claim/checklist/correction/verify, private evidence link, stale recovery, metadata refresh, no reward control, and no horizontal page overflow.

- [ ] **Step 5: Review persisted boundaries**

Query the exercised submission, points, XP, earnings, rewards, and workspace budget before and after proof verification; expected values are unchanged while the work item/workflow end at `proof_verified`.

- [ ] **Step 6: Confirm verification left no unreviewed changes**

```bash
git status --short
```

Expected: no output. If verification exposed a defect, return to the task that owns that file, add a failing regression test there, complete that task's red-green cycle, and rerun all six verification steps.

---

## Final Completion Checklist

- [ ] New active-workspace deliverables receive complete publication instructions and freeze them on approval.
- [ ] Existing approved items require explicit operator setup.
- [ ] Creator proof attempts are normalized, numbered, tenant-bound, immutable, and checksum-idempotent.
- [ ] Unsafe destinations are rejected before private/reserved network access.
- [ ] Metadata failure preserves a reviewable attempt.
- [ ] Evidence is private, finalized, owned, and atomically bound.
- [ ] Review claim, correction, and verification target the exact current attempt.
- [ ] Corrections create a new attempt and a future response deadline.
- [ ] Late proof remains submittable and receives canonical queue priority.
- [ ] Required items alone govern aggregate `proof_verified`.
- [ ] Notifications are best-effort and analytics are content-free.
- [ ] Legacy and Phase 2 behavior pass regression coverage.
- [ ] Proof verification changes no submission, reward, points, XP, earnings, or budget state.
- [ ] Live integration, full tests, lint, type-check, build, and both browser viewports pass.
