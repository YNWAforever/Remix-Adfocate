# Creator Studio Mission Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a focused Creator Studio workbench that lets an accepted creator open one mission workspace, complete deliverables, upload proof assets, submit, see requested changes, resubmit, and reach an approved state through a single workspace projection and repository-backed command flow.

**Architecture:** Add a Creator Studio domain boundary on top of the existing `mission_submissions` records. A workflow/work-item schema and repository adapter own the workspace read model and every creator mutation; Supabase RPCs make each command atomic and idempotent, while an in-memory adapter keeps route and UI tests deterministic. The client uses a focused workbench route with a compact deliverable navigator, one active editor/upload surface, and a right-side next-action panel.

**Tech Stack:** TypeScript, Hono, Supabase Postgres/RLS/RPCs, `@supabase/supabase-js`, React 19, TanStack Router, TanStack Query, Vitest, Testing Library, existing Tailwind utility classes, and the repository's current ESM/type-check/build scripts.

## Global Constraints

- The approved design is recorded in `docs/superpowers/specs/2026-08-09-creator-studio-mission-workspace-design.md`; this plan implements that contract and does not broaden the phase.
- The current branch has the legacy `/api/missions/my` submission flow but no active-workspace route, repository, tables, or components. Establish the new boundary in this branch; do not assume files from an adjacent worktree are already available.
- Keep the existing mission relationship naming convention in the new SQL (`mission_submission_id`, `mission_workflow_id`, and `mission_work_item_id` plus `workspace_id` composite keys) so the preserved publication-proof migration remains structurally reviewable if it is separately brought forward later.
- `mission_submissions.status` remains backward-compatible (`applied`, `joined`, `submitted`, `under_review`, `approved`, `rejected`, `expired`, `declined`). The Creator Studio workflow state is authoritative for active work once a workflow row exists; do not overload the legacy status column with `not_started`, `drafting`, `ready_to_submit`, `changes_requested`, or `resubmitted`.
- The creator-facing API is mounted under `/api/my-missions` and uses these paths: `GET /:submissionId/workspace`, `PATCH /:submissionId/work-items/:workItemId/draft`, `POST /:submissionId/work-items/:workItemId/assets/upload-grant`, `POST /:submissionId/work-items/:workItemId/assets/:assetId/finalize`, and `POST /:submissionId/work-items/:workItemId/submit`.
- Every creator mutation enters through `CreatorStudioRepository`; route handlers must not write Supabase tables or storage metadata directly. Each database mutation is one security-definer RPC transaction that records the command, state change, version snapshot, and workflow event together.
- Every mutation accepts a stable `command_id`. Replaying the same command and request hash returns the original result without duplicate rows; reusing the command ID with a different payload returns `409 command_conflict`.
- Enforce `actorId`, `workspaceId`, and `submissionId` ownership at the repository/database boundary. A cross-creator or cross-workspace submission returns the same `404 submission_not_found` response as an unknown submission.
- The workspace read model has a strict core (`submission`, `workflow`, `workItems`) and explicit optional enrichment (`reviewFeedback`, asset metadata). Missing optional data is represented with a state, not an exception or a fabricated empty success.
- Upload paths are server-generated as `<creatorId>/<workflowId>/<workItemId>/<assetId>.<extension>` in a private `creator-studio-assets` bucket. The client never chooses a bucket or arbitrary object path.
- Keep the workbench limited to drafting, assets, submit/resubmit, and creator-visible review feedback. Reward payout and operator review UI are outside this phase; Creator Case remains the operator review boundary.
- Publication proofs remain a distinct evidence lane. Ordinary Creator Studio assets must not read, write, or masquerade as publication-proof records; existing publication-proof endpoints remain separate when a mission requires them.
- Do not install dependencies, edit the reference worktree `worktrees/creator-activation-spine`, alter unrelated untracked artifacts, or stage with `git add -A`. Use exact file lists for every commit.
- Use `npm.cmd` on this Windows workspace. Run focused tests first, then ESM validation, type-check, lint, and build. Run Supabase integration tests only when the existing test environment is explicitly configured; never print or request secrets in chat.

---

## Context and Existing Files

The approved design and current code establish these boundaries:

- `server/routes/missions.ts` owns the existing `/missions` catalogue, join/apply, legacy submit, and `/missions/my` list.
- `server/app.ts` creates the guarded Hono router with `userId`, `workspaceId`, and `jwt` in `Env`; the new route must be mounted beside `/missions` at `guarded.route("/my-missions", creatorStudioRoutes)`.
- `src/lib/queries/kocmax.ts` owns the current `MyMission` type and `useMyMissions`; the new query/mutation layer should be a separate focused module rather than adding workspace logic to the large legacy query file.
- `src/routes/_app.my.tsx` currently links every submission to `/mission/$missionSlug`; the implementation must route only submissions with an available Creator Studio workflow to the new workspace while preserving the legacy mission detail fallback.
- `worktrees/creator-activation-spine/` contains prior active-mission experiments, including `server/lib/activeMission/*`, `src/components/active-mission/*`, and active-mission migrations. Those files are behavioral references only. They are not the current branch's source of truth and must not be copied wholesale or modified.
- The working tree contains unrelated untracked patches and `supabase/migrations/20260723170000_publication_proof_rollout.sql`; preserve them and keep them out of Creator Studio commits.

## File Map

### Server and database

- Create `supabase/migrations/20260809100000_creator_studio_mission_workspace.sql` — workflow, work-item, draft, asset, review-feedback, command, and event tables; RLS; storage bucket policies; workflow initialization and state-refresh functions.
- Create `supabase/migrations/20260809103000_creator_studio_command_rpc.sql` — atomic draft-save, upload-grant reservation, asset-finalize, and submit/resubmit RPCs with command replay protection.
- Create `server/lib/creatorStudio/types.ts` — lifecycle unions, strict workspace projection, draft/asset/review contracts, command inputs, and repository results.
- Create `server/lib/creatorStudio/errors.ts` — stable public error codes and safe error conversion.
- Create `server/lib/creatorStudio/command.ts` — canonical request serialization and SHA-256 request hashing.
- Create `server/lib/creatorStudio/repository.ts` — the only server-side interface for Creator Studio reads and writes.
- Create `server/lib/creatorStudio/inMemoryRepository.ts` — deterministic adapter used by route/unit tests.
- Create `server/lib/creatorStudio/supabaseRepository.ts` — Supabase query/RPC/storage adapter implementing the same interface.
- Create `server/lib/creatorStudio/metrics.ts` — allowlisted non-sensitive Creator Studio lifecycle events.
- Create `server/routes/creatorStudio.ts` — authenticated route factory for read and mutation endpoints.
- Modify `server/app.ts` — mount `/my-missions` under the guarded router.
- Modify `server/routes/missions.ts` — annotate legacy `/missions/my` rows with workflow availability/state without changing legacy submission status semantics.
- Create `server/test/creator-studio-repository.test.ts` — in-memory repository contract and transition tests.
- Create `server/test/creator-studio-schema.test.ts` — migration invariant and security-policy checks that do not require live Supabase.
- Create `server/test/creator-studio-route.test.ts` — injected repository route tests for reads and mutations.
- Create `server/test/creator-studio-mutations.test.ts` — command parsing, replay, version, storage, and transition tests.
- Create `server/test/creator-studio-integration.test.ts` — opt-in Supabase/RLS/RPC acceptance tests using existing test helpers.

