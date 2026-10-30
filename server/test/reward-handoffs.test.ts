import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeOperatorRewardHandoffProjection } from "../lib/activeMission/rewardHandoff";
import {
  activeMissionIntegrationSkipReason,
  cleanup,
  creatorRewardSnapshot,
  DEMO_WS,
  makeBrand,
  makeCreator,
  makeStaff,
  seedActiveMission,
  serviceForTests,
  userForJwt,
} from "./helpers";

const unique = () => randomUUID();
const migrationPath = resolve(
  "supabase/migrations/20260731120000_reward_handoff_transitions.sql",
);
const integrationSkipReason = activeMissionIntegrationSkipReason();
const integrationSuite = integrationSkipReason === null ? describe : describe.skip;
const integrationSuiteName = integrationSkipReason === null
  ? "reward handoff transitions"
  : `reward handoff transitions (skipped: ${integrationSkipReason})`;

type WorkItemState =
  | "drafting"
  | "approved_to_publish"
  | "proof_submitted"
  | "proof_under_review"
  | "proof_correction_requested"
  | "proof_verified";

type Fixture = {
  workspaceId: string;
  workflowId: string;
  submissionId: string;
  missionId: string;
  creatorId: string;
  creatorJwt: string;
  operatorId: string;
  expectedState: "proof_verified";
  expectedRevision: number;
  contractId: string;
  requiredItemIds: string[];
  requiredReviewIds: string[];
  optionalItemIds: string[];
};

type HandoffResult = {
  workflow: { id: string; state: string; revision: number };
  decision: {
    id: string;
    decision_kind: string;
    pending_reward_id: string | null;
    required_item_count: number;
    verified_required_item_count: number;
    evidence_snapshot: {
      requiredItems: Array<{
        workItemId: string;
        proofAttemptId: string;
        proofReviewId: string;
      }>;
    };
  };
  pendingReward: {
    id: string;
    status: string;
    points_amount: number;
    cash_amount: number;
    currency: string;
    xp_amount: number;
    processing_window_days: number | null;
    target_at: string | null;
    cancellation_decision_id: string | null;
    cancelled_at: string | null;
  };
  idempotent: boolean;
};

describe("reward handoff transition migration contract", () => {
  it("defines the approval, cancellation, and creator-safe read RPCs", () => {
    const sql = existsSync(migrationPath)
      ? readFileSync(migrationPath, "utf8").toLowerCase()
      : "";
    expect(sql).toContain(
      "create or replace function public.approve_mission_completion",
    );
    expect(sql).toContain(
      "create or replace function public.cancel_mission_reward_handoff",
    );
    expect(sql).toContain(
      "create or replace function public.get_my_mission_reward_handoff",
    );
  });
});

describe("reward handoff operator projection", () => {
  it.each([
    ["a frozen SLA", 7, "2026-08-07T10:00:00.000Z"],
    ["no SLA", null, null],
  ])("uses the pending reward's %s after workspace settings change", (
    _label,
    processingWindowDays,
    targetAt,
  ) => {
    const projection = normalizeOperatorRewardHandoffProjection({
      workflow: { state: "reward_pending" },
      contract: null,
      requiredItems: [],
      processingWindowDays: 30,
      pendingReward: {
        id: "pending-1",
        status: "pending",
        processing_window_days: processingWindowDays,
        target_at: targetAt,
        created_at: "2026-07-31T10:00:00.000Z",
      },
    });

    expect(projection.processingWindowDays).toBe(processingWindowDays);
    expect(projection.processingTargetAt).toBe(targetAt);
  });
});

async function linkOperator(workspaceId = DEMO_WS) {
  const email = `reward-handoff-operator-${unique()}@test.local`;
  const operator = await makeStaff(email);
  const membership = await serviceForTests().from("brand_users").insert({
    user_id: operator.userId,
    workspace_id: workspaceId,
    email,
    role: "member",
    active: true,
  });
  expect(membership.error).toBeNull();
  return operator;
}

