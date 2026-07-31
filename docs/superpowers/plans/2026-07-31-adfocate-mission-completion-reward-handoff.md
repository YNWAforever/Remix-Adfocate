# Adfocate Mission Completion and Reward Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an auditable transition from verified publication proof to a durable `reward_pending` finance handoff without issuing rewards or changing legacy financial state.

**Architecture:** Add immutable reward contracts, append-only completion decisions, and guarded pending-reward handoffs beside the active-mission workflow. Server-controlled, workspace-scoped transactions own contract backfill, completion approval, cancellation, SLA snapshots, events, and idempotency; creator, operator, and finance screens consume the same projections.

**Tech Stack:** PostgreSQL/Supabase migrations and RPCs, Hono API routes, TypeScript, React 19, TanStack Router and Query, Vitest/Testing Library, Tailwind CSS, English and Traditional Chinese dictionaries.

**Design source:** `docs/superpowers/specs/2026-07-31-adfocate-mission-completion-reward-handoff-design.md`

## Global Constraints

- `reward_pending` never credits points, cash, earnings, or XP and never mutates workspace budgets.
- Legacy `mission_submissions.status`, `approve_submission`, issued-reward ledgers, earnings, point balances, XP, redemptions, and budget transactions remain behaviorally unchanged.
- Completion requires all required work items to be `proof_verified`; optional items never block completion.
- Reward facts come from one immutable join-time contract. Existing workflows require explicit audited backfill.
- XP is `0` until an explicit mission XP reward exists; the legacy fixed approval XP is not silently presented as a joined promise.
- Workspace processing windows use calendar days. A missing setting produces `targetAt: null` and honest no-date copy.
- Approval and cancellation use expected revisions, normalized-payload idempotency, row locking, and append-only decisions.
- Cancellation is allowed only while a handoff is `pending`; it returns the workflow to `proof_verified` without modifying proof history.
- Creator and staff reads are workspace-scoped; cross-workspace identifiers must not reveal record existence.
- Notifications are in-app only, privacy-safe, deduplicated, and failure-isolated from workflow transactions.
- All user-visible copy ships in English and Traditional Chinese with keyboard, focus, live-region, responsive, and color-independent behavior.
- Do not add a payment provider, queue dependency, holiday calendar, formal dispute model, or external notification channel.

## File Map

| Responsibility | Files |
| --- | --- |
| Schema and constraints | `supabase/migrations/20260731100000_reward_handoff_schema.sql`, `server/test/active-mission-schema.test.ts` |
| Reward contract capture/backfill/SLA | `supabase/migrations/20260731110000_reward_contract_capture.sql`, `server/test/reward-contracts.test.ts`, `server/routes/missions.ts` |
| Approval and cancellation transactions | `supabase/migrations/20260731120000_reward_handoff_transitions.sql`, `server/test/reward-handoffs.test.ts` |
| Shared server domain | `server/lib/activeMission/rewardHandoff.ts`, `server/lib/activeMission/types.ts`, `server/lib/activeMission/repo.ts` |
| Staff APIs | `server/routes/adminRewardHandoffs.ts`, `server/routes/admin.ts`, `server/test/admin-reward-handoffs.test.ts` |
| Creator projection | `server/lib/activeMission/repo.ts`, `src/lib/activeMission.ts`, `src/lib/queries/activeMission.ts` |
| Notifications and metrics | `supabase/migrations/20260731130000_reward_handoff_notifications.sql`, `src/lib/notifications.ts`, `src/lib/i18n.dict.ts`, `server/lib/activeMission/metrics.ts` |
| Client admin API | `src/lib/adminRewardHandoff.ts`, `src/lib/adminRewardHandoff.test.ts` |
| Operator completion UI | `src/components/admin/MissionCompletionReview.tsx`, `src/routes/admin.active-missions.$workflowId.tsx` |
| Creator pending UI | `src/components/active-mission/RewardPendingCard.tsx`, `src/routes/_app.my.$submissionId.tsx` |
| Finance queue and settings | `src/components/admin/RewardHandoffQueue.tsx`, `src/routes/admin.reward-handoffs.tsx`, `src/components/admin/adminNavItems.ts` |
| Acceptance and operations | `scripts/seed-reward-handoff-acceptance.ts`, `scripts/run-integration-tests.mjs`, `docs/operations/reward-handoff.md` |

---

### Task 1: Add the reward-handoff schema and shared states

**Files:**
- Create: `supabase/migrations/20260731100000_reward_handoff_schema.sql`
- Modify: `server/test/active-mission-schema.test.ts`
- Modify: `server/lib/activeMission/types.ts`
- Modify: `src/lib/activeMission.ts`
- Test: `server/test/active-mission-schema.test.ts`
- Test: `src/lib/activeMission.test.ts`

**Interfaces:**
- Produces: `WorkflowState` with `"reward_pending"`.
- Produces: `RewardContract`, `CompletionDecision`, `PendingReward`, and `RewardHandoffStatus` TypeScript types.
- Produces tables consumed by Tasks 2–10.

- [ ] **Step 1: Write failing schema assertions**

Add a test that reads the new migration and asserts the three tables, immutable/guarded triggers, partial unique index, workspace SLA column, workflow state, grants, and empty search paths:

```ts
it("defines an additive, reward-neutral handoff schema", () => {
  const sql = readFileSync(
    resolve("supabase/migrations/20260731100000_reward_handoff_schema.sql"),
    "utf8",
  );
  expect(sql).toContain("create table public.mission_reward_contracts");
  expect(sql).toContain("create table public.mission_completion_decisions");
  expect(sql).toContain("create table public.mission_pending_rewards");
  expect(sql).toContain("reward_processing_window_days");
  expect(sql).toContain("'reward_pending'");
  expect(sql).toContain("where status = 'pending'");
  expect(sql).toContain("set search_path = ''");
  expect(sql).toContain("revoke all");
  expect(sql).not.toContain("approve_submission(");
});
```

- [ ] **Step 2: Run the schema test and confirm RED**

Run:

```powershell
npx.cmd vitest run server/test/active-mission-schema.test.ts
```