### Client

- Create `src/lib/queries/creatorStudio.ts` — workspace types, query key, read hook, mutation hooks, and signed-upload helper.
- Modify `src/lib/queries/kocmax.ts` — add `creator_studio_state`/availability fields to `MyMission` without moving existing mission APIs.
- Modify `src/routes/_app.my.tsx` — link workflow-backed rows to the focused workbench and keep legacy rows on mission detail.
- Create `src/routes/_app.my.$submissionId.tsx` — route-level workspace fetch, selected work-item state, and workbench composition.
- Create `src/components/creator-studio/WorkspaceHeader.tsx` — mission identity, workflow state, deadline, and save/submission status.
- Create `src/components/creator-studio/DeliverableNavigator.tsx` — compact ordered work-item navigation with state badges.
- Create `src/components/creator-studio/DraftEditor.tsx` — caption, URL, and checklist editing with explicit dirty/saving/error states.
- Create `src/components/creator-studio/AssetUploadPanel.tsx` — upload grant, signed upload, finalize, retry, and asset list.
- Create `src/components/creator-studio/ReviewFeedback.tsx` — requested-change and approved feedback presentation.
- Create `src/components/creator-studio/NextActionPanel.tsx` — one primary next action derived from the workflow/work-item state.
- Create `src/components/creator-studio/CreatorStudioWorkbench.tsx` — focused desktop/mobile layout and keyboard-accessible composition.
- Create `src/routes/-_app.my.$submissionId.test.tsx` — route/workbench flow tests.
- Modify `src/routes/-_app.my.test.tsx` — list-link regression coverage.
- Create `src/components/creator-studio/CreatorStudioWorkbench.test.tsx` — state, retry, accessibility, and narrow-layout behavior.

---

### Task 1: Establish the Creator Studio domain contract and schema foundation

**Files:**
- Create: `supabase/migrations/20260809100000_creator_studio_mission_workspace.sql`
- Create: `server/lib/creatorStudio/types.ts`
- Create: `server/lib/creatorStudio/errors.ts`
- Create: `server/lib/creatorStudio/command.ts`
- Create: `server/lib/creatorStudio/repository.ts`
- Create: `server/lib/creatorStudio/inMemoryRepository.ts`
- Create: `server/test/creator-studio-repository.test.ts`
- Create: `server/test/creator-studio-schema.test.ts`

**Interfaces:**
- Consumes: `mission_submissions`, `missions`, `creators`, and `workspaces` from the current tracked migrations.
- Produces: `CreatorStudioRepository`, `SubmissionWorkspace`, `CreatorStudioState`, `WorkItemState`, `DraftPatch`, `SaveDraftInput`, `CreateUploadGrantInput`, `FinalizeAssetInput`, `SubmitWorkItemInput`, and stable `CreatorStudioError` codes for Tasks 2–5.

- [ ] **Step 1: Write the failing repository contract tests.**

  Create a fixture with one creator, one joined submission, two work items, an empty draft, and one requested-change review item. Assert the exact lifecycle and command behavior:

  ```ts
  it("creates a draft, advances the item to ready_to_submit, and replays the same command", async () => {
    const repository = makeRepository();
    const context = creatorContext();
    const input = {
      commandId: "draft-command-1",
      expectedVersion: 0,
      patch: {
        caption: "Launch copy",
        externalUrl: "https://example.com/post",
        checklist: { disclosure: true, brandTag: true },
      },
    } satisfies SaveDraftInput;

    const first = await repository.saveDraft(context, "work-item-1", input);
    const replay = await repository.saveDraft(context, "work-item-1", input);

    expect(first.replayed).toBe(false);
    expect(replay).toEqual({ ...first, replayed: true });
    expect(first.value.draft.version).toBe(1);
    expect(first.value.workItem.state).toBe("ready_to_submit");
    expect(repository.events()).toHaveLength(1);
  });

  it("rejects a changed payload that reuses a command id without changing state", async () => {
    const repository = makeRepository();
    const context = creatorContext();
    const input = { commandId: "same-command", expectedVersion: 0, patch: { caption: "First" } } satisfies SaveDraftInput;

    await repository.saveDraft(context, "work-item-1", input);
    await expect(repository.saveDraft(context, "work-item-1", {
      ...input,
      patch: { caption: "Different" },
    })).rejects.toMatchObject({ code: "command_conflict" });
    expect(repository.getDraft("work-item-1")?.caption).toBe("First");
  });

  it("does not disclose a work item owned by another creator", async () => {
    const repository = makeRepository({ creatorId: "other-creator" });
    await expect(repository.getWorkspace(creatorContext())).resolves.toBeNull();
    await expect(repository.saveDraft(creatorContext(), "work-item-1", {
      commandId: "cross-owner",
      expectedVersion: 0,
      patch: { caption: "Must not write" },
    })).rejects.toMatchObject({ code: "submission_not_found" });
  });
  ```

- [ ] **Step 2: Run the contract tests to verify the missing domain boundary fails.**

  Run:

  ```powershell
  npm.cmd test -- server/test/creator-studio-repository.test.ts
  ```

  Expected: FAIL because the Creator Studio types, adapter, and transition implementation do not exist yet.

- [ ] **Step 3: Define the shared domain types and repository interface.**

  Use one canonical shape so later server and client work cannot drift. The central contracts must include these signatures and properties:

  ```ts
  export const CREATOR_STUDIO_STATES = [
    "not_started", "drafting", "ready_to_submit", "submitted",
    "changes_requested", "resubmitted", "approved",
  ] as const;
  export type CreatorStudioState = (typeof CREATOR_STUDIO_STATES)[number];
  export type WorkItemState = CreatorStudioState;

  export type CreatorStudioContext = {
    actorId: string;
    workspaceId: string;
    submissionId: string;
  };

  export type DraftPatch = {
    caption?: string;
    externalUrl?: string | null;
    checklist?: Record<string, boolean>;
  };

  export type SaveDraftInput = {
    commandId: string;
    expectedVersion: number;
    patch: DraftPatch;
  };

  export type CreateUploadGrantInput = {
    commandId: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
  };

  export type FinalizeAssetInput = {
    commandId: string;
    byteSize: number;
    mimeType: string;
    checksumSha256: string | null;
  };

  export type SubmitWorkItemInput = {
    commandId: string;
    expectedVersion: number;
  };

  export interface CreatorStudioRepository {
    getWorkspace(context: CreatorStudioContext): Promise<SubmissionWorkspace | null>;
    saveDraft(context: CreatorStudioContext, workItemId: string, input: SaveDraftInput): Promise<CommandResult<DraftCommandResult>>;
    createUploadGrant(context: CreatorStudioContext, workItemId: string, input: CreateUploadGrantInput): Promise<CommandResult<UploadGrant>>;
    finalizeAsset(context: CreatorStudioContext, workItemId: string, assetId: string, input: FinalizeAssetInput): Promise<CommandResult<FinalizedAsset>>;
    submitWorkItem(context: CreatorStudioContext, workItemId: string, input: SubmitWorkItemInput): Promise<CommandResult<SubmittedWorkItem>>;
  }
  ```

  `SubmissionWorkspace` must contain strict `submission`, `brief`, `workflow`, ordered `workItems`, and `nextAction` fields. Each work item includes `id`, `position`, `title`, `instructions`, `requirements`, `requiresAsset`, `state`, `validation`, `draft`, `assets`, and `reviewFeedback`; use `null` for a missing draft and this explicit wrapper for optional feedback/enrichment:

  ```ts
  export type OptionalSection<T> =
    | { status: "available"; value: T }
    | { status: "unavailable"; reason: "not_configured" | "temporarily_unavailable" };
  ```

  `CommandResult<T>` must be `{ value: T; replayed: boolean }`.

