import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  cleanup,
  creatorRewardSnapshot,
  DEMO_WS,
  makeCreator,
  makeMission,
  makeStaff,
  seedActiveMission,
  serviceForTests,
  userForJwt,
} from "../server/test/helpers";

export const REWARD_HANDOFF_CANCELLATION_REASON = "eligibility_error" as const;

export const REWARD_HANDOFF_SCENARIO_LABELS = [
  "new_join_contract",
  "existing_workflow_needing_backfill",
  "eligible_proof_verified",
  "blocked_required_proof",
  "pending_handoff",
  "cancelled_and_reassessable_handoff",
  "configured_sla_workspace",
  "missing_sla_workspace",
] as const;

export const REWARD_NEUTRALITY_SNAPSHOT_FIELDS = [
  "points",
  "xp",
  "earnings",
  "issuedRewards",
  "redemptions",
  "workspaceBudget",
] as const;

type ScenarioLabel = (typeof REWARD_HANDOFF_SCENARIO_LABELS)[number];
type SnapshotField = (typeof REWARD_NEUTRALITY_SNAPSHOT_FIELDS)[number];
type StructuralCounts = {
  scenarioCounts: Record<ScenarioLabel, number>;
  neutralitySnapshotCounts: Record<SnapshotField, number>;
};

type SeededWorkflow = {
  creatorId: string;
  workflowId: string;
  submissionId: string;
  missionId: string;
  operatorId: string;
  revision: number;
};

export function rewardHandoffAcceptanceSummary(counts: StructuralCounts) {
  return {
    scenarios: REWARD_HANDOFF_SCENARIO_LABELS.map((label) => ({
      label,
      count: counts.scenarioCounts[label],
    })),
    rewardNeutralityBeforeSnapshots: REWARD_NEUTRALITY_SNAPSHOT_FIELDS.map(
      (label) => ({ label, count: counts.neutralitySnapshotCounts[label] }),
    ),
  };
}

function fail(context: string, error?: { message?: string | null } | null): never {
  throw new Error(`${context}: ${error?.message ?? "missing data"}`);
}

function requireLocalAcceptanceEnvironment(): void {
  for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SUPABASE_ANON_KEY"] as const) {
    if (!process.env[name]) throw new Error(`missing_${name.toLowerCase()}`);
  }
  const parsed = new URL(process.env.SUPABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname)) {
    throw new Error("reward_handoff_acceptance_requires_loopback_supabase");
  }
}

function fixtureEmail(label: string): string {
  return `reward-handoff-acceptance-${label}@test.local`;
}

async function rewardNeutralitySnapshot(creatorId: string) {
  const [base, issuedRewards] = await Promise.all([
    creatorRewardSnapshot(creatorId),
    serviceForTests().from("mission_submissions")
      .select("points_awarded, xp_awarded")
      .eq("creator_id", creatorId)
      .eq("status", "approved"),
  ]);
  if (issuedRewards.error) fail("read acceptance issued-reward anchors", issuedRewards.error);
  return {
    points: { balance: base.points, transactions: base.pointTransactions },
    xp: base.xp,
    earnings: { available: base.earnings, transactions: base.earningsTransactions },
    issuedRewards: {
      count: issuedRewards.data?.length ?? 0,
      points: (issuedRewards.data ?? []).reduce((sum, row) => sum + (row.points_awarded ?? 0), 0),
      xp: (issuedRewards.data ?? []).reduce((sum, row) => sum + (row.xp_awarded ?? 0), 0),
    },
    redemptions: {
      count: base.redemptions,
      catalogCount: base.rewardCatalogCount,
      catalogInventory: base.rewardCatalogInventory,
    },
    workspaceBudget: { balance: base.budget, transactions: base.budgetTransactions },
  };
}

async function linkOperator(): Promise<string> {
  const email = fixtureEmail("operator");
  const operator = await makeStaff(email);
  const membership = await serviceForTests().from("brand_users").insert({
    user_id: operator.userId,
    workspace_id: DEMO_WS,
    email,
    role: "member",
    active: true,
  });
  if (membership.error) fail("link acceptance operator", membership.error);
  return operator.userId;
}

