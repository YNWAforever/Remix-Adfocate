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