Expected: FAIL because `20260731100000_reward_handoff_schema.sql` does not exist.

- [ ] **Step 3: Create the forward-only schema migration**

Implement these exact boundaries:

```sql
alter table public.workspaces
  add column reward_processing_window_days smallint
  check (reward_processing_window_days between 0 and 365);

alter table public.mission_workflows
  add column revision integer not null default 0 check (revision >= 0),
  drop constraint if exists mission_workflows_state_check,
  add constraint mission_workflows_state_check check (
    state in (
      'accepted','fulfillment_pending','drafting','in_review','revision_requested',
      'approved_to_publish','publication_in_progress','proof_verified',
      'reward_pending','cancelled','expired'
    )
  );

create table public.mission_reward_contracts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  mission_workflow_id uuid not null unique references public.mission_workflows(id),
  mission_submission_id uuid not null references public.mission_submissions(id),
  mission_id uuid not null references public.missions(id),
  points_amount integer not null check (points_amount >= 0),
  cash_amount numeric(10,2) not null check (cash_amount >= 0),
  currency text not null default 'HKD' check (currency ~ '^[A-Z]{3}$'),
  xp_amount integer not null default 0 check (xp_amount >= 0),
  source text not null check (source in ('join','operator_backfill')),
  source_mission_updated_at timestamptz,
  confirmed_by uuid references auth.users(id),
  confirmation_evidence_source text check (
    confirmation_evidence_source in ('mission_brief','signed_agreement','operator_record','other')
  ),
  confirmation_reason text,
  created_at timestamptz not null default now(),
  check (
    (source = 'join' and confirmed_by is null
      and confirmation_evidence_source is null and confirmation_reason is null)
    or
    (source = 'operator_backfill' and confirmed_by is not null
      and confirmation_evidence_source is not null
      and nullif(btrim(confirmation_reason), '') is not null)
  )
);

create table public.mission_completion_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  mission_workflow_id uuid not null references public.mission_workflows(id),
  decision_kind text not null check (decision_kind in ('approved','cancelled')),
  reward_contract_id uuid not null references public.mission_reward_contracts(id),
  pending_reward_id uuid,
  supersedes_decision_id uuid references public.mission_completion_decisions(id),
  workflow_revision integer not null check (workflow_revision >= 0),
  required_item_count integer not null check (required_item_count >= 0),
  verified_required_item_count integer not null check (verified_required_item_count >= 0),
  evidence_snapshot jsonb not null check (jsonb_typeof(evidence_snapshot) = 'object'),
  reason_category text,
  reason_note text,
  decided_by uuid not null references auth.users(id),
  decided_at timestamptz not null default now(),
  idempotency_key uuid not null,
  request_hash text not null check (btrim(request_hash) <> ''),
  unique (workspace_id, idempotency_key)
);

create table public.mission_pending_rewards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  mission_workflow_id uuid not null references public.mission_workflows(id),
  mission_submission_id uuid not null references public.mission_submissions(id),
  creator_id uuid not null references public.creators(id),
  mission_id uuid not null references public.missions(id),
  reward_contract_id uuid not null references public.mission_reward_contracts(id),
  completion_decision_id uuid not null unique references public.mission_completion_decisions(id),
  points_amount integer not null check (points_amount >= 0),
  cash_amount numeric(10,2) not null check (cash_amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  xp_amount integer not null check (xp_amount >= 0),
  status text not null default 'pending' check (status in ('pending','cancelled')),
  processing_window_days smallint check (processing_window_days between 0 and 365),
  target_at timestamptz,
  cancellation_decision_id uuid unique references public.mission_completion_decisions(id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

alter table public.mission_completion_decisions
  add constraint mission_completion_decisions_pending_reward_fk
  foreign key (pending_reward_id) references public.mission_pending_rewards(id);

create unique index mission_pending_rewards_one_pending_idx
  on public.mission_pending_rewards (mission_workflow_id)
  where status = 'pending';
```

Add indexes on every `(workspace_id, ...)` read path. Enable RLS and deny raw table access to browser roles; raw completion decisions contain operator audit notes. Creator reads use the bounded ownership-checking RPC added in Task 3, while staff APIs use service-role reads only after active `brand_users` membership is verified.

Create:

```sql
private.guard_reward_contract_immutable()
private.guard_completion_decision_immutable()
private.guard_pending_reward_update()
```

The pending guard permits only `status`, `cancellation_decision_id`, and `cancelled_at` to change together from `pending` to `cancelled`. Revoke execution from all roles.

- [ ] **Step 4: Add matching server and client domain types**

In both `server/lib/activeMission/types.ts` and `src/lib/activeMission.ts`, add:

```ts
export type RewardHandoffStatus = "pending" | "cancelled";

export type RewardContract = {
  id: string;
  pointsAmount: number;
  cashAmount: number;
  currency: string;
  xpAmount: number;
  source: "join" | "operator_backfill";
  createdAt: string;
};

export type PendingReward = {
  id: string;
  status: RewardHandoffStatus;
  reward: Pick<RewardContract, "pointsAmount" | "cashAmount" | "currency" | "xpAmount">;
  processingWindowDays: number | null;
  targetAt: string | null;
  createdAt: string;
  cancelledAt: string | null;
};
```

Add `"reward_pending"` to both `WorkflowState` unions.
Add `revision: number` to the server and client `MissionWorkflow` projections.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run:

```powershell
npx.cmd vitest run server/test/active-mission-schema.test.ts src/lib/activeMission.test.ts
```

Expected: both files pass.

- [ ] **Step 6: Commit Task 1**

```powershell
git add supabase/migrations/20260731100000_reward_handoff_schema.sql server/test/active-mission-schema.test.ts server/lib/activeMission/types.ts src/lib/activeMission.ts
git commit -m "feat: add reward handoff schema"
```

---

### Task 2: Capture join-time contracts and support audited backfill and SLA settings

