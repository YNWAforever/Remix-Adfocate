import { fixtureName } from "./helpers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { cleanup, DEMO_WS, hasSupabaseEnv, makeCreator, makeMission, serviceForTests, userForJwt } from "./helpers";

const suite = hasSupabaseEnv ? describe : describe.skip;

suite("operator CRM schema and RLS", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("lets the service role write review, note, shortlist, and audit rows", async () => {
    const svc = serviceForTests();
    const creator = await makeCreator(fixtureName("operator-crm-schema@test.local"));
    const mission = await makeMission({ slug: fixtureName("test-operator-crm-schema") });

    const review = await svc
      .from("creator_review_statuses")
      .insert({
        creator_id: creator.userId,
        workspace_id: DEMO_WS,
        status: "approved",
        risk_level: "low",
        summary: "Reliable creator for beauty missions.",
        reviewed_by: "schema-test",
      })
      .select("creator_id, status, risk_level")
      .single();
    expect(review.error).toBeNull();
    expect(review.data).toMatchObject({ creator_id: creator.userId, status: "approved", risk_level: "low" });

    const note = await svc.from("creator_review_notes").insert({
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      operator_id: "schema-test",
      category: "quality",
      body: "Strong recent samples.",
    });
    expect(note.error).toBeNull();

    const shortlist = await svc
      .from("mission_shortlists")
      .insert({
        mission_id: mission.id,
        creator_id: creator.userId,
        workspace_id: DEMO_WS,
        status: "shortlisted",
        source: "manual",
        notes: "Good fit for campaign.",
        created_by: "schema-test",
        updated_by: "schema-test",
      })
      .select("mission_id, creator_id, status")
      .single();
    expect(shortlist.error).toBeNull();
    expect(shortlist.data).toMatchObject({ mission_id: mission.id, creator_id: creator.userId, status: "shortlisted" });

    const audit = await svc.from("operator_audit_events").insert({
      workspace_id: DEMO_WS,
      operator_id: "schema-test",
      actor_label: "Schema Test",
      event_type: "creator_review.updated",
      target_type: "creator",
      target_id: creator.userId,
      creator_id: creator.userId,
      metadata: { status: "approved" },
    });
    expect(audit.error).toBeNull();
  });

  it("denies authenticated creators direct read access to operator CRM tables", async () => {
    const svc = serviceForTests();
    const creator = await makeCreator(fixtureName("operator-crm-hidden@test.local"));
    const mission = await makeMission({ slug: fixtureName("test-operator-crm-hidden") });

    await svc.from("creator_review_statuses").insert({
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      status: "flagged",
      risk_level: "high",
      summary: "Internal brand safety concern.",
      reviewed_by: "schema-test",
    });
    await svc.from("creator_review_notes").insert({
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      operator_id: "schema-test",
      category: "brand_safety",
      body: "Internal note must stay private.",
    });
    await svc.from("mission_shortlists").insert({
      mission_id: mission.id,
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      status: "shortlisted",
      source: "manual",
      notes: "Internal shortlist note.",
      created_by: "schema-test",
      updated_by: "schema-test",
    });
    await svc.from("operator_audit_events").insert({
      workspace_id: DEMO_WS,
      operator_id: "schema-test",
      actor_label: "Schema Test",
      event_type: "creator_note.created",
      target_type: "creator",
      target_id: creator.userId,
      creator_id: creator.userId,
      metadata: { category: "brand_safety" },
    });

    const user = userForJwt(creator.jwt);
    for (const table of ["creator_review_statuses", "creator_review_notes", "mission_shortlists", "operator_audit_events"]) {
      const { data, error } = await user.from(table).select("*");
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    }
  });

  it("enforces one shortlist row per mission and creator", async () => {
    const svc = serviceForTests();
    const creator = await makeCreator(fixtureName("operator-crm-unique@test.local"));
    const mission = await makeMission({ slug: fixtureName("test-operator-crm-unique") });
    const row = {
      mission_id: mission.id,
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      status: "shortlisted",
      source: "manual",
      created_by: "schema-test",
      updated_by: "schema-test",
    };

    const first = await svc.from("mission_shortlists").insert(row);
    expect(first.error).toBeNull();

    const second = await svc.from("mission_shortlists").insert(row);
    expect(second.error?.code).toBe("23505");
  });

  it("rejects shortlist rows when mission and creator workspaces differ", async () => {
    const svc = serviceForTests();
    const creator = await makeCreator(fixtureName("operator-crm-workspace-guard@test.local"));
    const workspaceId = randomUUID();
    const missionId = randomUUID();

    try {
      await svc.from("workspaces").insert({
        id: workspaceId,
        slug: `test-operator-crm-guard-${workspaceId.slice(0, 8)}`,
        name: "Operator CRM guard test",
        theme: {},
      });
      await svc.from("missions").insert({
        id: missionId,
        workspace_id: workspaceId,
        slug: `test-operator-crm-guard-${missionId.slice(0, 8)}`,
        title: "Operator CRM guard mission",
        mission_type: "ugc",
        access_type: "open",
        points_reward: 100,
        quota: 5,
        filled: 0,
        status: "active",
        required_level: "L0",
        category: "美容",
      });

      const result = await svc.from("mission_shortlists").insert({
        mission_id: missionId,
        creator_id: creator.userId,
        workspace_id: workspaceId,
        status: "shortlisted",
        source: "manual",
        notes: "Cross-workspace rows must be blocked.",
        created_by: "schema-test",
        updated_by: "schema-test",
      });

      expect(result.error?.code).toBe("23514");
      expect(result.error?.message).toContain("workspace mismatch");
    } finally {
      await svc.from("mission_shortlists").delete().eq("mission_id", missionId);
      await svc.from("operator_audit_events").delete().eq("mission_id", missionId);
      await svc.from("mission_submissions").delete().eq("mission_id", missionId);
      await svc.from("missions").delete().eq("id", missionId);
      await svc.from("workspaces").delete().eq("id", workspaceId);
    }
  });
});
