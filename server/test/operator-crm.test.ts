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

  it("requires a note when shortlisting a flagged creator", async () => {
    const creator = await makeCreator("operator-crm-flag-note@test.local");
    const mission = await makeMission({ slug: "test-operator-crm-flag-note" });
    await adminreq(`/admin/creators/${creator.userId}/review?workspace=${DEMO_WS}`, {
      method: "POST",
      body: JSON.stringify({
        command_id: "operator-crm-flag-note-review",
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
    await adminreq(`/admin/creators/${creator.userId}/review?workspace=${DEMO_WS}`, {
      method: "POST",
      body: JSON.stringify({
        command_id: "operator-crm-flag-invite-review",
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

  it("preserves an existing shortlist note when updating only the shortlist status", async () => {
    const creator = await makeCreator("operator-crm-shortlist-note-preserve@test.local");
    const mission = await makeMission({ slug: "test-operator-crm-shortlist-note-preserve" });

    const created = await adminreq(`/admin/missions/${mission.id}/shortlist`, {
      method: "POST",
      body: JSON.stringify({ creator_id: creator.userId, source: "manual", notes: "Keep this operator note." }),
    });
    expect(created.status).toBe(200);

    const updated = await adminreq(`/admin/missions/${mission.id}/shortlist/${creator.userId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "invited" }),
    });
    expect(updated.status).toBe(200);
    expect((await updated.json()).shortlist).toMatchObject({
      mission_id: mission.id,
      creator_id: creator.userId,
      status: "invited",
      notes: "Keep this operator note.",
    });
  });

  it("rejects shortlists when the mission and creator belong to different workspaces", async () => {
    const svc = serviceForTests();
    const creator = await makeCreator("operator-crm-workspace-mismatch@test.local");
    const workspaceId = "00000000-0000-0000-0000-0000000000bb";
    const missionId = "00000000-0000-0000-0000-000000000013";

    try {
      await svc.from("workspaces").upsert({
        id: workspaceId,
        slug: "test-operator-crm-workspace-mismatch",
        name: "Workspace mismatch test",
        theme: {},
      });
      await svc.from("missions").insert({
        id: missionId,
        workspace_id: workspaceId,
        slug: "test-operator-crm-workspace-mismatch",
        title: "Workspace mismatch mission",
        mission_type: "ugc",
        access_type: "open",
        points_reward: 100,
        quota: 5,
        filled: 0,
        status: "active",
        required_level: "L0",
        category: "美容",
      });

      const res = await adminreq(`/admin/missions/${missionId}/shortlist`, {
        method: "POST",
        body: JSON.stringify({ creator_id: creator.userId, source: "manual", notes: "This should be rejected." }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("workspace_mismatch");
    } finally {
      await svc.from("mission_shortlists").delete().eq("mission_id", missionId);
      await svc.from("operator_audit_events").delete().eq("mission_id", missionId);
      await svc.from("mission_submissions").delete().eq("mission_id", missionId);
      await svc.from("missions").delete().eq("id", missionId);
      await svc.from("workspaces").delete().eq("id", workspaceId);
    }
  });

});