async function createNewJoinContractScenario() {
  const creator = await makeCreator(fixtureEmail("new-join"), 250);
  const mission = await makeMission({
    slug: "test-reward-handoff-acceptance-new-join",
    points_reward: 500,
    cash_reward: 125,
  });
  const service = serviceForTests();
  const configured = await service.from("missions")
    .update({ creator_workflow_mode: "active_workspace" })
    .eq("id", mission.id)
    .select("id, workspace_id")
    .single();
  if (configured.error) fail("configure new-join mission", configured.error);
  const template = await service.from("mission_deliverable_templates").insert({
    workspace_id: DEMO_WS,
    mission_id: mission.id,
    title: "Required acceptance publication",
    platform: "instagram",
    position: 0,
    required: true,
    publication_instructions: "Publish the approved acceptance content",
    publication_window_hours: 72,
    required_disclosures: [],
    proof_evidence_policy: {},
  });
  if (template.error) fail("insert new-join template", template.error);
  const joined = await userForJwt(creator.jwt).rpc("join_active_mission", {
    p_mission: mission.id,
  });
  if (joined.error) fail("join new acceptance mission", joined.error);
  const workflowId = joined.data?.workflow?.id as string | undefined;
  if (!workflowId || !joined.data?.rewardContract?.id) {
    fail("assert new-join reward contract");
  }
  return { creatorId: creator.userId, workflowId };
}

async function insertVerifiedAttempt(input: {
  creatorId: string;
  itemId: string;
  operatorId: string;
  label: string;
}) {
  const service = serviceForTests();
  const attempt = await service.from("mission_publication_proof_attempts").insert({
    workspace_id: DEMO_WS,
    mission_work_item_id: input.itemId,
    attempt_number: 1,
    primary_url: `https://www.instagram.com/p/${input.label}`,
    additional_urls: [],
    submitted_by: input.creatorId,
    submitted_late: false,
    metadata_status: "unavailable",
    metadata_snapshot: {},
    metadata_error_category: "platform_blocked",
    content_checksum: `sha256:${input.label}`,
    submission_idempotency_key: randomUUID(),
  }).select("id").single();
  if (attempt.error) fail("insert verified acceptance attempt", attempt.error);
  const review = await service.from("mission_publication_proof_reviews").insert({
    workspace_id: DEMO_WS,
    mission_publication_proof_attempt_id: attempt.data!.id,
    review_number: 1,
    state: "verified",
    decision: "verified",
    reviewer_id: input.operatorId,
    reviewed_at: new Date().toISOString(),
    checklist: {
      publicly_accessible: true,
      platform_matches: true,
      account_matches: true,
      content_matches_approved_version: true,
      timing_acceptable: true,
      disclosures_present: true,
    },
    summary: "Acceptance fixture verification",
    decision_idempotency_key: randomUUID(),
  }).select("id").single();
  if (review.error) fail("insert verified acceptance review", review.error);
  return { attemptId: attempt.data!.id as string };
}

async function createWorkflowScenario(input: {
  label: string;
  operatorId: string;
  states: Array<"proof_verified" | "proof_submitted">;
  withContract: boolean;
}): Promise<SeededWorkflow> {
  const active = await seedActiveMission({
    email: fixtureEmail(input.label),
    slug: `test-reward-handoff-acceptance-${input.label}`,
    deliverables: input.states.map((_, index) => ({
      title: `Required acceptance publication ${index + 1}`,
      platform: "instagram",
      required: true,
    })),
  });
  const service = serviceForTests();
  const created = await userForJwt(active.creator.jwt).rpc("create_mission_workflow", {
    p_submission: active.submission.id,
  });
  if (created.error) fail("create acceptance workflow", created.error);
  const workflowId = created.data?.id as string | undefined;
  if (!workflowId) fail("resolve acceptance workflow");
  const items = await service.from("mission_work_items")
    .select("id, position")
    .eq("mission_workflow_id", workflowId)
    .order("position");
  if (items.error) fail("read acceptance work items", items.error);
  for (const [index, item] of (items.data ?? []).entries()) {
    const state = input.states[index]!;
    let attemptId: string | null = null;
    if (state === "proof_verified") {
      const attempt = await insertVerifiedAttempt({
        creatorId: active.creator.id,
        itemId: item.id,
        operatorId: input.operatorId,
        label: `${input.label}-${index}`,
      });
      attemptId = attempt.attemptId;
    }
    const updated = await service.from("mission_work_items").update({
      state,
      current_proof_attempt_id: attemptId,
      verified_proof_attempt_id: state === "proof_verified" ? attemptId : null,
    }).eq("id", item.id).eq("workspace_id", DEMO_WS);
    if (updated.error) fail("set acceptance work-item state", updated.error);
  }
  const revision = 7;
  const workflow = await service.from("mission_workflows").update({
    state: "proof_verified",
    revision,
    updated_at: new Date().toISOString(),
  }).eq("id", workflowId).eq("workspace_id", DEMO_WS);
  if (workflow.error) fail("set acceptance workflow state", workflow.error);
  if (input.withContract) {
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
    });
    if (contract.error) fail("insert acceptance reward contract", contract.error);
  }
  return {
    creatorId: active.creator.id,
    workflowId,
    submissionId: active.submission.id,
    missionId: active.mission.id,
    operatorId: input.operatorId,
    revision,
  };
}

