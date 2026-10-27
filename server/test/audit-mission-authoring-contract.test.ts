import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createAuditFixture } from "./auditWorkflowFixture";

describe.skipIf(process.env.RUN_AUDIT_INTEGRATION !== "1")("D12 real disposable authoring contract", () => {
  let fx: Awaited<ReturnType<typeof createAuditFixture>>;
  let app: ReturnType<(typeof import("../app"))["createApp"]>["app"];
  let draft: Record<string, unknown>, foreignId: string;
  let before: Awaited<ReturnType<Awaited<ReturnType<typeof createAuditFixture>>["neutrality"]>>;
  const ownedIds: string[] = [];
  const policy = { screenshots: 1, legacy_review: { manual: true, modes: ["owner", 2] } };
  const template = { title: "合成作者交付", platform: "instagram", position: 0, required: true, draft_due_offset_hours: 24,
    publication_instructions: "發布已批准的短片及清楚披露合作", publication_window_hours: 48,
    required_disclosures: ["#廣告", "品牌合作"], expected_account: "@synthetic_creator", proof_evidence_policy: policy,
    requirements: [{ category: "compliance", text: "短片須清楚披露合作", required: true, position: 0 }] };
  const body = () => ({ workspace_id: fx.workspaceId, slug: `authoring-${randomUUID()}`, title: "合成作者任務", mission_type: "ugc",
    description: "Synthetic authoring acceptance", category: "寵物", access_type: "open", required_level: "L0", points_reward: 500,
    cash_reward: 125, quota: 10, deadline: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), platforms: ["instagram"],
    creator_workflow_mode: "active_workspace", fulfillment_required: false, revision_limit: 2, review_sla_hours: 48, revision_response_hours: 48,
    deliverable_templates: [template], deliverables: ["合成作者交付"] });
  async function request(path: string, method = "GET", data?: unknown, status = 200, actor?: { jwt: string }) {
    const response = await app.request(`/api${path}`, { method,
      headers: { Authorization: `Bearer ${(actor ?? fx.operator).jwt}`, "X-Workspace-Slug": fx.slug, "Content-Type": "application/json" },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    expect(response.status, `${method} ${path}: ${await response.clone().text()}`).toBe(status);
    return response.json();
  }
  beforeAll(async () => {
    fx = await (await import("./auditWorkflowFixture")).createAuditFixture();
    app = (await import("../app")).createApp().app;
    before = await fx.neutrality(fx.creators[0].id);
    draft = (await request("/admin/missions", "POST", body(), 201)).mission;
    ownedIds.push(draft.id as string);
    foreignId = randomUUID(); ownedIds.push(foreignId);
    fx.must(await fx.service.from("missions").insert({ id: foreignId, workspace_id: fx.otherWorkspaceId, slug: `foreign-${foreignId}`,
      title: "Foreign synthetic authoring", mission_type: "ugc", required_level: "L0", points_reward: 50, quota: 10, status: "draft" }));
  }, 60000);
  afterAll(async () => {
    if (!fx) return;
    const after = await fx.neutrality(fx.creators[0].id);
    expect(after).toEqual(before);
    writeFileSync(".codex-tmp/D12-fixture.private.json", JSON.stringify({ runId: fx.runId, target: fx.target.identity,
      workspaceId: fx.workspaceId, slug: fx.slug, creator: fx.creators[0], operator: fx.operator,
      navMission: draft, ownedMissionIds: ownedIds }, (key, value) => key === "client" ? undefined : value));
    writeFileSync("docs/verification/D12-api-contract.json", JSON.stringify({ runId: fx.runId, target: fx.target.identity,
      ownedMissionIds: ownedIds, navMissionId: draft.id, unknownPolicy: policy,
      neutrality: { before, after, allEqual: JSON.stringify(before) === JSON.stringify(after) },
      cleanup: "retained exact IDs; no reset or delete", providers: "external HTTP blocked; no paid provider or real publication" }, null, 2) + "\n");
    fx.recordEvidence({ caseId: "D12-authoring", ownedMissionIds: ownedIds, before, after });
  });
  it("creates and reloads a complete required deliverable with unknown policy keys unchanged", async () => {
    const loaded = (await request(`/admin/missions/${draft.id}`)).mission;
    expect(loaded.deliverable_templates).toHaveLength(1);
    expect(loaded.deliverable_templates[0]).toMatchObject(template);
  });
  it("preserves nested unknown rules during an unrelated edit and readback", async () => {
    await request(`/admin/missions/${draft.id}`, "PATCH", { title: "合成作者任務已更新" });
    const loaded = (await request(`/admin/missions/${draft.id}`)).mission;
    expect(loaded.title).toBe("合成作者任務已更新");
    expect(loaded.deliverable_templates[0].proof_evidence_policy).toEqual(policy);
  });
  it("rejects invalid JSON policy values and negative windows without persisting them", async () => {
    for (const patch of [{ proof_evidence_policy: "invalid object" }, { publication_window_hours: -1 }]) {
      const loaded = (await request(`/admin/missions/${draft.id}`)).mission;
      await request(`/admin/missions/${draft.id}`, "PATCH", { deliverable_templates: [{ ...loaded.deliverable_templates[0], ...patch }] }, 422);
      const after = (await request(`/admin/missions/${draft.id}`)).mission;
      expect(after.deliverable_templates).toEqual(loaded.deliverable_templates);
    }
  });
  it("rejects publishing an existing active-workspace draft that lacks required deliverables", async () => {
    const id = randomUUID(); ownedIds.push(id);
    const input = body();
    const { deliverable_templates: ignored, ...bare } = input; void ignored;
    fx.must(await fx.service.from("missions").insert({ ...bare, id, status: "draft" }));
    const result = await request(`/admin/missions/${id}/publish`, "POST", {}, 422);
    expect(result.fields).toHaveProperty("deliverable_templates");
    expect((await request(`/admin/missions/${id}`)).mission.status).toBe("draft");
  });
  it("keeps real staff, membership and foreign-workspace boundaries on authoring", async () => {
    await request(`/admin/missions/${draft.id}`, "PATCH", { title: "forbidden" }, 403, fx.noMembership);
    await request(`/admin/missions/${draft.id}`, "PATCH", { title: "forbidden" }, 403, fx.creators[0]);
    // Existing resource-scoped authoring hides foreign records with 404.
    await request(`/admin/missions/${foreignId}`, "PATCH", { title: "forbidden" }, 404);
    const untouched = fx.must(await fx.service.from("missions").select("title").eq("id", foreignId).eq("workspace_id", fx.otherWorkspaceId).single());
    expect(untouched?.title).toBe("Foreign synthetic authoring");
  });
  it("retains the existing legacy publish path without active-template requirements", async () => {
    const created = (await request("/admin/missions", "POST", { ...body(), creator_workflow_mode: "legacy", deliverable_templates: [] }, 201)).mission;
    ownedIds.push(created.id);
    await request(`/admin/missions/${created.id}/publish`, "POST", {});
    expect((await request(`/admin/missions/${created.id}`)).mission.status).toBe("active");
  });
});