- [ ] **Step 4: Add safe errors and command hashing.**

  Implement `CreatorStudioError` with the public codes `command_required`, `command_conflict`, `version_conflict`, `submission_not_found`, `work_item_not_found`, `invalid_transition`, `draft_invalid`, `file_not_allowed`, `file_too_large`, `asset_not_found`, `asset_not_uploaded`, `asset_finalized`, `storage_error`, and `db_error`. Store private database details only in the server log/correlation context. `command.ts` must sort object keys recursively, serialize the request, and hash it with `createHash("sha256")`; the same object in a different key order must produce the same hash.

- [ ] **Step 5: Add the schema migration and workflow initializer.**

  Create the seven focused workflow/read tables plus the command and event ledgers:

  | Table | Required responsibility |
  | --- | --- |
  | `mission_workflows` | One creator-owned execution workflow per `mission_submissions.id` through `mission_submission_id`; stores the Creator Studio state and revision. |
  | `mission_work_items` | Ordered deliverable snapshots taken from `missions.deliverables`, `requirements`, and `platforms`, linked by `mission_workflow_id`; stores item state and revision. |
  | `mission_working_drafts` | Current caption, external URL, checklist, version, and update timestamp, linked by `mission_work_item_id`. |
  | `mission_draft_versions` | Immutable version snapshots for recovery/audit, linked by `mission_work_item_id` and `mission_workflow_id`. |
  | `mission_draft_assets` | Creator-owned upload reservations and finalized object metadata, linked by `mission_work_item_id` and `mission_workflow_id`. |
  | `mission_review_rounds` and `mission_review_items` | Immutable creator-visible requested-change/approval feedback linked to each work item. |
  | `mission_workflow_commands` | `(mission_submission_id, actor_id, command_id, request_hash, response)` replay ledger. |
  | `mission_workflow_events` | Append-only lifecycle event log with `mission_workflow_id`/`mission_work_item_id` and no draft text or asset bytes. |

  Every child table must carry `creator_id` and `workspace_id`, use composite foreign keys back to the owner-scoped parent, and have indexes for `(workspace_id, creator_id, mission_submission_id)`. Add unique `(id, workspace_id)` keys to `creators` and `mission_submissions` needed by the composite references without changing the submission status check. Enable RLS, allow authenticated owner reads, grant writes only to `service_role`/security-definer functions, and add owner-scoped policies for `creator-studio-assets` storage objects.

  Add `initialize_creator_studio_workflow(mission_submission_id uuid)` as a security-definer function. It must lock the joined submission, reject a submission whose `status` is not `joined`, insert one `mission_workflows` row with `not_started` if absent, snapshot each mission deliverable into an ordered work item, and create one fallback item titled with the mission title when `deliverables` is empty. Add an `after insert or update of status` trigger for `mission_submissions` when the new status is `joined`, then backfill only existing `joined` rows in the migration. Do not rewrite legacy `submitted`, `under_review`, `approved`, `rejected`, or `expired` rows.

  Add `refresh_creator_studio_state(mission_workflow_id uuid)` to derive workflow state from child items using this exact rule: any `changes_requested` item yields `changes_requested`; all items `approved` yields `approved`; any `resubmitted` item yields `resubmitted`; any `submitted` item yields `submitted`; any `ready_to_submit` item yields `ready_to_submit`; any `drafting` item yields `drafting`; otherwise `not_started`. Use `FOR UPDATE` in the function so concurrent commands cannot skip a transition.

- [ ] **Step 6: Implement the in-memory adapter as the executable contract.**

  Store fixtures, draft versions, assets, command hashes/results, and events in `Map`s. Implement the same ownership checks, state transitions, `expectedVersion` checks, file constraints, and replay behavior that the SQL RPCs will enforce. A submit command is valid only when all required assets are finalized and the draft has the required caption/URL/checklist; a first submit changes `ready_to_submit` to `submitted`, and a resubmit changes `changes_requested` to `resubmitted`.

- [ ] **Step 7: Run the contract and schema checks.**

  Run:

  ```powershell
  npm.cmd test -- server/test/creator-studio-repository.test.ts server/test/creator-studio-schema.test.ts
  npm.cmd run check:esm
  ```

  Expected: all focused tests PASS; the schema test confirms the new migration contains owner keys, RLS, grants, the trigger/backfill, command uniqueness, and storage path policy; ESM checking passes.

- [ ] **Step 8: Commit the domain/schema foundation.**

  ```powershell
  git add supabase/migrations/20260809100000_creator_studio_mission_workspace.sql server/lib/creatorStudio/types.ts server/lib/creatorStudio/errors.ts server/lib/creatorStudio/command.ts server/lib/creatorStudio/repository.ts server/lib/creatorStudio/inMemoryRepository.ts server/test/creator-studio-repository.test.ts server/test/creator-studio-schema.test.ts
  git diff --cached --name-only
  git commit -m "feat: establish creator studio workspace contract"
  ```

  Expected: the staged path list contains exactly the eight paths above and the commit succeeds without staging unrelated worktree artifacts.

---

### Task 2: Implement the workspace projection and authenticated read route

**Files:**
- Create: `server/lib/creatorStudio/supabaseRepository.ts`
- Create: `server/routes/creatorStudio.ts`
- Modify: `server/app.ts`
- Create: `server/test/creator-studio-route.test.ts`

**Interfaces:**
- Consumes: `CreatorStudioRepository`, `CreatorStudioContext`, and `SubmissionWorkspace` from Task 1; `Env` and `makeUserClient` from `server/app.ts`/`server/lib/supabase.ts`.
- Produces: `createCreatorStudioRoutes({ repositoryForRequest })` and `GET /api/my-missions/:submissionId/workspace` for the client route.

- [ ] **Step 1: Write failing route tests against an injected in-memory repository.**

  Build a Hono test app that sets `userId`, `workspaceId`, and `jwt`, injects `InMemoryCreatorStudioRepository`, and asserts the following concrete responses:

  ```ts
  it("returns one stable workspace projection in position order", async () => {
    const response = await app.request("/my-missions/submission-1/workspace");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      submission: { id: "submission-1" },
      workflow: { state: "not_started" },
      workItems: [
        { id: "work-item-1", position: 1 },
        { id: "work-item-2", position: 2 },
      ],
    });
  });

  it("does not disclose a cross-owner submission", async () => {
    const response = await appForContext({ userId: "other-creator" }).request(
      "/my-missions/submission-1/workspace",
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "submission_not_found", code: "submission_not_found" });
  });

  it("returns safe correlated errors without private database details", async () => {
    const response = await appForRepository(failingRepository()).request(
      "/my-missions/submission-1/workspace",
    );
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body).toMatchObject({ code: "db_error", correlationId: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain("private database details");
  });
  ```