async function seedRewardHandoffFixture(options: {
  requiredStates: WorkItemState[];
  optionalStates?: WorkItemState[];
  processingWindowDays?: number | null;
  omitVerifiedReviewPositions?: number[];
}): Promise<Fixture> {
  const optionalStates = options.optionalStates ?? [];
  const states = [...options.requiredStates, ...optionalStates];
  const active = await seedActiveMission({
    email: `reward-handoff-creator-${unique()}@test.local`,
    slug: `test-reward-handoff-${unique()}`,
    deliverables: [
      ...options.requiredStates.map((_, index) => ({
        title: `Required publication ${index + 1}`,
        platform: "instagram",
        required: true,
      })),
      ...optionalStates.map((_, index) => ({
        title: `Optional publication ${index + 1}`,
        platform: "tiktok",
        required: false,
      })),
    ],
  });
  const service = serviceForTests();
  const created = await userForJwt(active.creator.jwt).rpc(
    "create_mission_workflow",
    { p_submission: active.submission.id },
  );
  expect(created.error).toBeNull();
  const workflowId = created.data.id as string;
  const itemsResult = await service.from("mission_work_items")
    .select("id, required, position")
    .eq("mission_workflow_id", workflowId)
    .order("position");
  expect(itemsResult.error).toBeNull();
  const items = itemsResult.data ?? [];
  const operator = await linkOperator();
  const reviewIds = new Map<string, string>();

  for (const [index, item] of items.entries()) {
    const state = states[index]!;
    let attemptId: string | null = null;
    if (state === "proof_verified") {
      const attempt = await service.from("mission_publication_proof_attempts")
        .insert({
          workspace_id: DEMO_WS,
          mission_work_item_id: item.id,
          attempt_number: 1,
          primary_url: `https://www.instagram.com/p/${unique()}`,
          additional_urls: [],
          submitted_by: active.creator.id,
          submitted_late: false,
          metadata_status: "unavailable",
          metadata_snapshot: {},
          metadata_error_category: "platform_blocked",
          content_checksum: `sha256:${unique()}`,
          submission_idempotency_key: unique(),
        })
        .select("id")
        .single();
      expect(attempt.error).toBeNull();
      attemptId = attempt.data!.id;
      if (!(options.omitVerifiedReviewPositions ?? []).includes(index)) {
        const review = await service.from("mission_publication_proof_reviews")
          .insert({
            workspace_id: DEMO_WS,
            mission_publication_proof_attempt_id: attemptId,
            review_number: 1,
            state: "verified",
            decision: "verified",
            reviewer_id: operator.userId,
            reviewed_at: new Date().toISOString(),
            checklist: {
              publicly_accessible: true,
              platform_matches: true,
              account_matches: true,
              content_matches_approved_version: true,
              timing_acceptable: true,
              disclosures_present: true,
            },
            summary: "Verified publication proof",
            decision_idempotency_key: unique(),
          })
          .select("id")
          .single();
        expect(review.error).toBeNull();
        reviewIds.set(item.id, review.data!.id);
      }
    }
    const updated = await service.from("mission_work_items").update({
      state,
      current_proof_attempt_id: attemptId,
      verified_proof_attempt_id: attemptId,
    }).eq("id", item.id).eq("workspace_id", DEMO_WS);
    expect(updated.error).toBeNull();
  }

  const expectedRevision = 7;
  expect((await service.from("mission_workflows").update({
    state: "proof_verified",
    revision: expectedRevision,
    updated_at: new Date().toISOString(),
  }).eq("id", workflowId).eq("workspace_id", DEMO_WS)).error).toBeNull();
  const contract = await service.from("mission_reward_contracts").insert({
    workspace_id: DEMO_WS,
    mission_workflow_id: workflowId,
    mission_submission_id: active.submission.id,
    mission_id: active.mission.id,
    points_amount: 500,
    cash_amount: 125,
    currency: "HKD",
    xp_amount: 0,
    source: "join",
    source_mission_updated_at: null,
  }).select("id").single();
  expect(contract.error).toBeNull();
  expect((await service.from("workspaces").update({
    reward_processing_window_days: options.processingWindowDays === undefined
      ? 14
      : options.processingWindowDays,
  }).eq("id", DEMO_WS)).error).toBeNull();
  return {
    workspaceId: DEMO_WS,
    workflowId,
    submissionId: active.submission.id,
    missionId: active.mission.id,
    creatorId: active.creator.id,
    creatorJwt: active.creator.jwt,
    operatorId: operator.userId,
    expectedState: "proof_verified",
    expectedRevision,
    contractId: contract.data!.id,
    requiredItemIds: items.filter((item) => item.required).map((item) => item.id),
    requiredReviewIds: items.filter((item) => item.required)
      .map((item) => reviewIds.get(item.id))
      .filter((id): id is string => id !== undefined),
    optionalItemIds: items.filter((item) => !item.required).map((item) => item.id),
  };
}

