import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createApp } from "../app";
import { makeCreator, makeMission, getCreatorScores, cleanup, hasSupabaseEnv } from "./helpers";

// Make the in-process admin middleware and the test agree on the secret.
process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || "test-admin-secret";
const ADMIN_SECRET = process.env.ADMIN_SECRET;

const { app } = createApp();

describe("active mission authoring contract", () => {
  it("exposes controlled policy validation for always-available API tests", async () => {
    const authoring = await import("../routes/adminMissions");
    expect(typeof (authoring as Record<string, unknown>).validateMissionWorkflowAuthoring).toBe("function");
  });

  it("normalizes legacy defaults without active templates", async () => {
    const { validateMissionWorkflowAuthoring } = await import("../routes/adminMissions");
    expect(validateMissionWorkflowAuthoring({})).toMatchObject({
      ok: true,
      policy: {
        creator_workflow_mode: "legacy",
        fulfillment_required: false,
        revision_limit: 2,
        review_sla_hours: 48,
        revision_response_hours: 48,
      },
      templates: [],
    });
  });

  it("accepts an exact active policy with nullable platform and repeated requirement categories", async () => {
    const { validateMissionWorkflowAuthoring } = await import("../routes/adminMissions");
    const result = validateMissionWorkflowAuthoring({
      creator_workflow_mode: "active_workspace",
      fulfillment_required: true,
      revision_limit: 2,
      review_sla_hours: 48,
      revision_response_hours: 24,
      deliverable_templates: [{
        title: "Social video",
        platform: null,
        position: 0,
        required: true,
        draft_due_offset_hours: 12,
        publication_instructions: "Publish the approved social video",
        publication_window_hours: 48,
        required_disclosures: ["#ad"],
        expected_account: null,
        proof_evidence_policy: {},
        requirements: [
          { category: "compliance", text: "Show #ad", required: true, position: 0 },
          { category: "compliance", text: "Show the product", required: true, position: 1 },
        ],
      }],
    });
    expect(result).toMatchObject({ ok: true, errors: {} });
  });

  it("reports exact nested shape and scalar validation without throwing", async () => {
    const { validateMissionWorkflowAuthoring } = await import("../routes/adminMissions");
    const result = validateMissionWorkflowAuthoring({
      creator_workflow_mode: "active_workspace",
      fulfillment_required: "yes",
      revision_limit: -1,
      review_sla_hours: 0,
      revision_response_hours: 1.5,
      deliverable_templates: [{
        id: "not-a-uuid",
        title: "   ",
        platform: "   ",
        position: -1,
        required: "yes",
        draft_due_offset_hours: -2,
        requirements: [{
          id: "also-not-a-uuid",
          category: "unknown",
          text: "  ",
          required: "yes",
          position: -1,
        }],
      }],
    } as never);

    expect(result.ok).toBe(false);
    expect(result.errors).toMatchObject({
      fulfillment_required: "Must be a boolean",
      revision_limit: "Must be a non-negative integer",
      review_sla_hours: "Must be a positive integer",
      revision_response_hours: "Must be a positive integer",
      "deliverable_templates.0.id": "Must be a UUID",
      "deliverable_templates.0.title": "Title is required",
      "deliverable_templates.0.platform": "Platform must be null or a non-empty string",
      "deliverable_templates.0.position": "Must be a non-negative integer",
      "deliverable_templates.0.required": "Must be a boolean",
      "deliverable_templates.0.draft_due_offset_hours": "Must be a non-negative integer",
      "deliverable_templates.0.requirements.0.id": "Must be a UUID",
      "deliverable_templates.0.requirements.0.category": "Invalid requirement category",
      "deliverable_templates.0.requirements.0.text": "Requirement text is required",
      "deliverable_templates.0.requirements.0.required": "Must be a boolean",
      "deliverable_templates.0.requirements.0.position": "Must be a non-negative integer",
    });
  });

  it("requires arrays and unique positions at each nesting level", async () => {
    const { validateMissionWorkflowAuthoring } = await import("../routes/adminMissions");
    expect(validateMissionWorkflowAuthoring({ deliverable_templates: null } as never).errors).toMatchObject({
      deliverable_templates: "Must be an array",
    });

    const duplicate = validateMissionWorkflowAuthoring({
      creator_workflow_mode: "active_workspace",
      deliverable_templates: [
        { title: "A", platform: null, position: 0, required: true, draft_due_offset_hours: 0, requirements: [] },
        { title: "B", platform: "instagram", position: 0, required: false, draft_due_offset_hours: 0, requirements: [
          { category: "format", text: "One", required: true, position: 0 },
          { category: "quality", text: "Two", required: true, position: 0 },
        ] },
      ],
    });
    expect(duplicate.errors).toMatchObject({
      "deliverable_templates.1.position": "Deliverable positions must be unique",
      "deliverable_templates.1.requirements.1.position": "Requirement positions must be unique",
    });

    expect(validateMissionWorkflowAuthoring({
      creator_workflow_mode: "active_workspace",
      deliverable_templates: [{
        title: "A", platform: null, position: 0, required: true, draft_due_offset_hours: 0, requirements: null,
      }],
    } as never).errors).toMatchObject({
      "deliverable_templates.0.requirements": "Must be an array",
    });
  });

  it("persists mission, policy, templates, and requirements through one atomic RPC", async () => {
    const { persistMissionWorkflowAuthoring } = await import("../routes/adminMissions");
    const rpc = vi.fn().mockResolvedValue({ data: { id: "mission-1" }, error: null });
    const request = {
      missionId: null,
      mission: { workspace_id: "ws-1", slug: "active-brief", title: "Active brief", status: "draft" },
      policy: {
        creator_workflow_mode: "active_workspace" as const,
        fulfillment_required: true,
        revision_limit: 2,
        review_sla_hours: 48,
        revision_response_hours: 24,
      },
      templates: [{
        title: "Reel",
        platform: null,
        position: 0,
        required: true,
        draft_due_offset_hours: 12,
        publication_instructions: "Publish the approved reel",
        publication_window_hours: 48,
        required_disclosures: ["#ad"],
        expected_account: null,
        proof_evidence_policy: {},
        requirements: [{ category: "compliance" as const, text: "Use #ad", required: true, position: 0 }],
      }],
    };

    const result = await persistMissionWorkflowAuthoring({ rpc } as never, request);

    expect(result).toEqual({ data: { id: "mission-1" }, error: null });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("author_mission_workflow", {
      p_mission_id: null,
      p_mission: request.mission,
      p_policy: request.policy,
      p_templates: request.templates,
    });
  });

  it("uses explicit composite relationship hints for nested mission authoring reads", async () => {
    const { MISSION_COLS } = await import("../routes/adminMissions");

    expect(MISSION_COLS).toContain(
      "deliverable_templates:mission_deliverable_templates!mission_templates_mission_workspace_fk(",
    );
    expect(MISSION_COLS).toContain(
      "requirements:mission_deliverable_requirements!mission_requirements_template_workspace_fk(",
    );
  });

  it("serializes workflow snapshots against template deletion with a guarded parent-row trigger", () => {
    const migrationDir = join(process.cwd(), "supabase", "migrations");
    const migrationName = readdirSync(migrationDir).find((name) =>
      name.includes("guard_mission_authoring_snapshot_race"),
    );
    expect(migrationName).toBeTruthy();
    const sql = readFileSync(join(migrationDir, migrationName!), "utf8");

    expect(sql).toMatch(/create or replace function private\.guard_mission_work_item_source_template/i);
    expect(sql).toMatch(/security definer[\s\S]*set search_path = ''/i);
    expect(sql).toMatch(
      /create trigger mission_work_items_source_template_guard[\s\S]*before insert or update of source_template_id[\s\S]*on public\.mission_work_items/i,
    );
    expect(sql).toMatch(
      /from public\.mission_workflows workflow[\s\S]*join public\.mission_submissions submission[\s\S]*join public\.missions mission[\s\S]*join public\.mission_deliverable_templates template/i,
    );
    expect(sql).toMatch(/workflow\.workspace_id = new\.workspace_id/i);
    expect(sql).toMatch(/submission\.workspace_id = new\.workspace_id/i);
    expect(sql).toMatch(/mission\.workspace_id = new\.workspace_id/i);
    expect(sql).toMatch(/template\.workspace_id = new\.workspace_id/i);
    expect(sql).toMatch(/for key share of mission/i);
    expect(sql).toMatch(
      /revoke all on function private\.guard_mission_work_item_source_template\(\)[\s\S]*from public/i,
    );
  });

  it("defines a locked service-only atomic authoring RPC and nullable template platform", () => {
    const migrationDir = join(process.cwd(), "supabase", "migrations");
    const migrationName = readdirSync(migrationDir).find((name) => name.includes("author_active_mission_workflow_policies"));
    expect(migrationName).toBeTruthy();
    const sql = readFileSync(join(migrationDir, migrationName!), "utf8");

    expect(sql).toContain("alter column platform drop not null");
    expect(sql).toMatch(/alter table public\.mission_work_items[\s\S]*alter column platform drop not null/i);
    expect(sql).toContain("v_keep_templates := array_append(v_keep_templates, v_template_id)");
    expect(sql).toContain("v_keep_requirements := array_append(v_keep_requirements, v_requirement_id)");
    expect(sql).toContain("private.author_mission_workflow");
    expect(sql).toContain("public.author_mission_workflow");
    expect(sql).toMatch(/for update[\s\S]*mission_deliverable_templates/i);
    expect(sql).toContain("mission_template_snapshotted");
    expect(sql).toMatch(/revoke all on function public\.author_mission_workflow[\s\S]*from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.author_mission_workflow[\s\S]*to service_role/i);
  });

  it("hydrates workflow policy and nested template requirements with legacy-safe defaults", async () => {
    const { hydrateMissionWorkflowAuthoring } = await import("../routes/adminMissions");
    const active = hydrateMissionWorkflowAuthoring({
      id: "mission-1",
      title: "Active mission",
      creator_workflow_mode: "active_workspace",
      fulfillment_required: true,
      revision_limit: 3,
      review_sla_hours: 36,
      revision_response_hours: 18,
      deliverable_templates: [{
        id: "template-1",
        title: "Reel",
        platform: null,
        position: 0,
        required: true,
        draft_due_offset_hours: 12,
        requirements: [{
          id: "requirement-1",
          category: "compliance",
          text: "Use #ad",
          required: true,
          position: 0,
        }],
      }],
    });
    expect(active).toMatchObject({
      id: "mission-1",
      creator_workflow_mode: "active_workspace",
      fulfillment_required: true,
      revision_limit: 3,
      review_sla_hours: 36,
      revision_response_hours: 18,
      deliverable_templates: [{
        id: "template-1",
        platform: null,
        requirements: [{ id: "requirement-1", text: "Use #ad" }],
      }],
    });

    expect(hydrateMissionWorkflowAuthoring({ id: "legacy-1", title: "Legacy" })).toMatchObject({
      id: "legacy-1",
      creator_workflow_mode: "legacy",
      fulfillment_required: false,
      revision_limit: 2,
      review_sla_hours: 48,
      revision_response_hours: 48,
      deliverable_templates: [],
    });
  });
});