- [ ] **Step 2: Run the route tests and confirm the read boundary is missing.**

  Run:

  ```powershell
  npm.cmd test -- server/test/creator-studio-route.test.ts
  ```

  Expected: FAIL because the route factory and Supabase adapter do not exist.

- [ ] **Step 3: Implement `SupabaseCreatorStudioRepository.getWorkspace`.**

  Query the owner-scoped submission and mission brief, workflow, ordered work items, current drafts, finalized/granted assets, and review feedback through the authenticated user client. Map snake_case rows to the exact domain contracts, including per-item validation and the server-computed `nextAction` object. Return `null` when the submission/workflow is not visible to the actor; sort work items by `position`, assets by `createdAt`, and review items by `createdAt`. Keep optional review enrichment in an explicit unavailable/available wrapper when the query has no rows or the optional relation is unavailable. The client must not reconstruct this projection by joining separate raw endpoints.

  The adapter must validate `actorId`, `workspaceId`, and `submissionId` before any query, use `.eq("creator_id", actorId).eq("workspace_id", workspaceId)`, and translate Supabase errors to `CreatorStudioError("db_error", "repository read failed", correlationId)` without exposing the raw message.

- [ ] **Step 4: Implement the route factory and mount it.**

  Export this injectable boundary:

  ```ts
  export type CreatorStudioRouteDeps = {
    repositoryForRequest: (context: Context<Env>) => CreatorStudioRepository;
  };

  export function createCreatorStudioRoutes(deps: CreatorStudioRouteDeps): Hono<Env> {
    const routes = new Hono<Env>();
    routes.get("/:submissionId/workspace", async (c) => {
      const workspace = await deps.repositoryForRequest(c).getWorkspace({
        actorId: c.get("userId"),
        workspaceId: c.get("workspaceId"),
        submissionId: c.req.param("submissionId"),
      });
      if (!workspace) return c.json({ error: "submission_not_found", code: "submission_not_found" }, 404);
      return c.json(workspace);
    });
    return routes;
  }
  ```

  The production dependency constructs `new SupabaseCreatorStudioRepository(makeUserClient(c.get("jwt")))`. Catch `CreatorStudioError` at the route boundary and use status `404` for not-found, `409` for command/version/state conflicts, `422` for request constraints, and `500` for safe database/storage failures. Add the import and `guarded.route("/my-missions", creatorStudioRoutes)` to `server/app.ts` without moving the existing `/missions` mount.

- [ ] **Step 5: Run the focused read-route tests.**

  ```powershell
  npm.cmd test -- server/test/creator-studio-route.test.ts server/test/creator-studio-repository.test.ts
  npm.cmd run check:esm
  ```

  Expected: all tests PASS and every new server import satisfies the repository's `.js` ESM import check.

- [ ] **Step 6: Commit the read model and route boundary.**

  ```powershell
  git add server/lib/creatorStudio/supabaseRepository.ts server/routes/creatorStudio.ts server/app.ts server/test/creator-studio-route.test.ts
  git diff --cached --name-only
  git commit -m "feat: expose creator studio workspace read model"
  ```

  Expected: only the four listed paths are staged and committed.

---

### Task 3: Add atomic draft, asset, and submit commands

**Files:**
- Create: `supabase/migrations/20260809103000_creator_studio_command_rpc.sql`
- Modify: `server/lib/creatorStudio/supabaseRepository.ts`
- Modify: `server/lib/creatorStudio/inMemoryRepository.ts`
- Modify: `server/lib/creatorStudio/types.ts`
- Modify: `server/routes/creatorStudio.ts`
- Create: `server/test/creator-studio-mutations.test.ts`

**Interfaces:**
- Consumes: the repository interface and route factory from Tasks 1–2.
- Produces: the four mutation endpoints, replay-safe `CommandResult` responses, and the Supabase RPC names `creator_studio_save_draft`, `creator_studio_create_upload_grant`, `creator_studio_finalize_asset`, and `creator_studio_submit_work_item`.

- [ ] **Step 1: Write failing mutation tests for the complete command matrix.**

  Cover these requests and outcomes:

  ```ts
  const json = (body: unknown, method = "POST"): RequestInit => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  it("saves a draft through the repository and replays the command", async () => {
    const first = await app.request("/my-missions/submission-1/work-items/work-item-1/draft", json({
      command_id: "draft-1",
      expected_version: 0,
      patch: { caption: "A caption", external_url: "https://example.com/post", checklist: { disclosure: true } },
    }, "PATCH"));
    const replay = await app.request("/my-missions/submission-1/work-items/work-item-1/draft", json({
      command_id: "draft-1",
      expected_version: 0,
      patch: { caption: "A caption", external_url: "https://example.com/post", checklist: { disclosure: true } },
    }, "PATCH"));
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true, draft: { version: 1 } });
  });

  it("returns 409 for a stale draft version and does not overwrite the newer draft", async () => {
    const response = await app.request("/my-missions/submission-1/work-items/work-item-1/draft", json({
      command_id: "stale-1",
      expected_version: 0,
      patch: { caption: "Stale write" },
    }, "PATCH"));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "version_conflict" });
  });

  it("submits only after finalized assets and required draft fields exist", async () => {
    const blocked = await app.request("/my-missions/submission-1/work-items/work-item-1/submit", json({
      command_id: "submit-before-ready", expected_version: 0,
    }));
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ code: "invalid_transition" });
  });

  it("keeps upload grant retries idempotent and finalization single-use", async () => {
    const body = { command_id: "asset-1", file_name: "proof.png", mime_type: "image/png", byte_size: 1024 };
    const first = await app.request("/my-missions/submission-1/work-items/work-item-1/assets/upload-grant", json(body));
    const retry = await app.request("/my-missions/submission-1/work-items/work-item-1/assets/upload-grant", json(body));
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { assetId: string };
    expect((await retry.json()).assetId).toBe(firstBody.assetId);
    const finalized = await app.request(`/my-missions/submission-1/work-items/work-item-1/assets/${firstBody.assetId}/finalize`, json({
      command_id: "finalize-1", byte_size: 1024, mime_type: "image/png", checksum_sha256: null,
    }));
    expect(finalized.status).toBe(200);
  });
  ```

- [ ] **Step 2: Run the mutation tests to verify the command endpoints fail before implementation.**

  ```powershell
  npm.cmd test -- server/test/creator-studio-mutations.test.ts
  ```

  Expected: FAIL because the RPC migration and mutation route handlers are not present.

