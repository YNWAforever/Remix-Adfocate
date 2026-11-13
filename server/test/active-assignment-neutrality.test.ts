import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activeMissionIntegrationSkipReason,
  cleanup,
  creatorRewardSnapshot,
  DEMO_WS,
  grantStaffFixture,
  makeCreator,
  makeMission,
  makeStaff,
  serviceForTests,
  userForJwt,
} from "./helpers";

const skipReason = activeMissionIntegrationSkipReason();
const suite = skipReason === null ? describe : describe.skip;

async function activeMission(access: "open" | "application") {
  const seeded = await makeMission({ slug: `test-assignment-neutral-${randomUUID()}`, quota: 1, points_reward: 475, cash_reward: 18.5 });
  const service = serviceForTests();
  const updated = await service.from("missions").update({ creator_workflow_mode: "active_workspace", access_type: access })
    .eq("id", seeded.id).select("id,workspace_id,points_reward,cash_reward,updated_at").single();
  expect(updated.error).toBeNull();
  const template = await service.from("mission_deliverable_templates").insert({
    workspace_id: DEMO_WS, mission_id: seeded.id, title: "Required post", platform: "instagram", position: 0, required: true,
    publication_instructions: "Publish approved post", publication_window_hours: 72, required_disclosures: [], proof_evidence_policy: {},
  });
  expect(template.error).toBeNull();
  return updated.data!;
}

suite(skipReason === null ? "active assignment neutrality integration" : `active assignment neutrality integration (skipped: ${skipReason})`, () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("serializes two creators competing for one active slot with no XP or reward balance change", async () => {
    const mission = await activeMission("open");
    const creators = await Promise.all([0, 1].map(index => makeCreator(`assignment-race-${index}-${randomUUID()}@test.local`)));
    const before = await Promise.all(creators.map(creator => creatorRewardSnapshot(creator.userId)));
    const attempts = await Promise.all(creators.map(creator => userForJwt(creator.jwt).rpc("join_active_mission", { p_mission: mission.id })));
    expect(attempts.filter(result => result.error === null)).toHaveLength(1);
    expect(attempts.filter(result => result.error !== null).map(result => result.error!.message)).toEqual(["mission_full"]);
    expect(await Promise.all(creators.map(creator => creatorRewardSnapshot(creator.userId)))).toEqual(before);
    const service = serviceForTests();
    const submissions = await service.from("mission_submissions").select("id,xp_awarded").eq("mission_id", mission.id);
    expect(submissions.error).toBeNull();
    expect(submissions.data).toHaveLength(1);
    expect(submissions.data![0].xp_awarded).toBe(0);
    const filled = await service.from("missions").select("filled").eq("id", mission.id).single();
    expect(filled.data?.filled).toBe(1);
    const contracts = await service.from("mission_reward_contracts").select("xp_amount").eq("mission_id", mission.id);
    expect(contracts.error).toBeNull();
    expect(contracts.data).toEqual([{ xp_amount: 0 }]);
  });

  it("keeps primitive active acceptance neutral and preserves pre-existing anchor XP on replay", async () => {
    const mission = await activeMission("application");
    const creator = await makeCreator(`assignment-accept-${randomUUID()}@test.local`);
    const service = serviceForTests();
    const applied = await userForJwt(creator.jwt).rpc("apply_mission", { p_mission: mission.id });
    expect(applied.error).toBeNull();
    // Synthetic pre-existing award: acceptance may neither add nor remove it.
    expect((await service.from("mission_submissions").update({ xp_awarded: 93 }).eq("id", applied.data.id)).error).toBeNull();
    const before = await creatorRewardSnapshot(creator.userId);
    const accepted = await service.rpc("accept_application", { p_submission: applied.data.id });
    expect(accepted.error).toBeNull();
    expect(accepted.data).toMatchObject({ status: "joined", xp_awarded: 93 });
    const replay = await service.rpc("accept_application", { p_submission: applied.data.id });
    expect(replay.error).toBeNull();
    expect(replay.data).toEqual(accepted.data);
    expect(await creatorRewardSnapshot(creator.userId)).toEqual(before);
    expect((await service.from("missions").select("filled").eq("id", mission.id).single()).data?.filled).toBe(1);
  });

  it("keeps latest staff acceptance neutral while freezing a zero-XP reward contract exactly once", async () => {
    const mission = await activeMission("application");
    const creator = await makeCreator(`assignment-decision-${randomUUID()}@test.local`);
    const operator = await makeStaff(`assignment-operator-${randomUUID()}@test.local`, DEMO_WS);
    await grantStaffFixture(operator.userId, DEMO_WS, "operator");
    const service = serviceForTests();
    const applied = await userForJwt(creator.jwt).rpc("apply_mission", { p_mission: mission.id });
    expect(applied.error).toBeNull();
    const args = { p_workspace: DEMO_WS, p_operator: operator.userId, p_submission: applied.data.id,
      p_request: randomUUID(), p_expected_revision: 0, p_decision: "accept", p_notes: null };
    const before = await creatorRewardSnapshot(creator.userId);
    const accepted = await service.rpc("decide_mission_application", args);
    expect(accepted.error).toBeNull();
    expect(accepted.data.submission).toMatchObject({ status: "joined", xp_awarded: 0 });
    const replay = await service.rpc("decide_mission_application", args);
    expect(replay.error).toBeNull();
    expect(replay.data).toEqual(accepted.data);
    expect(await creatorRewardSnapshot(creator.userId)).toEqual(before);
    const captured = await service.from("mission_reward_contracts").select("*").eq("mission_id", mission.id);
    expect(captured.error).toBeNull();
    expect(captured.data).toHaveLength(1);
    expect(captured.data![0]).toMatchObject({ source: "join", points_amount: 475, cash_amount: 18.5,
      xp_amount: 0, source_mission_updated_at: mission.updated_at });
    expect((await service.from("missions").update({ points_reward: 999 }).eq("id", mission.id)).error).toBeNull();
    expect((await service.from("mission_reward_contracts").select("*").eq("mission_id", mission.id)).data).toEqual(captured.data);
  });
});
