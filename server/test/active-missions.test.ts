import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp, type Env } from "../app";
import { ActiveMissionError } from "../lib/activeMission/errors";
import { createUploadGrant } from "../lib/activeMission/creatorActions";
import { createActiveMissionRepository, type ActiveMissionRepository } from "../lib/activeMission/repo";
import { createActiveMissionRoutes } from "../routes/activeMissions";
import { createAdminActiveMissionRepository, createAdminActiveMissionRoutes, sortActiveMissionQueue, type AdminActiveMissionRepository } from "../routes/adminActiveMissions";
import { validateMissionWorkflowAuthoring } from "../routes/adminMissions";
import {
  activeMissionIntegrationSkipReason, cleanup, creatorRewardSnapshot, DEMO_WS, makeCreator,
  makeMission, makeStaff, seedActiveMission, serviceForTests, userForJwt,
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
  const createSignedUrl = vi.fn(async (path: string) => ({
    data: { signedUrl: `https://signed.test/${path}` }, error: null,
  }));
  const storage = { from: vi.fn(() => ({ createSignedUrl })) };
  return { client: { from, storage } as unknown as SupabaseClient, calls, createSignedUrl, remaining: () => scripts.length - cursor };
}

const owner = { submissionId: "sub-1", creatorId: "creator-1", workspaceId: "workspace-1" };
const finalReviewMigration = () => readdirSync(resolve("supabase/migrations"))
  .filter((file) => file.includes("final_review_active_mission_contracts"))
  .sort()
  .at(-1);
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
const version = {
  id: "version-1", workspace_id: owner.workspaceId, mission_work_item_id: item.id,
  version_number: 1, caption_snapshot: "First submitted version", external_draft_url_snapshot: null,
  checklist_snapshot: { "req-1": true }, submitted_at: "2026-07-18T02:00:00.000Z",
};
const review = {
  id: "review-1", workspace_id: owner.workspaceId, mission_work_item_id: item.id,
  mission_draft_version_id: version.id, round_number: 1, state: "revision_requested",
  reviewer_id: "operator-1", review_started_at: "2026-07-18T03:00:00.000Z",
  decision_at: "2026-07-18T04:00:00.000Z", creator_response_deadline: "2026-07-20T04:00:00.000Z",
  mission_review_items: [{
    id: "change-1", requirement_id: "req-1", required_change_text: "Keep the product visible",
    category: "quality", required: true, position: 0, created_at: "2026-07-18T04:00:00.000Z",
  }],
};
const assets = [
  {
    id: "asset-draft", workspace_id: owner.workspaceId, mission_workflow_id: workflow.id,
    mission_work_item_id: item.id, creator_id: owner.creatorId, mission_draft_version_id: null,
    original_filename: "working.png", mime_type: "image/png", byte_size: 1024,
    storage_object_path: "creator-1/workflow-1/item-1/working.png", checksum: "abc", upload_state: "ready",
    created_at: "2026-07-18T01:00:00.000Z", deleted_at: null,
  },
  {
    id: "asset-version", workspace_id: owner.workspaceId, mission_workflow_id: workflow.id,
    mission_work_item_id: item.id, creator_id: owner.creatorId, mission_draft_version_id: version.id,
    original_filename: "submitted.mp4", mime_type: "video/mp4", byte_size: 2048,
    storage_object_path: "creator-1/workflow-1/item-1/submitted.mp4", checksum: "def", upload_state: "ready",
    created_at: "2026-07-18T02:00:00.000Z", deleted_at: null,
  },
];
const anchor = (): Script[] => [
  { table: "mission_submissions", data: submission },
  { table: "mission_workflows", data: workflow },
];