- [ ] **Step 3: Add the atomic RPC migration.**

  Each RPC must lock the owner-scoped workflow/work item, validate the actor from `auth.uid()`, look up `(mission_submission_id, actor_id, workspace_id)`, check the command ledger first, compare `request_hash` on replay, and write the command response only after all state changes succeed. The required write ordering for draft save is:

  The draft RPC accepts `p_patch jsonb`, `p_expected_version integer`, `p_command_id text`, `p_request_hash text`, `p_submission_id uuid`, `p_workspace_id uuid`, and `p_work_item_id uuid`. A missing draft is created only at expected version `0`; an existing draft must match the expected version.

  ```sql
  select * into v_item
  from public.mission_work_items
  where id = p_work_item_id and mission_workflow_id = v_workflow_id and creator_id = auth.uid()
  for update;

  select request_hash, response into v_existing_hash, v_existing_response
  from public.mission_workflow_commands
  where mission_submission_id = p_submission_id and actor_id = auth.uid() and command_id = p_command_id
  for update;

  if found then
    if v_existing_hash <> p_request_hash then raise exception 'command_conflict'; end if;
    return v_existing_response || jsonb_build_object('replayed', true);
  end if;

  if exists (
    select 1 from public.mission_working_drafts
    where mission_work_item_id = p_work_item_id
  ) then
    update public.mission_working_drafts
    set caption = case when p_patch ? 'caption' then coalesce(p_patch->>'caption', '') else caption end,
        external_url = case when p_patch ? 'external_url' then p_patch->>'external_url' else external_url end,
        checklist = case when p_patch ? 'checklist' then coalesce(p_patch->'checklist', '{}'::jsonb) else checklist end,
        version = version + 1,
        updated_at = now()
    where mission_work_item_id = p_work_item_id and version = p_expected_version
    returning * into v_draft;
    if not found then raise exception 'version_conflict'; end if;
  else
    if p_expected_version <> 0 then raise exception 'version_conflict'; end if;
    insert into public.mission_working_drafts
      (mission_work_item_id, mission_workflow_id, creator_id, workspace_id, caption, external_url, checklist, version)
    values
      (v_item.id, v_item.mission_workflow_id, v_item.creator_id, v_item.workspace_id,
       coalesce(p_patch->>'caption', ''), p_patch->>'external_url',
       coalesce(p_patch->'checklist', '{}'::jsonb), 1)
    returning * into v_draft;
  end if;

  insert into public.mission_draft_versions
    (mission_work_item_id, mission_workflow_id, creator_id, workspace_id, version, caption, external_url, checklist)
  values
    (v_item.id, v_item.mission_workflow_id, v_item.creator_id, v_item.workspace_id,
     v_draft.version, v_draft.caption, v_draft.external_url, v_draft.checklist);
  perform public.refresh_creator_studio_state(v_workflow_id);
  insert into public.mission_workflow_events
    (mission_workflow_id, mission_work_item_id, creator_id, workspace_id, event_type, command_id, payload)
  values
    (v_item.mission_workflow_id, v_item.id, v_item.creator_id, v_item.workspace_id,
     'draft_saved', p_command_id, jsonb_build_object('version', v_draft.version));
  insert into public.mission_workflow_commands
    (mission_submission_id, actor_id, workspace_id, command_id, action, request_hash, response)
  values
    (p_submission_id, auth.uid(), p_workspace_id, p_command_id, 'save_draft', p_request_hash,
     jsonb_build_object('draft', to_jsonb(v_draft), 'workItem', to_jsonb(v_item)));
  return jsonb_build_object('replayed', false, 'draft', to_jsonb(v_draft), 'workItem', to_jsonb(v_item));
  ```

  Use the same named-column discipline for the other three RPCs. `creator_studio_create_upload_grant` reserves an asset row and returns its server-generated path; `creator_studio_finalize_asset` requires the reservation to be `granted`, writes immutable metadata, and rejects a second finalize; `creator_studio_submit_work_item` requires a current draft, all required checklist keys, at least one finalized asset when the work item requires an asset, and the correct source state before writing `submitted` or `resubmitted`.

  Grant only `execute` to `authenticated` for these RPCs, revoke direct table writes, and grant `service_role` for controlled integration setup. Do not put draft text, upload bytes, or raw storage URLs in `mission_workflow_events` or metrics.

- [ ] **Step 4: Implement Supabase adapter command calls and storage grant handling.**

  Compute `request_hash` from the canonical request object in `command.ts`, call the matching RPC, map PostgREST error messages to `CreatorStudioError`, and return the RPC snapshot. For upload grants, call the storage API only after the reservation RPC succeeds and return `{ bucket, path, token, assetId, expiresAt }`. On an identical replay, reuse the stored asset/path and issue a fresh short-lived upload token; never insert another asset row. If storage token generation fails, return `storage_error` while leaving the idempotent reservation available for retry.

- [ ] **Step 5: Extend the in-memory adapter and add route request parsing.**

  Validate `command_id` as a non-empty bounded string, `expected_version` as a non-negative integer, `external_url` as `null` or an `http(s)` URL, checklist values as booleans, and uploads against the fixed allowed MIME set `{ image/jpeg, image/png, image/webp, video/mp4, application/pdf }` and a 50 MiB maximum. Parse snake_case request keys at the route boundary and pass only typed inputs to the repository. Never accept a client-supplied storage path, bucket, creator ID, workflow ID, or state.

- [ ] **Step 6: Run mutation tests and ESM/type checks.**

  ```powershell
  npm.cmd test -- server/test/creator-studio-mutations.test.ts server/test/creator-studio-route.test.ts server/test/creator-studio-repository.test.ts
  npm.cmd run check:esm
  npm.cmd run type-check
  ```

  Expected: all focused tests PASS, ESM validation PASS, and TypeScript reports no new errors.

- [ ] **Step 7: Commit atomic Creator Studio commands.**

  ```powershell
  git add supabase/migrations/20260809103000_creator_studio_command_rpc.sql server/lib/creatorStudio/supabaseRepository.ts server/lib/creatorStudio/inMemoryRepository.ts server/lib/creatorStudio/types.ts server/routes/creatorStudio.ts server/test/creator-studio-mutations.test.ts
  git diff --cached --name-only
  git commit -m "feat: add atomic creator studio commands"
  ```

  Expected: only the listed command migration, adapter, type, route, and test files are staged.

---

### Task 4: Add the client workspace query layer and My Missions entry point

**Files:**
- Create: `src/lib/queries/creatorStudio.ts`
- Modify: `src/lib/queries/kocmax.ts`
- Modify: `server/routes/missions.ts`
- Modify: `src/routes/_app.my.tsx`
- Create: `src/routes/_app.my.$submissionId.tsx`
- Create: `src/routes/-_app.my.$submissionId.test.tsx`
- Modify: `src/routes/-_app.my.test.tsx`

**Interfaces:**
- Consumes: `/api/my-missions/:submissionId/*` responses and the current `apiFetch`/`supabase` clients.
- Produces: `useSubmissionWorkspace(submissionId)`, `useSaveCreatorDraft`, `useCreateDraftAssetGrant`, `useFinalizeDraftAsset`, `useSubmitWorkItem`, and a route at `/my/$submissionId`.

