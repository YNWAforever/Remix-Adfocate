# Adfocate Active Mission Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the mobile-first creator and operator workflow from accepted mission through per-deliverable approval to publish without crossing the existing publication-proof and reward boundary.

**Architecture:** Add normalized `mission_workflow` records beside `mission_submissions`, with transactional SQL functions owning every state transition and an append-only event log. Creator routes use the existing workspace-authenticated Hono tree; operator routes use the existing admin-authenticated tree; React Query read models power focused creator and admin interfaces. The existing legacy submit/approve functions remain the only reward path.

**Tech Stack:** PostgreSQL/Supabase migrations and RLS, Supabase Storage, TypeScript 5.8, Hono 4, React 19, TanStack Router/Query, Vitest, Testing Library, Tailwind CSS.

## Global Constraints

- `mission_submissions` remains the ownership and final reward anchor; active-workspace rows stay `joined` throughout Phase 2.
- No fulfilment, draft, review, revision, grant, or approve-to-publish operation may change creator points, XP, earnings, workspace budget, or `mission_submissions.status`.
- `creator_workflow_mode` defaults to `legacy`; only explicitly enabled missions use the new workflow.
- Legacy `PUT /missions/:slug/submit` returns `409 WORKFLOW_MODE_MISMATCH` for active-workspace missions before calling `submit_mission`.
- Overall workflow state is derived from fulfilment and work-item truth and materialized only inside the same transaction as a transition.
- Submitted versions, completed reviews, revision grants, and workflow events are append-only.
- Every creator and operator query is scoped by `workspace_id`; creator asset paths are additionally scoped by creator ID, workflow ID, and work-item ID.
- Attachments are private images or videos, at most 20 MB each and five assets per draft version; signed upload grants expire after 10 minutes.
- Autosave uses optimistic concurrency through an integer `revision`; stale writes return `409 WORKFLOW_STALE` and the current server draft.
- Revision limit defaults to `2`; a further revision requires an append-only operator grant with a non-empty reason.
- Analytics payloads contain workflow state, mission type, timing buckets, and counts only; never creator-authored copy, URLs, filenames, or direct creator identifiers.
- Notifications are in-app and best-effort; notification insertion failure never rolls back a workflow transition.
- The primary metric is required workflows approved to publish on or before their snapshotted deadline divided by required workflows due in the selected period.
- Preserve existing Cantonese UI conventions and provide English and Traditional Chinese translation keys for every new visible string.
- Do not migrate legacy records in `submitted`, `under_review`, `approved`, `rejected`, `declined`, or `expired`; only pristine `joined` records may be explicitly migrated.

---

## File Structure

### Database and server

- Create `supabase/migrations/20260715090000_active_mission_workspace.sql`: mission policy fields, templates, workflow tables, private bucket policies, indexes, transition functions, event and notification helpers, and legacy-submit guard.
- Create `server/lib/activeMission/types.ts`: shared server domain literals, request shapes, and read-model types.
- Create `server/lib/activeMission/errors.ts`: canonical error codes and Hono response mapping.
- Create `server/lib/activeMission/state.ts`: pure overall-state derivation, validation, and review-queue sorting.
- Create `server/lib/activeMission/repo.ts`: workspace-scoped reads and RPC wrappers.
- Create `server/lib/activeMission/assets.ts`: MIME/size/path validation and signed upload/finalize behavior.
- Create `server/routes/activeMissions.ts`: creator workspace endpoints.
- Create `server/routes/adminActiveMissions.ts`: operator queue, detail, fulfilment, review, revision, grant, and approval endpoints.
- Modify `server/routes/missions.ts`: reject legacy submission for active-workspace missions.
- Modify `server/routes/admin.ts`: mount active-mission operator endpoints and accept mission policy/templates during authoring.
- Modify `server/app.ts`: mount creator `/my-missions` routes.
- Modify `server/test/helpers.ts`: seed active mission templates/workflows.
- Create `server/test/active-mission-schema.test.ts`: schema, constraints, RLS, append-only, and reward-boundary integration coverage.
- Create `server/test/active-missions.test.ts`: creator and operator API lifecycle integration coverage.
- Modify `server/test/missions.test.ts`, `server/test/admin.test.ts`, `server/test/applications.test.ts`, and `server/test/notifications-triggers.test.ts`: rollout, creation, accepted-application, legacy guard, and notification regressions.

### Client

- Create `src/lib/activeMission.ts`: public client types, state labels, next-action derivation, and API error parsing.
- Create `src/lib/queries/activeMission.ts`: creator workspace queries and mutations.
- Modify `src/lib/admin.ts`: authoring fields plus operator queue/detail/actions.
- Modify `src/lib/queries/kocmax.ts`: expose workflow mode in mission and my-mission records; retain legacy mutation only for legacy mode.
- Modify `src/lib/activationAnalytics.ts`: typed privacy-limited Phase 2 events.
- Modify `src/lib/notifications.ts`: workflow notification types, links, icons, and interpolation values.
- Modify `src/lib/i18n.ts`: English and Traditional Chinese workflow strings.
- Create `src/components/active-mission/WorkspaceHeader.tsx`: state, owner, deadline, and single next action.
- Create `src/components/active-mission/FulfillmentCard.tsx`: shipment state and receipt confirmation.
- Create `src/components/active-mission/DeliverableNavigator.tsx`: per-deliverable progress and selection.
- Create `src/components/active-mission/DraftEditor.tsx`: autosaved copy, URL, checklist, and assets.
- Create `src/components/active-mission/ReviewFeedback.tsx`: structured feedback and revision deadline.
- Create `src/components/active-mission/VersionTimeline.tsx`: immutable versions and append-only events.
- Create `src/routes/_app.my.$submissionId.tsx`: creator workspace route.
- Modify `src/routes/_app.my.tsx`, `src/routes/_app.home.tsx`, and `src/routes/_app.mission.$missionSlug.tsx`: entry points and active/legacy branching.
- Create `src/components/admin/ActiveMissionQueue.tsx`: deadline/SLA-prioritized operator queue.
- Create `src/components/admin/ActiveMissionReview.tsx`: brief/version comparison and structured decisions.
- Create `src/routes/admin.active-missions.tsx` and `src/routes/admin.active-missions.$workflowId.tsx`: operator routes.
- Modify `src/components/admin/MissionEditor.tsx` and admin navigation: policy/template authoring and queue access.
- Add colocated Vitest/Testing Library files for every new pure module, component, and route.