**Files:**
- Create: `supabase/migrations/20260731110000_reward_contract_capture.sql`
- Create: `server/test/reward-contracts.test.ts`
- Modify: `server/test/active-mission-schema.test.ts`
- Modify: `server/routes/missions.ts`
- Test: `server/test/reward-contracts.test.ts`
- Test: `server/test/active-missions.test.ts`

**Interfaces:**
- Produces RPCs:
  - `public.backfill_mission_reward_contract(uuid, uuid, uuid, integer, numeric, text, integer, timestamptz, text, text, uuid) -> jsonb`
  - `public.set_reward_processing_window(uuid, uuid, smallint) -> jsonb`
- Produces join-triggered contracts with `xp_amount = 0`.

- [ ] **Step 1: Write failing live tests**

Add integration tests guarded by `RUN_INTEGRATION`:

```ts
it("captures one immutable reward contract when an active workflow is created", async () => {
  const joined = await joinActiveWorkspaceMission();
  const contract = await rewardContractFor(joined.workflow.id);
  expect(contract).toMatchObject({
    source: "join",
    points_amount: joined.mission.points_reward,
    cash_amount: joined.mission.cash_reward ?? 0,
    currency: "HKD",
    xp_amount: 0,
  });
});

it("requires audited staff provenance for an existing-workflow backfill", async () => {
  const result = await backfillRewardContract({
    sourceMissionUpdatedAt: null,
    confirmationReason: "",
  });
  expect(result.error?.message).toContain("backfill_reason_required");
});
```

Also snapshot the contract, edit the mission reward fields, and assert the contract is unchanged.

- [ ] **Step 2: Run the live test and confirm RED**

Run:

```powershell
$env:RUN_INTEGRATION='1'; npx.cmd vitest run --no-file-parallelism server/test/reward-contracts.test.ts
```

Expected: FAIL because contract capture and RPCs are absent.

- [ ] **Step 3: Implement atomic join-time capture**

Do not use a generic workflow-insert trigger: a historical joined submission can create its workflow later, and silently snapshotting current mission values would violate the audited-backfill rule.

Create a dedicated authenticated RPC used only for a fresh active-workspace join:

```sql
create or replace function public.join_active_mission(p_mission uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.mission_submissions;
  v_workflow public.mission_workflows;
  v_contract public.mission_reward_contracts;
begin
  v_submission := public.join_mission(p_mission);
  v_workflow := private.create_mission_workflow(v_submission.id);

  insert into public.mission_reward_contracts (
    workspace_id, mission_workflow_id, mission_submission_id, mission_id,
    points_amount, cash_amount, currency, xp_amount,
    source, source_mission_updated_at
  )
  select
    v_workflow.workspace_id, v_workflow.id, v_submission.id, mission.id,
    mission.points_reward, coalesce(mission.cash_reward, 0), 'HKD', 0,
    'join', mission.updated_at
  from public.missions mission
  where mission.id = v_submission.mission_id
    and mission.workspace_id = v_submission.workspace_id
  returning * into v_contract;

  if not found then raise exception 'reward_contract_source_missing'; end if;
  return jsonb_build_object(
    'submission', to_jsonb(v_submission),
    'workflow', to_jsonb(v_workflow),
    'rewardContract', to_jsonb(v_contract)
  );
end;
$$;
```

Revoke public/anonymous execution and grant only `authenticated`. Keep `private.create_mission_workflow` revoked.

Update `joinMissionWithWorkflowRecovery()` so a fresh active-workspace join calls `join_active_mission` once. Its existing `already_joined` recovery may create a missing workflow but must not create a contract; the operator backfill remains mandatory. Add tests for both branches.
- [ ] **Step 4: Implement audited backfill and workspace SLA RPCs**

The backfill RPC must:

- lock the workflow;
- resolve its submission and mission in the supplied workspace;
- verify an active `brand_users` membership for `p_operator`;
- reject an existing contract;
- require non-negative values, ISO currency, one bounded evidence source, source timestamp when known, and a non-empty reason;
- insert `source = 'operator_backfill'`; and
- return `{ contract, idempotent: false }`.

The SLA RPC must verify the same staff membership and update only:

```sql
update public.workspaces
set reward_processing_window_days = p_days
where id = p_workspace;
```

Allow `p_days` to be null to remove the promise. Grant both public wrappers only to `service_role`; keep private helpers unexecutable.

- [ ] **Step 5: Run contract tests and confirm GREEN**

Run:

```powershell
$env:RUN_INTEGRATION='1'; npx.cmd vitest run --no-file-parallelism server/test/reward-contracts.test.ts server/test/active-missions.test.ts
```

Expected: all contract and active-mission tests pass.

- [ ] **Step 6: Commit Task 2**

```powershell
git add supabase/migrations/20260731110000_reward_contract_capture.sql server/test/reward-contracts.test.ts server/test/active-mission-schema.test.ts server/routes/missions.ts
git commit -m "feat: freeze active mission reward contracts"
```

---

### Task 3: Add atomic completion approval and cancellation

**Files:**
- Create: `supabase/migrations/20260731120000_reward_handoff_transitions.sql`
- Create: `server/test/reward-handoffs.test.ts`
- Modify: `server/test/active-mission-schema.test.ts`
- Test: `server/test/reward-handoffs.test.ts`

**Interfaces:**
- Produces:
  - `public.approve_mission_completion(...) -> jsonb`
  - `public.cancel_mission_reward_handoff(...) -> jsonb`
  - `public.get_my_mission_reward_handoff(uuid) -> jsonb`
- Returns `{ workflow, decision, pendingReward, idempotent }`.

- [ ] **Step 1: Write failing approval, neutrality, retry, and cancellation tests**

Cover:

```ts
it("approves only when every required item is proof_verified", async () => {
  const fixture = await seedRewardHandoffFixture({ requiredStates: ["proof_verified", "proof_verified"] });
  const before = await creatorRewardSnapshot(fixture.creatorId, fixture.workspaceId);
  const approved = await approveCompletion(fixture);
  expect(approved.workflow.state).toBe("reward_pending");
  expect(approved.pendingReward.status).toBe("pending");
  expect(await creatorRewardSnapshot(fixture.creatorId, fixture.workspaceId)).toEqual(before);
});

it("returns the original result for an identical idempotent retry", async () => {
  const first = await approveCompletion(fixture, key);
  const retry = await approveCompletion(fixture, key);
  expect(retry.pendingReward.id).toBe(first.pendingReward.id);
  expect(retry.idempotent).toBe(true);
});

it("cancels append-only and returns the workflow to proof_verified", async () => {
  const approved = await approveCompletion(fixture);
  const cancelled = await cancelHandoff(approved, {
    reasonCategory: "contract_error",
    reasonNote: "Confirmed contract requires reassessment.",
  });
  expect(cancelled.workflow.state).toBe("proof_verified");
  expect(cancelled.pendingReward.status).toBe("cancelled");
});
```

Add required-item, optional-item, stale revision, cross-workspace, concurrent approval, changed-payload key, repeated cancellation, and database rollback cases.

- [ ] **Step 2: Run and confirm RED**

```powershell
$env:RUN_INTEGRATION='1'; npx.cmd vitest run --no-file-parallelism server/test/reward-handoffs.test.ts
```

Expected: FAIL because transition RPCs do not exist.

- [ ] **Step 3: Implement normalized request hashing and idempotency**

Both RPCs must build a stable hash with `digest(convert_to(..., 'UTF8'), 'sha256')` over action, workflow, expected state, revision, and normalized fields.

Before a new mutation:

```sql
select decision.*, pending.*
from public.mission_completion_decisions decision
left join public.mission_pending_rewards pending
  on pending.completion_decision_id = decision.id
where decision.workspace_id = p_workspace
  and decision.idempotency_key = p_idempotency_key;
```

Return the original result when hashes match. Raise `idempotency_conflict` when they differ.

- [ ] **Step 4: Implement approval in one transaction**

The RPC must:

1. verify staff workspace membership;
2. lock `mission_workflows FOR UPDATE`;
3. require `state = 'proof_verified'` and expected revision;
4. select the immutable contract;
5. count required items and require every required item to be `proof_verified`;
6. build an evidence snapshot from exact accepted proof attempts;
7. insert the approval decision;
8. insert the pending reward with the workspace SLA snapshot and:

```sql
target_at := case
  when v_processing_days is null then null
  else v_now + make_interval(days => v_processing_days)
end;
```

9. leave the immutable approval decision's `pending_reward_id` null; the pending record already references it through `completion_decision_id`;
10. update workflow state to `reward_pending`, increment `revision`, and set `updated_at = v_now`;
11. append `mission_completion_approved` to `mission_workflow_events`.

Do not call `approve_submission`.

- [ ] **Step 5: Implement guarded cancellation**

Use reason categories:

```sql
('contract_error','eligibility_error','duplicate','other')
```

Require a non-empty note, lock the workflow and handoff, require `reward_pending` plus `pending`, insert a cancellation decision, set the handoff's three permitted cancellation fields, return the workflow to `proof_verified` while incrementing `revision` and updating `updated_at`, and append `mission_reward_pending_cancelled`.

Create `public.get_my_mission_reward_handoff(p_submission uuid)` for `authenticated`. It verifies `auth.uid()` owns the submission and returns only the frozen reward, status, processing window, target, timestamps, and bounded decision state. It never returns operator notes, backfill reasons, idempotency values, request hashes, or cross-workspace existence.

- [ ] **Step 6: Run live transition tests and confirm GREEN**

```powershell
$env:RUN_INTEGRATION='1'; npx.cmd vitest run --no-file-parallelism server/test/reward-handoffs.test.ts server/test/active-mission-schema.test.ts
```

Expected: all tests pass with exact reward/budget neutrality.

- [ ] **Step 7: Commit Task 3**

```powershell
git add supabase/migrations/20260731120000_reward_handoff_transitions.sql server/test/reward-handoffs.test.ts server/test/active-mission-schema.test.ts
git commit -m "feat: add mission completion reward handoff"
```

---

### Task 4: Add workspace-scoped server services, routes, and projections

**Files:**
- Create: `server/lib/activeMission/rewardHandoff.ts`
- Create: `server/routes/adminRewardHandoffs.ts`
- Create: `server/test/admin-reward-handoffs.test.ts`
- Modify: `server/routes/admin.ts`
- Modify: `server/lib/activeMission/repo.ts`
- Modify: `server/routes/adminActiveMissions.ts`
- Modify: `server/test/active-missions.test.ts`
- Modify: `server/test/active-missions-publication-operator.test.ts`

**Interfaces:**
- Produces Hono routes:
  - `GET /api/admin/active-missions/:workflowId/completion`
  - `POST /api/admin/active-missions/:workflowId/reward-contract`
  - `POST /api/admin/active-missions/:workflowId/completion`
  - `POST /api/admin/active-missions/:workflowId/reward-handoff/cancel`
  - `GET /api/admin/reward-handoffs`
  - `PUT /api/admin/reward-handoffs/settings`
- Extends creator/admin projections with `rewardContract`, `completionEligibility`, and `pendingReward`.

- [ ] **Step 1: Write failing route contract tests**

Use an injected repository:

```ts
const routes = createAdminRewardHandoffRoutes(repository, () => ({ userId: operatorId }));
const response = await routes.request(`/active-missions/${workflowId}/completion`, {
  method: "POST",
  headers: { "X-Workspace-Slug": "alpha", "Content-Type": "application/json" },
  body: JSON.stringify({
    expectedState: "proof_verified",
    expectedRevision: 7,
    idempotencyKey: key,
  }),
});
expect(repository.approveCompletion).toHaveBeenCalledWith({
  workflowId,
  workspaceSlug: "alpha",
  operatorId,
  expectedState: "proof_verified",
  expectedRevision: 7,
  idempotencyKey: key,
});
```

Assert 400 validation, 401 missing staff, non-enumerating 403, stale 409, and normalized filters.

- [ ] **Step 2: Run and confirm RED**

```powershell
npx.cmd vitest run server/test/admin-reward-handoffs.test.ts
```

Expected: FAIL because the route module does not exist.