- [ ] **Step 1: Write failing client query and list-link tests.**

  Extend `MyMission` with `creator_studio_state: CreatorStudioState | null` and `creator_studio_available: boolean`. Mock one joined row with availability and one submitted legacy row without it. Assert that only the first row renders a `/my/submission-id` link, while the legacy row keeps `/mission/mission-slug`.

  Add a route test that mocks `useSubmissionWorkspace` with two ordered work items and asserts the mission title, active work-item title, and next-action label render together.

  Add explicit cases for the loading skeleton, a core workspace error with a recoverable retry action, and a workspace whose optional review enrichment is unavailable while the brief/editor still renders. Add a mutation case that shows an item-level `draft_invalid` response beside the affected work item.

- [ ] **Step 2: Run the client tests to confirm the new hooks/route are absent.**

  ```powershell
  npm.cmd test -- src/routes/-_app.my.test.tsx src/routes/-_app.my.$submissionId.test.tsx
  ```

  Expected: FAIL because the Creator Studio query module and route do not exist.

- [ ] **Step 3: Implement `src/lib/queries/creatorStudio.ts`.**

  Define client-side response types matching `server/lib/creatorStudio/types.ts` field-for-field and use query keys that include the submission ID:

  ```ts
  import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
  import { apiFetch } from "@/lib/api";
  import { supabase } from "@/lib/supabase";

  export type CreatorStudioState =
    | "not_started" | "drafting" | "ready_to_submit" | "submitted"
    | "changes_requested" | "resubmitted" | "approved";
  export type WorkingDraft = {
    caption: string;
    externalUrl: string | null;
    checklist: Record<string, boolean>;
    version: number;
    updatedAt: string;
  };
  export type WorkItem = {
    id: string;
    position: number;
    title: string;
    instructions: string | null;
    requirements: string[];
    requiresAsset: boolean;
    state: CreatorStudioState;
    draft: WorkingDraft | null;
    validation: { status: "ready" | "incomplete"; messages: string[] };
  };
  export type NextAction = {
    kind: "start_draft" | "finish_draft" | "upload_asset" | "submit" | "review_changes" | "resubmit" | "approved";
    label: string;
    workItemId: string | null;
    blockedBy: string[];
  };
  export type SubmissionWorkspace = {
    submission: { id: string; missionSlug: string; missionTitle: string; status: string; deadline: string | null };
    brief: { description: string | null; requirements: string[]; platforms: string[]; deliverables: string[] };
    workflow: { id: string; state: CreatorStudioState; revision: number; updatedAt: string };
    workItems: WorkItem[];
    nextAction: NextAction;
  };
  export type UploadGrant = { assetId: string; bucket: string; path: string; token: string; expiresAt: string };
  export type FinalizedAsset = { assetId: string; state: "finalized"; path: string; finalizedAt: string };
  export type DraftCommandResponse = { replayed: boolean; draft: WorkingDraft; workItem: WorkItem };
  export type SubmittedWorkItem = { replayed: boolean; workItem: WorkItem; workflow: SubmissionWorkspace["workflow"] };

  export type SaveDraftCommandInput = {
    commandId: string;
    expectedVersion: number;
    patch: { caption?: string; externalUrl?: string | null; checklist?: Record<string, boolean> };
  };
  export type CreateUploadGrantCommandInput = {
    commandId: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
  };
  export type FinalizeAssetCommandInput = {
    commandId: string;
    byteSize: number;
    mimeType: string;
    checksumSha256: string | null;
  };
  export type SubmitWorkItemCommandInput = { commandId: string; expectedVersion: number };

  export const creatorStudioKeys = {
    workspace: (submissionId: string) => ["creator-studio", "workspace", submissionId] as const,
  };

  export function useSubmissionWorkspace(submissionId: string) {
    return useQuery({
      queryKey: creatorStudioKeys.workspace(submissionId),
      queryFn: () => apiFetch<SubmissionWorkspace>(`/my-missions/${submissionId}/workspace`),
      enabled: Boolean(submissionId),
    });
  }

  export function useSaveCreatorDraft(submissionId: string, workItemId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (input: SaveDraftCommandInput) => apiFetch<DraftCommandResponse>(
        `/my-missions/${submissionId}/work-items/${workItemId}/draft`,
        {
          method: "PATCH",
          body: JSON.stringify({
            command_id: input.commandId,
            expected_version: input.expectedVersion,
            patch: {
              caption: input.patch.caption,
              external_url: input.patch.externalUrl,
              checklist: input.patch.checklist,
            },
          }),
        },
      ),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: creatorStudioKeys.workspace(submissionId) }),
    });
  }

  export function useCreateDraftAssetGrant(submissionId: string, workItemId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (input: CreateUploadGrantCommandInput) => apiFetch<UploadGrant>(
        `/my-missions/${submissionId}/work-items/${workItemId}/assets/upload-grant`,
        { method: "POST", body: JSON.stringify({
          command_id: input.commandId,
          file_name: input.fileName,
          mime_type: input.mimeType,
          byte_size: input.byteSize,
        }) },
      ),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: creatorStudioKeys.workspace(submissionId) }),
    });
  }

  export function useFinalizeDraftAsset(submissionId: string, workItemId: string, assetId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (input: FinalizeAssetCommandInput) => apiFetch<FinalizedAsset>(
        `/my-missions/${submissionId}/work-items/${workItemId}/assets/${assetId}/finalize`,
        { method: "POST", body: JSON.stringify({
          command_id: input.commandId,
          byte_size: input.byteSize,
          mime_type: input.mimeType,
          checksum_sha256: input.checksumSha256,
        }) },
      ),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: creatorStudioKeys.workspace(submissionId) }),
    });
  }

  export function useSubmitWorkItem(submissionId: string, workItemId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (input: SubmitWorkItemCommandInput) => apiFetch<SubmittedWorkItem>(
        `/my-missions/${submissionId}/work-items/${workItemId}/submit`,
        { method: "POST", body: JSON.stringify({ command_id: input.commandId, expected_version: input.expectedVersion }) },
      ),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: creatorStudioKeys.workspace(submissionId) }),
    });
  }

  export async function uploadDraftAsset(grant: UploadGrant, file: File) {
    const { error } = await supabase.storage.from(grant.bucket).uploadToSignedUrl(grant.path, grant.token, file);
    if (error) throw error;
  }
  ```

  `useCreateDraftAssetGrant` must upload with `supabase.storage.from(grant.bucket).uploadToSignedUrl(grant.path, grant.token, file)` and call `useFinalizeDraftAsset` only after the signed upload succeeds. A failed upload keeps the draft/query data intact and exposes a retry action.

- [ ] **Step 4: Add workflow availability to `/missions/my` without changing legacy states.**

  In `server/routes/missions.ts`, after reading the caller's submissions, query `mission_workflows` by the returned submission IDs and current creator/workspace, build a `Map<submissionId, state>`, and map each row with `creator_studio_available: Boolean(state)` and `creator_studio_state: state ?? null`. Add those fields to the `MyMission` client type. If the workflow query fails, return the legacy rows with `creator_studio_available: false` and log a safe correlated read failure; do not make the existing mission list unavailable because an optional Creator Studio projection is missing.