---

### Task 1: Database foundation and invariant guards

**Files:**
- Create: `supabase/migrations/20260715090000_active_mission_workspace.sql`
- Create: `server/test/active-mission-schema.test.ts`
- Modify: `server/test/helpers.ts`

**Interfaces:**
- Produces PostgreSQL enums/checks and the tables named in File Structure.
- Produces `public.create_mission_workflow(p_submission uuid)` and `public.refresh_mission_workflow_state(p_workflow uuid)`.
- Produces private bucket `mission-draft-assets`.

- [ ] **Step 1: Write the failing schema test**

```ts
it("creates an active workflow without changing the reward anchor", async () => {
  const { mission, creator, submission } = await seedActiveMission(db, {
    fulfillmentRequired: false,
    deliverables: [{ title: "Instagram Reel", platform: "instagram", required: true }],
  });
  const before = await creatorBalances(db, creator.id);
  const workflow = await rpcAs(db, creator.id, "create_mission_workflow", { p_submission: submission.id });
  const anchor = await row(db, "mission_submissions", submission.id);
  expect(workflow.state).toBe("drafting");
  expect(anchor.status).toBe("joined");
  expect(await creatorBalances(db, creator.id)).toEqual(before);
  expect(await rows(db, "mission_work_items", { mission_workflow_id: workflow.id })).toHaveLength(1);
  expect(mission.creator_workflow_mode).toBe("active_workspace");
});
```

- [ ] **Step 2: Run it and confirm the missing-schema failure**

Run: `npx vitest run server/test/active-mission-schema.test.ts`

Expected: FAIL with relation/column `mission_workflows` or `creator_workflow_mode` missing.

- [ ] **Step 3: Add mission policy, templates, workflow tables, indexes, and RLS**

```sql
alter table public.missions
  add column creator_workflow_mode text not null default 'legacy'
    check (creator_workflow_mode in ('legacy','active_workspace')),
  add column fulfillment_required boolean not null default false,
  add column revision_limit smallint not null default 2 check (revision_limit >= 0),
  add column review_sla_hours integer not null default 48 check (review_sla_hours > 0),
  add column revision_response_hours integer not null default 48 check (revision_response_hours > 0);

create table public.mission_workflows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  mission_submission_id uuid not null unique references public.mission_submissions(id),
  state text not null check (state in ('accepted','fulfillment_pending','drafting','in_review','revision_requested','approved_to_publish','cancelled','expired')),
  accepted_at timestamptz not null,
  deadline timestamptz,
  fulfillment_required boolean not null,
  revision_limit smallint not null,
  review_sla_hours integer not null,
  revision_response_hours integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

In the same migration, create every remaining table from the approved spec with workspace foreign keys, immutable-version uniqueness `(mission_work_item_id, version_number)`, a partial uniqueness constraint for one mutable draft per work item, event indexes `(mission_workflow_id, created_at, id)`, queue indexes on work-item state/deadline/review timestamps, and creator self-read policies. Grant all tables/functions to `service_role`; grant creator reads only through ownership joins or guarded server routes.

- [ ] **Step 4: Add workflow creation and state refresh transaction functions**

```sql
create or replace function public.refresh_mission_workflow_state(p_workflow uuid)
returns public.mission_workflows language plpgsql security definer set search_path=public as $$
declare v public.mission_workflows; v_state text;
begin
  select * into v from mission_workflows where id=p_workflow for update;
  if exists(select 1 from mission_fulfillments where mission_workflow_id=v.id and status<>'received') then v_state:='fulfillment_pending';
  elsif not exists(select 1 from mission_work_items where mission_workflow_id=v.id and required and state<>'approved_to_publish') then v_state:='approved_to_publish';
  elsif exists(select 1 from mission_work_items where mission_workflow_id=v.id and state='revision_requested') then v_state:='revision_requested';
  elsif exists(select 1 from mission_work_items where mission_workflow_id=v.id and state in ('submitted','under_review')) then v_state:='in_review';
  else v_state:='drafting'; end if;
  update mission_workflows set state=v_state,updated_at=now() where id=v.id returning * into v;
  return v;
end $$;
```

`create_mission_workflow` must lock the submission, require its status to be `joined`, require the mission mode to be `active_workspace`, snapshot mission policies/templates/requirements, create at least one required work item, create fulfilment only when required, append `workflow_created`, and return the refreshed workflow. Make the unique submission constraint provide idempotency by returning the existing workflow.

- [ ] **Step 5: Add private storage and append-only protection**

Create the private bucket with a 20 MB limit and image/video MIME allow-list. Add `before update or delete` trigger functions that raise `immutable_record` for `mission_draft_versions`, completed `mission_review_rounds`, `mission_revision_grants`, and `mission_workflow_events`; allow only asset retention metadata to change after finalize.

- [ ] **Step 6: Run schema and baseline integration tests**

Run: `npx vitest run server/test/active-mission-schema.test.ts server/test/missions.test.ts server/test/campaigns.test.ts --no-file-parallelism`

Expected: PASS; the active test proves balances and anchor status are unchanged.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260715090000_active_mission_workspace.sql server/test/active-mission-schema.test.ts server/test/helpers.ts
git commit -m "feat: add active mission workflow schema"
```

### Task 2: Domain state, validation, and errors

**Files:**
- Create: `server/lib/activeMission/types.ts`
- Create: `server/lib/activeMission/errors.ts`
- Create: `server/lib/activeMission/state.ts`
- Create: `server/lib/activeMission/state.test.ts`