- [ ] **Step 3: Implement the focused domain service**

Export:

```ts
export type CompletionInput = {
  workflowId: string;
  workspaceId: string;
  operatorId: string;
  expectedState: "proof_verified";
  expectedRevision: number;
  idempotencyKey: string;
};

export type CancellationInput = {
  workflowId: string;
  workspaceId: string;
  operatorId: string;
  expectedState: "reward_pending";
  expectedRevision: number;
  idempotencyKey: string;
  reasonCategory: "contract_error" | "eligibility_error" | "duplicate" | "other";
  reasonNote: string;
};
```

Implement validators, safe RPC error mapping, and projection normalization in `rewardHandoff.ts`. Keep route parsing in `adminRewardHandoffs.ts`; do not enlarge `adminActiveMissions.ts` with the new mutation family.

- [ ] **Step 4: Implement and mount the staff routes**

Mount in `server/routes/admin.ts`:

```ts
adminRoutes.route("/", adminRewardHandoffRoutes);
```

Use the existing staff middleware and verify active `brand_users` membership before calling service-role RPCs. Treat body workspace values as untrusted; use the authorized `X-Workspace-Slug` context.

- [ ] **Step 5: Extend creator and operator detail projections**

Add:

```ts
type RewardHandoffProjection = {
  rewardContract: RewardContract | null;
  completionEligibility: {
    eligible: boolean;
    blockers: Array<
      "wrong_state" | "required_proof_incomplete" | "reward_contract_required" | "pending_reward_exists"
    >;
    requiredItemCount: number;
    verifiedRequiredItemCount: number;
  };
  pendingReward: PendingReward | null;
};
```

Creator projections call `get_my_mission_reward_handoff` and omit operator notes and backfill reasons. Operator projections include contract provenance and decision evidence. Neither projection includes signed proof URLs inside reward-handoff objects.

- [ ] **Step 6: Run focused server tests and confirm GREEN**

```powershell
npx.cmd vitest run server/test/admin-reward-handoffs.test.ts server/test/active-missions.test.ts server/test/active-missions-publication-operator.test.ts
```

Expected: all route and projection tests pass.

- [ ] **Step 7: Commit Task 4**

```powershell
git add server/lib/activeMission/rewardHandoff.ts server/routes/adminRewardHandoffs.ts server/routes/admin.ts server/lib/activeMission/repo.ts server/routes/adminActiveMissions.ts server/test/admin-reward-handoffs.test.ts server/test/active-missions.test.ts server/test/active-missions-publication-operator.test.ts
git commit -m "feat: expose reward handoff APIs"
```

---

### Task 5: Add failure-isolated notifications and operational metrics

**Files:**
- Create: `supabase/migrations/20260731130000_reward_handoff_notifications.sql`
- Modify: `server/test/notifications-triggers.test.ts`
- Modify: `server/lib/activeMission/metrics.ts`
- Modify: `server/lib/activeMission/metrics.test.ts`
- Modify: `src/lib/notifications.ts`
- Modify: `src/lib/notifications.test.ts`
- Modify: `src/lib/activationAnalytics.ts`
- Modify: `src/lib/activationAnalytics.test.ts`
- Modify: `src/lib/i18n.dict.ts`

**Interfaces:**
- Produces notification types `mission_reward_pending` and `mission_reward_pending_cancelled`.
- Produces `calculateRewardHandoffOperationalMetrics(rows, now)`.

- [ ] **Step 1: Write failing notification and metric tests**

Assert one deduplicated creator notification per decision, bounded payload keys, failure isolation, href to `/my/:submissionId`, both locales, privacy-safe analytics contracts, and:

```ts
expect(calculateRewardHandoffOperationalMetrics(rows, now)).toEqual({
  pendingCount: 2,
  overdueCount: 1,
  cancellationRate: 0.25,
  medianProofVerifiedToPendingMinutes: 90,
  missingContractCount: 3,
});
```

- [ ] **Step 2: Run and confirm RED**

```powershell
npx.cmd vitest run server/test/notifications-triggers.test.ts server/lib/activeMission/metrics.test.ts src/lib/notifications.test.ts src/lib/activationAnalytics.test.ts
```

Expected: FAIL because types, renderer copy, and metrics are absent.

- [ ] **Step 3: Add notification constraints and trigger**

Preserve every existing notification type and append:

```sql
'mission_reward_pending',
'mission_reward_pending_cancelled'
```

Observe `mission_completion_approved` and `mission_reward_pending_cancelled` events. Rebuild payload from only:

```text
mission_title, mission_slug, submission_id, target_at, reward_components, reason_category
```

Use the existing `private.mission_workflow_notification_dedupe` transaction pattern. Catch notification exceptions and return the inserted workflow event unchanged.

- [ ] **Step 4: Add renderer copy and metrics**

Add explicit EN/zh titles and bodies. `hrefFor()` returns the exact creator mission route. `reward_components` is a bounded array from `points`, `cash`, and `xp`; do not include amounts.

Implement metrics with invalid timestamps and non-finite values excluded from both numerator and denominator.

Add these typed activation events and value validators:

```ts
type RewardHandoffAnalyticsEvent =
  | "mission_completion_review_viewed"
  | "mission_completion_approved"
  | "mission_reward_pending_viewed"
  | "mission_reward_pending_cancelled"
  | "mission_reward_support_selected"
  | "reward_handoff_queue_viewed"
  | "reward_handoff_queue_filtered";
```

Allow only mission ID, locale, device category, workflow state, contract source, bounded error category, and booleans for points/cash/XP presence. Reject amounts, notes, URLs, handles, emails, paths, and raw errors even when placed under an allowlisted key.

- [ ] **Step 5: Run focused tests and confirm GREEN**

```powershell
npx.cmd vitest run server/test/notifications-triggers.test.ts server/lib/activeMission/metrics.test.ts src/lib/notifications.test.ts src/lib/activationAnalytics.test.ts
```

Expected: all files pass.

- [ ] **Step 6: Commit Task 5**