describe("active mission repository without a live database", () => {
  it("constrains workspace read ownership and shapes the creator view", async () => {
    const scripted = scriptedClient([
      ...anchor(), { table: "mission_fulfillments", data: null },
      { table: "mission_work_items", data: [item] }, { table: "mission_working_drafts", data: [draft] },
      { table: "mission_workflow_events", data: [] }, { table: "mission_draft_versions", data: [version] },
      { table: "mission_review_rounds", data: [review] }, { table: "mission_draft_assets", data: assets },
    ]);
    const result = await createActiveMissionRepository(scripted.client).getWorkspace(owner);
    expect(result.mission).toMatchObject({
      id: mission.id, missionType: "ugc", brief: { targetAudience: "HK creators", keyMessages: ["Fast setup"] },
    });
    expect(result.workItems[0]).toMatchObject({ id: item.id, draft: { caption: "", revision: 0 } });
    expect(result.workItems[0]).toMatchObject({
      draftAssets: [{ id: "asset-draft", signedUrl: expect.stringContaining("working.png") }],
      versions: [{
        id: version.id,
        versionNumber: 1,
        state: "revision_requested",
        decisionAt: review.decision_at,
        assets: [{ id: "asset-version", signedUrl: expect.stringContaining("submitted.mp4") }],
      }],
      reviewRounds: [{ id: review.id, state: "revision_requested" }],
      requiredChanges: [{
        id: "change-1", requirementId: "req-1", text: "Keep the product visible",
        createdAt: "2026-07-18T04:00:00.000Z",
      }],
      revisionDeadline: review.creator_response_deadline,
    });
    expect(result.nextAction).toMatchObject({ kind: "continue_draft", workItemId: item.id });
    expect(scripted.calls.filter((c) => c.table === "mission_submissions" && c.op === "eq").map((c) => c.args))
      .toEqual([["id", owner.submissionId], ["creator_id", owner.creatorId], ["workspace_id", owner.workspaceId]]);
    expect(scripted.calls.filter((c) => c.table === "mission_working_drafts" && c.op === "in").map((c) => c.args))
      .toEqual([["mission_work_item_id", [item.id]]]);
    expect(scripted.calls.filter((c) => c.table === "mission_draft_assets" && c.op === "eq").map((c) => c.args))
      .toEqual(expect.arrayContaining([
        ["mission_workflow_id", workflow.id], ["workspace_id", owner.workspaceId], ["creator_id", owner.creatorId],
      ]));
    expect(scripted.calls.filter((c) => c.table === "mission_review_rounds" && c.op === "select").map((c) => c.args))
      .toEqual([[expect.stringContaining("mission_review_items!mission_review_items_round_workspace_fk")]]);

    expect(scripted.createSignedUrl).toHaveBeenCalledTimes(2);
    expect(scripted.createSignedUrl).toHaveBeenNthCalledWith(1, assets[0].storage_object_path, 600);
    expect(scripted.createSignedUrl).toHaveBeenNthCalledWith(2, assets[1].storage_object_path, 600);
    expect(scripted.remaining()).toBe(0);
  });

  it("stops at a 404 ownership anchor for another creator or workspace", async () => {
    const scripted = scriptedClient([{ table: "mission_submissions", data: null }]);
    await expect(createActiveMissionRepository(scripted.client).getWorkspace({ ...owner, creatorId: "other" }))
      .rejects.toMatchObject({ code: "WORKFLOW_NOT_FOUND" });
    expect(scripted.remaining()).toBe(0);
  });

  it("saves a draft with exactly one service RPC using every route-derived owner anchor", async () => {
    const saved = {
      ...draft,
      caption_text: "First draft",
      external_draft_url: "https://example.com/draft",
      revision: 1,
    };
    const rpc = vi.fn(async () => ({ data: { draft: saved }, error: null }));
    const result = await createActiveMissionRepository({ rpc } as unknown as SupabaseClient).saveDraft(
      { ...owner, workItemId: item.id },
      { revision: 0, caption: "First draft", externalUrl: "https://example.com/draft", checklist: {} },
    );
    expect(result).toMatchObject({ caption: "First draft", revision: 1 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("save_active_mission_draft", {
      p_submission: owner.submissionId,
      p_creator: owner.creatorId,
      p_workspace: owner.workspaceId,
      p_work_item: item.id,
      p_expected_revision: 0,
      p_patch: { caption: "First draft", externalUrl: "https://example.com/draft", checklist: {} },
    });
  });

  it("maps a stale atomic autosave payload without issuing a compensating read", async () => {
    const current = { ...draft, caption_text: "First draft", revision: 1 };
    const rpc = vi.fn(async () => ({
      data: { code: "WORKFLOW_STALE", current_draft: current },
      error: null,
    }));
    const repo = createActiveMissionRepository({ rpc } as unknown as SupabaseClient);
    await expect(repo.saveDraft({ ...owner, workItemId: item.id }, {
      revision: 0, caption: "stale", externalUrl: null, checklist: {},
    })).rejects.toMatchObject({
      code: "WORKFLOW_STALE", details: { currentDraft: { caption: "First draft", revision: 1 } },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("maps a non-editable atomic autosave payload to WRONG_STATE", async () => {
    const rpc = vi.fn(async () => ({ data: { code: "WRONG_STATE", current_draft: draft }, error: null }));
    await expect(createActiveMissionRepository({ rpc } as unknown as SupabaseClient).saveDraft(
      { ...owner, workItemId: item.id }, { revision: 0, caption: "too late" },
    )).rejects.toMatchObject({ code: "WRONG_STATE", details: { currentDraft: { revision: 0 } } });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("validates malformed autosave fields before any RPC", async () => {
    const rpc = vi.fn();
    await expect(createActiveMissionRepository({ rpc } as unknown as SupabaseClient).saveDraft(
      { ...owner, workItemId: item.id }, { revision: 0, externalUrl: "javascript:alert(1)" },
    )).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps database-side checklist validation failures without leaking SQL errors", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "validation_failed" } }));
    await expect(createActiveMissionRepository({ rpc } as unknown as SupabaseClient).saveDraft(
      { ...owner, workItemId: item.id }, { revision: 0, checklist: { unknown: true } },
    )).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(rpc).toHaveBeenCalledTimes(1);
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

describe("active mission creator upload service", () => {
  it("abandons an owner/path-scoped pending asset when signed URL creation fails without masking that failure", async () => {
    const asset = {
      id: "asset-1",
      storage_object_path: "creator-1/workflow-1/item-1/asset-1.jpg",
      upload_state: "pending",
      mime_type: "image/jpeg",
      byte_size: 1024,
      upload_grant_expires_at: "2026-07-19T12:10:00.000Z",
    };
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: asset, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "cleanup unavailable" } });
    const createSignedUploadUrl = vi.fn(async () => ({ data: null, error: { message: "signing failed" } }));
    const client = {
      rpc,
      storage: { from: vi.fn(() => ({ createSignedUploadUrl })) },
    } as unknown as SupabaseClient;

    await expect(createUploadGrant(client, { ...owner, workItemId: item.id }, {
      fileName: "draft.jpg", contentType: "image/jpeg", sizeBytes: 1024,
    })).rejects.toMatchObject({ code: "UNKNOWN", message: "signing failed" });

    expect(rpc).toHaveBeenNthCalledWith(2, "abandon_active_mission_asset", {
      p_submission: owner.submissionId,
      p_creator: owner.creatorId,
      p_workspace: owner.workspaceId,
      p_work_item: item.id,
      p_asset: asset.id,
      p_storage_object_path: asset.storage_object_path,
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

  it.each(["submitted", "under_review", "approved_to_publish"])(
    "returns controlled 409 WRONG_STATE when autosave reaches a %s item",
    async (state) => {
      const repo = {
        getWorkspace: vi.fn(),
        saveDraft: vi.fn(async () => {
          throw new ActiveMissionError("WRONG_STATE", "Draft is no longer editable", {
            state,
            currentDraft: { caption: "", externalUrl: null, checklist: {}, revision: 2 },
          });
        }),
        receiveFulfillment: vi.fn(),
      } as unknown as ActiveMissionRepository;
      const response = await controlledApp(repo).request(
        "/api/my-missions/sub-1/work-items/item-1/draft",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: 1, caption: "too late" }),
        },
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: "WRONG_STATE",
        state,
        currentDraft: { revision: 2 },
      });
    },
  );

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

  it("returns a private signed upload grant for an owned editable work item", async () => {
    const createUploadGrant = vi.fn(async () => ({
      asset: { id: "asset-1", path: "creator-1/workflow-1/item-1/asset-1.jpg", uploadState: "pending" },
      upload: { path: "creator-1/workflow-1/item-1/asset-1.jpg", token: "signed-token" },
    }));
    const repo = { createUploadGrant } as unknown as ActiveMissionRepository;
    const response = await controlledApp(repo).request(
      "/api/my-missions/sub-1/work-items/item-1/assets/upload-grant",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        fileName: "draft.JPG", contentType: "image/jpeg", sizeBytes: 1024,
      }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      asset: { id: "asset-1", uploadState: "pending" },
      upload: { path: "creator-1/workflow-1/item-1/asset-1.jpg", token: "signed-token" },
    });
    expect(createUploadGrant).toHaveBeenCalledWith({ ...owner, workItemId: item.id }, {
      fileName: "draft.JPG", contentType: "image/jpeg", sizeBytes: 1024,
    });
  });

  it("rejects unsupported upload metadata before creating an asset", async () => {
    const createUploadGrant = vi.fn();
    const repo = { createUploadGrant } as unknown as ActiveMissionRepository;
    const response = await controlledApp(repo).request(
      "/api/my-missions/sub-1/work-items/item-1/assets/upload-grant",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: "draft.pdf", contentType: "application/pdf", sizeBytes: 20_971_521 }) },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(createUploadGrant).not.toHaveBeenCalled();
  });

  it("finalizes an owned asset after metadata verification", async () => {
    const finalizeAsset = vi.fn(async () => ({ id: "asset-1", uploadState: "ready", checksum: "sha256-value" }));
    const repo = { finalizeAsset } as unknown as ActiveMissionRepository;
    const response = await controlledApp(repo).request(
      "/api/my-missions/sub-1/work-items/item-1/assets/asset-1/finalize",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ checksum: "sha256-value" }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ asset: { id: "asset-1", uploadState: "ready" } });
    expect(finalizeAsset).toHaveBeenCalledWith(
      { ...owner, workItemId: item.id, assetId: "asset-1" },
      { checksum: "sha256-value" },
    );
  });

  it("requires an idempotency key before submitting a draft", async () => {
    const submitDraft = vi.fn();
    const repo = { submitDraft } as unknown as ActiveMissionRepository;
    const response = await controlledApp(repo).request(
      "/api/my-missions/sub-1/work-items/item-1/submit",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: 2 }) },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(submitDraft).not.toHaveBeenCalled();
  });

  it("submits a draft with revision and idempotency key", async () => {
    const submitDraft = vi.fn(async () => ({ version: { id: "version-1" }, workItem: { id: "item-1", state: "submitted" } }));
    const repo = { submitDraft } as unknown as ActiveMissionRepository;
    const response = await controlledApp(repo).request(
      "/api/my-missions/sub-1/work-items/item-1/submit",
      { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "submission-key-1" }, body: JSON.stringify({ expectedRevision: 2 }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ version: { id: "version-1" }, workItem: { state: "submitted" } });
    expect(submitDraft).toHaveBeenCalledWith(
      { ...owner, workItemId: item.id },
      { expectedRevision: 2, idempotencyKey: "submission-key-1" },
    );
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

describe("active mission creator submit migration contract", () => {
  it("is atomic, service-only, idempotent, asset-scoped, and reward-neutral", () => {
    const name = readdirSync(resolve("supabase/migrations"))
      .find((file) => file.includes("submit_active_mission_draft"));
    expect(name).toBeTruthy();
    const sql = readFileSync(resolve("supabase/migrations", name!), "utf8").toLowerCase();
    for (const token of [
      "function private.submit_active_mission_draft", "function public.submit_active_mission_draft",
      "security definer", "set search_path = ''", "for update", "p_idempotency_key",
      "mission_submission_idempotency_key", "mission_draft_versions", "mission_draft_assets",
      "mission_review_rounds", "review_due_at", "least(", "mission_workflow_events",
      "private.refresh_mission_workflow_state", "to service_role",
    ]) expect(sql).toContain(token);
    expect(sql).toContain("revoke all on function private.submit_active_mission_draft");
    expect(sql).toContain("revoke all on function public.submit_active_mission_draft");
    for (const forbidden of [
      " to authenticated", "update public.mission_submissions", "update public.point_balances",
      "update public.earnings_balances", "update public.creators set xp",
    ]) expect(sql).not.toContain(forbidden);
  });
});

describe("active mission final-review forward migration contract", () => {
  it("submits canonical immutable content without claiming operator review", () => {
    const name = finalReviewMigration();
    expect(name).toBeTruthy();
    const sql = readFileSync(resolve("supabase/migrations", name!), "utf8").toLowerCase();
    for (const token of [
      "function private.submit_active_mission_draft", "function public.submit_active_mission_draft",
      "extensions.digest", "sha256", "regexp_replace", "jsonb_agg", "order by",
      "checklist_incomplete", "submission_content_required", "deadline_passed", "duplicate_content",
      "set state = 'submitted'", "current_reviewer_id = null", "review_started_at = null", "review_due_at = null",
      "review_started_at, decision_at, creator_response_deadline", "null, null, null",
      "function private.start_mission_review", "set state = 'under_review'", "'mission_review_started'",
      "grant execute on function public.submit_active_mission_draft", "to service_role",
    ]) expect(sql).toContain(token);
    expect(sql.indexOf("select w.* into v_workflow")).toBeLessThan(sql.indexOf("select i.* into v_item"));
    expect(sql.indexOf("select i.* into v_item")).toBeLessThan(sql.indexOf("select d.* into v_draft"));
    for (const forbidden of [
      "set state = 'under_review',\n      current_submitted_version_id",
      "update public.mission_submissions", "update public.point_balances",
      "update public.earnings_balances", "update public.creators set xp", " to authenticated",
    ]) expect(sql).not.toContain(forbidden);
  });

  it("saves drafts atomically through one service-only owner-scoped RPC", () => {
    const name = finalReviewMigration();
    expect(name).toBeTruthy();
    const sql = readFileSync(resolve("supabase/migrations", name!), "utf8").toLowerCase();
    for (const token of [
      "function private.save_active_mission_draft", "function public.save_active_mission_draft",
      "p_submission uuid", "p_creator uuid", "p_workspace uuid", "p_work_item uuid",
      "p_expected_revision integer", "for update", "('drafting', 'revision_requested')",
      "stale_revision", "wrong_state", "current_draft", "set search_path = ''",
      "revoke all on function public.save_active_mission_draft", "to service_role",
    ]) expect(sql).toContain(token);
    expect(sql).not.toContain("grant execute on function public.save_active_mission_draft(uuid, uuid, uuid, uuid, integer, text, text, jsonb) to authenticated");
  });

  it("caps revision requests at the snapshotted response policy and hard deadline", () => {
    const name = finalReviewMigration();
    expect(name).toBeTruthy();
    const sql = readFileSync(resolve("supabase/migrations", name!), "utf8").toLowerCase();
    for (const token of [
      "function private.request_mission_revision", "revision_response_hours", "make_interval",
      "v_allowed_deadline", "p_deadline > v_allowed_deadline", "creator_response_deadline = v_effective_deadline",
      "'deadline', v_effective_deadline", "function public.request_mission_revision",
      "revoke all on function public.request_mission_revision", "to service_role",
    ]) expect(sql).toContain(token);
  });
});

describe("active mission failed upload cleanup migration contract", () => {
  it("is service-only, owner/path-scoped, and cannot abandon finalized assets", () => {
    const name = readdirSync(resolve("supabase/migrations"))
      .find((file) => file.includes("abandon_active_mission_asset"));
    expect(name).toBeTruthy();
    const sql = readFileSync(resolve("supabase/migrations", name!), "utf8").toLowerCase();
    for (const token of [
      "function private.abandon_active_mission_asset", "function public.abandon_active_mission_asset",
      "security definer", "set search_path = ''", "for update", "a.storage_object_path = p_storage_object_path",
      "s.id = p_submission", "s.creator_id = p_creator", "a.workspace_id = p_workspace",
      "a.mission_work_item_id = p_work_item", "a.id = p_asset", "a.upload_state = 'pending'",
      "a.mission_draft_version_id is null", "set upload_state = 'deleted'", "deleted_at = now()",
      "to service_role",
    ]) expect(sql).toContain(token);
    expect(sql).not.toContain(" to authenticated");
  });
});

describe("active mission operator routes without a live database", () => {
  const workflowId = "11111111-1111-4111-8111-111111111111";
  const workItemId = "22222222-2222-4222-8222-222222222222";
  const versionId = "33333333-3333-4333-8333-333333333333";
  const requirementId = "44444444-4444-4444-8444-444444444444";
  const idempotencyKey = "55555555-5555-4555-8555-555555555555";
  const urgent = { workItemId: "urgent", reviewDueAt: "2026-07-18T00:00:00.000Z", creatorDeadline: "2026-07-20T00:00:00.000Z", submittedAt: "2026-07-17T00:00:00.000Z" };
  const later = { workItemId: "later", reviewDueAt: "2026-07-19T00:00:00.000Z", creatorDeadline: "2026-07-21T00:00:00.000Z", submittedAt: "2026-07-16T00:00:00.000Z" };

  it("orders the operator queue by overdue SLA, SLA due, creator deadline, and submitted time", () => {
    expect(sortActiveMissionQueue([later, urgent], new Date("2026-07-18T12:00:00.000Z")).map((row) => row.workItemId))
      .toEqual(["urgent", "later"]);
  });

  it("projects exact mission and deliverable identity into every queue item", async () => {
    const { client } = scriptedClient([
      { table: "workspaces", data: { id: "workspace-1" } },
      { table: "mission_work_items", data: [{
        id: workItemId,
        mission_workflow_id: workflowId,
        title: "Instagram reel",
        state: "submitted",
        deadline: "2026-07-20T00:00:00.000Z",
        review_due_at: "2026-07-19T00:00:00.000Z",
        current_reviewer_id: null,
        current_submitted_version_id: null,
      }] },
      { table: "mission_workflows", data: [{ id: workflowId, mission_submission_id: "submission-1" }] },
      { table: "mission_submissions", data: [{
        id: "submission-1",
        mission_id: "mission-1",
        creator_id: "creator-1",
        creators: { display_name: "Amy Wong" },
        missions: { title: "Summer launch" },
      }] },
    ]);
    const result = await createAdminActiveMissionRepository(client).listQueue({ workspaceSlug: "demo" });
    expect(result.items).toEqual([
      expect.objectContaining({ missionId: "mission-1", deliverableTitle: "Instagram reel" }),
    ]);
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

  it("rejects revision feedback with an invalid supplied deadline and no required change", async () => {
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

  it("allows the database contract to default an omitted revision deadline", async () => {
    const requestRevision = vi.fn(async () => ({ workItem: { id: workItemId } }));
    const app = new Hono<Env>();
    app.route("/api/admin/active-missions", createAdminActiveMissionRoutes({ requestRevision } as unknown as AdminActiveMissionRepository, () => ({ userId: "operator-1", email: "op@example.com" })));
    const items = [{ requirementId: null, category: "quality", text: "Tighten the opening", required: true }];
    const response = await app.request(`/api/admin/active-missions/${workflowId}/work-items/${workItemId}/request-revision`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Workspace-Slug": "demo" },
      body: JSON.stringify({ expectedState: "under_review", versionId, items }),
    });

    expect(response.status).toBe(200);
    expect(requestRevision).toHaveBeenCalledWith(expect.objectContaining({
      workflowId, workItemId, deadline: null, items,
    }));
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
  it("validates and sends one guarded pre-freeze publication instruction override", async () => {
    const setPublicationInstructions = vi.fn(async () => ({ instruction: { mission_work_item_id: workItemId, revision: 1 } }));
    const repository = { setPublicationInstructions } as unknown as AdminActiveMissionRepository;
    const app = new Hono<Env>();
    app.route("/api/admin/active-missions", createAdminActiveMissionRoutes(repository, () => ({ userId: "operator-1", email: "op@example.com" })));
    const body = {
      expectedState: "under_review", expectedRevision: 0, idempotencyKey,
      overrideReason: "Creator account changed before approval",
      instructions: {
        publicationInstructions: "Publish the approved reel", publicationWindowHours: 36,
        requiredDisclosures: ["#ad", "Paid partnership"], expectedAccount: "@creator",
        proofEvidencePolicy: { screenshots: 1 },
      },
    };
    const response = await app.request(`/api/admin/active-missions/${workflowId}/work-items/${workItemId}/publication-instructions`, {
      method: "PUT", headers: { "Content-Type": "application/json", "X-Workspace-Slug": "demo" }, body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    expect(setPublicationInstructions).toHaveBeenCalledWith({ workflowId, workItemId, workspaceSlug: "demo", operatorId: "operator-1", ...body });
  });

  it("sends exact guarded publication instruction RPC arguments", async () => {
    const rpc = vi.fn(async () => ({ data: { instruction: { revision: 1 } }, error: null }));
    const repository = createAdminActiveMissionRepository(operatorClient(rpc));
    await repository.setPublicationInstructions({
      workflowId: "workflow-1", workItemId: "item-1", operatorId: "operator-1", workspaceSlug: "demo",
      expectedState: "under_review", expectedRevision: 0, idempotencyKey,
      overrideReason: "Account changed",
      instructions: {
        publicationInstructions: "Publish approved content", publicationWindowHours: 48,
        requiredDisclosures: ["#ad"], expectedAccount: null, proofEvidencePolicy: {},
      },
    });
    expect(rpc).toHaveBeenCalledWith("set_publication_instructions", {
      p_workflow: "workflow-1", p_work_item: "item-1", p_operator: "operator-1", p_workspace: "workspace-1",
      p_expected_state: "under_review", p_expected_revision: 0, p_idempotency_key: idempotencyKey,
      p_instructions: {
        publication_instructions: "Publish approved content", publication_window_hours: 48,
        required_disclosures: ["#ad"], expected_account: null, proof_evidence_policy: {}, override_reason: "Account changed",
      },
    });
  });

  it.each([
    ["missing reason", { overrideReason: " " }],
    ["non-positive publication window", { instructions: { publicationWindowHours: 0 } }],
    ["blank disclosure", { instructions: { requiredDisclosures: ["#ad", " "] } }],
    ["invalid evidence policy", { instructions: { proofEvidencePolicy: [] } }],
    ["negative expected revision", { expectedRevision: -1 }],
    ["malformed idempotency key", { idempotencyKey: "not-a-uuid" }],
    ["missing expected state", { expectedState: " " }],
  ])("rejects a publication instruction override with %s", async (_label, patch) => {
    const setPublicationInstructions = vi.fn();
    const repository = { setPublicationInstructions } as unknown as AdminActiveMissionRepository;
    const app = new Hono<Env>();
    app.route("/api/admin/active-missions", createAdminActiveMissionRoutes(repository, () => ({ userId: "operator-1", email: "op@example.com" })));
    const base = {
      expectedState: "under_review", expectedRevision: 0, idempotencyKey, overrideReason: "Operator override",
      instructions: {
        publicationInstructions: "Publish the approved reel", publicationWindowHours: 36,
        requiredDisclosures: ["#ad"], expectedAccount: null, proofEvidencePolicy: {},
      },
    };
    const instructionsPatch = "instructions" in patch ? patch.instructions : undefined;
    const response = await app.request(`/api/admin/active-missions/${workflowId}/work-items/${workItemId}/publication-instructions`, {
      method: "PUT", headers: { "Content-Type": "application/json", "X-Workspace-Slug": "demo" },
      body: JSON.stringify({ ...base, ...patch, instructions: instructionsPatch ? { ...base.instructions, ...instructionsPatch } : base.instructions }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(setPublicationInstructions).not.toHaveBeenCalled();
  });

  it("maps publication setup failures to the stable conflict response", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "PUBLICATION_SETUP_REQUIRED" } }));
    const repository = createAdminActiveMissionRepository(operatorClient(rpc));
    const app = new Hono<Env>();
    app.route("/api/admin/active-missions", createAdminActiveMissionRoutes(repository, () => ({ userId: "operator-1", email: "op@example.com" })));
    const response = await app.request(`/api/admin/active-missions/${workflowId}/work-items/${workItemId}/approve-to-publish`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Workspace-Slug": "demo" },
      body: JSON.stringify({ expectedState: "under_review", versionId }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "PUBLICATION_SETUP_REQUIRED" });
  });
});

describe("active mission publication authoring validation", () => {
  const completeTemplate = {
    title: "Reel", platform: "instagram", position: 0, required: true, draft_due_offset_hours: 0,
    publication_instructions: "Publish the approved reel", publication_window_hours: 48,
    required_disclosures: ["#ad", "Paid partnership"], expected_account: null,
    proof_evidence_policy: { screenshots: 1 }, requirements: [],
  };

  it("requires complete publication defaults only for active-workspace deliverables", () => {
    const active = validateMissionWorkflowAuthoring({
      creator_workflow_mode: "active_workspace",
      deliverable_templates: [{ title: "Reel", platform: "instagram", position: 0, required: true, draft_due_offset_hours: 0, requirements: [] }],
    });
    expect(active.ok).toBe(false);
    expect(active.errors).toMatchObject({
      "deliverable_templates.0.publication_instructions": expect.any(String),
      "deliverable_templates.0.publication_window_hours": expect.any(String),
      "deliverable_templates.0.required_disclosures": expect.any(String),
      "deliverable_templates.0.proof_evidence_policy": expect.any(String),
    });
    expect(validateMissionWorkflowAuthoring({
      creator_workflow_mode: "legacy",
      deliverable_templates: [{ title: "Legacy", platform: null, position: 0, required: false, draft_due_offset_hours: 0, requirements: [] }],
    }).ok).toBe(true);
  });

  it("accepts ordered disclosures and rejects blank entries or invalid evidence policy", () => {
    expect(validateMissionWorkflowAuthoring({ creator_workflow_mode: "active_workspace", deliverable_templates: [completeTemplate] }))
      .toMatchObject({ ok: true, errors: {} });
    const invalid = validateMissionWorkflowAuthoring({
      creator_workflow_mode: "active_workspace",
      deliverable_templates: [{ ...completeTemplate, publication_window_hours: 0, required_disclosures: ["#ad", " "], proof_evidence_policy: [] }],
    } as never);
    expect(invalid.errors).toMatchObject({
      "deliverable_templates.0.publication_window_hours": "PUBLICATION_WINDOW_HOURS_INVALID",
      "deliverable_templates.0.required_disclosures.1": "REQUIRED_DISCLOSURE_REQUIRED",
      "deliverable_templates.0.proof_evidence_policy": "PROOF_EVIDENCE_POLICY_INVALID",
    });
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

async function seedLiveDraft(
  label: string,
  requirements: Array<{
    category: "format" | "key_message" | "compliance" | "quality" | "other";
    text: string;
    required?: boolean;
  }> = [],
) {
  const active = await seedActiveMission({
    email: `active-${label}-${randomUUID()}@test.local`,
    slug: `test-active-${label}-${randomUUID()}`,
    deliverables: [{ title: "Review reel", platform: "instagram", requirements }],
  });
  const created = await userForJwt(active.creator.jwt).rpc("create_mission_workflow", {
    p_submission: active.submission.id,
  });
  expect(created.error).toBeNull();
  const svc = serviceForTests();
  const [itemResult, workflowResult] = await Promise.all([
    svc.from("mission_work_items")
      .select("id, state, requirements_snapshot, deadline, current_submitted_version_id")
      .eq("mission_workflow_id", created.data.id)
      .single(),
    svc.from("mission_workflows")
      .select("id, deadline, revision_response_hours")
      .eq("id", created.data.id)
      .single(),
  ]);
  expect(itemResult.error).toBeNull();
  expect(workflowResult.error).toBeNull();
  const draftResult = await svc.from("mission_working_drafts")
    .select("id, revision")
    .eq("mission_work_item_id", itemResult.data!.id)
    .single();
  expect(draftResult.error).toBeNull();
  return { active, svc, workflow: workflowResult.data!, item: itemResult.data!, draft: draftResult.data! };
}

async function seedLiveReview(label: string) {
  const ctx = await seedLiveDraft(label);
  const saved = await ctx.svc.rpc("save_active_mission_draft", {
    p_submission: ctx.active.submission.id,
    p_creator: ctx.active.creator.id,
    p_workspace: DEMO_WS,
    p_work_item: ctx.item.id,
    p_expected_revision: 0,
    p_patch: { caption: "Ready for review" },
  });
  expect(saved.error).toBeNull();
  const submitted = await ctx.svc.rpc("submit_active_mission_draft", {
    p_submission: ctx.active.submission.id,
    p_creator: ctx.active.creator.id,
    p_workspace: DEMO_WS,
    p_work_item: ctx.item.id,
    p_expected_revision: 1,
    p_idempotency_key: randomUUID(),
  });
  expect(submitted.error).toBeNull();
  const operator = await makeStaff(`active-${label}-reviewer-${randomUUID()}@test.local`);
  const started = await ctx.svc.rpc("start_mission_review", {
    p_workflow: ctx.workflow.id,
    p_work_item: ctx.item.id,
    p_operator: operator.userId,
    p_workspace: DEMO_WS,
    p_expected_state: "submitted",
  });
  expect(started.error).toBeNull();
  return {
    ...ctx,
    operator,
    versionId: submitted.data.version.id as string,
    requestRevision: (deadline: string | null) => ctx.svc.rpc("request_mission_revision", {
      p_workflow: ctx.workflow.id,
      p_work_item: ctx.item.id,
      p_version: submitted.data.version.id,
      p_operator: operator.userId,
      p_workspace: DEMO_WS,
      p_expected_state: "under_review",
      p_deadline: deadline,
      p_items: [{ category: "quality", text: "Tighten the opening", required: true }],
    }),
  };
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
    expect(workspaceResponse.status, JSON.stringify(workspace)).toBe(200);
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

  it("enforces submit content/checklist, preserves idempotency, and separates operator review claim", async () => {
    const ctx = await seedLiveDraft("submit-contract", [
      { category: "format", text: "Use a vertical frame", required: true },
    ]);
    const requirementId = (ctx.item.requirements_snapshot as Array<{ id: string }>)[0]?.id;
    expect(requirementId).toBeTruthy();
    const submit = (expectedRevision: number, key: string) => ctx.svc.rpc("submit_active_mission_draft", {
      p_submission: ctx.active.submission.id,
      p_creator: ctx.active.creator.id,
      p_workspace: DEMO_WS,
      p_work_item: ctx.item.id,
      p_expected_revision: expectedRevision,
      p_idempotency_key: key,
    });
    const save = (expectedRevision: number, patch: Record<string, unknown>) =>
      ctx.svc.rpc("save_active_mission_draft", {
        p_submission: ctx.active.submission.id,
        p_creator: ctx.active.creator.id,
        p_workspace: DEMO_WS,
        p_work_item: ctx.item.id,
        p_expected_revision: expectedRevision,
        p_patch: patch,
      });

    const empty = await submit(0, randomUUID());
    expect(empty.error?.message.toLowerCase()).toContain("checklist_incomplete");
    const captionOnly = await save(0, {
      caption: "First line\r\nSecond line",
      checklist: { [requirementId]: false },
    });
    expect(captionOnly.error).toBeNull();
    expect(captionOnly.data).toMatchObject({ draft: { revision: 1 } });
    const incomplete = await submit(1, randomUUID());
    expect(incomplete.error?.message.toLowerCase()).toContain("checklist_incomplete");

    const ready = await save(1, { checklist: { [requirementId]: true } });
    expect(ready.error).toBeNull();
    expect(ready.data).toMatchObject({ draft: { revision: 2 } });
    const key = randomUUID();
    const submitted = await submit(2, key);
    expect(submitted.error).toBeNull();
    expect(submitted.data).toMatchObject({
      work_item: {
        state: "submitted",
        current_reviewer_id: null,
        review_started_at: null,
        review_due_at: null,
      },
      version: { version_number: 1 },
    });
    const versionId = submitted.data.version.id as string;

    const sameKey = await submit(999, key);
    expect(sameKey.error).toBeNull();
    expect(sameKey.data.version.id).toBe(versionId);
    const sameContentNewKey = await submit(2, randomUUID());
    expect(sameContentNewKey.error).toBeNull();
    expect(sameContentNewKey.data.version.id).toBe(versionId);
    const versions = await ctx.svc.from("mission_draft_versions")
      .select("id, content_checksum")
      .eq("mission_work_item_id", ctx.item.id);
    expect(versions.error).toBeNull();
    expect(versions.data).toHaveLength(1);
    expect(versions.data![0].content_checksum).toMatch(/^[a-f0-9]{64}$/);

    const submittedRound = await ctx.svc.from("mission_review_rounds")
      .select("state, reviewer_id, review_started_at, decision_at, creator_response_deadline")
      .eq("mission_work_item_id", ctx.item.id)
      .single();
    expect(submittedRound.error).toBeNull();
    expect(submittedRound.data).toEqual({
      state: "open",
      reviewer_id: null,
      review_started_at: null,
      decision_at: null,
      creator_response_deadline: null,
    });
    expect((await save(2, { caption: "blocked while submitted" })).data)
      .toMatchObject({ code: "WRONG_STATE", current_draft: { revision: 2 } });

    const operator = await makeStaff(`active-reviewer-${randomUUID()}@test.local`);
    const started = await ctx.svc.rpc("start_mission_review", {
      p_workflow: ctx.workflow.id,
      p_work_item: ctx.item.id,
      p_operator: operator.userId,
      p_workspace: DEMO_WS,
      p_expected_state: "submitted",
    });
    expect(started.error).toBeNull();
    expect(started.data).toMatchObject({ state: "under_review", current_reviewer_id: operator.userId });
    expect(started.data.review_started_at).toBeTruthy();
    expect(started.data.review_due_at).toBeTruthy();
    expect((await save(2, { caption: "blocked while under review" })).data)
      .toMatchObject({ code: "WRONG_STATE" });
    const reviewEvent = await ctx.svc.from("mission_workflow_events")
      .select("event_type, actor_id")
      .eq("mission_work_item_id", ctx.item.id)
      .eq("event_type", "mission_review_started")
      .single();
    expect(reviewEvent.error).toBeNull();
    expect(reviewEvent.data).toEqual({ event_type: "mission_review_started", actor_id: operator.userId });

    const approved = await ctx.svc.rpc("approve_mission_version", {
      p_workflow: ctx.workflow.id,
      p_work_item: ctx.item.id,
      p_version: versionId,
      p_operator: operator.userId,
      p_workspace: DEMO_WS,
      p_expected_state: "under_review",
    });
    expect(approved.error).toBeNull();
    expect(approved.data).toMatchObject({ state: "approved_to_publish" });
    expect((await save(2, { caption: "blocked after approval" })).data)
      .toMatchObject({ code: "WRONG_STATE" });
  });

  it("rejects empty submissions and submissions after the item deadline", async () => {
    const ctx = await seedLiveDraft("submit-deadline");
    const submit = (expectedRevision: number) => ctx.svc.rpc("submit_active_mission_draft", {
      p_submission: ctx.active.submission.id,
      p_creator: ctx.active.creator.id,
      p_workspace: DEMO_WS,
      p_work_item: ctx.item.id,
      p_expected_revision: expectedRevision,
      p_idempotency_key: randomUUID(),
    });
    const empty = await submit(0);
    expect(empty.error?.message.toLowerCase()).toContain("submission_content_required");
    const saved = await ctx.svc.rpc("save_active_mission_draft", {
      p_submission: ctx.active.submission.id,
      p_creator: ctx.active.creator.id,
      p_workspace: DEMO_WS,
      p_work_item: ctx.item.id,
      p_expected_revision: 0,
      p_patch: { caption: "Late draft" },
    });
    expect(saved.error).toBeNull();
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    const expiredItem = await ctx.svc.from("mission_work_items")
      .update({ deadline: expiredAt })
      .eq("id", ctx.item.id);
    expect(expiredItem.error).toBeNull();
    const expired = await submit(1);
    expect(expired.error?.message.toLowerCase()).toContain("deadline_passed");
  });

  it("rejects overlong revision deadlines and persists defaulted or stricter effective deadlines", async () => {
    const defaulted = await seedLiveReview("revision-default");
    const overlong = await defaulted.requestRevision("2099-01-01T00:00:00.000Z");
    expect(overlong.error?.message.toLowerCase()).toContain("validation_failed");

    const beforeDefault = Date.now();
    const acceptedDefault = await defaulted.requestRevision(null);
    const afterDefault = Date.now();
    expect(acceptedDefault.error).toBeNull();
    expect(acceptedDefault.data).toMatchObject({ state: "revision_requested" });
    const defaultRound = await defaulted.svc.from("mission_review_rounds")
      .select("state, creator_response_deadline")
      .eq("mission_work_item_id", defaulted.item.id)
      .single();
    expect(defaultRound.error).toBeNull();
    expect(defaultRound.data!.state).toBe("revision_requested");
    const defaultDeadline = Date.parse(defaultRound.data!.creator_response_deadline!);
    const policyCeiling = afterDefault + defaulted.workflow.revision_response_hours * 3_600_000;
    const hardCeilings = [defaulted.item.deadline, defaulted.workflow.deadline]
      .filter((value): value is string => typeof value === "string")
      .map(Date.parse);
    const expectedCeiling = Math.min(policyCeiling, ...hardCeilings);
    expect(defaultDeadline).toBeGreaterThan(beforeDefault);
    expect(defaultDeadline).toBeLessThanOrEqual(expectedCeiling + 1_000);

    const explicit = await seedLiveReview("revision-explicit");
    const stricterDeadline = new Date(Date.now() + 15 * 60_000).toISOString();
    const acceptedExplicit = await explicit.requestRevision(stricterDeadline);
    expect(acceptedExplicit.error).toBeNull();
    expect(acceptedExplicit.data).toMatchObject({ state: "revision_requested" });
    const explicitRound = await explicit.svc.from("mission_review_rounds")
      .select("creator_response_deadline")
      .eq("mission_work_item_id", explicit.item.id)
      .single();
    expect(explicitRound.error).toBeNull();
    expect(Date.parse(explicitRound.data!.creator_response_deadline!))
      .toBe(Date.parse(stricterDeadline));
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

  it("migrates only a pristine joined submission and records the explicit rollout event", async () => {
    const active = await seedActiveMission({
      email: "active-rollout-" + randomUUID() + "@test.local",
      slug: "test-active-rollout-" + randomUUID(),
      deliverables: [{ title: "Rollout reel", platform: "instagram" }],
    });
    const before = await creatorRewardSnapshot(active.creator.id);
    const svc = serviceForTests();

    const migrated = await svc.rpc("migrate_pristine_joined_active_mission", {
      p_submission: active.submission.id,
    });
    expect(migrated.error).toBeNull();
    expect(migrated.data).toMatchObject({
      mission_submission_id: active.submission.id,
      state: "drafting",
    });
    const events = await svc.from("mission_workflow_events")
      .select("event_type")
      .eq("mission_workflow_id", migrated.data.id);
    expect(events.error).toBeNull();
    expect(events.data).toEqual(expect.arrayContaining([
      { event_type: "workflow_created" },
      { event_type: "legacy_submission_migrated" },
    ]));
    expect(await creatorRewardSnapshot(active.creator.id)).toEqual(before);
  });

  it("rejects non-joined, content-bearing, reviewed, rewarded, and previously migrated submissions", async () => {
    const svc = serviceForTests();
    const seed = async (label: string) => seedActiveMission({
      email: `active-rollout-${label}-${randomUUID()}@test.local`,
      slug: `test-active-rollout-${label}-${randomUUID()}`,
      deliverables: [{ title: "Rollout post", platform: "instagram" }],
    });
    const expectWrongState = async (submissionId: string) => {
      const result = await svc.rpc("migrate_pristine_joined_active_mission", {
        p_submission: submissionId,
      });
      expect(result.error?.message.toLowerCase()).toContain("wrong_state");
    };

    for (const status of ["submitted", "under_review", "approved", "rejected", "declined", "expired"]) {
      const active = await seed(`status-${status}`);
      const changed = await svc.from("mission_submissions").update({ status }).eq("id", active.submission.id);
      expect(changed.error).toBeNull();
      await expectWrongState(active.submission.id);
    }

    const content = await seed("content");
    expect((await svc.from("mission_submissions").update({ content_urls: ["https://example.test/legacy"] })
      .eq("id", content.submission.id)).error).toBeNull();
    await expectWrongState(content.submission.id);

    const reward = await seed("reward");
    expect((await svc.from("mission_submissions").update({ points_awarded: 1 })
      .eq("id", reward.submission.id)).error).toBeNull();
    await expectWrongState(reward.submission.id);

    const priorReview = await seed("prior-review");
    expect((await svc.from("mission_submissions").update({ quality_rating: 4 })
      .eq("id", priorReview.submission.id)).error).toBeNull();
    await expectWrongState(priorReview.submission.id);

    const prior = await seed("prior-workflow");
    expect((await svc.rpc("create_mission_workflow", { p_submission: prior.submission.id })).error).toBeNull();
    await expectWrongState(prior.submission.id);
  });

  it("preserves legacy final approval and its existing points and XP rewards", async () => {
    const svc = serviceForTests();
    const creator = await makeCreator(`active-legacy-reward-${randomUUID()}@test.local`, 0);
    const mission = await makeMission({
      slug: `test-active-legacy-reward-${randomUUID()}`,
      points_reward: 321,
      cash_reward: 0,
    });
    const inserted = await svc.from("mission_submissions").insert({
      mission_id: mission.id,
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      status: "submitted",
      content_urls: ["https://example.test/legacy-final"],
      xp_awarded: 35,
      submitted_at: new Date().toISOString(),
    }).select("id").single();
    expect(inserted.error).toBeNull();
    const beforeSubmission = await svc.from("mission_submissions")
      .select("xp_awarded").eq("id", inserted.data!.id).single();
    expect(beforeSubmission.error).toBeNull();
    const before = await creatorRewardSnapshot(creator.userId);

    const approved = await svc.rpc("approve_submission", {
      p_submission: inserted.data!.id,
      p_notes: "Legacy approval remains the reward boundary",
      p_quality_rating: null,
    });
    expect(approved.error).toBeNull();
    expect(approved.data).toMatchObject({
      status: "approved", points_awarded: 321, xp_awarded: 135, quality_rating: null,
    });
    const after = await creatorRewardSnapshot(creator.userId);
    const afterSubmission = await svc.from("mission_submissions")
      .select("xp_awarded").eq("id", inserted.data!.id).single();
    expect(afterSubmission.error).toBeNull();
    expect(after.points - before.points).toBe(321);
    expect(after.xp - before.xp).toBe(100);
    expect(afterSubmission.data!.xp_awarded - beforeSubmission.data!.xp_awarded).toBe(100);
  });
});