**Interfaces:**
- Produces `WorkflowErrorCode`, `ActiveMissionError`, `deriveWorkflowState`, `assertTransition`, `validateDraftPatch`, and `compareQueueItems`.

- [ ] **Step 1: Write failing pure-domain tests**

```ts
expect(deriveWorkflowState({ fulfillment: "shipped", requiredStates: ["drafting"] })).toBe("fulfillment_pending");
expect(deriveWorkflowState({ fulfillment: null, requiredStates: ["approved_to_publish","drafting"] })).toBe("drafting");
expect(deriveWorkflowState({ fulfillment: null, requiredStates: ["approved_to_publish"] })).toBe("approved_to_publish");
expect(() => assertTransition("approved_to_publish", "drafting")).toThrowError(/WRONG_STATE/);
expect(compareQueueItems({ deadline:"2026-07-16T00:00:00Z", reviewDueAt:null }, { deadline:"2026-07-17T00:00:00Z", reviewDueAt:null })).toBeLessThan(0);
```

- [ ] **Step 2: Verify failure**

Run: `npx vitest run server/lib/activeMission/state.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement exact public types and error mapping**

```ts
export type WorkflowErrorCode = "WORKFLOW_NOT_FOUND"|"WORKFLOW_MODE_MISMATCH"|"WORKFLOW_STALE"|"WRONG_STATE"|"REVISION_LIMIT_REACHED"|"DEADLINE_PASSED"|"VALIDATION_FAILED"|"ASSET_UPLOAD_FAILED"|"NOT_AUTHORIZED"|"RATE_LIMITED"|"UNKNOWN";
export class ActiveMissionError extends Error {
  constructor(public code: WorkflowErrorCode, message: string, public details?: unknown) { super(message); }
}
export const statusFor = (code: WorkflowErrorCode) => ({WORKFLOW_NOT_FOUND:404,WORKFLOW_MODE_MISMATCH:409,WORKFLOW_STALE:409,WRONG_STATE:409,REVISION_LIMIT_REACHED:409,DEADLINE_PASSED:409,VALIDATION_FAILED:400,ASSET_UPLOAD_FAILED:422,NOT_AUTHORIZED:403,RATE_LIMITED:429,UNKNOWN:500})[code];
```

Implement transition sets exactly as specified, validate `caption <= 10_000`, HTTP(S) external URLs, boolean checklist values for known requirement IDs, and sort queue entries by creator deadline, then review SLA due time, then submission time.

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/lib/activeMission/state.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/activeMission
git commit -m "feat: define active mission domain rules"
```

### Task 3: Workflow creation at assignment acceptance and legacy guard

**Files:**
- Modify: `server/routes/missions.ts`
- Modify: `server/routes/admin.ts`
- Modify: `server/test/missions.test.ts`
- Modify: `server/test/applications.test.ts`

**Interfaces:**
- Consumes `create_mission_workflow` from Task 1.
- Produces `409 { code: "WORKFLOW_MODE_MISMATCH" }` on legacy submit mismatch.

- [ ] **Step 1: Add failing direct-join, accepted-application, and legacy-submit tests**

```ts
expect((await joinActiveMission()).workflow.state).toBe("drafting");
expect((await acceptActiveApplication()).workflow.mission_submission_id).toBe(application.id);
const response = await creator.put(`/api/missions/${mission.slug}/submit`, { content_urls:["https://example.com/post"] });
expect(response.status).toBe(409);
expect(await response.json()).toMatchObject({ code:"WORKFLOW_MODE_MISMATCH" });
expect(await creatorBalances(db, creatorId)).toEqual(before);
```

- [ ] **Step 2: Verify the tests fail**

Run: `npx vitest run server/test/missions.test.ts server/test/applications.test.ts --no-file-parallelism`

Expected: FAIL because no workflow is created and legacy submission succeeds.

- [ ] **Step 3: Call workflow creation after ownership is established**

After direct `join_mission` and after admin `accept_application`, fetch the mission mode. For `active_workspace`, call `create_mission_workflow` with the returned submission ID and include `{ submission, workflow }` in the response. Before legacy `submit_mission`, fetch mode and return the mismatch response without invoking the RPC.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run server/test/missions.test.ts server/test/applications.test.ts --no-file-parallelism`

Expected: PASS, including unchanged XP/points assertions.

- [ ] **Step 5: Commit**

```bash
git add server/routes/missions.ts server/routes/admin.ts server/test/missions.test.ts server/test/applications.test.ts
git commit -m "feat: create workflows for active mission assignments"
```

### Task 4: Creator workspace read, fulfilment, and autosave APIs

**Files:**
- Create: `server/lib/activeMission/repo.ts`
- Create: `server/routes/activeMissions.ts`
- Modify: `server/app.ts`
- Create: `server/test/active-missions.test.ts`

**Interfaces:**
- Produces `GET /api/my-missions/:submissionId/workspace`.
- Produces `PATCH /api/my-missions/:submissionId/work-items/:workItemId/draft`.
- Produces `POST /api/my-missions/:submissionId/fulfillment/received`.

- [ ] **Step 1: Write failing ownership, receipt, and concurrency tests**

```ts
expect((await otherCreator.get(`/api/my-missions/${submission.id}/workspace`)).status).toBe(404);
const saved = await creator.patch(draftPath, { revision:0, caption:"First draft", externalUrl:null, checklist:{} });
expect(saved.body.draft).toMatchObject({ caption:"First draft", revision:1 });
const stale = await creator.patch(draftPath, { revision:0, caption:"stale", externalUrl:null, checklist:{} });
expect(stale.status).toBe(409);
expect(stale.body).toMatchObject({ code:"WORKFLOW_STALE", currentDraft:{ revision:1 } });
expect((await creator.post(receiptPath, {})).body.workflow.state).toBe("drafting");
```

- [ ] **Step 2: Verify failure**

Run: `npx vitest run server/test/active-missions.test.ts -t "workspace read|autosave|receipt" --no-file-parallelism`

Expected: FAIL with 404 route responses.

- [ ] **Step 3: Implement the read model and routes**

```ts
export type ActiveMissionWorkspace = {
  workflow: MissionWorkflow;
  mission: { id:string; slug:string; title:string; missionType:string; brief:MissionBriefSnapshot };
  fulfillment: MissionFulfillment|null;
  workItems: MissionWorkItemView[];
  events: MissionWorkflowEvent[];
  nextAction: { kind:string; workItemId:string|null; deadline:string|null; blockedReason:string|null };
};
```

Use `serviceClient` reads constrained by submission ID, `creator_id=c.get("userId")`, and `workspace_id=c.get("workspaceId")`. Implement autosave as one conditional update on `revision`; zero updated rows triggers a reread and `WORKFLOW_STALE`. Receipt requires `shipped`, updates all blocked items to `drafting`, appends an event, and refreshes overall state in one RPC transaction.

- [ ] **Step 4: Mount and verify**

Add `guarded.route("/my-missions", activeMissionRoutes)` in `server/app.ts`.

Run: `npx vitest run server/test/active-missions.test.ts -t "workspace read|autosave|receipt" --no-file-parallelism`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/activeMission/repo.ts server/routes/activeMissions.ts server/app.ts server/test/active-missions.test.ts
git commit -m "feat: add creator active mission APIs"
```