const suite = hasSupabaseEnv ? describe : describe.skip;

function koreq(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "X-Workspace-Slug": "demo",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}
function adminreq(path: string, init: RequestInit = {}, secret = ADMIN_SECRET) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { "x-admin-secret": secret, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

suite("admin submission review", () => {
  let koc: { userId: string; jwt: string };
  let submissionId: string;
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("admin@test.local", 0);
    await makeMission({ slug: "test-admin-mission", points_reward: 250, quota: 5 });
    await koreq("/missions/test-admin-mission/join", koc.jwt, { method: "POST" });
    const sub = await koreq("/missions/test-admin-mission/submit", koc.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://ig.com/p/admin"] }),
    });
    submissionId = (await sub.json()).id;
  });
  afterAll(cleanup);

  it("rejects admin calls with an empty secret header", async () => {
    const res = await adminreq(`/admin/submissions/${submissionId}/approve`, { method: "POST" }, "");
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("no_admin");
  });

  it("rejects admin calls with no secret header at all", async () => {
    const res = await app.request("/api/admin/submissions?status=submitted", {
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("no_admin");
  });

  it("lists pending submissions", async () => {
    const res = await adminreq("/admin/submissions?status=submitted");
    expect(res.status).toBe(200);
    const { submissions } = await res.json();
    const row = submissions.find((s: { id: string }) => s.id === submissionId);
    expect(row).toBeTruthy();
    expect(row.creator_review).toEqual({ status: "needs_review", risk_level: "unknown" });
    expect(row.mission_shortlist).toBeNull();
  });

  it("lists pending applications with creator review and shortlist metadata", async () => {
    const applicant = await makeCreator("admin-app-meta@test.local", 0);
    await makeMission({ slug: "test-admin-app-meta", access_type: "application", points_reward: 100, quota: 5 });
    await koreq("/missions/test-admin-app-meta/apply", applicant.jwt, { method: "POST" });

    const res = await adminreq("/admin/applications");
    expect(res.status).toBe(200);
    const { applications } = await res.json();
    const row = applications.find((item: { creator_id: string }) => item.creator_id === applicant.userId);
    expect(row.mission_id).toMatch(/[0-9a-f-]{36}/);
    expect(row.creator_review).toEqual({ status: "needs_review", risk_level: "unknown" });
    expect(row.mission_shortlist).toBeNull();
  });

  it("approves once: awards 250 points + 100 XP, and is idempotent", async () => {
    const res = await adminreq(`/admin/submissions/${submissionId}/approve`, {
      method: "POST",
      body: JSON.stringify({ notes: "looks good" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("approved");
    expect(body.points_awarded).toBe(250);

    const bal1 = await koreq("/wallet/points", koc.jwt);
    expect((await bal1.json()).balance).toBe(250);
    const me1 = await koreq("/me", koc.jwt);
    expect((await me1.json()).xp).toBe(135); // 10 join + 25 submit + 100 approve

    // Second approve must not double-award.
    await adminreq(`/admin/submissions/${submissionId}/approve`, { method: "POST" });
    const bal2 = await koreq("/wallet/points", koc.jwt);
    expect((await bal2.json()).balance).toBe(250);
  });

  it("rejects a submitted submission (no award)", async () => {
    const koc2 = await makeCreator("admin2@test.local", 0);
    await makeMission({ slug: "test-admin-reject", points_reward: 100, quota: 5 });
    await koreq("/missions/test-admin-reject/join", koc2.jwt, { method: "POST" });
    const sub = await koreq("/missions/test-admin-reject/submit", koc2.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://ig.com/p/x"] }),
    });
    const id = (await sub.json()).id;
    const res = await adminreq(`/admin/submissions/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ notes: "off-brief" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("rejected");
    const bal = await koreq("/wallet/points", koc2.jwt);
    expect((await bal.json()).balance).toBe(0);
  });

  it("approves with a 5★ rating: stores the rating, awards +50 bonus XP, snapshots scores", async () => {
    const koc3 = await makeCreator("admin-rate@test.local", 0);
    await makeMission({ slug: "test-admin-rate", points_reward: 100, quota: 5 });
    await koreq("/missions/test-admin-rate/join", koc3.jwt, { method: "POST" });
    const sub = await koreq("/missions/test-admin-rate/submit", koc3.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://ig.com/p/rate"] }),
    });
    const id = (await sub.json()).id;

    const res = await adminreq(`/admin/submissions/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ notes: "great", quality_rating: 5 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quality_rating).toBe(5);

    // 10 join + 25 submit + 100 approve + 50 bonus = 185.
    const me = await koreq("/me", koc3.jwt);
    expect((await me.json()).xp).toBe(185);

    // persistScores wrote the snapshot: 1 approved + rated 5 → content 100, brand safety 100.
    const scores = await getCreatorScores(koc3.userId);
    expect(scores.content).toBe(100);
    expect(scores.brandSafety).toBe(100);
    expect(scores.reliability).toBe(100);
  });

  it("rejects an out-of-range rating with 400 bad_rating", async () => {
    const koc4 = await makeCreator("admin-badrate@test.local", 0);
    await makeMission({ slug: "test-admin-badrate", points_reward: 100, quota: 5 });
    await koreq("/missions/test-admin-badrate/join", koc4.jwt, { method: "POST" });
    const sub = await koreq("/missions/test-admin-badrate/submit", koc4.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://ig.com/p/bad"] }),
    });
    const id = (await sub.json()).id;
    const res = await adminreq(`/admin/submissions/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ quality_rating: 7 }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("bad_rating");
    const resLow = await adminreq(`/admin/submissions/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ quality_rating: 0 }),
    });
    expect(resLow.status).toBe(400);
    expect((await resLow.json()).code).toBe("bad_rating");
  });

  it("rejection snapshots scores (brand safety reflects the rejection)", async () => {
    const koc5 = await makeCreator("admin-rej-snap@test.local", 0);
    await makeMission({ slug: "test-admin-rej-snap", points_reward: 100, quota: 5 });
    await koreq("/missions/test-admin-rej-snap/join", koc5.jwt, { method: "POST" });
    const sub = await koreq("/missions/test-admin-rej-snap/submit", koc5.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://ig.com/p/rej"] }),
    });
    const id = (await sub.json()).id;
    await adminreq(`/admin/submissions/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ notes: "off-brief" }),
    });
    const scores = await getCreatorScores(koc5.userId);
    expect(scores.brandSafety).toBe(0); // 0 approved / 1 reviewed
    expect(scores.reliability).toBe(0);
    // influence/content move from the DB default 0 to null → proves persistScores wrote the snapshot.
    expect(scores.influence).toBeNull();
    expect(scores.content).toBeNull();
  });
});

suite("admin engaged roster", () => {
  afterAll(cleanup);

  it("requires the admin secret", async () => {
    const res = await app.request("/api/admin/engaged", { headers: { "Content-Type": "application/json" } });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("no_admin");
  });

  it("lists creators with active participations and excludes fully-completed ones", async () => {
    await cleanup();
    const active = await makeCreator("engaged-active@test.local", 0);
    await makeMission({ slug: "test-engaged-active-mission", points_reward: 100, quota: 5 });
    await koreq("/missions/test-engaged-active-mission/join", active.jwt, { method: "POST" });

    const done = await makeCreator("engaged-done@test.local", 0);
    await makeMission({ slug: "test-engaged-done-mission", points_reward: 100, quota: 5 });
    await koreq("/missions/test-engaged-done-mission/join", done.jwt, { method: "POST" });
    const sub = await koreq("/missions/test-engaged-done-mission/submit", done.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://ig.com/p/done"] }),
    });
    await adminreq(`/admin/submissions/${(await sub.json()).id}/approve`, { method: "POST" });

    const res = await adminreq("/admin/engaged");
    expect(res.status).toBe(200);
    const { creators } = await res.json();

    const activeRow = creators.find((c: { id: string }) => c.id === active.userId);
    expect(activeRow).toBeTruthy();
    expect(activeRow.activeCount).toBe(1);
    expect(activeRow.completedCount).toBe(0);
    expect(activeRow.activeMissions[0].missionSlug).toBe("test-engaged-active-mission");
    expect(activeRow.activeMissions[0].status).toBe("joined");

    expect(creators.find((c: { id: string }) => c.id === done.userId)).toBeUndefined();
  });
});

suite("B2: workspace-scoped review", () => {
  const DEMO = "00000000-0000-0000-0000-0000000000aa";
  const OTHER = "00000000-0000-0000-0000-0000000000bb";
  afterAll(cleanup);

  it("filters applications by ?workspace= (demo returns the row, bogus returns none)", async () => {
    const koc = await makeCreator("ws-scope@test.local", 0);
    await makeMission({ slug: "test-ws-scope", points_reward: 100, quota: 5, access_type: "application" });
    await koreq("/missions/test-ws-scope/apply", koc.jwt, { method: "POST" });

    const scoped = await adminreq(`/admin/applications?workspace=${DEMO}`);
    expect(scoped.status).toBe(200);
    const rows = (await scoped.json()).applications as Array<{ missions: { slug: string } }>;
    expect(rows.some((r) => r.missions.slug === "test-ws-scope")).toBe(true);

    const none = await adminreq(`/admin/applications?workspace=${OTHER}`);
    expect(((await none.json()).applications as unknown[]).length).toBe(0);
  });

  it("filters submissions by ?workspace=", async () => {
    const none = await adminreq(`/admin/submissions?status=submitted&workspace=${OTHER}`);
    expect(((await none.json()).submissions as unknown[]).length).toBe(0);
    const ok = await adminreq(`/admin/submissions?status=submitted&workspace=${DEMO}`);
    expect(ok.status).toBe(200);
  });

  it("filters engaged by ?workspace=", async () => {
    const none = await adminreq(`/admin/engaged?workspace=${OTHER}`);
    expect(((await none.json()).creators as unknown[]).length).toBe(0);
    const ok = await adminreq(`/admin/engaged?workspace=${DEMO}`);
    expect(ok.status).toBe(200);
  });
});

suite("B2: mission activity drill-in", () => {
  afterAll(cleanup);

  it("returns the mission + bucketed activity", async () => {
    const koc = await makeCreator("activity@test.local", 0);
    await makeMission({ slug: "test-activity", points_reward: 200, quota: 5 });
    const list = await (await adminreq(`/admin/missions?workspace=00000000-0000-0000-0000-0000000000aa`)).json();
    const m = (list.missions as Array<{ id: string; slug: string }>).find((x) => x.slug === "test-activity")!;

    await koreq("/missions/test-activity/join", koc.jwt, { method: "POST" });
    await koreq("/missions/test-activity/submit", koc.jwt, {
      method: "PUT", body: JSON.stringify({ content_urls: ["https://ig.com/p/x"] }),
    });

    const res = await adminreq(`/admin/missions/${m.id}/activity`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mission.slug).toBe("test-activity");
    expect(body.submissions.length).toBe(1);
    expect(body.fill.quota).toBe(5);
  });

  it("404s for a missing mission", async () => {
    const res = await adminreq("/admin/missions/00000000-0000-0000-0000-0000000000ff/activity");
    expect(res.status).toBe(404);
  });
});