async function approve(fixture: SeededWorkflow) {
  const result = await serviceForTests().rpc("approve_mission_completion", {
    p_workspace: DEMO_WS,
    p_workflow: fixture.workflowId,
    p_operator: fixture.operatorId,
    p_expected_state: "proof_verified",
    p_expected_revision: fixture.revision,
    p_idempotency_key: randomUUID(),
  });
  if (result.error) fail("approve acceptance reward handoff", result.error);
  return result.data as { workflow: { revision: number }; pendingReward: { id: string } };
}

async function assertRewardNeutrality(
  label: string,
  creatorId: string,
  before: Awaited<ReturnType<typeof rewardNeutralitySnapshot>>,
): Promise<void> {
  const after = await rewardNeutralitySnapshot(creatorId);
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    throw new Error(`reward_neutrality_changed_${label}`);
  }
}

export async function seedRewardHandoffAcceptance(): Promise<StructuralCounts> {
  requireLocalAcceptanceEnvironment();
  await cleanup();
  const service = serviceForTests();
  const operatorId = await linkOperator();
  const configuredSla = await service.from("workspaces")
    .update({ reward_processing_window_days: 7 })
    .eq("id", DEMO_WS);
  if (configuredSla.error) fail("configure acceptance SLA", configuredSla.error);
  const missingSla = await service.from("workspaces").insert({
    slug: "test-brand-ws-reward-handoff-no-sla",
    name: "Reward handoff acceptance without SLA",
    reward_processing_window_days: null,
  });
  if (missingSla.error) fail("create acceptance missing-SLA workspace", missingSla.error);

  const snapshots: Array<Awaited<ReturnType<typeof rewardNeutralitySnapshot>>> = [];
  const newJoin = await createNewJoinContractScenario();
  snapshots.push(await rewardNeutralitySnapshot(newJoin.creatorId));

  const backfill = await createWorkflowScenario({
    label: "backfill",
    operatorId,
    states: ["proof_verified"],
    withContract: false,
  });
  snapshots.push(await rewardNeutralitySnapshot(backfill.creatorId));

  const eligible = await createWorkflowScenario({
    label: "eligible",
    operatorId,
    states: ["proof_verified"],
    withContract: true,
  });
  snapshots.push(await rewardNeutralitySnapshot(eligible.creatorId));

  const blocked = await createWorkflowScenario({
    label: "blocked",
    operatorId,
    states: ["proof_verified", "proof_submitted"],
    withContract: true,
  });
  snapshots.push(await rewardNeutralitySnapshot(blocked.creatorId));

  const pending = await createWorkflowScenario({
    label: "pending",
    operatorId,
    states: ["proof_verified"],
    withContract: true,
  });
  const pendingBefore = await rewardNeutralitySnapshot(pending.creatorId);
  snapshots.push(pendingBefore);
  await approve(pending);
  await assertRewardNeutrality("pending", pending.creatorId, pendingBefore);

  const cancelled = await createWorkflowScenario({
    label: "cancelled",
    operatorId,
    states: ["proof_verified"],
    withContract: true,
  });
  const cancelledBefore = await rewardNeutralitySnapshot(cancelled.creatorId);
  snapshots.push(cancelledBefore);
  const approved = await approve(cancelled);
  const cancellation = await service.rpc("cancel_mission_reward_handoff", {
    p_workspace: DEMO_WS,
    p_workflow: cancelled.workflowId,
    p_operator: operatorId,
    p_expected_state: "reward_pending",
    p_expected_revision: approved.workflow.revision,
    p_idempotency_key: randomUUID(),
    p_reason_category: REWARD_HANDOFF_CANCELLATION_REASON,
    p_reason_note: "Acceptance fixture returns the verified proof for reassessment.",
  });
  if (cancellation.error) fail("cancel acceptance reward handoff", cancellation.error);
  await assertRewardNeutrality("cancelled", cancelled.creatorId, cancelledBefore);

  const scenarioCounts = Object.fromEntries(
    REWARD_HANDOFF_SCENARIO_LABELS.map((label) => [label, 1]),
  ) as Record<ScenarioLabel, number>;
  const neutralitySnapshotCounts = Object.fromEntries(
    REWARD_NEUTRALITY_SNAPSHOT_FIELDS.map((field) => [field, snapshots.length]),
  ) as Record<SnapshotField, number>;
  return { scenarioCounts, neutralitySnapshotCounts };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  seedRewardHandoffAcceptance()
    .then((counts) => {
      process.stdout.write(`${JSON.stringify(rewardHandoffAcceptanceSummary(counts), null, 2)}\n`);
    })
    .catch(() => {
      process.stderr.write("Reward handoff acceptance seed failed with a classified setup error.\n");
      process.exitCode = 1;
    });
}