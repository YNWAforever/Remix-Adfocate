import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanup, DEMO_WS, hasSupabaseEnv, makeCreator, makeMission, serviceForTests, userForJwt } from "./helpers";

const suite = hasSupabaseEnv ? describe : describe.skip;

suite("operator CRM schema and RLS", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("lets the service role write review, note, shortlist, and audit rows", async () => {
    const svc = serviceForTests();
    const creator = await makeCreator("operator-crm-schema@test.local");
    const mission = await makeMission({ slug: "test-operator-crm-schema" });

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
    const creator = await makeCreator("operator-crm-hidden@test.local");
    const mission = await makeMission({ slug: "test-operator-crm-hidden" });

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
    const creator = await makeCreator("operator-crm-unique@test.local");
    const mission = await makeMission({ slug: "test-operator-crm-unique" });
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
});
