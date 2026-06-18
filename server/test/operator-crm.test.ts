import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { cleanup, DEMO_WS, hasSupabaseEnv, makeCreator, makeMission, serviceForTests } from "./helpers";

process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || "test-admin-secret";
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function adminreq(path: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: {
      "x-admin-secret": ADMIN_SECRET,
      "x-operator-id": "crm-test",
      "x-operator-label": "CRM Test",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function adminreqAs(
  path: string,
  operator: { id: string; label: string },
  init: RequestInit = {},
) {
  return app.request(`/api${path}`, {
    ...init,
    headers: {
      "x-admin-secret": ADMIN_SECRET,
      "x-operator-id": operator.id,
      "x-operator-label": operator.label,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

suite("operator CRM admin API", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("lists creators with default needs_review status when no review row exists", async () => {
    const creator = await makeCreator("operator-crm-queue@test.local");
    const res = await adminreq("/admin/creators/review?q=operator-crm-queue");
    expect(res.status).toBe(200);

    const body = await res.json();
    const row = body.creators.find((item: { id: string }) => item.id === creator.userId);
    expect(row.review).toMatchObject({ status: "needs_review", riskLevel: "unknown" });
    expect(row.social.ownershipLabel).toBe("Ownership not verified");
  });

  it("updates review status, creates an optional note, and writes audit events", async () => {
    const creator = await makeCreator("operator-crm-review@test.local");
    const review = await adminreq(`/admin/creators/${creator.userId}/review`, {
      method: "POST",
      body: JSON.stringify({
        status: "approved",
        risk_level: "low",
        summary: "Strong fit for skincare missions.",
        note: "Prior delivery was on brief.",
      }),
    });
    expect(review.status).toBe(200);
    expect(await review.json()).toMatchObject({
      review: { status: "approved", riskLevel: "low", summary: "Strong fit for skincare missions." },
    });

    const svc = serviceForTests();
    const notes = await svc.from("creator_review_notes").select("body, category").eq("creator_id", creator.userId);
    expect(notes.data).toEqual([{ body: "Prior delivery was on brief.", category: "other" }]);

    const audits = await svc
      .from("operator_audit_events")
      .select("event_type, operator_id, actor_label")
      .eq("creator_id", creator.userId)
      .order("created_at");
    expect(audits.data?.map((event) => event.event_type).sort()).toEqual(["creator_note.created", "creator_review.updated"]);
    expect(audits.data?.every((event) => event.operator_id === "crm-test" && event.actor_label === "CRM Test")).toBe(true);
  });

  it("returns creator detail with notes, shortlists, social summary, mission history, and audit timeline", async () => {
    const creator = await makeCreator("operator-crm-detail@test.local");
    const mission = await makeMission({ slug: "test-operator-crm-detail" });
    const svc = serviceForTests();
    await svc.from("creator_social_accounts").insert({
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      platform: "instagram",
      handle: "detailcreator",
      sync_status: "synced",
      follower_count: 22000,
      engagement_rate: 4.1,
      api_synced_at: "2026-06-18T03:00:00.000Z",
    });
    await adminreq(`/admin/creators/${creator.userId}/review`, {
      method: "POST",
      body: JSON.stringify({ status: "approved", risk_level: "low", summary: "Ready for mission selection." }),
    });
    await adminreq(`/admin/missions/${mission.id}/shortlist`, {
      method: "POST",
      body: JSON.stringify({ creator_id: creator.userId, source: "manual", notes: "Add to launch list." }),
    });

    const res = await adminreq(`/admin/creators/${creator.userId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.creator.id).toBe(creator.userId);
    expect(body.social.followerCount).toBe(22000);
    expect(body.review.status).toBe("approved");
    expect(body.shortlists[0]).toMatchObject({ mission_id: mission.id, status: "shortlisted" });
    expect(body.audit.some((event: { event_type: string }) => event.event_type === "mission_shortlist.created")).toBe(true);
  });

  it("requires a note when flagging a creator review", async () => {
    const creator = await makeCreator("operator-crm-flag-review@test.local");
    const res = await adminreq(`/admin/creators/${creator.userId}/review`, {
      method: "POST",
      body: JSON.stringify({ status: "flagged", risk_level: "high", summary: "Needs senior review." }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("flagged_review_note_required");
  });

  it("requires a note when shortlisting a flagged creator", async () => {
    const creator = await makeCreator("operator-crm-flag-note@test.local");
    const mission = await makeMission({ slug: "test-operator-crm-flag-note" });
    await adminreq(`/admin/creators/${creator.userId}/review`, {
      method: "POST",
      body: JSON.stringify({
        status: "flagged",
        risk_level: "high",
        summary: "Needs senior review.",
        note: "Escalated for brand safety review.",
      }),
    });

    const res = await adminreq(`/admin/missions/${mission.id}/shortlist`, {
      method: "POST",
      body: JSON.stringify({ creator_id: creator.userId, source: "manual" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("flagged_note_required");
  });

  it("blocks invited status for a flagged creator", async () => {
    const creator = await makeCreator("operator-crm-flag-invite@test.local");
    const mission = await makeMission({ slug: "test-operator-crm-flag-invite" });
    await adminreq(`/admin/creators/${creator.userId}/review`, {
      method: "POST",
      body: JSON.stringify({
        status: "flagged",
        risk_level: "high",
        summary: "Needs senior review.",
        note: "Escalated for brand safety review.",
      }),
    });

    const created = await adminreq(`/admin/missions/${mission.id}/shortlist`, {
      method: "POST",
      body: JSON.stringify({ creator_id: creator.userId, source: "manual", notes: "Escalated exception." }),
    });
    expect(created.status).toBe(200);

    const invite = await adminreq(`/admin/missions/${mission.id}/shortlist/${creator.userId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "invited", notes: "Invite after exception." }),
    });
    expect(invite.status).toBe(409);
    expect((await invite.json()).code).toBe("flagged_invite_blocked");
  });

  it("preserves created_by while updating updated_by when re-shortlisting an existing row", async () => {
    const creator = await makeCreator("operator-crm-reshortlist@test.local");
    const mission = await makeMission({ slug: "test-operator-crm-reshortlist" });

    const first = await adminreqAs(
      `/admin/missions/${mission.id}/shortlist`,
      { id: "operator-a", label: "Operator A" },
      {
        method: "POST",
        body: JSON.stringify({ creator_id: creator.userId, source: "manual", notes: "Initial shortlist." }),
      },
    );
    expect(first.status).toBe(200);

    const second = await adminreqAs(
      `/admin/missions/${mission.id}/shortlist`,
      { id: "operator-b", label: "Operator B" },
      {
        method: "POST",
        body: JSON.stringify({ creator_id: creator.userId, source: "review_queue", notes: "Restore to shortlist." }),
      },
    );
    expect(second.status).toBe(200);

    const body = await second.json();
    expect(body.shortlist).toMatchObject({
      mission_id: mission.id,
      creator_id: creator.userId,
      created_by: "operator-a",
      updated_by: "operator-b",
      source: "review_queue",
      notes: "Restore to shortlist.",
    });

    const svc = serviceForTests();
    const row = await svc
      .from("mission_shortlists")
      .select("created_by, updated_by, source, notes")
      .eq("mission_id", mission.id)
      .eq("creator_id", creator.userId)
      .single();
    expect(row.error).toBeNull();
    expect(row.data).toMatchObject({
      created_by: "operator-a",
      updated_by: "operator-b",
      source: "review_queue",
      notes: "Restore to shortlist.",
    });
  });

  it("treats concurrent first-time shortlist posts as an idempotent upsert", async () => {
    const creator = await makeCreator("operator-crm-shortlist-race@test.local");
    const mission = await makeMission({ slug: "test-operator-crm-shortlist-race" });

    const [first, second] = await Promise.all([
      adminreqAs(
        `/admin/missions/${mission.id}/shortlist`,
        { id: "operator-a", label: "Operator A" },
        {
          method: "POST",
          body: JSON.stringify({ creator_id: creator.userId, source: "manual", notes: "Initial shortlist." }),
        },
      ),
      adminreqAs(
        `/admin/missions/${mission.id}/shortlist`,
        { id: "operator-b", label: "Operator B" },
        {
          method: "POST",
          body: JSON.stringify({ creator_id: creator.userId, source: "match", notes: "Duplicate shortlist." }),
        },
      ),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const svc = serviceForTests();
    const rows = await svc
      .from("mission_shortlists")
      .select("created_by, updated_by, source, notes")
      .eq("mission_id", mission.id)
      .eq("creator_id", creator.userId);
    expect(rows.error).toBeNull();
    expect(rows.data).toHaveLength(1);
    expect([rows.data?.[0].created_by, rows.data?.[0].updated_by].sort()).toEqual(["operator-a", "operator-b"]);
  });

  it("creates creator notes through the admin note endpoint", async () => {
    const creator = await makeCreator("operator-crm-note-endpoint@test.local");
    const res = await adminreq(`/admin/creators/${creator.userId}/notes`, {
      method: "POST",
      body: JSON.stringify({ category: "fit", body: "Great match for wellness launches." }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).note).toMatchObject({
      creator_id: creator.userId,
      category: "fit",
      body: "Great match for wellness launches.",
      operator_id: "crm-test",
    });
  });

  it("lists mission shortlist rows through the admin shortlist endpoint", async () => {
    const creator = await makeCreator("operator-crm-shortlist-list@test.local");
    const mission = await makeMission({ slug: "test-operator-crm-shortlist-list" });
    await adminreq(`/admin/missions/${mission.id}/shortlist`, {
      method: "POST",
      body: JSON.stringify({ creator_id: creator.userId, source: "manual", notes: "List endpoint coverage." }),
    });

    const res = await adminreq(`/admin/missions/${mission.id}/shortlist`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.mission).toMatchObject({ id: mission.id, slug: "test-operator-crm-shortlist-list" });
    expect(body.shortlists).toHaveLength(1);
    expect(body.shortlists[0]).toMatchObject({
      mission_id: mission.id,
      creator_id: creator.userId,
      created_by: "crm-test",
      updated_by: "crm-test",
      status: "shortlisted",
    });
  });

  it("hides flagged creators by default in a mission-scoped queue", async () => {
    const approved = await makeCreator("operator-crm-approved@test.local");
    const flagged = await makeCreator("operator-crm-hidden-flagged@test.local");
    const mission = await makeMission({ slug: "test-operator-crm-mission-filter" });
    await adminreq(`/admin/creators/${approved.userId}/review`, {
      method: "POST",
      body: JSON.stringify({ status: "approved", risk_level: "low", summary: "Ready." }),
    });
    await adminreq(`/admin/creators/${flagged.userId}/review`, {
      method: "POST",
      body: JSON.stringify({
        status: "flagged",
        risk_level: "high",
        summary: "Hidden by default.",
        note: "Hold for operator review.",
      }),
    });

    const res = await adminreq(`/admin/creators/review?mission_id=${mission.id}`);
    expect(res.status).toBe(200);
    const ids = (await res.json()).creators.map((row: { id: string }) => row.id);
    expect(ids).toContain(approved.userId);
    expect(ids).not.toContain(flagged.userId);

    const flaggedRes = await adminreq(`/admin/creators/review?mission_id=${mission.id}&status=flagged`);
    expect(flaggedRes.status).toBe(200);
    const flaggedIds = (await flaggedRes.json()).creators.map((row: { id: string }) => row.id);
    expect(flaggedIds).toContain(flagged.userId);
  });
});