```powershell
git add supabase/migrations/20260731130000_reward_handoff_notifications.sql server/test/notifications-triggers.test.ts server/lib/activeMission/metrics.ts server/lib/activeMission/metrics.test.ts src/lib/notifications.ts src/lib/notifications.test.ts src/lib/activationAnalytics.ts src/lib/activationAnalytics.test.ts src/lib/i18n.dict.ts
git commit -m "feat: notify and measure reward handoffs"
```

---

### Task 6: Add typed client API and stable mutation retries

**Files:**
- Create: `src/lib/adminRewardHandoff.ts`
- Create: `src/lib/adminRewardHandoff.test.ts`
- Modify: `src/lib/activeMission.ts`
- Modify: `src/lib/queries/activeMission.ts`
- Modify: `src/lib/queries/activeMission.test.tsx`

**Interfaces:**
- Produces:
  - `fetchCompletionReview(workflowId, workspace)`
  - `backfillRewardContract(workflowId, input)`
  - `approveMissionCompletion(workflowId, input)`
  - `cancelRewardHandoff(workflowId, input)`
  - `fetchRewardHandoffs(filters)`
  - `setRewardProcessingWindow(days)`
- Produces React Query hooks with stable action signatures and invalidation.

- [ ] **Step 1: Write failing serialization and retry tests**

Assert exact routes, headers, body names, workspace header, error propagation, and that an ambiguous approval retry reuses one key while success, `WORKFLOW_STALE`, and `WRONG_STATE` clear it.

- [ ] **Step 2: Run and confirm RED**

```powershell
npx.cmd vitest run src/lib/adminRewardHandoff.test.ts src/lib/queries/activeMission.test.tsx
```

Expected: FAIL because client functions and projection fields are absent.

- [ ] **Step 3: Implement typed API contracts**

Use `adminFetch` and export:

```ts
export type ApproveCompletionInput = {
  workspace: string;
  expectedState: "proof_verified";
  expectedRevision: number;
  idempotencyKey: string;
};

export type CancelRewardHandoffInput = {
  workspace: string;
  expectedState: "reward_pending";
  expectedRevision: number;
  idempotencyKey: string;
  reasonCategory: "contract_error" | "eligibility_error" | "duplicate" | "other";
  reasonNote: string;
};
```

Normalize list filters with `URLSearchParams`; omit empty values.

- [ ] **Step 4: Add query hooks and invalidation**

On approval, backfill, or cancellation, invalidate:

```ts
["admin-active-mission", workspace, workflowId]
["admin-reward-handoffs", workspace]
["active-mission", submissionId]
["notifications"]
```

Keep the existing stable-key map pattern for ambiguous operator retries and key it by action plus normalized input.

- [ ] **Step 5: Run and confirm GREEN**

```powershell
npx.cmd vitest run src/lib/adminRewardHandoff.test.ts src/lib/queries/activeMission.test.tsx
```

Expected: both files pass.

- [ ] **Step 6: Commit Task 6**

```powershell
git add src/lib/adminRewardHandoff.ts src/lib/adminRewardHandoff.test.ts src/lib/activeMission.ts src/lib/queries/activeMission.ts src/lib/queries/activeMission.test.tsx
git commit -m "feat: add reward handoff client contracts"
```

---

### Task 7: Build operator contract, approval, and cancellation controls

**Files:**
- Create: `src/components/admin/MissionCompletionReview.tsx`
- Create: `src/components/admin/MissionCompletionReview.test.tsx`
- Modify: `src/routes/admin.active-missions.$workflowId.tsx`
- Modify: `src/routes/-admin.active-missions.test.tsx`
- Modify: `src/lib/i18n.dict.ts`

**Interfaces:**
- Consumes Task 6 functions and Task 4 projections.
- Produces `MissionCompletionReview` with backfill, approve, and cancel callbacks.

- [ ] **Step 1: Write failing component and route tests**

Cover:

- hidden outside `proof_verified` and `reward_pending`;
- blockers and exact required counts;
- reward breakdown with `xp = 0` omitted from visual emphasis;
- backfill provenance form and validation;
- no-issuance warning;
- pending dialog remains open while busy;
- ambiguous failure preserves dialog and key;
- success closes, announces, refreshes, and restores focus;
- cancellation requires category and note;
- stale state refreshes without losing recoverable input;
- EN/zh and keyboard focus behavior.

- [ ] **Step 2: Run and confirm RED**

```powershell
npx.cmd vitest run src/components/admin/MissionCompletionReview.test.tsx src/routes/-admin.active-missions.test.tsx
```

Expected: FAIL because the completion UI is absent.

- [ ] **Step 3: Implement the focused component**

Use this prop boundary:

```ts
type MissionCompletionReviewProps = {
  workflowId: string;
  workflowState: WorkflowState;
  workflowRevision: number;
  rewardContract: RewardContract | null;
  eligibility: CompletionEligibility;
  pendingReward: PendingReward | null;
  busy: boolean;
  onBackfill: (input: BackfillRewardContractInput) => Promise<unknown>;
  onApprove: (input: Omit<ApproveCompletionInput, "workspace">) => Promise<unknown>;
  onCancel: (input: Omit<CancelRewardHandoffInput, "workspace">) => Promise<unknown>;
  onActionError: (error: unknown) => void;
};
```

Use native labels, alertdialog confirmation, visible focus, `aria-live`, and the existing focus-restoration pattern from `PublicationProofReview`.

- [ ] **Step 4: Integrate with the active-mission route**

Render the completion component below proof review. Reuse the route's stable `runProofAction` concept under a generalized `runWorkflowAction` helper so all handoff retries use the same lifecycle without duplicating logic.

Emit `mission_completion_review_viewed` once per workflow/revision, `mission_completion_approved` only after confirmed success, and `mission_reward_pending_cancelled` only after confirmed cancellation. Never emit success analytics from rejection paths.

- [ ] **Step 5: Run and confirm GREEN**

```powershell
npx.cmd vitest run src/components/admin/MissionCompletionReview.test.tsx src/routes/-admin.active-missions.test.tsx
```

Expected: all operator completion tests pass.

