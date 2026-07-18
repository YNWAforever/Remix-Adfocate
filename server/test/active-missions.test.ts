import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp, type Env } from "../app";
import { ActiveMissionError } from "../lib/activeMission/errors";
import { createActiveMissionRepository, type ActiveMissionRepository } from "../lib/activeMission/repo";
import { createActiveMissionRoutes } from "../routes/activeMissions";
import { createAdminActiveMissionRepository, createAdminActiveMissionRoutes, sortActiveMissionQueue, type AdminActiveMissionRepository } from "../routes/adminActiveMissions";
import {
  activeMissionIntegrationSkipReason, cleanup, creatorRewardSnapshot, makeCreator,
  seedActiveMission, serviceForTests, userForJwt,
} from "./helpers";

type Script = { table: string; data: unknown; error?: { message: string } | null };
function scriptedClient(scripts: Script[]) {
  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
  let cursor = 0;
  const from = vi.fn((table: string) => {
    const script = scripts[cursor++];
    if (!script || script.table !== table) throw new Error("unexpected table " + table);
    const result = { data: script.data, error: script.error ?? null };
    const builder: Record<string, unknown> = {};
    for (const op of ["select", "eq", "is", "in", "order", "update"]) {
      builder[op] = (...args: unknown[]) => {
        calls.push({ table, op, args });
        return builder;
      };
    }
    builder.maybeSingle = async () => result;
    builder.single = async () => result;
    builder.then = (yes: (value: unknown) => unknown, no: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(yes, no);
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, calls, remaining: () => scripts.length - cursor };
}

const owner = { submissionId: "sub-1", creatorId: "creator-1", workspaceId: "workspace-1" };
const mission = {
  id: "mission-1", slug: "test-active-api", title: "Creator mission", mission_type: "ugc",
  description: "Make a short video", deliverables: ["One video"], requirements: ["Show product"],
  platforms: ["instagram"], effort: "medium", target_audience: "HK creators", dos: ["Be specific"],
  donts: ["No unsupported claims"], key_messages: ["Fast setup"], reference_links: ["https://example.com"],
};
const submission = {
  id: owner.submissionId, creator_id: owner.creatorId, workspace_id: owner.workspaceId,
  mission_id: mission.id, missions: mission,
};
const workflow = {
  id: "workflow-1", workspace_id: owner.workspaceId, mission_submission_id: owner.submissionId,
  state: "drafting", accepted_at: "2026-07-01T00:00:00.000Z", deadline: "2026-07-31T00:00:00.000Z",
  fulfillment_required: false, revision_limit: 2, review_sla_hours: 48, revision_response_hours: 48,
  created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z",
};
const item = {
  id: "item-1", workspace_id: owner.workspaceId, mission_workflow_id: workflow.id,
  title: "Instagram Reel", platform: "instagram",
  requirements_snapshot: [{ id: "req-1", category: "format", text: "Vertical", required: true, position: 0 }],
  required: true, position: 0, deadline: "2026-07-20T00:00:00.000Z", state: "drafting",
  current_submitted_version_id: null, approved_version_id: null, review_started_at: null, review_due_at: null,
  created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z",
};
const draft = {
  id: "draft-1", workspace_id: owner.workspaceId, mission_work_item_id: item.id,
  caption_text: "", external_draft_url: null, checklist_answers: {}, revision: 0,
  last_saved_at: "2026-07-01T00:00:00.000Z", archived_at: null,
};
const anchor = (): Script[] => [
  { table: "mission_submissions", data: submission },
  { table: "mission_workflows", data: workflow },
];

describe("active mission repository without a live database", () => {
  it("constrains workspace read ownership and shapes the creator view", async () => {
    const scripted = scriptedClient([
      ...anchor(), { table: "mission_fulfillments", data: null },
      { table: "mission_work_items", data: [item] }, { table: "mission_working_drafts", data: [draft] },
      { table: "mission_workflow_events", data: [] },
    ]);
    const result = await createActiveMissionRepository(scripted.client).getWorkspace(owner);
    expect(result.mission).toMatchObject({
      id: mission.id, missionType: "ugc", brief: { targetAudience: "HK creators", keyMessages: ["Fast setup"] },
    });
    expect(result.workItems[0]).toMatchObject({ id: item.id, draft: { caption: "", revision: 0 } });
    expect(result.nextAction).toMatchObject({ kind: "continue_draft", workItemId: item.id });
    expect(scripted.calls.filter((c) => c.table === "mission_submissions" && c.op === "eq").map((c) => c.args))
      .toEqual([["id", owner.submissionId], ["creator_id", owner.creatorId], ["workspace_id", owner.workspaceId]]);
    expect(scripted.calls.filter((c) => c.table === "mission_working_drafts" && c.op === "in").map((c) => c.args))
      .toEqual([["mission_work_item_id", [item.id]]]);
    expect(scripted.remaining()).toBe(0);
  });

  it("stops at a 404 ownership anchor for another creator or workspace", async () => {
    const scripted = scriptedClient([{ table: "mission_submissions", data: null }]);
    await expect(createActiveMissionRepository(scripted.client).getWorkspace({ ...owner, creatorId: "other" }))
      .rejects.toMatchObject({ code: "WORKFLOW_NOT_FOUND" });
    expect(scripted.remaining()).toBe(0);
  });

  it("saves revision zero with one conditional update and returns revision one", async () => {
    const saved = {
      ...draft,
      caption_text: "First draft",
      external_draft_url: "https://example.com/draft",
      revision: 1,
    };
    const scripted = scriptedClient([
      ...anchor(), { table: "mission_work_items", data: item },
      { table: "mission_working_drafts", data: saved },
    ]);
    const result = await createActiveMissionRepository(scripted.client).saveDraft(
      { ...owner, workItemId: item.id },
      { revision: 0, caption: "First draft", externalUrl: "https://example.com/draft", checklist: {} },
    );
    expect(result).toMatchObject({ caption: "First draft", revision: 1 });
    expect(scripted.calls.filter((call) => call.op === "update")).toHaveLength(1);
    expect(scripted.calls.find((call) => call.op === "update")?.args[0]).toMatchObject({
      caption_text: "First draft", external_draft_url: "https://example.com/draft", revision: 1,
    });
    expect(scripted.calls.filter((call) => call.table === "mission_working_drafts" && call.op === "eq")
      .map((call) => call.args)).toContainEqual(["revision", 0]);
    expect(scripted.remaining()).toBe(0);
  });

  it("uses one conditional update for autosave and returns the server draft on a stale revision", async () => {
    const current = { ...draft, caption_text: "First draft", revision: 1 };
    const scripted = scriptedClient([
      ...anchor(), { table: "mission_work_items", data: item },
      { table: "mission_working_drafts", data: null }, { table: "mission_working_drafts", data: current },
    ]);
    const repo = createActiveMissionRepository(scripted.client);
    await expect(repo.saveDraft({ ...owner, workItemId: item.id }, {
      revision: 0, caption: "stale", externalUrl: null, checklist: {},
    })).rejects.toMatchObject({
      code: "WORKFLOW_STALE", details: { currentDraft: { caption: "First draft", revision: 1 } },
    });
    expect(scripted.calls.filter((c) => c.op === "update")).toHaveLength(1);
    expect(scripted.calls.some((c) => c.table === "mission_working_drafts" && c.op === "eq"
      && c.args[0] === "revision" && c.args[1] === 0)).toBe(true);
  });

  it("validates draft checklist keys before any update", async () => {
    const scripted = scriptedClient([...anchor(), { table: "mission_work_items", data: item }]);
    await expect(createActiveMissionRepository(scripted.client).saveDraft({ ...owner, workItemId: item.id }, {
      revision: 0, checklist: { unknown: true },
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(scripted.calls.filter((c) => c.op === "update")).toHaveLength(0);
  });

  it("receives fulfillment with exactly one authenticated-context RPC", async () => {
    const rpc = vi.fn(async () => ({ data: workflow, error: null }));
    const repository = createActiveMissionRepository({ rpc } as unknown as SupabaseClient);
    const result = await repository.receiveFulfillment(owner);
    expect(result).toMatchObject({ id: workflow.id, state: "drafting" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("receive_mission_fulfillment", {
      p_submission: owner.submissionId,
      p_creator: owner.creatorId,
      p_workspace: owner.workspaceId,
    });
  });
});

function controlledApp(repository: ActiveMissionRepository, creatorId = owner.creatorId) {
  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    c.set("userId", creatorId); c.set("workspaceId", owner.workspaceId); c.set("jwt", "test"); await next();
  });
  app.route("/api/my-missions", createActiveMissionRoutes(repository));
  return app;
}

describe("active mission routes without a live database", () => {
  it("returns 404 without leaking cross-creator existence", async () => {
    const repo = {
      getWorkspace: vi.fn(async () => { throw new ActiveMissionError("WORKFLOW_NOT_FOUND", "not found"); }),
      saveDraft: vi.fn(), receiveFulfillment: vi.fn(),
    } as unknown as ActiveMissionRepository;
    const response = await controlledApp(repo, "other").request("/api/my-missions/sub-1/workspace");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "WORKFLOW_NOT_FOUND" });
  });

  it("returns 409 WORKFLOW_STALE with the current draft", async () => {
    const repo = {
      getWorkspace: vi.fn(),
      saveDraft: vi.fn(async () => { throw new ActiveMissionError("WORKFLOW_STALE", "stale", {
        currentDraft: { caption: "First draft", externalUrl: null, checklist: {}, revision: 1 },
      }); }),
      receiveFulfillment: vi.fn(),
    } as unknown as ActiveMissionRepository;
    const response = await controlledApp(repo).request("/api/my-missions/sub-1/work-items/item-1/draft", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 0, caption: "stale", externalUrl: null, checklist: {} }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "WORKFLOW_STALE", currentDraft: { revision: 1 } });
  });

  it("rejects a JSON null draft body before repository access", async () => {
    const saveDraft = vi.fn();
    const repo = {
      getWorkspace: vi.fn(), saveDraft, receiveFulfillment: vi.fn(),
    } as unknown as ActiveMissionRepository;
    const response = await controlledApp(repo).request(
      "/api/my-missions/sub-1/work-items/item-1/draft",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "null",
      },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("returns the atomically refreshed workflow after receipt", async () => {
    const receiveFulfillment = vi.fn(async () => ({ ...workflow, state: "drafting" as const }));
    const repo = { getWorkspace: vi.fn(), saveDraft: vi.fn(), receiveFulfillment } as unknown as ActiveMissionRepository;
    const response = await controlledApp(repo).request("/api/my-missions/sub-1/fulfillment/received", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ workflow: { state: "drafting" } });
    expect(receiveFulfillment).toHaveBeenCalledWith(owner);
  });
});

describe("active mission receipt migration contract", () => {
  it("is atomic, private-backed, service-only, and reward-neutral", () => {
    const name = readdirSync(resolve("supabase/migrations"))
      .find((file) => file.includes("receive_mission_fulfillment"));
    expect(name).toBeTruthy();
    const sql = readFileSync(resolve("supabase/migrations", name!), "utf8").toLowerCase();
    for (const token of [
      "function private.receive_mission_fulfillment", "function public.receive_mission_fulfillment",
      "for update", "status <> 'shipped'", "set status = 'received'", "set state = 'drafting'",
      "'fulfillment_received'", "private.refresh_mission_workflow_state",
      "grant execute on function public.receive_mission_fulfillment(uuid, uuid, uuid) to service_role",
    ]) expect(sql).toContain(token);
    expect(sql).toContain("revoke all on function private.receive_mission_fulfillment");
    expect(sql).toContain("revoke all on function public.receive_mission_fulfillment");
    for (const forbidden of [
      "update public.mission_submissions", "update public.point_balances",
      "update public.earnings_balances", "update public.creators set xp",
    ]) expect(sql).not.toContain(forbidden);
  });
});

describe("active mission operator routes without a live database", () => {
  const workflowId = "11111111-1111-4111-8111-111111111111";
  const workItemId = "22222222-2222-4222-8222-222222222222";
  const versionId = "33333333-3333-4333-8333-333333333333";
  const requirementId = "44444444-4444-4444-8444-444444444444";
  const urgent = { workItemId: "urgent", reviewDueAt: "2026-07-18T00:00:00.000Z", creatorDeadline: "2026-07-20T00:00:00.000Z", submittedAt: "2026-07-17T00:00:00.000Z" };
  const later = { workItemId: "later", reviewDueAt: "2026-07-19T00:00:00.000Z", creatorDeadline: "2026-07-21T00:00:00.000Z", submittedAt: "2026-07-16T00:00:00.000Z" };

  it("orders the operator queue by overdue SLA, SLA due, creator deadline, and submitted time", () => {
    expect(sortActiveMissionQueue([later, urgent], new Date("2026-07-18T12:00:00.000Z")).map((row) => row.workItemId))
      .toEqual(["urgent", "later"]);
  });

  it("uses the workspace header and returns queue metadata without private URLs", async () => {
    const listQueue = vi.fn(async () => ({ items: [{ ...urgent, workflowId: "workflow-1", creatorDisplayName: "Creator", missionTitle: "Launch", state: "submitted", reviewerId: null, riskBucket: "overdue" }] }));
    const repository = { listQueue } as unknown as AdminActiveMissionRepository;
    const app = new Hono<Env>();
    app.use("*", async (c, next) => { c.set("userId", "operator-1"); c.set("workspaceId", "unused"); c.set("jwt", "test"); await next(); });
    app.route("/api/admin/active-missions", createAdminActiveMissionRoutes(repository, () => ({ userId: "operator-1", email: "op@example.com" })));
    const response = await app.request("/api/admin/active-missions/queue", { headers: { "X-Workspace-Slug": "demo" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ items: [{ workItemId: "urgent", riskBucket: "overdue" }] });
    expect(JSON.stringify(await listQueue.mock.results[0].value)).not.toContain("signedUrl");
    expect(listQueue).toHaveBeenCalledWith(expect.objectContaining({ workspaceSlug: "demo" }));
  });

  it("authorizes detail before returning ten-minute signed asset URLs", async () => {
    const getDetail = vi.fn(async () => ({ workflow: { id: workflowId }, assets: [{ id: "asset-1", signedUrl: "https://signed" }] }));
    const repository = { getDetail } as unknown as AdminActiveMissionRepository;
    const app = new Hono<Env>();
    app.route("/api/admin/active-missions", createAdminActiveMissionRoutes(repository, () => ({ userId: "operator-1", email: "op@example.com" })));
    const response = await app.request(`/api/admin/active-missions/${workflowId}`, { headers: { "X-Workspace-Slug": "demo" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ assets: [{ signedUrl: "https://signed" }] });
    expect(getDetail).toHaveBeenCalledWith({ workflowId, workspaceSlug: "demo", signedUrlTtlSeconds: 600 });
  });

  it("passes authenticated operator and workspace context to one start-review transition", async () => {
    const startReview = vi.fn(async () => ({ workItem: { id: workItemId, state: "under_review" } }));
    const repository = { startReview } as unknown as AdminActiveMissionRepository;
    const app = new Hono<Env>();
    app.route("/api/admin/active-missions", createAdminActiveMissionRoutes(repository, () => ({ userId: "operator-1", email: "op@example.com" })));
    const response = await app.request(`/api/admin/active-missions/${workflowId}/work-items/${workItemId}/start-review`, { method: "POST", headers: { "Content-Type": "application/json", "X-Workspace-Slug": "demo" }, body: JSON.stringify({ expectedState: "submitted" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ workItem: { state: "under_review" } });
    expect(startReview).toHaveBeenCalledWith({ workflowId, workItemId, workspaceSlug: "demo", operatorId: "operator-1", expectedState: "submitted" });
  });

  function operatorClient(rpc: ReturnType<typeof vi.fn>) {
    const builder: Record<string, unknown> = {};
    for (const op of ["select", "eq"]) builder[op] = () => builder;
    builder.maybeSingle = async () => ({ data: { id: "workspace-1" }, error: null });
    return { from: vi.fn(() => builder), rpc } as unknown as SupabaseClient;
  }

  it("maps revision limits and sends exact revision context", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "revision_limit_reached" } }));
    const repository = createAdminActiveMissionRepository(operatorClient(rpc));
    const app = new Hono<Env>();
    app.route("/api/admin/active-missions", createAdminActiveMissionRoutes(repository, () => ({ userId: "operator-1", email: "op@example.com" })));
    const deadline = new Date(Date.now() + 86_400_000).toISOString();
    const items = [{ requirementId: null, category: "quality", text: "Show the product early", required: true }];
    const response = await app.request(`/api/admin/active-missions/${workflowId}/work-items/${workItemId}/request-revision`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Workspace-Slug": "demo" },
      body: JSON.stringify({ expectedState: "under_review", versionId, deadline, items }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "REVISION_LIMIT_REACHED" });
    expect(rpc).toHaveBeenCalledWith("request_mission_revision", {
      p_workflow: workflowId, p_work_item: workItemId, p_version: versionId,
      p_operator: "operator-1", p_workspace: "workspace-1", p_expected_state: "under_review",
      p_deadline: deadline, p_items: items,
    });
  });

  it("rejects revision feedback without a future deadline and required change", async () => {
    const requestRevision = vi.fn();
    const app = new Hono<Env>();
    app.route("/api/admin/active-missions", createAdminActiveMissionRoutes({ requestRevision } as unknown as AdminActiveMissionRepository, () => ({ userId: "operator-1", email: "op@example.com" })));
    const response = await app.request(`/api/admin/active-missions/${workflowId}/work-items/${workItemId}/request-revision`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Workspace-Slug": "demo" },
      body: JSON.stringify({ expectedState: "under_review", versionId, deadline: "2020-01-01T00:00:00.000Z", items: [] }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(requestRevision).not.toHaveBeenCalled();
  });

  it("rejects every malformed path UUID before repository access", async () => {
    const repository = {
      getDetail: vi.fn(), startReview: vi.fn(), requestRevision: vi.fn(),
      grantRevision: vi.fn(), approveVersion: vi.fn(), markFulfillmentShipped: vi.fn(),
    } as unknown as AdminActiveMissionRepository;
    const app = new Hono<Env>();
    app.route("/api/admin/active-missions", createAdminActiveMissionRoutes(repository, () => ({ userId: "operator-1", email: "op@example.com" })));
    const deadline = new Date(Date.now() + 86_400_000).toISOString();
    const headers = { "Content-Type": "application/json", "X-Workspace-Slug": "demo" };
    const itemRoutes = [
      { suffix: "start-review", body: { expectedState: "submitted" } },
      { suffix: "request-revision", body: { expectedState: "under_review", versionId, deadline, items: [{ requirementId: null, category: "quality", text: "Fix", required: true }] } },
      { suffix: "grant-revision", body: { reason: "Brief changed", grantedCount: 1 } },
      { suffix: "approve-to-publish", body: { expectedState: "under_review", versionId } },
    ];
    const cases = [
      { path: "/not-a-uuid", init: { headers } },
      { path: "/not-a-uuid/fulfillment/shipped", init: { method: "POST", headers, body: "{}" } },
      ...itemRoutes.flatMap(({ suffix, body }) => [
        { path: `/not-a-uuid/work-items/${workItemId}/${suffix}`, init: { method: "POST", headers, body: JSON.stringify(body) } },
        { path: `/${workflowId}/work-items/not-a-uuid/${suffix}`, init: { method: "POST", headers, body: JSON.stringify(body) } },
      ]),
    ];
    for (const testCase of cases) {
      const response = await app.request("/api/admin/active-missions" + testCase.path, testCase.init);
      expect(response.status, testCase.path).toBe(400);
      expect(await response.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    }
    for (const method of Object.values(repository)) expect(method).not.toHaveBeenCalled();
  });

  it("rejects malformed version and optional requirement UUIDs before repository access", async () => {
    const requestRevision = vi.fn();
    const approveVersion = vi.fn();
    const repository = { requestRevision, approveVersion } as unknown as AdminActiveMissionRepository;
    const app = new Hono<Env>();
    app.route("/api/admin/active-missions", createAdminActiveMissionRoutes(repository, () => ({ userId: "operator-1", email: "op@example.com" })));
    const deadline = new Date(Date.now() + 86_400_000).toISOString();
    const headers = { "Content-Type": "application/json", "X-Workspace-Slug": "demo" };
    const malformedFeedback = await app.request(`/api/admin/active-missions/${workflowId}/work-items/${workItemId}/request-revision`, {
      method: "POST", headers,
      body: JSON.stringify({
        expectedState: "under_review", versionId, deadline,
        items: [{ requirementId: "not-a-uuid", category: "quality", text: "Fix", required: true }],
      }),
    });
    expect(malformedFeedback.status).toBe(400);
    expect(await malformedFeedback.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    const malformedVersion = await app.request(`/api/admin/active-missions/${workflowId}/work-items/${workItemId}/approve-to-publish`, {
      method: "POST", headers,
      body: JSON.stringify({ expectedState: "under_review", versionId: "not-a-uuid" }),
    });
    expect(malformedVersion.status).toBe(400);
    expect(await malformedVersion.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(requestRevision).not.toHaveBeenCalled();
    expect(approveVersion).not.toHaveBeenCalled();

    const validFeedback = [{ requirementId, category: "quality", text: "Fix", required: true }];
    requestRevision.mockResolvedValueOnce({ workItem: { id: workItemId } });
    const valid = await app.request(`/api/admin/active-missions/${workflowId}/work-items/${workItemId}/request-revision`, {
      method: "POST", headers,
      body: JSON.stringify({ expectedState: "under_review", versionId, deadline, items: validFeedback }),
    });
    expect(valid.status).toBe(200);
    expect(requestRevision).toHaveBeenCalledWith(expect.objectContaining({ workflowId, workItemId, versionId, items: validFeedback }));
  });

  it("sends exact grant, approval, and shipping RPC arguments", async () => {
    const rpc = vi.fn(async (name: string) => ({ data: name.includes("shipped") ? { status: "shipped" } : { id: "item-1" }, error: null }));
    const repository = createAdminActiveMissionRepository(operatorClient(rpc));
    await repository.grantRevision({ workflowId: "workflow-1", workItemId: "item-1", operatorId: "operator-1", workspaceSlug: "demo", reason: "Brief changed", grantedCount: 1 });
    await repository.approveVersion({ workflowId: "workflow-1", workItemId: "item-1", operatorId: "operator-1", workspaceSlug: "demo", expectedState: "under_review", versionId: "version-2" });
    await repository.markFulfillmentShipped({ workflowId: "workflow-1", operatorId: "operator-1", workspaceSlug: "demo", note: "Courier collected" });
    expect(rpc.mock.calls).toEqual([
      ["grant_mission_revision", {
        p_workflow: "workflow-1", p_work_item: "item-1", p_operator: "operator-1",
        p_workspace: "workspace-1", p_reason: "Brief changed", p_granted_count: 1,
      }],
      ["approve_mission_version", {
        p_workflow: "workflow-1", p_work_item: "item-1", p_version: "version-2",
        p_operator: "operator-1", p_workspace: "workspace-1", p_expected_state: "under_review",
      }],
      ["mark_mission_fulfillment_shipped", {
        p_workflow: "workflow-1", p_operator: "operator-1", p_workspace: "workspace-1", p_note: "Courier collected",
      }],
    ]);
  });
});

describe("active mission operator lifecycle migration contract", () => {
  it("is locked, private-backed, service-only, validated, and reward-neutral", () => {
    const name = readdirSync(resolve("supabase/migrations")).find((file) => file.includes("active_mission_operator_lifecycle"));
    expect(name).toBeTruthy();
    const sql = readFileSync(resolve("supabase/migrations", name!), "utf8").toLowerCase();
    for (const fn of ["start_mission_review", "request_mission_revision", "grant_mission_revision", "approve_mission_version", "mark_mission_fulfillment_shipped"]) {
      expect(sql).toContain(`function private.${fn}`);
      expect(sql).toContain(`function public.${fn}`);
    }
    for (const token of ["for update", "revision_limit_reached", "creator_response_deadline", "private.refresh_mission_workflow_state", "to service_role"]) expect(sql).toContain(token);
    expect(sql).toContain("jsonb_array_length");
    expect(sql).toContain("current_submitted_version_id");
    expect(sql).toContain("status <> 'preparing'");
    for (const forbidden of ["update public.mission_submissions", "update public.point_balances", "update public.earnings_balances", "update public.creators set xp", "approve_submission("]) expect(sql).not.toContain(forbidden);
  });

  it("applies the corrective lifecycle definitions in executable dependency order", () => {
    const name = readdirSync(resolve("supabase/migrations"))
      .find((file) => file.includes("harden_active_mission_operator_lifecycle"));
    expect(name).toBeTruthy();
    const sql = readFileSync(resolve("supabase/migrations", name!), "utf8").toLowerCase();
    const definition = (qualifiedName: string) => {
      const start = sql.indexOf(`create or replace function ${qualifiedName}(`);
      expect(start, `${qualifiedName} definition`).toBeGreaterThanOrEqual(0);
      const bodyStart = sql.indexOf("as $$", start);
      const end = sql.indexOf("$$;", bodyStart);
      expect(bodyStart, `${qualifiedName} body`).toBeGreaterThan(start);
      expect(end, `${qualifiedName} terminator`).toBeGreaterThan(bodyStart);
      return { start, source: sql.slice(start, end + 3) };
    };
    const helper = definition("private.v_item_round_limit");
    const startReview = definition("private.start_mission_review");
    const requestRevision = definition("private.request_mission_revision");
    const grantRevision = definition("private.grant_mission_revision");

    expect(helper.start).toBeLessThan(requestRevision.start);
    expect(requestRevision.source).toContain("private.v_item_round_limit(");
    expect(requestRevision.source).toContain("p_deadline <= now()");
    expect(requestRevision.source).not.toContain("p_deadline > v_item.deadline");

    expect(startReview.source).toContain("from public.mission_draft_versions");
    expect(startReview.source).toContain("for update");
    expect(startReview.source).toContain("insert into public.mission_review_rounds");
    expect(startReview.source).toContain("v_completed + 1");
    expect(startReview.source).toContain("state = 'open'");
    expect(startReview.source).toContain("mission_draft_version_id = v_item.current_submitted_version_id");
    expect(startReview.source.indexOf("select count(*) into v_completed"))
      .toBeLessThan(startReview.source.indexOf("insert into public.mission_review_rounds"));

    const refresh = grantRevision.source.lastIndexOf("private.refresh_mission_workflow_state");
    expect(refresh).toBeGreaterThanOrEqual(0);
    expect(refresh).toBeLessThan(grantRevision.source.lastIndexOf("return v_item"));
  });
});

const skipReason = activeMissionIntegrationSkipReason();
const integrationSuite = skipReason === null ? describe : describe.skip;
const { app } = createApp();
function request(path: string, jwt: string, init: RequestInit = {}) {
  return app.request("/api" + path, { ...init, headers: {
    Authorization: "Bearer " + jwt, "X-Workspace-Slug": "demo", "Content-Type": "application/json",
    ...(init.headers ?? {}),
  } });
}

integrationSuite("active mission API live integration", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("supports owned workspace read and revision-safe autosave", async () => {
    const active = await seedActiveMission({
      email: "active-api-" + randomUUID() + "@test.local", slug: "test-active-api-" + randomUUID(),
      deliverables: [{ title: "Reel", platform: "instagram" }],
    });
    const other = await makeCreator("active-other-" + randomUUID() + "@test.local");
    expect((await userForJwt(active.creator.jwt).rpc("create_mission_workflow", {
      p_submission: active.submission.id,
    })).error).toBeNull();
    expect((await request("/my-missions/" + active.submission.id + "/workspace", other.jwt)).status).toBe(404);
    const workspaceResponse = await request("/my-missions/" + active.submission.id + "/workspace", active.creator.jwt);
    const workspace = await workspaceResponse.json();
    expect(workspaceResponse.status).toBe(200);
    const path = "/my-missions/" + active.submission.id + "/work-items/" + workspace.workItems[0].id + "/draft";
    const saved = await request(path, active.creator.jwt, { method: "PATCH", body: JSON.stringify({
      revision: 0, caption: "First draft", externalUrl: null, checklist: {},
    }) });
    expect(await saved.json()).toMatchObject({ draft: { caption: "First draft", revision: 1 } });
    const stale = await request(path, active.creator.jwt, { method: "PATCH", body: JSON.stringify({
      revision: 0, caption: "stale", externalUrl: null, checklist: {},
    }) });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "WORKFLOW_STALE", currentDraft: { revision: 1 } });
  });

  it("receives shipped fulfilment atomically without rewards or legacy status changes", async () => {
    const active = await seedActiveMission({
      email: "active-receipt-" + randomUUID() + "@test.local", slug: "test-active-receipt-" + randomUUID(),
      fulfillmentRequired: true, deliverables: [{ title: "Unboxing", platform: "instagram" }],
    });
    const created = await userForJwt(active.creator.jwt).rpc("create_mission_workflow", {
      p_submission: active.submission.id,
    });
    const before = await creatorRewardSnapshot(active.creator.id);
    const svc = serviceForTests();
    await svc.from("mission_fulfillments").update({ status: "shipped", shipped_at: new Date().toISOString() })
      .eq("mission_workflow_id", created.data.id);
    const response = await request("/my-missions/" + active.submission.id + "/fulfillment/received",
      active.creator.jwt, { method: "POST", body: "{}" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ workflow: { state: "drafting" } });
    const [fulfillment, items, submissionRow] = await Promise.all([
      svc.from("mission_fulfillments").select("status, received_by").eq("mission_workflow_id", created.data.id).single(),
      svc.from("mission_work_items").select("state").eq("mission_workflow_id", created.data.id),
      svc.from("mission_submissions").select("status").eq("id", active.submission.id).single(),
    ]);
    expect(fulfillment.data).toMatchObject({ status: "received", received_by: active.creator.id });
    expect(items.data?.every((row) => row.state === "drafting")).toBe(true);
    expect(submissionRow.data?.status).toBe("joined");
    expect(await creatorRewardSnapshot(active.creator.id)).toEqual(before);
  });
});