- [ ] **Step 5: Implement the route shell and list navigation.**

  `src/routes/_app.my.$submissionId.tsx` reads `submissionId` from `Route.useParams()`, calls `useSubmissionWorkspace`, renders loading/error/not-found states, and passes the workspace to `CreatorStudioWorkbench`. `src/routes/_app.my.tsx` chooses the link using this exact rule:

  ```tsx
  const href = s.creator_studio_available
    ? { to: "/my/$submissionId" as const, params: { submissionId: s.id } }
    : { to: "/mission/$missionSlug" as const, params: { missionSlug: s.missions.slug } };
  ```

  Preserve existing status group labels, points text, and legacy rows. Do not send an accepted creator to the mission discovery page when a workflow is available.

- [ ] **Step 6: Run client tests and type/route generation checks.**

  ```powershell
  npm.cmd test -- src/routes/-_app.my.test.tsx src/routes/-_app.my.$submissionId.test.tsx
  npm.cmd run type-check
  npm.cmd run check:esm
  ```

  Expected: list and route tests PASS, generated TanStack route types compile, and ESM/type checks PASS.

- [ ] **Step 7: Commit the client data boundary and entry route.**

  ```powershell
  git add src/lib/queries/creatorStudio.ts src/lib/queries/kocmax.ts server/routes/missions.ts src/routes/_app.my.tsx src/routes/_app.my.$submissionId.tsx src/routes/-_app.my.$submissionId.test.tsx src/routes/-_app.my.test.tsx
  git diff --cached --name-only
  git commit -m "feat: route creators into studio workspaces"
  ```

  Expected: only the client query, list, route, and optional `/missions/my` projection paths are staged.

---

### Task 5: Build the focused Creator Studio workbench

**Files:**
- Create: `src/components/creator-studio/WorkspaceHeader.tsx`
- Create: `src/components/creator-studio/DeliverableNavigator.tsx`
- Create: `src/components/creator-studio/DraftEditor.tsx`
- Create: `src/components/creator-studio/AssetUploadPanel.tsx`
- Create: `src/components/creator-studio/ReviewFeedback.tsx`
- Create: `src/components/creator-studio/NextActionPanel.tsx`
- Create: `src/components/creator-studio/CreatorStudioWorkbench.tsx`
- Modify: `src/routes/_app.my.$submissionId.tsx`
- Create: `src/components/creator-studio/CreatorStudioWorkbench.test.tsx`
- Modify: `src/routes/-_app.my.$submissionId.test.tsx`

**Interfaces:**
- Consumes: `SubmissionWorkspace`, mutation hooks, and `creatorStudioKeys` from Task 4.
- Produces: a keyboard-accessible focused workbench with one active editor, one primary next action, and explicit save/upload/submit/review states.

- [ ] **Step 1: Write failing component tests for the approved workbench states.**

  Cover at least these fixtures and assertions:

  ```tsx
  import { fireEvent, render, screen } from "@testing-library/react";

  it("shows the focused editor, navigator, and one next action for a drafting item", () => {
    render(<CreatorStudioWorkbench workspace={draftingWorkspace()} />);
    expect(screen.getByRole("heading", { name: "Spring launch mission" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Deliverables" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Caption" })).toHaveValue("Draft caption");
    expect(screen.getByRole("button", { name: "Save draft" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit deliverable" })).toBeDisabled();
  });

  it("shows requested changes and enables resubmit only after the checklist/assets are ready", () => {
    render(<CreatorStudioWorkbench workspace={changesRequestedWorkspace()} />);
    expect(screen.getByRole("region", { name: "Review feedback" })).toHaveTextContent("Add the disclosure line");
    expect(screen.getByRole("button", { name: "Resubmit deliverable" })).toBeEnabled();
  });

  it("keeps upload errors retryable without discarding the draft", async () => {
    mockUploadGrantRejectedOnce();
    render(<CreatorStudioWorkbench workspace={draftingWorkspace()} />);
    fireEvent.upload(screen.getByLabelText("Proof asset"), new File(["x"], "proof.png", { type: "image/png" }));
    expect(await screen.findByText("Upload failed. Retry without losing your draft.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Caption" })).toHaveValue("Draft caption");
    expect(screen.getByRole("button", { name: "Retry upload" })).toBeInTheDocument();
  });
  ```

- [ ] **Step 2: Run the component tests to confirm the focused UI is absent.**

  ```powershell
  npm.cmd test -- src/components/creator-studio/CreatorStudioWorkbench.test.tsx src/routes/-_app.my.$submissionId.test.tsx
  ```

  Expected: FAIL because the Creator Studio components are not present.

- [ ] **Step 3: Implement the workbench composition.**

  Use this component contract and layout:

  ```ts
  export type CreatorStudioWorkbenchProps = {
    workspace: SubmissionWorkspace;
  };

  export function CreatorStudioWorkbench({ workspace }: CreatorStudioWorkbenchProps) {
    // Header: mission title, workflow state, deadline, save/submission status.
    // Main: compact DeliverableNavigator + active DraftEditor/AssetUploadPanel.
    // Aside: NextActionPanel + ReviewFeedback when feedback is available.
  }
  ```

  Use semantic `<main>`, `<nav aria-label="Deliverables">`, `<section>` headings, visible labels, `aria-current="step"` for the selected item, and keyboard-operable buttons. On wide screens use a three-column grid with the navigator narrow, workbench dominant, and next-action panel narrow. On small screens stack the navigator above the active workbench and move the next-action panel below it. Keep the active work item in local state by ID, not by array index, so a refreshed projection cannot edit the wrong deliverable.

- [ ] **Step 4: Implement each focused component with explicit state behavior.**

  - `WorkspaceHeader` renders the mission title, current workflow state, deadline, and a non-blocking “Saved”/“Saving…”/“Save failed” indicator.
  - `DeliverableNavigator` renders ordered item titles and state badges; clicking a row changes only the active item and never submits or discards the draft.
  - `DraftEditor` debounces or explicitly saves caption, external URL, and checklist values with the current draft version; it disables submit until the server projection reports readiness and displays `version_conflict` as “This draft changed elsewhere. Reload the latest draft.”
  - `AssetUploadPanel` requests a command-specific grant, uploads through the returned signed token, finalizes the same asset ID, and exposes retry for grant/upload/finalize failures without clearing draft fields.
  - `ReviewFeedback` renders open feedback in `changes_requested`, resolved feedback in history, and the approved summary in `approved`; it never exposes internal reviewer IDs or audit payloads.
  - `NextActionPanel` renders the authoritative `workspace.nextAction` as exactly one primary label: “Start drafting”, “Finish draft”, “Upload proof”, “Submit deliverable”, “Review requested changes”, “Resubmit deliverable”, or “Approved”. Secondary details can explain prerequisites but cannot create a second competing primary action; if the next action belongs to another item, the panel identifies that item and offers navigation to it.