function approvalArgs(
  fixture: Fixture,
  idempotencyKey: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    p_workspace: fixture.workspaceId,
    p_workflow: fixture.workflowId,
    p_operator: fixture.operatorId,
    p_expected_state: fixture.expectedState,
    p_expected_revision: fixture.expectedRevision,
    p_idempotency_key: idempotencyKey,
    ...overrides,
  };
}

async function approveCompletion(
  fixture: Fixture,
  idempotencyKey = unique(),
  overrides: Record<string, unknown> = {},
) {
  const result = await serviceForTests().rpc(
    "approve_mission_completion",
    approvalArgs(fixture, idempotencyKey, overrides),
  );
  expect(result.error).toBeNull();
  return result.data as HandoffResult;
}

function cancellationArgs(
  fixture: Fixture,
  approved: HandoffResult,
  idempotencyKey: string,
  reason: { reasonCategory: string; reasonNote: string },
  overrides: Record<string, unknown> = {},
) {
  return {
    p_workspace: fixture.workspaceId,
    p_workflow: fixture.workflowId,
    p_operator: fixture.operatorId,
    p_expected_state: "reward_pending",
    p_expected_revision: approved.workflow.revision,
    p_idempotency_key: idempotencyKey,
    p_reason_category: reason.reasonCategory,
    p_reason_note: reason.reasonNote,
    ...overrides,
  };
}

async function cancelHandoff(
  fixture: Fixture,
  approved: HandoffResult,
  reason: { reasonCategory: string; reasonNote: string },
  idempotencyKey = unique(),
) {
  const result = await serviceForTests().rpc(
    "cancel_mission_reward_handoff",
    cancellationArgs(fixture, approved, idempotencyKey, reason),
  );
  expect(result.error).toBeNull();
  return result.data as HandoffResult;
}

