import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { joinMissionWithWorkflowRecovery } from "../routes/missions";
import {
  activeMissionIntegrationSkipReason,
  cleanup,
  creatorRewardSnapshot,
  DEMO_WS,
  makeCreator,
  makeBrand,
  makeMission,
  makeStaff,
  seedActiveMission,
  serviceForTests,
  userForJwt,
} from "./helpers";

const unique = () => randomUUID();
const integrationSkipReason = activeMissionIntegrationSkipReason();
const integrationSuite = integrationSkipReason === null ? describe : describe.skip;
const integrationSuiteName = integrationSkipReason === null
  ? "reward contract capture"
  : `reward contract capture (skipped: ${integrationSkipReason})`;

describe("mission join reward-contract routing", () => {
  it("uses one atomic RPC for a fresh active-workspace join", async () => {
    const joined = {
      submission: { id: "submission-1", status: "joined" },
      workflow: { id: "workflow-1", mission_submission_id: "submission-1" },
      rewardContract: { id: "contract-1", source: "join", xp_amount: 0 },
    };
    const rpc = vi.fn(async () => ({ data: joined, error: null }));
    const from = vi.fn();

    const result = await joinMissionWithWorkflowRecovery(
      { rpc, from } as unknown as SupabaseClient,
      { id: "mission-1", creator_workflow_mode: "active_workspace" },
      "creator-1",
      "workspace-1",
    );

    expect(result).toEqual({ data: joined, error: null });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("join_active_mission", {
      p_mission: "mission-1",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("recovers an already-joined workflow without creating a reward contract", async () => {
    const submission = {
      id: "submission-1",
      mission_id: "mission-1",
      creator_id: "creator-1",
      workspace_id: "workspace-1",
      status: "joined",
    };
    const workflow = {
      id: "workflow-1",
      mission_submission_id: submission.id,
      workspace_id: submission.workspace_id,
    };
    const rpc = vi.fn(async (name: string) => {
      if (name === "join_active_mission") {
        return { data: null, error: { message: "already_joined" } };
      }
      if (name === "create_mission_workflow") {
        return { data: workflow, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    });
    const maybeSingle = vi.fn(async () => ({ data: submission, error: null }));
    const eq = vi.fn(() => ({ eq, maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    const result = await joinMissionWithWorkflowRecovery(
      { rpc, from } as unknown as SupabaseClient,
      { id: submission.mission_id, creator_workflow_mode: "active_workspace" },
      submission.creator_id,
      submission.workspace_id,
    );

    expect(result).toEqual({ data: { submission, workflow }, error: null });
    expect(result.data).not.toHaveProperty("rewardContract");
    expect(rpc.mock.calls).toEqual([
      ["join_active_mission", { p_mission: submission.mission_id }],
      ["create_mission_workflow", { p_submission: submission.id }],
    ]);
  });

  it("keeps the legacy join path on join_mission", async () => {
    const submission = { id: "submission-legacy", status: "joined" };
    const rpc = vi.fn(async () => ({ data: submission, error: null }));

    const result = await joinMissionWithWorkflowRecovery(
      { rpc } as unknown as SupabaseClient,
      { id: "mission-legacy", creator_workflow_mode: "legacy" },
      "creator-1",
      "workspace-1",
    );

    expect(result).toEqual({ data: submission, error: null });
    expect(rpc).toHaveBeenCalledWith("join_mission", {
      p_mission: "mission-legacy",
    });
  });
});

async function seedFreshActiveMission() {
  const id = unique();
  const creator = await makeCreator(`reward-contract-${id}@test.local`, 250);
  const seeded = await makeMission({
    slug: `test-reward-contract-${id}`,
    points_reward: 725,
    cash_reward: 187.5,
  });
  const service = serviceForTests();
  const { data: mission, error: missionError } = await service
    .from("missions")
    .update({ creator_workflow_mode: "active_workspace" })
    .eq("id", seeded.id)
    .select("id, workspace_id, points_reward, cash_reward, updated_at")
    .single();
  if (missionError) throw missionError;
  const { error: templateError } = await service
    .from("mission_deliverable_templates")
    .insert({
      workspace_id: mission.workspace_id,
      mission_id: mission.id,
      title: "Required post",
      platform: "instagram",
      position: 0,
      required: true,
      publication_instructions: "Publish the approved post",
      publication_window_hours: 72,
      required_disclosures: [],
      proof_evidence_policy: {},
    });
  if (templateError) throw templateError;
  return { creator, mission };
}

integrationSuite(integrationSuiteName, () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("denies anonymous and authenticated callers access to service-only wrappers", async () => {
    const id = unique();
    const creator = await makeCreator(`reward-wrapper-denial-${id}@test.local`);
    const backfillArgs = {
      p_workspace: DEMO_WS,
      p_workflow: unique(),
      p_operator: unique(),
      p_points_amount: 100,
      p_cash_amount: 0,
      p_currency: "HKD",
      p_xp_amount: 0,
      p_source_mission_updated_at: null,
      p_confirmation_evidence_source: "operator_record",
      p_confirmation_reason: "Permission boundary check",
      p_idempotency_key: unique(),
    };
    const slaArgs = {
      p_workspace: DEMO_WS,
      p_operator: unique(),
      p_days: 14,
    };

    for (const client of [
      userForJwt(""),
      userForJwt(creator.jwt),
    ]) {
      const [backfill, sla] = await Promise.all([
        client.rpc("backfill_mission_reward_contract", backfillArgs),
        client.rpc("set_reward_processing_window", slaArgs),
      ]);
      expect(backfill.error?.message.toLowerCase()).toContain(
        "permission denied",
      );
      expect(sla.error?.message.toLowerCase()).toContain(
        "permission denied",
      );
    }
  });

  it("captures one immutable reward contract when an active workflow is created", async () => {
    const seeded = await seedFreshActiveMission();
    const beforeRewards = await creatorRewardSnapshot(seeded.creator.userId);
    const user = userForJwt(seeded.creator.jwt);
    const joined = await user.rpc("join_active_mission", {
      p_mission: seeded.mission.id,
    });
    expect(joined.error).toBeNull();
    const afterJoinRewards = await creatorRewardSnapshot(seeded.creator.userId);
    expect(afterJoinRewards).toEqual({
      ...beforeRewards,
      xp: beforeRewards.xp + 10,
    });

    const workflow = joined.data.workflow as { id: string };
    const service = serviceForTests();
    const contractResult = await service
      .from("mission_reward_contracts")
      .select("*")
      .eq("mission_workflow_id", workflow.id)
      .single();
    expect(contractResult.error).toBeNull();
    expect(contractResult.data).toMatchObject({
      source: "join",
      points_amount: seeded.mission.points_reward,
      cash_amount: seeded.mission.cash_reward ?? 0,
      currency: "HKD",
      xp_amount: 0,
      source_mission_updated_at: seeded.mission.updated_at,
    });

    const frozen = contractResult.data;
    expect((await service.from("missions").update({
      points_reward: 9999,
      cash_reward: 999.99,
    }).eq("id", seeded.mission.id)).error).toBeNull();
    const afterEdit = await service
      .from("mission_reward_contracts")
      .select("*")
      .eq("mission_workflow_id", workflow.id)
      .single();
    expect(afterEdit.data).toEqual(frozen);

    const duplicate = await user.rpc("join_active_mission", {
      p_mission: seeded.mission.id,
    });
    expect(duplicate.error?.message).toBe("already_joined");
    const contracts = await service
      .from("mission_reward_contracts")
      .select("id")
      .eq("mission_workflow_id", workflow.id);
    expect(contracts.data).toHaveLength(1);
    expect(await creatorRewardSnapshot(seeded.creator.userId)).toEqual(afterJoinRewards);
  });

  it("requires audited staff provenance for an existing-workflow backfill", async () => {
    const id = unique();
    const historical = await seedActiveMission({
      email: `reward-backfill-${id}@test.local`,
      slug: `test-reward-backfill-${id}`,
      deliverables: [{ title: "Historical post", platform: "instagram" }],
    });
    const recovered = await joinMissionWithWorkflowRecovery(
      userForJwt(historical.creator.jwt),
      historical.mission,
      historical.creator.id,
      DEMO_WS,
    );
    expect(recovered.error).toBeNull();
    expect(recovered.data).not.toHaveProperty("rewardContract");
    const workflow = recovered.data.workflow as { id: string };
    const service = serviceForTests();
    const missingContract = await service
      .from("mission_reward_contracts")
      .select("id")
      .eq("mission_workflow_id", workflow.id);
    expect(missingContract.data).toEqual([]);

    const operator = await makeStaff(`reward-backfill-operator-${id}@test.local`);
    const nonMember = await service.rpc("backfill_mission_reward_contract", {
      p_workspace: DEMO_WS,
      p_workflow: workflow.id,
      p_operator: operator.userId,
      p_points_amount: 500,
      p_cash_amount: 125,
      p_currency: "HKD",
      p_xp_amount: 0,
      p_source_mission_updated_at: null,
      p_confirmation_evidence_source: "operator_record",
      p_confirmation_reason: "Membership boundary check",
      p_idempotency_key: unique(),
    });
    expect(nonMember.error?.message).toContain("not_authorized");

    expect((await service.from("brand_users").insert({
      user_id: operator.userId,
      workspace_id: DEMO_WS,
      email: `reward-backfill-operator-${id}@test.local`,
      role: "member",
      active: true,
    })).error).toBeNull();
    const args = {
      p_workspace: DEMO_WS,
      p_workflow: workflow.id,
      p_operator: operator.userId,
      p_points_amount: 500,
      p_cash_amount: 125,
      p_currency: "HKD",
      p_xp_amount: 0,
      p_source_mission_updated_at: null,
      p_confirmation_evidence_source: "operator_record",
      p_confirmation_reason: "",
      p_idempotency_key: unique(),
    };
    const missingReason = await service.rpc("backfill_mission_reward_contract", args);
    expect(missingReason.error?.message).toContain("backfill_reason_required");

    for (const invalid of [
      { p_points_amount: -1 },
      { p_cash_amount: -1 },
      { p_currency: "hkd" },
      { p_confirmation_evidence_source: "unbounded_source" },
    ]) {
      const result = await service.rpc("backfill_mission_reward_contract", {
        ...args,
        ...invalid,
        p_confirmation_reason: "Historical values verified",
        p_idempotency_key: unique(),
      });
      expect(result.error?.message).toContain("backfill_contract_invalid");
    }

    const created = await service.rpc("backfill_mission_reward_contract", {
      ...args,
      p_confirmation_reason: "Historical values verified",
    });
    expect(created.error).toBeNull();
    expect(created.data).toMatchObject({
      contract: {
        source: "operator_backfill",
        confirmed_by: operator.userId,
        confirmation_evidence_source: "operator_record",
        confirmation_reason: "Historical values verified",
        source_mission_updated_at: null,
      },
      idempotent: false,
    });
    const duplicate = await service.rpc("backfill_mission_reward_contract", {
      ...args,
      p_confirmation_reason: "Historical values verified",
      p_idempotency_key: unique(),
    });
    expect(duplicate.error?.message).toContain("reward_contract_exists");
  });

  it("does not reveal a workflow that belongs to another workspace", async () => {
    const id = unique();
    const historical = await seedActiveMission({
      email: `reward-privacy-${id}@test.local`,
      slug: `test-reward-privacy-${id}`,
      deliverables: [{ title: "Private post", platform: "instagram" }],
    });
    const recovered = await joinMissionWithWorkflowRecovery(
      userForJwt(historical.creator.jwt),
      historical.mission,
      historical.creator.id,
      DEMO_WS,
    );
    expect(recovered.error).toBeNull();
    const workflow = recovered.data.workflow as { id: string };

    const otherWorkspace = await makeBrand(
      `reward-privacy-brand-${id}@test.local`,
    );
    const operator = await makeStaff(
      `reward-privacy-operator-${id}@test.local`,
    );
    const service = serviceForTests();
    expect((await service.from("brand_users").insert({
      user_id: operator.userId,
      workspace_id: otherWorkspace.workspaceId,
      email: `reward-privacy-operator-${id}@test.local`,
      role: "member",
      active: true,
    })).error).toBeNull();

    const args = {
      p_workspace: otherWorkspace.workspaceId,
      p_workflow: workflow.id,
      p_operator: operator.userId,
      p_points_amount: 500,
      p_cash_amount: 125,
      p_currency: "HKD",
      p_xp_amount: 0,
      p_source_mission_updated_at: null,
      p_confirmation_evidence_source: "operator_record",
      p_confirmation_reason: "Tenant privacy check",
      p_idempotency_key: unique(),
    };
    const crossWorkspace = await service.rpc(
      "backfill_mission_reward_contract",
      args,
    );
    const absent = await service.rpc("backfill_mission_reward_contract", {
      ...args,
      p_workflow: unique(),
      p_idempotency_key: unique(),
    });
    expect(crossWorkspace.error?.message).toContain(
      "reward_workflow_not_found",
    );
    expect(absent.error?.message).toBe(crossWorkspace.error?.message);
  });

  it("sets and removes the workspace reward-processing promise with active membership", async () => {
    const id = unique();
    const service = serviceForTests();
    const operator = await makeStaff(`reward-sla-operator-${id}@test.local`);
    expect((await service.from("brand_users").insert({
      user_id: operator.userId,
      workspace_id: DEMO_WS,
      email: `reward-sla-operator-${id}@test.local`,
      role: "member",
      active: true,
    })).error).toBeNull();

    for (const days of [0, 365]) {
      const accepted = await service.rpc("set_reward_processing_window", {
        p_workspace: DEMO_WS,
        p_operator: operator.userId,
        p_days: days,
      });
      expect(accepted.error).toBeNull();
      expect(accepted.data).toEqual({
        workspaceId: DEMO_WS,
        rewardProcessingWindowDays: days,
      });
    }
    for (const days of [-1, 366]) {
      const rejected = await service.rpc("set_reward_processing_window", {
        p_workspace: DEMO_WS,
        p_operator: operator.userId,
        p_days: days,
      });
      expect(rejected.error?.message).toContain(
        "reward_processing_window_invalid",
      );
    }

    const removed = await service.rpc("set_reward_processing_window", {
      p_workspace: DEMO_WS,
      p_operator: operator.userId,
      p_days: null,
    });
    expect(removed.error).toBeNull();
    expect(removed.data).toEqual({ workspaceId: DEMO_WS, rewardProcessingWindowDays: null });

    expect((await service.from("brand_users").update({ active: false })
      .eq("user_id", operator.userId)
      .eq("workspace_id", DEMO_WS)).error).toBeNull();
    const denied = await service.rpc("set_reward_processing_window", {
      p_workspace: DEMO_WS,
      p_operator: operator.userId,
      p_days: 7,
    });
    expect(denied.error?.message).toContain("not_authorized");
  });
});