- [ ] **Step 5: Add route-level integration tests for the full creator journey.**

  Use the in-memory/mocked API sequence:

  ```text
  joined + not_started
    -> save draft
    -> finalize asset
    -> submit
    -> changes_requested + feedback
    -> save correction
    -> resubmit
    -> approved
  ```

  Assert that each successful mutation invalidates the submission-specific query key, that the selected work item remains stable after refetch, and that a `404 submission_not_found` renders a safe not-found page rather than an empty editor.

  Include an approved fixture that renders a completion summary and either “Continue to next deliverable” or the terminal approved state. Include a context-change test that changes `submissionId` and verifies pending command IDs and local draft state from the previous submission are cleared before the next workspace is rendered.

  Include pending, finalized, failed, and retryable asset fixtures; verify a draft remains present after a failed grant/upload/finalize operation and after navigating to another work item and back.

- [ ] **Step 6: Run the focused UI tests and quality checks.**

  ```powershell
  npm.cmd test -- src/components/creator-studio/CreatorStudioWorkbench.test.tsx src/routes/-_app.my.$submissionId.test.tsx src/routes/-_app.my.test.tsx
  npm.cmd run lint -- src/components/creator-studio src/routes/_app.my.tsx src/routes/_app.my.$submissionId.tsx src/lib/queries/creatorStudio.ts
  npm.cmd run type-check
  ```

  Expected: all workbench/list/route tests PASS, lint reports no new violations in the listed paths, and TypeScript passes.

- [ ] **Step 7: Commit the focused workbench UI.**

  ```powershell
  git add src/components/creator-studio/WorkspaceHeader.tsx src/components/creator-studio/DeliverableNavigator.tsx src/components/creator-studio/DraftEditor.tsx src/components/creator-studio/AssetUploadPanel.tsx src/components/creator-studio/ReviewFeedback.tsx src/components/creator-studio/NextActionPanel.tsx src/components/creator-studio/CreatorStudioWorkbench.tsx src/components/creator-studio/CreatorStudioWorkbench.test.tsx src/routes/_app.my.$submissionId.tsx src/routes/-_app.my.$submissionId.test.tsx
  git diff --cached --name-only
  git commit -m "feat: add focused creator studio workbench"
  ```

  Expected: only the Creator Studio UI and its route test files are staged.

---

### Task 6: Add observability, isolated acceptance coverage, and final verification

**Files:**
- Create: `server/lib/creatorStudio/metrics.ts`
- Modify: `server/lib/creatorStudio/supabaseRepository.ts`
- Modify: `server/routes/creatorStudio.ts`
- Create: `server/test/creator-studio-integration.test.ts`
- Modify: `server/test/creator-studio-schema.test.ts`

**Interfaces:**
- Consumes: completed server/client workflow and command contracts from Tasks 1–5.
- Produces: an evidence-backed acceptance report for the creator journey and a release-safe handoff with no external mutation.

- [ ] **Step 1: Add an allowlisted metrics seam.**

  Implement `recordCreatorStudioEvent(event)` with only these event names: `workspace_opened`, `draft_saved`, `asset_finalized`, `work_item_submitted`, `changes_viewed`, `work_item_resubmitted`, and `work_item_approved`. Include `workspaceId`, `submissionId`, `workItemId`, `commandId` when available, and `createdAt`; never include caption text, checklist contents, asset bytes, signed tokens, or raw URLs. Route/repository tests should inject a spy sink rather than requiring an analytics provider.

- [ ] **Step 2: Add opt-in Supabase/RLS acceptance tests.**

  Follow the existing `hasSupabaseEnv`, `serviceForTests`, creator fixture, and `cleanup` conventions. When the required test environment is absent, the suite must be skipped with the repository's standard skip behavior. When enabled, cover:

  1. A joined submission creates one workflow and ordered work items.
  2. The creator sees the workspace; a second creator receives no data and cannot write.
  3. Draft save writes exactly one current draft, one immutable version, one command row, and one event.
  4. Identical replay returns the original snapshot without duplicate command/event/version rows.
  5. A changed payload with the same command ID returns `command_conflict`.
  6. A full draft with a finalized asset submits, while a missing prerequisite returns `invalid_transition`.
  7. A request after `changes_requested` can resubmit, and an approved item is immutable to creator commands.
  8. Ordinary deliverable asset reads and writes cannot address publication-proof rows or publication-proof storage paths.

- [ ] **Step 3: Run the full verification matrix.**

  Run in this order:

  ```powershell
  npm.cmd test -- server/test/creator-studio-repository.test.ts server/test/creator-studio-schema.test.ts server/test/creator-studio-route.test.ts server/test/creator-studio-mutations.test.ts server/test/creator-studio-integration.test.ts src/routes/-_app.my.test.tsx src/routes/-_app.my.$submissionId.test.tsx src/components/creator-studio/CreatorStudioWorkbench.test.tsx
  npm.cmd run check:esm
  npm.cmd run type-check
  npm.cmd run lint
  npm.cmd run build
  git diff --check HEAD~6 HEAD
  git status --short --branch
  ```

  Expected: focused tests PASS (or the explicitly environment-skipped integration suite), ESM/type/lint/build PASS, `git diff --check` emits no whitespace errors, and status shows only pre-existing unrelated untracked artifacts plus the intended branch commits. Do not run a live Supabase migration, production seed, deployment, or external upload acceptance from this task.

- [ ] **Step 4: Review the final diff against the approved design.**

  Confirm the final diff demonstrates: one strict workspace projection, focused three-zone workbench, all five API contracts, every mutation through the repository adapter, owner/RLS/storage isolation, stable command replay, requested-change/resubmit behavior, and isolated acceptance coverage. Confirm no files under `worktrees/creator-activation-spine` changed and no unrelated untracked file is staged.

- [ ] **Step 5: Commit observability and acceptance coverage.**

  ```powershell
  git add server/lib/creatorStudio/metrics.ts server/lib/creatorStudio/supabaseRepository.ts server/routes/creatorStudio.ts server/test/creator-studio-integration.test.ts server/test/creator-studio-schema.test.ts
  git diff --cached --name-only
  git commit -m "test: verify creator studio mission journey"
  ```

  Expected: only the metrics, adapter/route wiring, and acceptance/schema test paths are staged.

---

## Self-Review Checklist

### Spec coverage

- Goals and non-goals are implemented by Tasks 1–5 and enforced by the global constraints.
- The accepted → drafting → ready → submitted → changes requested → resubmitted → approved journey is covered by the lifecycle types, state-refresh function, in-memory tests, UI fixtures, and Task 6 acceptance tests.
- The workspace projection and focused-workbench data flow are covered by Tasks 2, 4, and 5.
- Atomic writes, replay/conflict behavior, RLS, owner checks, safe 404s, storage ownership, and retry behavior are covered by Tasks 1–3 and Task 6.
- Observability, isolated tests, verification commands, and rollout boundaries are covered by Task 6.

### Placeholder and consistency checks

- Before execution handoff, run the writing-plans no-placeholder scan against this file and require no matches.
- All later tasks use the same `CreatorStudioRepository`, `CreatorStudioContext`, state unions, command input names, route paths, and query key defined in Task 1.
- The SQL command example in Task 3 is an implementation ordering contract; the committed migration must replace every illustrative ellipsis with named SQL columns before it is considered complete.
- The current branch gap and reference-worktree boundary are explicit, so the implementation does not silently depend on or mutate the adjacent active-mission worktree.