### Task 5: Private draft asset upload and finalize

**Files:**
- Create: `server/lib/activeMission/assets.ts`
- Create: `server/lib/activeMission/assets.test.ts`
- Modify: `server/routes/activeMissions.ts`
- Modify: `server/test/active-missions.test.ts`

**Interfaces:**
- Produces `validateDraftAsset`, `ownedDraftAssetPath`, `createUploadGrant`, and `finalizeDraftAsset`.
- Produces upload-grant and finalize endpoints from the design.

- [ ] **Step 1: Write failing validation and ownership tests**

```ts
expect(validateDraftAsset({fileName:"draft.mp4",contentType:"video/mp4",sizeBytes:20_000_000}).extension).toBe("mp4");
expect(() => validateDraftAsset({fileName:"x.exe",contentType:"application/x-msdownload",sizeBytes:1})).toThrowError(/VALIDATION_FAILED/);
expect(() => ownedDraftAssetPath("creator-a","workflow-a","item-a","item-b/file.jpg")).toThrowError(/NOT_AUTHORIZED/);
```

- [ ] **Step 2: Verify failure**

Run: `npx vitest run server/lib/activeMission/assets.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement private upload grants**

```ts
export const ALLOWED_DRAFT_MIME = ["image/jpeg","image/png","image/webp","video/mp4","video/quicktime"] as const;
export const MAX_DRAFT_ASSET_BYTES = 20_971_520;
export function draftAssetPath(creatorId:string, workflowId:string, workItemId:string, assetId:string, ext:string) {
  return `${creatorId}/${workflowId}/${workItemId}/${assetId}.${ext}`;
}
```

The grant route verifies ownership and fewer than five non-deleted draft assets, inserts `uploading`, and calls `createSignedUploadUrl(path, { upsert:false })`. Finalize verifies the exact path, reads object metadata, rejects MIME/size mismatch, and changes the row to `ready`; it never makes the bucket public.

- [ ] **Step 4: Run unit and integration tests**

Run: `npx vitest run server/lib/activeMission/assets.test.ts server/test/active-missions.test.ts -t "asset" --no-file-parallelism`

Expected: PASS, including cross-creator 404 and oversize 400 cases.

- [ ] **Step 5: Commit**

```bash
git add server/lib/activeMission/assets.ts server/lib/activeMission/assets.test.ts server/routes/activeMissions.ts server/test/active-missions.test.ts
git commit -m "feat: add private mission draft assets"
```

### Task 6: Immutable submission versions

**Files:**
- Modify: `supabase/migrations/20260715090000_active_mission_workspace.sql`
- Modify: `server/routes/activeMissions.ts`
- Modify: `server/test/active-missions.test.ts`

**Interfaces:**
- Produces `public.submit_mission_work_item(p_work_item uuid, p_expected_revision integer)`.
- Produces creator submit endpoint.

- [ ] **Step 1: Write failing submission tests**

```ts
const first = await creator.post(`${itemPath}/submit`, { expectedRevision:2 });
expect(first.body.version).toMatchObject({ versionNumber:1, caption:"Locked copy" });
expect(first.body.workItem.state).toBe("submitted");
await creator.patch(draftPath, { revision:2, caption:"new working copy", checklist:validChecklist });
expect((await getVersion(first.body.version.id)).caption).toBe("Locked copy");
expect((await creator.post(`${itemPath}/submit`, { expectedRevision:3 })).body.version.versionNumber).toBe(2);
```

- [ ] **Step 2: Verify failure**

Run: `npx vitest run server/test/active-missions.test.ts -t "immutable submission" --no-file-parallelism`

Expected: FAIL because submit route/RPC is absent.

- [ ] **Step 3: Implement the transactional submit RPC**

Lock the work item and draft; require `drafting` or `revision_requested`, matching revision, all required checklist values true, and at least one of caption, external URL, or ready asset. Compute `digest(caption || external_url || checklist || ordered asset checksums, 'sha256')`; return the existing latest version when the checksum matches. Otherwise insert the next version, attach selected ready assets, set work item `submitted` and `current_submitted_version_id`, append `draft_submitted`, and refresh the workflow. Do not update `mission_submissions` or `creators`.

- [ ] **Step 4: Verify immutability and reward boundary**

Run: `npx vitest run server/test/active-missions.test.ts -t "immutable submission|reward boundary" --no-file-parallelism`

Expected: PASS; direct version update raises `immutable_record`; balances and anchor status equal their pre-submit values.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260715090000_active_mission_workspace.sql server/routes/activeMissions.ts server/test/active-missions.test.ts
git commit -m "feat: submit immutable mission draft versions"
```