integrationSuite(integrationSuiteName, () => {
  beforeAll(cleanup);
  afterAll(async () => {
    await serviceForTests().from("workspaces")
      .update({ reward_processing_window_days: null }).eq("id", DEMO_WS);
    await cleanup();
  });

  it("approves only when every required item is proof_verified and ignores optional items", async () => {
    const fixture = await seedRewardHandoffFixture({
      requiredStates: ["proof_verified", "proof_verified"],
      optionalStates: ["drafting"],
      processingWindowDays: 14,
    });
    const before = await creatorRewardSnapshot(fixture.creatorId);
    const approved = await approveCompletion(fixture);
    expect(approved.workflow).toMatchObject({
      state: "reward_pending",
      revision: fixture.expectedRevision + 1,
    });
    expect(approved.pendingReward).toMatchObject({
      status: "pending",
      points_amount: 500,
      cash_amount: 125,
      currency: "HKD",
      xp_amount: 0,
      processing_window_days: 14,
      cancellation_decision_id: null,
      cancelled_at: null,
    });
    expect(Date.parse(approved.pendingReward.target_at!)).toBeGreaterThan(
      Date.now() + 13 * 86_400_000,
    );
    expect(approved.decision).toMatchObject({
      decision_kind: "approved",
      pending_reward_id: null,
      required_item_count: 2,
      verified_required_item_count: 2,
    });
    const evidenceIds = approved.decision.evidence_snapshot.requiredItems
      .map((item) => item.workItemId);
    const evidenceReviewIds = approved.decision.evidence_snapshot.requiredItems
      .map((item) => item.proofReviewId);
    expect(evidenceIds).toEqual(fixture.requiredItemIds);
    expect(evidenceReviewIds).toEqual(fixture.requiredReviewIds);
    expect(evidenceIds.some((id) => fixture.optionalItemIds.includes(id))).toBe(false);
    expect(await creatorRewardSnapshot(fixture.creatorId)).toEqual(before);
  });

  it("rejects incomplete required items and stale revisions before append-only writes", async () => {
    const incomplete = await seedRewardHandoffFixture({
      requiredStates: ["proof_verified", "proof_submitted"],
    });
    const service = serviceForTests();
    const blocked = await service.rpc(
      "approve_mission_completion",
      approvalArgs(incomplete, unique()),
    );
    expect(blocked.error?.message.toLowerCase()).toContain("completion_not_eligible");

    const fresh = await seedRewardHandoffFixture({
      requiredStates: ["proof_verified"],
    });
    const stale = await service.rpc("approve_mission_completion", {
      ...approvalArgs(fresh, unique()),
      p_expected_revision: fresh.expectedRevision - 1,
    });
    expect(stale.error?.message.toLowerCase()).toContain("workflow_stale");
    for (const fixture of [incomplete, fresh]) {
      const decisions = await service.from("mission_completion_decisions")
        .select("id").eq("mission_workflow_id", fixture.workflowId);
      expect(decisions.data).toEqual([]);
    }
  });

  it("rejects a manually pointed verified attempt without an immutable verified review", async () => {
    const fixture = await seedRewardHandoffFixture({
      requiredStates: ["proof_verified"],
      omitVerifiedReviewPositions: [0],
    });
    const service = serviceForTests();
    const blocked = await service.rpc(
      "approve_mission_completion",
      approvalArgs(fixture, unique()),
    );
    expect(blocked.error?.message.toLowerCase()).toContain(
      "completion_not_eligible",
    );
    const [decisions, pending] = await Promise.all([
      service.from("mission_completion_decisions").select("id")
        .eq("mission_workflow_id", fixture.workflowId),
      service.from("mission_pending_rewards").select("id")
        .eq("mission_workflow_id", fixture.workflowId),
    ]);
    expect(decisions.data).toEqual([]);
    expect(pending.data).toEqual([]);
  });

  it("returns the original result for an identical retry and rejects changed payload reuse", async () => {
    const fixture = await seedRewardHandoffFixture({
      requiredStates: ["proof_verified"],
    });
    const key = unique();
    const first = await approveCompletion(fixture, key);
    const retry = await approveCompletion(fixture, key);
    expect(retry.pendingReward.id).toBe(first.pendingReward.id);
    expect(retry.decision.id).toBe(first.decision.id);
    expect(retry.idempotent).toBe(true);
    const changed = await serviceForTests().rpc(
      "approve_mission_completion",
      approvalArgs(fixture, key, {
        p_expected_revision: fixture.expectedRevision + 1,
      }),
    );
    expect(changed.error?.message.toLowerCase()).toContain("idempotency_conflict");
  });

  it("treats idempotency keys as workspace-wide before stale workflow checks", async () => {
    const first = await seedRewardHandoffFixture({
      requiredStates: ["proof_verified"],
    });
    const second = await seedRewardHandoffFixture({
      requiredStates: ["proof_verified"],
    });
    const key = unique();
    await approveCompletion(first, key);

    const service = serviceForTests();
    const conflict = await service.rpc(
      "approve_mission_completion",
      approvalArgs(second, key, {
        p_expected_revision: second.expectedRevision - 1,
      }),
    );
    expect(conflict.error?.message.toLowerCase()).toContain(
      "idempotency_conflict",
    );
    const [workflow, decisions, pending] = await Promise.all([
      service.from("mission_workflows").select("state, revision")
        .eq("id", second.workflowId).single(),
      service.from("mission_completion_decisions").select("id")
        .eq("mission_workflow_id", second.workflowId),
      service.from("mission_pending_rewards").select("id")
        .eq("mission_workflow_id", second.workflowId),
    ]);
    expect(workflow.data).toEqual({
      state: "proof_verified",
      revision: second.expectedRevision,
    });
    expect(decisions.data).toEqual([]);
    expect(pending.data).toEqual([]);
  });

  it("rejects replay when individually valid rows no longer form the canonical chain", async () => {
    const fixture = await seedRewardHandoffFixture({
      requiredStates: ["proof_verified"],
    });
    const key = unique();
    await approveCompletion(fixture, key);
    const foreignCreator = await makeCreator(
      `reward-handoff-replay-mismatch-${unique()}@test.local`,
    );
    const service = serviceForTests();
    const mismatch = await service.from("mission_submissions").update({
      creator_id: foreignCreator.userId,
    })
      .eq("id", fixture.submissionId)
      .eq("workspace_id", fixture.workspaceId)
      .select("id")
      .single();
    expect(mismatch.error).toBeNull();

    const replay = await service.rpc(
      "approve_mission_completion",
      approvalArgs(fixture, key),
    );
    expect(replay.error?.message.toLowerCase()).toContain(
      "idempotency_conflict",
    );
    expect(replay.data).toBeNull();
  });

  it("does not reveal whether a workflow exists in another workspace", async () => {
    const fixture = await seedRewardHandoffFixture({
      requiredStates: ["proof_verified"],
    });
    const other = await makeBrand(
      `reward-handoff-other-brand-${unique()}@test.local`,
    );
    const operator = await linkOperator(other.workspaceId);
    const base = {
      ...approvalArgs(fixture, unique()),
      p_workspace: other.workspaceId,
      p_operator: operator.userId,
    };
    const service = serviceForTests();
    const cross = await service.rpc("approve_mission_completion", base);
    const absent = await service.rpc("approve_mission_completion", {
      ...base,
      p_workflow: unique(),
      p_idempotency_key: unique(),
    });
    expect(cross.error?.message.toLowerCase()).toContain("not_found");
    expect(absent.error?.message).toBe(cross.error?.message);
  });

  it("serializes concurrent approvals to one decision and one pending reward", async () => {
    const fixture = await seedRewardHandoffFixture({
      requiredStates: ["proof_verified"],
    });
    const second = await linkOperator();
    const service = serviceForTests();
    const attempts = await Promise.all([
      service.rpc("approve_mission_completion", approvalArgs(fixture, unique())),
      service.rpc("approve_mission_completion", approvalArgs(fixture, unique(), {
        p_operator: second.userId,
      })),
    ]);
    expect(attempts.filter((attempt) => attempt.error === null)).toHaveLength(1);
    expect(attempts.find((attempt) => attempt.error)?.error?.message.toLowerCase())
      .toContain("wrong_state");
    const [decisions, pending] = await Promise.all([
      service.from("mission_completion_decisions").select("id")
        .eq("mission_workflow_id", fixture.workflowId),
      service.from("mission_pending_rewards").select("id")
        .eq("mission_workflow_id", fixture.workflowId),
    ]);
    expect(decisions.data).toHaveLength(1);
    expect(pending.data).toHaveLength(1);
  });

  it("cancels append-only, retries exactly, and returns to proof_verified", async () => {
    const fixture = await seedRewardHandoffFixture({
      requiredStates: ["proof_verified"],
      processingWindowDays: null,
    });
    const before = await creatorRewardSnapshot(fixture.creatorId);
    const approved = await approveCompletion(fixture);
    expect(approved.pendingReward.target_at).toBeNull();
    const key = unique();
    const reason = {
      reasonCategory: "contract_error",
      reasonNote: "Confirmed contract requires reassessment.",
    };
    const cancelled = await cancelHandoff(fixture, approved, reason, key);
    expect(cancelled.workflow).toMatchObject({
      state: "proof_verified",
      revision: approved.workflow.revision + 1,
    });
    expect(cancelled.pendingReward).toMatchObject({
      id: approved.pendingReward.id,
      status: "cancelled",
      cancellation_decision_id: cancelled.decision.id,
    });
    expect(cancelled.decision).toMatchObject({
      decision_kind: "cancelled",
      pending_reward_id: approved.pendingReward.id,
    });
    const retry = await cancelHandoff(fixture, approved, reason, key);
    expect(retry.decision.id).toBe(cancelled.decision.id);
    expect(retry.idempotent).toBe(true);
    const changed = await serviceForTests().rpc(
      "cancel_mission_reward_handoff",
      cancellationArgs(fixture, approved, key, {
        ...reason,
        reasonNote: "A different reassessment note.",
      }),
    );
    expect(changed.error?.message.toLowerCase()).toContain("idempotency_conflict");
    const repeated = await serviceForTests().rpc(
      "cancel_mission_reward_handoff",
      cancellationArgs(fixture, approved, unique(), reason),
    );
    expect(repeated.error?.message.toLowerCase()).toContain("wrong_state");
    const decisions = await serviceForTests().from("mission_completion_decisions")
      .select("id, decision_kind, supersedes_decision_id")
      .eq("mission_workflow_id", fixture.workflowId).order("decided_at");
    expect(decisions.data).toEqual([
      {
        id: approved.decision.id,
        decision_kind: "approved",
        supersedes_decision_id: null,
      },
      {
        id: cancelled.decision.id,
        decision_kind: "cancelled",
        supersedes_decision_id: approved.decision.id,
      },
    ]);
    expect(await creatorRewardSnapshot(fixture.creatorId)).toEqual(before);
  });

  it("replays immutable approval and cancellation cycle snapshots after later cycles", async () => {
    const fixture = await seedRewardHandoffFixture({
      requiredStates: ["proof_verified"],
    });
    const approvalKey = unique();
    const firstApproval = await approveCompletion(fixture, approvalKey);
    const cancellationKey = unique();
    const reason = {
      reasonCategory: "contract_error",
      reasonNote: "Freeze the first cancellation result.",
    };
    const firstCancellation = await cancelHandoff(
      fixture,
      firstApproval,
      reason,
      cancellationKey,
    );
    const secondApproval = await approveCompletion(fixture, unique(), {
      p_expected_revision: firstCancellation.workflow.revision,
    });
    expect(secondApproval.pendingReward.id).not.toBe(
      firstApproval.pendingReward.id,
    );

    const service = serviceForTests();
    const replays = await Promise.all([
      service.rpc(
        "approve_mission_completion",
        approvalArgs(fixture, approvalKey),
      ),
      service.rpc(
        "cancel_mission_reward_handoff",
        cancellationArgs(
          fixture,
          firstApproval,
          cancellationKey,
          reason,
        ),
      ),
      service.rpc(
        "approve_mission_completion",
        approvalArgs(fixture, approvalKey),
      ),
      service.rpc(
        "cancel_mission_reward_handoff",
        cancellationArgs(
          fixture,
          firstApproval,
          cancellationKey,
          reason,
        ),
      ),
    ]);
    for (const replay of replays) expect(replay.error).toBeNull();

    for (const replay of [replays[0]!, replays[2]!]) {
      expect(replay.data.workflow).toEqual(firstApproval.workflow);
      expect(replay.data.decision).toEqual(firstApproval.decision);
      expect(replay.data.pendingReward).toEqual(firstApproval.pendingReward);
      expect(replay.data.idempotent).toBe(true);
      expect(replay.data.pendingReward).toMatchObject({
        status: "pending",
        cancellation_decision_id: null,
        cancelled_at: null,
      });
    }
    for (const replay of [replays[1]!, replays[3]!]) {
      expect(replay.data.workflow).toEqual(firstCancellation.workflow);
      expect(replay.data.decision).toEqual(firstCancellation.decision);
      expect(replay.data.pendingReward).toEqual(
        firstCancellation.pendingReward,
      );
      expect(replay.data.idempotent).toBe(true);
      expect(replay.data.workflow.state).toBe("proof_verified");
    }
  });

  it("rolls a new decision back when pending insertion conflicts", async () => {
    const fixture = await seedRewardHandoffFixture({
      requiredStates: ["proof_verified"],
    });
    const service = serviceForTests();
    const prior = await service.from("mission_completion_decisions").insert({
      workspace_id: fixture.workspaceId,
      mission_workflow_id: fixture.workflowId,
      decision_kind: "approved",
      reward_contract_id: fixture.contractId,
      pending_reward_id: null,
      supersedes_decision_id: null,
      workflow_revision: fixture.expectedRevision,
      required_item_count: 1,
      verified_required_item_count: 1,
      evidence_snapshot: {},
      reason_category: null,
      reason_note: null,
      decided_by: fixture.operatorId,
      idempotency_key: unique(),
      request_hash: "a".repeat(64),
    }).select("id").single();
    expect(prior.error).toBeNull();
    expect((await service.from("mission_pending_rewards").insert({
      workspace_id: fixture.workspaceId,
      mission_workflow_id: fixture.workflowId,
      mission_submission_id: fixture.submissionId,
      creator_id: fixture.creatorId,
      mission_id: fixture.missionId,
      reward_contract_id: fixture.contractId,
      completion_decision_id: prior.data!.id,
      points_amount: 500,
      cash_amount: 125,
      currency: "HKD",
      xp_amount: 0,
      status: "pending",
      processing_window_days: 14,
      target_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    })).error).toBeNull();

    const failedKey = unique();
    const failed = await service.rpc(
      "approve_mission_completion",
      approvalArgs(fixture, failedKey),
    );
    expect(failed.error?.message.toLowerCase()).toContain("pending_reward_exists");
    const [decision, workflow, events] = await Promise.all([
      service.from("mission_completion_decisions").select("id")
        .eq("workspace_id", fixture.workspaceId)
        .eq("idempotency_key", failedKey),
      service.from("mission_workflows").select("state, revision")
        .eq("id", fixture.workflowId).single(),
      service.from("mission_workflow_events").select("id")
        .eq("mission_workflow_id", fixture.workflowId)
        .eq("event_type", "mission_completion_approved"),
    ]);
    expect(decision.data).toEqual([]);
    expect(workflow.data).toEqual({
      state: "proof_verified",
      revision: fixture.expectedRevision,
    });
    expect(events.data).toEqual([]);
  });

  it("returns a bounded creator projection without operator or proof secrets", async () => {
    const fixture = await seedRewardHandoffFixture({
      requiredStates: ["proof_verified"],
      processingWindowDays: 7,
    });
    await approveCompletion(fixture);
    const own = await userForJwt(fixture.creatorJwt).rpc(
      "get_my_mission_reward_handoff",
      { p_submission: fixture.submissionId },
    );
    expect(own.error).toBeNull();
    expect(own.data).toMatchObject({
      reward: {
        pointsAmount: 500,
        cashAmount: 125,
        currency: "HKD",
        xpAmount: 0,
      },
      status: "pending",
      processingWindowDays: 7,
      decisionState: { kind: "approved" },
    });
    expect(Object.keys(own.data).sort()).toEqual([
      "cancelledAt",
      "createdAt",
      "decisionState",
      "processingWindowDays",
      "reward",
      "settledAt",
      "status",
      "targetAt",
    ]);
    const serialized = JSON.stringify(own.data).toLowerCase();
    for (const forbidden of [
      "reason_note", "reasonnote", "confirmation_reason", "confirmed_by",
      "decided_by", "actor_id", "idempotency", "request_hash", "primary_url",
      "additional_urls", "storage_object_path", "signed",
    ]) expect(serialized).not.toContain(forbidden);

    const stranger = await makeCreator(
      `reward-handoff-stranger-${unique()}@test.local`,
    );
    const cross = await userForJwt(stranger.jwt).rpc(
      "get_my_mission_reward_handoff",
      { p_submission: fixture.submissionId },
    );
    const absent = await userForJwt(stranger.jwt).rpc(
      "get_my_mission_reward_handoff",
      { p_submission: unique() },
    );
    expect(cross.error?.message.toLowerCase()).toContain("not_found");
    expect(absent.error?.message).toBe(cross.error?.message);
  });

  it("ignores a newer handoff row whose tenant chain is internally mismatched", async () => {
    const owned = await seedRewardHandoffFixture({
      requiredStates: ["proof_verified"],
    });
    const foreignFacts = await seedRewardHandoffFixture({
      requiredStates: ["proof_verified"],
    });
    const service = serviceForTests();
    const decision = await service.from("mission_completion_decisions").insert({
      workspace_id: owned.workspaceId,
      mission_workflow_id: owned.workflowId,
      decision_kind: "approved",
      reward_contract_id: foreignFacts.contractId,
      pending_reward_id: null,
      supersedes_decision_id: null,
      workflow_revision: owned.expectedRevision,
      required_item_count: 1,
      verified_required_item_count: 1,
      evidence_snapshot: {},
      reason_category: null,
      reason_note: null,
      decided_by: owned.operatorId,
      idempotency_key: unique(),
      request_hash: "b".repeat(64),
    }).select("id").single();
    expect(decision.error).toBeNull();
    const forged = await service.from("mission_pending_rewards").insert({
      workspace_id: owned.workspaceId,
      mission_workflow_id: owned.workflowId,
      mission_submission_id: owned.submissionId,
      creator_id: foreignFacts.creatorId,
      mission_id: foreignFacts.missionId,
      reward_contract_id: foreignFacts.contractId,
      completion_decision_id: decision.data!.id,
      points_amount: 999999,
      cash_amount: 999999,
      currency: "HKD",
      xp_amount: 999999,
      status: "pending",
      processing_window_days: 365,
      target_at: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    });
    expect(forged.error).toBeNull();

    const read = await userForJwt(owned.creatorJwt).rpc(
      "get_my_mission_reward_handoff",
      { p_submission: owned.submissionId },
    );
    expect(read.error).toBeNull();
    expect(read.data).toBeNull();
  });
});