- [ ] **Step 6: Commit Task 7**

```powershell
git add src/components/admin/MissionCompletionReview.tsx src/components/admin/MissionCompletionReview.test.tsx src/routes/admin.active-missions.'$workflowId'.tsx src/routes/-admin.active-missions.test.tsx src/lib/i18n.dict.ts
git commit -m "feat: add operator completion review"
```

---

### Task 8: Build the creator reward-pending and reassessment experience

**Files:**
- Create: `src/components/active-mission/RewardPendingCard.tsx`
- Create: `src/components/active-mission/RewardPendingCard.test.tsx`
- Modify: `src/routes/_app.my.$submissionId.tsx`
- Modify: `src/routes/-_app.my.$submissionId.test.tsx`
- Modify: `src/components/active-mission/WorkspaceHeader.tsx`
- Modify: `src/lib/i18n.dict.ts`

**Interfaces:**
- Consumes `ActiveMissionWorkspace.pendingReward`.
- Produces creator-visible pending, no-date, and cancelled/reassessment states.

- [ ] **Step 1: Write failing creator tests**

Assert:

- `reward_pending` renders “mission complete” but not “paid”, “available”, or “credited”;
- points, cash/currency, and non-zero XP display from the frozen snapshot;
- `targetAt` renders locale-aware date;
- null target renders honest finance-review wording;
- timeline and support link are visible;
- cancelled handoff returns to proof-verification messaging without saying funds were reversed;
- EN/zh strings, live announcement, heading focus, 320px layout, and keyboard support.

- [ ] **Step 2: Run and confirm RED**

```powershell
npx.cmd vitest run src/components/active-mission/RewardPendingCard.test.tsx src/routes/-_app.my.'$submissionId'.test.tsx
```

Expected: FAIL because pending reward UI is absent.

- [ ] **Step 3: Implement `RewardPendingCard`**

Use:

```ts
type RewardPendingCardProps = {
  missionTitle: string;
  pendingReward: PendingReward;
  supportHref: string;
};
```

Render the frozen fields only. Use `<time dateTime={targetAt}>`, do not derive a new date client-side, and do not render zero reward components as promises.
Use `/contact?topic=reward-pending&submission=<submissionId>` as the contextual support route. Emit `mission_reward_pending_viewed` once per handoff and `mission_reward_support_selected` only from the support action.

- [ ] **Step 4: Integrate canonical workflow state**

Update `WorkspaceHeader` state labels and the creator route branch so `reward_pending` replaces proof submission controls. Keep proof history visible and immutable.

- [ ] **Step 5: Run and confirm GREEN**

```powershell
npx.cmd vitest run src/components/active-mission/RewardPendingCard.test.tsx src/routes/-_app.my.'$submissionId'.test.tsx src/components/active-mission/active-mission.i18n.test.tsx
```

Expected: all creator and bilingual tests pass.

- [ ] **Step 6: Commit Task 8**

```powershell
git add src/components/active-mission/RewardPendingCard.tsx src/components/active-mission/RewardPendingCard.test.tsx src/routes/_app.my.'$submissionId'.tsx src/routes/-_app.my.'$submissionId'.test.tsx src/components/active-mission/WorkspaceHeader.tsx src/lib/i18n.dict.ts
git commit -m "feat: show creator reward pending state"
```

---

### Task 9: Build the read-only finance queue and SLA setting

**Files:**
- Create: `src/components/admin/RewardHandoffQueue.tsx`
- Create: `src/components/admin/RewardHandoffQueue.test.tsx`
- Create: `src/routes/admin.reward-handoffs.tsx`
- Create: `src/routes/-admin.reward-handoffs.test.tsx`
- Modify: `src/components/admin/adminNavItems.ts`
- Modify: `src/components/admin/AdminSideNav.test.tsx`
- Modify: `src/lib/i18n.dict.ts`

**Interfaces:**
- Consumes `fetchRewardHandoffs()` and `setRewardProcessingWindow()`.
- Produces `/admin/reward-handoffs`.

- [ ] **Step 1: Write failing queue and navigation tests**

Cover:

- navigation label and top-bar title;
- workspace-scoped query;
- default pending-only view;
- earliest target then oldest creation ordering;
- workspace, due status, reward component, and status filters reflected in URL search;
- null target grouped as “No target date”;
- cancelled rows audit-visible but excluded by default;
- no issue, pay, release, or mark-paid action;
- SLA setting accepts null or integer `0..365`;
- EN/zh, keyboard controls, responsive table/card layout.

- [ ] **Step 2: Run and confirm RED**

```powershell
npx.cmd vitest run src/components/admin/RewardHandoffQueue.test.tsx src/routes/-admin.reward-handoffs.test.tsx src/components/admin/AdminSideNav.test.tsx
```

Expected: FAIL because route, component, and navigation entry are absent.

- [ ] **Step 3: Implement the read-only queue**

Use typed route search:

```ts
type RewardHandoffSearch = {
  due?: "overdue" | "due_soon" | "no_target";
  component?: "points" | "cash" | "xp";
  status?: "pending" | "cancelled";
};
```

Render links to `/admin/active-missions/$workflowId`. Keep operator-authored notes out of list rows.
Emit `reward_handoff_queue_viewed` once per workspace/query load and `reward_handoff_queue_filtered` with bounded filter categories only.

- [ ] **Step 4: Add the workspace SLA setting**

Place a compact setting panel above the queue. Require explicit save; do not update on every keystroke. Display “calendar days” in both locales. On success, invalidate the queue/settings query and announce the saved result.

- [ ] **Step 5: Run and confirm GREEN**

```powershell
npx.cmd vitest run src/components/admin/RewardHandoffQueue.test.tsx src/routes/-admin.reward-handoffs.test.tsx src/components/admin/AdminSideNav.test.tsx
```

Expected: all finance queue and navigation tests pass.

- [ ] **Step 6: Commit Task 9**