### Task 7: Operator queue, claim, revision, grant, and approval APIs

**Files:**
- Create: `server/routes/adminActiveMissions.ts`
- Modify: `server/routes/admin.ts`
- Modify: `supabase/migrations/20260715090000_active_mission_workspace.sql`
- Modify: `server/test/active-missions.test.ts`

**Interfaces:**
- Produces all `/api/admin/active-missions` endpoints in the design.
- Produces RPCs `start_mission_review`, `request_mission_revision`, `grant_mission_revision`, `approve_mission_version`, and `mark_mission_fulfillment_shipped`.

- [ ] **Step 1: Write failing operator lifecycle tests**

```ts
expect((await admin.get("/api/admin/active-missions/queue")).body.items[0].workItemId).toBe(urgent.id);
expect((await admin.post(`${workflowPath}/work-items/${item.id}/start-review`,{})).body.workItem.state).toBe("under_review");
expect((await admin.post(`${workflowPath}/work-items/${item.id}/request-revision`,{versionId,deadline,items:[{requirementId:null,category:"quality",text:"Show the product in the first three seconds",required:true}]})).body.workItem.state).toBe("revision_requested");
expect((await thirdRevisionWithoutGrant()).body.code).toBe("REVISION_LIMIT_REACHED");
expect((await grantRevision({reason:"Brand brief changed after acceptance"})).status).toBe(200);
expect((await approveExactVersion()).body.workItem.approvedVersionId).toBe(versionId);
```

- [ ] **Step 2: Verify route failures**

Run: `npx vitest run server/test/active-missions.test.ts -t "operator" --no-file-parallelism`

Expected: FAIL with missing routes.

- [ ] **Step 3: Implement SQL transitions**

Each RPC locks the workflow/work item/version, verifies workspace membership supplied by the service route, validates the exact allowed source state, writes the review/grant/event rows, and calls `refresh_mission_workflow_state`. Revision requires at least one non-empty required-change item and a future deadline; its round number is completed rounds + 1. Approval requires the latest submitted immutable version and never consumes a round. Shipped requires `preparing` and stores operator/timestamp/note.

- [ ] **Step 4: Implement admin routes and stable queue response**

Use existing admin middleware and `serviceClient`; never accept workspace ID from the body. Queue items expose workflow/work-item IDs, creator display name, mission title, state, creator deadline, submitted time, review SLA due time, reviewer, and risk bucket, but no private asset URL. Detail returns signed asset read URLs expiring in 10 minutes only after authorization.

- [ ] **Step 5: Run lifecycle tests**

Run: `npx vitest run server/test/active-missions.test.ts --no-file-parallelism`

Expected: PASS through fulfilment, two revisions, granted third revision, per-item approval, and all-items overall approval.

- [ ] **Step 6: Commit**

```bash
git add server/routes/adminActiveMissions.ts server/routes/admin.ts supabase/migrations/20260715090000_active_mission_workspace.sql server/test/active-missions.test.ts
git commit -m "feat: add active mission operator review APIs"
```

### Task 8: Mission authoring policy and deliverable templates

**Files:**
- Modify: `server/routes/admin.ts`
- Modify: `src/lib/admin.ts`
- Modify: `src/components/admin/MissionEditor.tsx`
- Modify: `src/routes/-admin.missions.manage.test.tsx`
- Modify: `server/test/admin.test.ts`

**Interfaces:**
- Produces `MissionWorkflowPolicyInput` and `MissionDeliverableTemplateInput`.

- [ ] **Step 1: Write failing API and editor tests**

```ts
expect(created).toMatchObject({creator_workflow_mode:"active_workspace",fulfillment_required:true,revision_limit:2,review_sla_hours:48,revision_response_hours:48});
expect(created.deliverable_templates[0].requirements[0]).toMatchObject({category:"compliance",required:true});
expect(screen.getByLabelText("Creator workflow")).toHaveValue("legacy");
await user.selectOptions(screen.getByLabelText("Creator workflow"), "active_workspace");
expect(screen.getByRole("button",{name:"Add deliverable"})).toBeEnabled();
```

- [ ] **Step 2: Verify failure**

Run: `npx vitest run server/test/admin.test.ts src/routes/-admin.missions.manage.test.tsx --no-file-parallelism`

Expected: FAIL because new fields and controls are absent.

- [ ] **Step 3: Extend exact authoring types and validation**

```ts
export type MissionWorkflowPolicyInput = { creator_workflow_mode:"legacy"|"active_workspace"; fulfillment_required:boolean; revision_limit:number; review_sla_hours:number; revision_response_hours:number };
export type MissionDeliverableTemplateInput = { id?:string; title:string; platform:string|null; position:number; required:boolean; draft_due_offset_hours:number; requirements:{id?:string;category:"format"|"key_message"|"compliance"|"quality"|"other";text:string;required:boolean;position:number}[] };
```

Validate title, at least one required deliverable in active mode, non-negative offsets/limits, positive SLA hours, and unique positions. Upsert templates and requirements inside the same admin transaction as mission save; reject template removal when an existing workflow snapshots it.

- [ ] **Step 4: Add editor controls and save payload**

Place the workflow selector above deliverables. Show fulfilment, revision, review, response-SLA, deliverable, and checklist controls only in active mode; preserve legacy `deliverables`/`requirements` fields for legacy mode.

- [ ] **Step 5: Run tests**

Run: `npx vitest run server/test/admin.test.ts src/routes/-admin.missions.manage.test.tsx --no-file-parallelism`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routes/admin.ts src/lib/admin.ts src/components/admin/MissionEditor.tsx src/routes/-admin.missions.manage.test.tsx server/test/admin.test.ts
git commit -m "feat: author active mission workflow policies"
```

### Task 9: Client domain and React Query layer

**Files:**
- Create: `src/lib/activeMission.ts`
- Create: `src/lib/activeMission.test.ts`
- Create: `src/lib/queries/activeMission.ts`
- Create: `src/lib/queries/activeMission.test.tsx`
- Modify: `src/lib/queries/kocmax.ts`

**Interfaces:**
- Produces `ActiveMissionWorkspace`, `deriveNextAction`, `useActiveMissionWorkspace`, `useSaveMissionDraft`, `useConfirmMissionReceipt`, `useCreateDraftAssetGrant`, `useFinalizeDraftAsset`, and `useSubmitMissionWorkItem`.

- [ ] **Step 1: Write failing next-action and cache tests**

```ts
expect(deriveNextAction(workspace({state:"revision_requested"}))).toEqual({kind:"revise",workItemId:"item-1",deadline:"2026-07-17T00:00:00Z",blockedReason:null});
await save.mutateAsync({workItemId:"item-1",revision:3,caption:"copy",externalUrl:null,checklist:{}});
expect(queryClient.getQueryData(["active-mission","sub-1"])).toMatchObject({workItems:[{draft:{revision:4}}]});
```

- [ ] **Step 2: Verify failure**

Run: `npx vitest run src/lib/activeMission.test.ts src/lib/queries/activeMission.test.tsx`

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement types, errors, and mutations**

Use the exact server read-model names. Autosave optimistically updates the cache, rolls back network/validation errors, and replaces local draft with `currentDraft` on `WORKFLOW_STALE` while surfacing a conflict banner. Receipt/submission invalidate `["active-mission", submissionId]`, `["my-missions"]`, and `["missions"]`; they must not invalidate `["me"]` because Phase 2 awards no XP.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/activeMission.test.ts src/lib/queries/activeMission.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/activeMission.ts src/lib/activeMission.test.ts src/lib/queries/activeMission.ts src/lib/queries/activeMission.test.tsx src/lib/queries/kocmax.ts
git commit -m "feat: add active mission client data layer"
```

### Task 10: Creator workspace components

**Files:**
- Create: `src/components/active-mission/WorkspaceHeader.tsx`
- Create: `src/components/active-mission/FulfillmentCard.tsx`
- Create: `src/components/active-mission/DeliverableNavigator.tsx`
- Create: `src/components/active-mission/DraftEditor.tsx`
- Create: `src/components/active-mission/ReviewFeedback.tsx`
- Create: `src/components/active-mission/VersionTimeline.tsx`
- Create: `src/components/active-mission/active-mission.test.tsx`

**Interfaces:**
- Consumes Task 9 types/hooks.
- Produces accessible, mobile-first presentational/workflow components.

- [ ] **Step 1: Write failing interaction/accessibility tests**

```tsx
render(<DraftEditor item={revisionItem} onSave={onSave} onSubmit={onSubmit} />);
expect(screen.getByRole("heading",{name:"Changes requested"})).toBeVisible();
await user.type(screen.getByLabelText("Caption or copy"), " updated");
await vi.advanceTimersByTimeAsync(800);
expect(onSave).toHaveBeenCalledWith(expect.objectContaining({caption:"Draft updated"}));
expect(screen.getByRole("button",{name:"Submit version"})).toBeDisabled();
await user.click(screen.getByRole("checkbox",{name:/Show the product/}));
expect(screen.getByRole("button",{name:"Submit version"})).toBeEnabled();
```

- [ ] **Step 2: Verify failure**

Run: `npx vitest run src/components/active-mission/active-mission.test.tsx`

Expected: FAIL because components do not exist.

- [ ] **Step 3: Implement header, fulfilment, and navigator**

Render exactly one primary CTA from `nextAction`, with state label, responsible party, deadline, and blocking reason. Use a horizontal scrollable deliverable list on mobile and vertical sidebar at `md`; expose `aria-current` for selection and text status beyond color.

- [ ] **Step 4: Implement draft, feedback, and history**