```powershell
git add src/components/admin/RewardHandoffQueue.tsx src/components/admin/RewardHandoffQueue.test.tsx src/routes/admin.reward-handoffs.tsx src/routes/-admin.reward-handoffs.test.tsx src/components/admin/adminNavItems.ts src/components/admin/AdminSideNav.test.tsx src/lib/i18n.dict.ts
git commit -m "feat: add pending reward finance queue"
```

---

### Task 10: Add deterministic acceptance, operations, and release gates

**Files:**
- Create: `scripts/seed-reward-handoff-acceptance.ts`
- Create: `scripts/seed-reward-handoff-acceptance.test.ts`
- Create: `docs/operations/reward-handoff.md`
- Modify: `package.json`
- Modify: `scripts/run-integration-tests.mjs`
- Modify: `server/test/run-integration-tests.test.ts`
- Modify: `server/test/helpers.ts`
- Modify: `docs/CREATOR_JOURNEY.md`

**Interfaces:**
- Produces `npm run seed:reward-handoff-acceptance`.
- Adds `server/test/reward-contracts.test.ts` and `server/test/reward-handoffs.test.ts` to the blocking integration gate.

- [ ] **Step 1: Write failing fixture and launcher tests**

Assert the seed produces:

- one new-join contract;
- one existing workflow needing backfill;
- one eligible `proof_verified` workflow;
- one blocked required-proof workflow;
- one pending handoff;
- one cancelled-and-reassessable handoff;
- configured and missing SLA workspaces; and
- exact before-snapshots for points, XP, earnings, issued rewards, redemptions, and budgets.

Assert the integration launcher includes both new live suites exactly once.

- [ ] **Step 2: Run and confirm RED**

```powershell
npx.cmd vitest run scripts/seed-reward-handoff-acceptance.test.ts server/test/run-integration-tests.test.ts
```

Expected: FAIL because the seed and launcher entries are absent.

- [ ] **Step 3: Implement deterministic seed and scripts**

Add:

```json
"seed:reward-handoff-acceptance": "vite-node scripts/seed-reward-handoff-acceptance.ts"
```

The seed logs only structural counts and named scenario labels. It must not print JWTs, emails, UUIDs, signed URLs, or environment values.

Extend `test:active-missions` in `package.json` with the schema, contract, handoff, server-route, operator, creator, and finance-queue suites so the focused gate remains one command.

- [ ] **Step 4: Wire blocking integration and update operations docs**

Add both live files to `integrationFiles` after `active-missions.test.ts`. Document:

- clean reset and seed;
- contract backfill evidence rules;
- SLA setting;
- approval and cancellation;
- notification retry;
- finance reconciliation;
- support escalation wording;
- reward-neutrality snapshot checks; and
- explicit non-support for issuance and payout.

Update `CREATOR_JOURNEY.md` to show `proof_verified -> reward_pending`, while retaining issuance and payout as future states.

- [ ] **Step 5: Run the ordered database gate**

Run:

```powershell
npx.cmd --yes supabase@2.110.0 db reset --local --yes
npm.cmd run seed:reward-handoff-acceptance
npm.cmd run test:integration
```

Expected:

- all migrations apply;
- seed exits 0 with complete structural summary;
- every integration file passes with zero enabled-suite skips;
- reward and budget before/after snapshots are exactly equal.

- [ ] **Step 6: Run the focused application gate**

```powershell
npx.cmd vitest run --no-file-parallelism server/test/active-mission-schema.test.ts server/test/reward-contracts.test.ts server/test/reward-handoffs.test.ts server/test/admin-reward-handoffs.test.ts server/test/notifications-triggers.test.ts src/lib/activationAnalytics.test.ts src/lib/adminRewardHandoff.test.ts src/lib/queries/activeMission.test.tsx src/components/admin/MissionCompletionReview.test.tsx src/components/active-mission/RewardPendingCard.test.tsx src/components/admin/RewardHandoffQueue.test.tsx src/routes/-admin.active-missions.test.tsx src/routes/-_app.my.'$submissionId'.test.tsx src/routes/-admin.reward-handoffs.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 7: Run static and production gates**

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run type-check
npm.cmd run build
git diff --check
```

Expected:

- test suite passes;
- lint has zero errors;
- type-check exits 0;
- production build exits 0;
- whitespace check exits 0.

Document unchanged baseline warnings separately from new regressions.

- [ ] **Step 8: Perform browser acceptance**

Use deterministic fixtures and verify at 1440×900 and 390×844:

1. operator backfill and approval;
2. ambiguous retry uses one idempotency key;
3. creator sees frozen reward and target/no-target copy;
4. finance queue filters, ordering, and read-only boundary;
5. cancellation returns to reassessment with history intact;
6. notification links to the exact mission;
7. EN/zh, keyboard, focus, live regions, zoom, reduced motion, and no horizontal overflow;
8. final persisted reward/budget snapshots remain unchanged.

If the browser runtime is environment-blocked, record the exact blocker and keep the release status draft/partial; do not infer browser acceptance from unit tests.

- [ ] **Step 9: Commit Task 10**

```powershell
git add scripts/seed-reward-handoff-acceptance.ts scripts/seed-reward-handoff-acceptance.test.ts docs/operations/reward-handoff.md package.json scripts/run-integration-tests.mjs server/test/run-integration-tests.test.ts server/test/helpers.ts docs/CREATOR_JOURNEY.md
git commit -m "test: add reward handoff release acceptance"
```

---

## Final Review Gate

After Task 10:

- Request a spec-compliance review against `docs/superpowers/specs/2026-07-31-adfocate-mission-completion-reward-handoff-design.md`.
- Request a separate code-quality and security review.
- Resolve all P0/P1 findings and rerun the narrowest affected tests plus the full final gate.
- Scan the staged diff for UUIDs, emails, JWT-shaped values, GitHub tokens, Supabase key assignments, signed-URL markers, UTF-8 BOMs, and unintended fixture data.
- Push and create a draft PR if browser acceptance is partial; create a ready PR only when every required browser scenario passes.

## Execution Completion

The implementation is complete only when all ten task commits exist, the ordered database/integration/static/browser gates are recorded, the final review is clean, and the branch contains no unrelated changes.