Debounce autosave by 800 ms, announce `Saving`, `Saved`, and conflict states through `aria-live`, preserve local values on failures, validate file MIME/size before upload, and show per-file retry. Show required-change items next to the matching checklist requirement. Render versions/events newest-first with exact version number and decision timestamps; never label approve-to-publish as completed or rewarded.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/components/active-mission/active-mission.test.tsx`

Expected: PASS, with keyboard navigation and live-region assertions.

- [ ] **Step 6: Commit**

```bash
git add src/components/active-mission
git commit -m "feat: build creator active mission components"
```

### Task 11: Creator routes and activation entry points

**Files:**
- Create: `src/routes/_app.my.$submissionId.tsx`
- Create: `src/routes/-_app.my.$submissionId.test.tsx`
- Modify: `src/routes/_app.my.tsx`
- Modify: `src/routes/_app.home.tsx`
- Modify: `src/routes/_app.mission.$missionSlug.tsx`
- Modify: existing route tests for those files.

**Interfaces:**
- Produces `/my/:submissionId` and active-mode links from `/my`, `/home`, and mission detail.

- [ ] **Step 1: Write failing route/branching tests**

```tsx
expect(screen.getByRole("link",{name:"Continue mission"})).toHaveAttribute("href","/my/sub-1");
expect(screen.queryByLabelText("Content URLs")).not.toBeInTheDocument();
expect(screen.getByRole("heading",{name:"Instagram Reel"})).toBeVisible();
expect(screen.getByText("Approved to publish — rewards are not issued yet")).toBeVisible();
```

- [ ] **Step 2: Verify failure**

Run: `npx vitest run src/routes/-_app.my.$submissionId.test.tsx src/routes/-_app.my.test.tsx src/routes/-_app.home.test.tsx src/routes/-_app.mission.$missionSlug.test.tsx`

Expected: FAIL because the workspace route/link is absent and the legacy URL form is still shown.

- [ ] **Step 3: Implement the workspace route**

Handle loading skeleton, 404, 403, recoverable query error, empty impossible-state guard, and normal state. Select the next-action work item by default while retaining a valid `?item=` selection. Wire receipt, autosave, upload, finalize, and submit mutations; focus the error summary after failed submit.

- [ ] **Step 4: Branch all entry points on workflow mode**

Add `creator_workflow_mode` and `active_workflow_id/submission_id` to mission/my-mission reads. Active joined missions link to `/my/:submissionId`; legacy joined missions keep the existing content-URL submission UI and behavior. Active mode never calls `useSubmitMission`.

- [ ] **Step 5: Run route tests**

Run: `npx vitest run src/routes/-_app.my.$submissionId.test.tsx src/routes/-_app.my.test.tsx src/routes/-_app.home.test.tsx src/routes/-_app.mission.$missionSlug.test.tsx`

Expected: PASS for both active and legacy fixtures.

- [ ] **Step 6: Commit**

```bash
git add src/routes/_app.my.$submissionId.tsx src/routes/-_app.my.$submissionId.test.tsx src/routes/_app.my.tsx src/routes/_app.home.tsx src/routes/_app.mission.$missionSlug.tsx src/routes/-_app.my.test.tsx src/routes/-_app.home.test.tsx src/routes/-_app.mission.$missionSlug.test.tsx
git commit -m "feat: connect creator active mission workspace"
```

### Task 12: Operator queue and review interface

**Files:**
- Modify: `src/lib/admin.ts`
- Create: `src/components/admin/ActiveMissionQueue.tsx`
- Create: `src/components/admin/ActiveMissionReview.tsx`
- Create: `src/components/admin/ActiveMissionReview.test.tsx`
- Create: `src/routes/admin.active-missions.tsx`
- Create: `src/routes/admin.active-missions.$workflowId.tsx`
- Create: `src/routes/-admin.active-missions.test.tsx`
- Modify: admin navigation component.

**Interfaces:**
- Produces `fetchActiveMissionQueue`, `fetchActiveMissionWorkflow`, `startActiveMissionReview`, `requestActiveMissionRevision`, `grantActiveMissionRevision`, `approveActiveMissionVersion`, and `markActiveMissionShipped`.

- [ ] **Step 1: Write failing queue and decision tests**

```tsx
expect(screen.getAllByTestId("queue-item")[0]).toHaveTextContent("Due today");
await user.click(screen.getByRole("button",{name:"Request revision"}));
expect(screen.getByText("Add at least one required change")).toBeVisible();
await user.type(screen.getByLabelText("Required change 1"), "Use the approved disclosure wording");
await user.click(screen.getByRole("button",{name:"Send revision request"}));
expect(requestRevision).toHaveBeenCalledWith(expect.objectContaining({versionId:"version-2",items:[expect.objectContaining({required:true})]}));
```

- [ ] **Step 2: Verify failure**

Run: `npx vitest run src/components/admin/ActiveMissionReview.test.tsx src/routes/-admin.active-missions.test.tsx`

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement admin client methods and queue**

Use `adminFetch` with the server paths from Task 7. Provide filters for SLA risk, state, reviewer, and mission; keep server order as canonical. Each card shows deadline, SLA, submitted age, deliverable, mission, creator display name, and review owner.

- [ ] **Step 4: Implement side-by-side review**

Desktop uses brief/checklist left and immutable version/assets right; mobile stacks brief, version, then sticky actions. `Start review` claims the exact work item. Revision requires a future deadline and at least one structured item. Approval confirmation names the exact version and states that no reward is issued. When the limit is exhausted, show grant-reason form before enabling another request.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/components/admin/ActiveMissionReview.test.tsx src/routes/-admin.active-missions.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/admin.ts src/components/admin/ActiveMissionQueue.tsx src/components/admin/ActiveMissionReview.tsx src/components/admin/ActiveMissionReview.test.tsx src/routes/admin.active-missions.tsx src/routes/admin.active-missions.$workflowId.tsx src/routes/-admin.active-missions.test.tsx src/components/admin
git commit -m "feat: build operator active mission review"
```

### Task 13: Workflow notifications, analytics, and metric query

**Files:**
- Modify: `supabase/migrations/20260715090000_active_mission_workspace.sql`
- Modify: `server/test/notifications-triggers.test.ts`
- Modify: `src/lib/notifications.ts`
- Modify: `src/lib/notifications.test.ts`
- Modify: `src/lib/activationAnalytics.ts`
- Modify: `src/lib/activationAnalytics.test.ts`
- Modify: `src/lib/i18n.ts`
- Create: `server/lib/activeMission/metrics.ts`
- Create: `server/lib/activeMission/metrics.test.ts`

**Interfaces:**
- Adds seven workflow notification types and ten Phase 2 analytics events from the design.
- Produces `calculateOnTimeApprovalMetric(rows)`.

- [ ] **Step 1: Write failing notification, analytics, and metric tests**

```ts
expect(renderNotification(notification("mission_revision_requested",{mission_title:"Launch",submission_id:"sub-1",deadline:"17 Jul"}),t).href).toBe("/my/sub-1");
trackActivationEvent("mission_draft_version_submitted",{locale:"zh-HK",missionType:"ugc",assetCount:2,versionNumber:1});
expect(calculateOnTimeApprovalMetric([{required:true,deadline:"2026-07-17T00:00:00Z",approvedAt:"2026-07-16T23:00:00Z"}])).toEqual({numerator:1,denominator:1,rate:1});
```

- [ ] **Step 2: Verify failure**

Run: `npx vitest run server/test/notifications-triggers.test.ts src/lib/notifications.test.ts src/lib/activationAnalytics.test.ts server/lib/activeMission/metrics.test.ts --no-file-parallelism`

Expected: FAIL on unknown event/notification types and missing metric module.

- [ ] **Step 3: Add best-effort workflow notifications**

Extend the DB notification check with `mission_product_shipped`, `mission_receipt_required`, `mission_revision_requested`, `mission_draft_approved`, `mission_approved_to_publish`, `mission_deadline_approaching`, and `mission_deadline_overdue`. Add a security-definer `notify_mission_workflow(...)` whose insert is inside `begin … exception when others then null; end`; call it after transition records are durable. Store only mission title/slug, submission ID, deliverable title, deadline, version number, and reason category.

- [ ] **Step 4: Extend renderer, translations, analytics typing, and metric**

Add workflow links to `/my/${submission_id}`, icons, and both locales. Add the exact events: `active_mission_workspace_viewed`, `active_mission_action_clicked`, `mission_product_received_confirmed`, `mission_draft_started`, `mission_draft_version_submitted`, `mission_review_started`, `mission_draft_revision_requested`, `mission_draft_approved_to_publish`, `active_mission_approved_to_publish`, and `active_mission_recovery_used`. Define payloads using locale, missionType, state/action/errorCategory, timingBucket, counts, and version/round numbers only. The metric excludes optional items and items without a deadline from the denominator.

- [ ] **Step 5: Run tests**

Run: `npx vitest run server/test/notifications-triggers.test.ts src/lib/notifications.test.ts src/lib/activationAnalytics.test.ts server/lib/activeMission/metrics.test.ts --no-file-parallelism`

Expected: PASS; a forced notification-insert error still leaves the workflow transition committed.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260715090000_active_mission_workspace.sql server/test/notifications-triggers.test.ts src/lib/notifications.ts src/lib/notifications.test.ts src/lib/activationAnalytics.ts src/lib/activationAnalytics.test.ts src/lib/i18n.ts server/lib/activeMission/metrics.ts server/lib/activeMission/metrics.test.ts
git commit -m "feat: measure and notify active mission progress"
```

### Task 14: Rollout migration, full verification, and operating notes

**Files:**
- Create: `docs/operations/active-mission-workspace.md`
- Modify: `package.json`
- Modify: `server/test/active-mission-schema.test.ts`
- Modify: `server/test/active-missions.test.ts`

**Interfaces:**
- Produces `npm run test:active-missions`.
- Documents enablement, rollback, monitoring, and pristine-joined migration procedure.

- [ ] **Step 1: Add a focused verification script**

```json
"test:active-missions": "vitest run --no-file-parallelism server/test/active-mission-schema.test.ts server/test/active-missions.test.ts server/test/notifications-triggers.test.ts src/lib/activeMission.test.ts src/lib/queries/activeMission.test.tsx src/components/active-mission/active-mission.test.tsx src/components/admin/ActiveMissionReview.test.tsx src/routes/-_app.my.$submissionId.test.tsx src/routes/-admin.active-missions.test.tsx"
```

- [ ] **Step 2: Add rollout safety tests**

```ts
expect(await migrateLegacySubmission(joined.id)).toMatchObject({state:"drafting"});
for (const status of ["submitted","under_review","approved","rejected","declined","expired"]) {
  await expect(migrateLegacySubmission(await seedLegacy(status))).rejects.toThrow(/WRONG_STATE/);
}
expect(await invokeFinalApproveOnLegacySubmission()).toMatchObject({status:"approved"});
expect(await rewardDelta()).toMatchObject({points:mission.points_reward,xp:expect.any(Number)});
```

- [ ] **Step 3: Write the operating guide**

Document: enable a mission by saving templates then setting `creator_workflow_mode=active_workspace`; confirm private bucket and policies; monitor workflow creation failures, stale autosave rate, upload failures, review SLA breaches, revision-limit grants, notification failures, and on-time approval rate; rollback by returning only missions with no active assignments to `legacy`; never delete workflow history; migrate only a locked `joined` submission with no submitted content, rewards, or prior workflow.

- [ ] **Step 4: Run focused verification**

Run: `npm run test:active-missions`

Expected: all active-mission tests PASS.

- [ ] **Step 5: Run complete repository verification**

Run: `npm run lint`

Expected: exit 0.

Run: `npm run type-check`

Expected: route tree generation and TypeScript exit 0.

Run: `npm test`

Expected: all unit/component tests PASS.

Run: `npm run test:integration`

Expected: all integration files PASS with local Supabase available; if unavailable, record the infrastructure error separately and run `npm run test:active-missions` against the configured integration environment.

Run: `npm run build`

Expected: ESM check, route generation, TypeScript, and Vite production build all exit 0.

- [ ] **Step 6: Perform the browser acceptance pass**

At 390×844 and 1440×900, verify: active mission entry from Home and My Missions; fulfilment receipt; draft autosave/conflict recovery; image/video retry; immutable submit; operator queue order; structured revision; third-round grant; exact-version approval; all-deliverable overall approval; keyboard-only completion; visible focus; no horizontal page overflow; legacy mission submission still works; creator balances and anchor status stay unchanged through Phase 2.

- [ ] **Step 7: Commit**

```bash
git add package.json docs/operations/active-mission-workspace.md server/test/active-mission-schema.test.ts server/test/active-missions.test.ts
git commit -m "test: verify active mission workspace rollout"
```

---

## Final Acceptance Checklist

- [ ] Direct join and accepted applications create one idempotent workflow with snapshotted policies and deliverables.
- [ ] Product missions block drafting until receipt; non-product missions begin drafting immediately.
- [ ] Creator autosave rejects stale revisions without losing local content.
- [ ] Assets remain private and signed URLs are ownership-scoped and short-lived.
- [ ] Submitted versions and decisions are immutable and auditable.
- [ ] Each required deliverable advances independently; overall approval requires all required items.
- [ ] Revision limit and explicit extra-round grant are enforced transactionally.
- [ ] Operator queue order follows deadline and review SLA.
- [ ] Every visible state identifies owner, deadline, blocking reason, and one next action.
- [ ] Phase 2 transitions do not mutate `mission_submissions.status`, points, XP, earnings, or budget.
- [ ] Legacy missions and final reward approval retain their existing behavior.
- [ ] Notifications are best-effort and analytics exclude creator-authored content and identifiers.
- [ ] Both locales, keyboard access, live status announcements, mobile layout, and recovery states pass.
- [ ] Focused, full test, integration, lint, type-check, build, and browser verification results are recorded before publish.
