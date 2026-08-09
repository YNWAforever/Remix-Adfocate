import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CreatorStudioError } from "../lib/creatorStudio/errors.js";
import type { CreatorStudioMetricEvent } from "../lib/creatorStudio/metrics.js";
import { SupabaseCreatorStudioRepository } from "../lib/creatorStudio/supabaseRepository.js";
import type { Env } from "../app.js";
import { createCreatorStudioRoutes } from "../routes/creatorStudio.js";
import {
  DEMO_WS,
  cleanup,
  hasSupabaseEnv,
  makeCreator,
  makeMission,
  serviceForTests,
  userForJwt,
} from "./helpers.js";

const suite = hasSupabaseEnv ? describe : describe.skip;
const ownedStoragePaths = new Set<string>();
let sequence = 0;

const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function makeRouteApp(repository: SupabaseCreatorStudioRepository, creatorId: string, events: CreatorStudioMetricEvent[]) {
  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    c.set("userId", creatorId);
    c.set("workspaceId", DEMO_WS);
    c.set("jwt", "creator-studio-integration-jwt");
    await next();
  });
  app.route("/my-missions", createCreatorStudioRoutes({
    repositoryForRequest: () => repository,
    metricsSink: (event) => { events.push(event); },
  }));
  return app;
}

async function createJourney(options: { requiresAsset?: boolean } = {}) {
  sequence += 1;
  const suffix = `${Date.now()}-${sequence}`;
  const owner = await makeCreator(`creator-studio-owner-${suffix}@test.local`);
  const other = await makeCreator(`creator-studio-other-${suffix}@test.local`);
  const mission = await makeMission({ slug: `test-creator-studio-${suffix}` });
  const svc = serviceForTests();
  const { error: missionError } = await svc.from("missions").update({
    deliverables: ["Post", "Story"],
    requirements: ["caption", "external_url", "disclosure"],
    platforms: ["instagram"],
  }).eq("id", mission.id);
  if (missionError) throw missionError;
  const { data: submission, error: submissionError } = await svc.from("mission_submissions").insert({
    mission_id: mission.id,
    creator_id: owner.userId,
    workspace_id: DEMO_WS,
    status: "joined",
  }).select("id").single();
  if (submissionError) throw submissionError;

  const events: CreatorStudioMetricEvent[] = [];
  const repository = new SupabaseCreatorStudioRepository(userForJwt(owner.jwt), (event) => { events.push(event); });
  const context = { actorId: owner.userId, workspaceId: DEMO_WS, submissionId: submission.id as string };
  const workspace = await repository.getWorkspace(context);
  if (!workspace) throw new Error("Creator Studio workflow was not initialized for the joined test submission");
  if (options.requiresAsset !== false) {
    const { error } = await svc.from("mission_work_items").update({ requires_asset: true }).eq("id", workspace.workItems[0]!.id);
    if (error) throw error;
  }
  const refreshed = await repository.getWorkspace(context);
  if (!refreshed) throw new Error("Creator Studio workspace could not be refreshed");
  return { owner, other, repository, context, workspace: refreshed, events };
}

async function saveCompleteDraft(
  repository: SupabaseCreatorStudioRepository,
  context: { actorId: string; workspaceId: string; submissionId: string },
  workItemId: string,
  commandId: string,
) {
  return repository.saveDraft(context, workItemId, {
    commandId,
    expectedVersion: 0,
    patch: {
      caption: "Creator Studio integration caption",
      externalUrl: "https://example.com/creator-studio-integration",
      checklist: { disclosure: true },
    },
  });
}

async function finalizeRequiredAsset(
  journey: Awaited<ReturnType<typeof createJourney>>,
  workItemId: string,
  prefix: string,
) {
  const grant = await journey.repository.createUploadGrant(journey.context, workItemId, {
    commandId: `${prefix}-grant`, fileName: "proof.png", mimeType: "image/png", byteSize: 1,
  });
  ownedStoragePaths.add(grant.value.path);
  const { error: uploadError } = await userForJwt(journey.owner.jwt)
    .storage.from(grant.value.bucket).upload(grant.value.path, new Uint8Array([1]), { contentType: "image/png", upsert: false });
  if (uploadError) throw uploadError;
  return journey.repository.finalizeAsset(journey.context, workItemId, grant.value.assetId, {
    commandId: `${prefix}-finalize`, byteSize: 1, mimeType: "image/png", checksumSha256: null,
  });
}

suite("Creator Studio Supabase acceptance", () => {
  beforeEach(async () => { await cleanup(); });
  afterEach(async () => {
    if (ownedStoragePaths.size) {
      await serviceForTests().storage.from("creator-studio-assets").remove([...ownedStoragePaths]);
      ownedStoragePaths.clear();
    }
    await cleanup();
  });

  it("initializes one ordered workflow for a joined submission", async () => {
    const journey = await createJourney();
    const { data: workflows, error } = await serviceForTests().from("mission_workflows")
      .select("id").eq("mission_submission_id", journey.context.submissionId);
    if (error) throw error;

    expect(workflows).toHaveLength(1);
    expect(journey.workspace.workItems.map((item) => item.position)).toEqual([1, 2]);
  });

  it("keeps workspace reads and writes owner-scoped", async () => {
    const journey = await createJourney();
    const otherRepository = new SupabaseCreatorStudioRepository(userForJwt(journey.other.jwt));
    const otherContext = { ...journey.context, actorId: journey.other.userId };

    await expect(otherRepository.getWorkspace(otherContext)).resolves.toBeNull();
    await expect(otherRepository.saveDraft(otherContext, journey.workspace.workItems[0]!.id, {
      commandId: "cross-owner-draft", expectedVersion: 0, patch: { caption: "must not write" },
    })).rejects.toMatchObject({ code: "submission_not_found" });
  });

  it("writes one draft, version, command, workflow event, and privacy-safe metric", async () => {
    const journey = await createJourney();
    const item = journey.workspace.workItems[0]!;
    const result = await saveCompleteDraft(journey.repository, journey.context, item.id, "draft-once");
    const app = makeRouteApp(journey.repository, journey.owner.userId, journey.events);
    await app.request(`/my-missions/${journey.context.submissionId}/workspace`);

    expect(result.replayed).toBe(false);
    for (const table of ["mission_working_drafts", "mission_draft_versions", "mission_workflow_commands"]) {
      const { data, error } = await serviceForTests().from(table).select("id").eq("mission_submission_id", journey.context.submissionId);
      if (error) throw error;
      expect(data).toHaveLength(1);
    }
    const { data: draftEvents, error: draftEventsError } = await serviceForTests().from("mission_workflow_events")
      .select("id").eq("mission_submission_id", journey.context.submissionId).eq("event_type", "draft_saved");
    if (draftEventsError) throw draftEventsError;
    expect(draftEvents).toHaveLength(1);
    expect(journey.events).toContainEqual(expect.objectContaining({
      name: "draft_saved", workspaceId: DEMO_WS, submissionId: journey.context.submissionId, workItemId: item.id, commandId: "draft-once",
    }));
    expect(JSON.stringify(journey.events)).not.toContain("Creator Studio integration caption");
  });

  it("replays an identical command without duplicate rows or metrics", async () => {
    const journey = await createJourney();
    const item = journey.workspace.workItems[0]!;
    const first = await saveCompleteDraft(journey.repository, journey.context, item.id, "replay-draft");
    const replay = await saveCompleteDraft(journey.repository, journey.context, item.id, "replay-draft");
    const { data: versions, error } = await serviceForTests().from("mission_draft_versions")
      .select("id").eq("mission_work_item_id", item.id);
    if (error) throw error;
    const { data: commands, error: commandsError } = await serviceForTests().from("mission_workflow_commands")
      .select("id").eq("mission_submission_id", journey.context.submissionId);
    if (commandsError) throw commandsError;
    const { data: workflowEvents, error: workflowEventsError } = await serviceForTests().from("mission_workflow_events")
      .select("id").eq("mission_submission_id", journey.context.submissionId);
    if (workflowEventsError) throw workflowEventsError;

    expect(replay).toEqual({ ...first, replayed: true });
    expect(versions).toHaveLength(1);
    expect(commands).toHaveLength(1);
    expect(workflowEvents).toHaveLength(1);
    expect(journey.events.filter((event) => event.name === "draft_saved")).toHaveLength(1);
  });

  it("rejects a changed payload that reuses a command id", async () => {
    const journey = await createJourney();
    const item = journey.workspace.workItems[0]!;
    await saveCompleteDraft(journey.repository, journey.context, item.id, "conflicting-draft");

    await expect(journey.repository.saveDraft(journey.context, item.id, {
      commandId: "conflicting-draft", expectedVersion: 0, patch: { caption: "changed content" },
    })).rejects.toBeInstanceOf(CreatorStudioError);
    await expect(journey.repository.saveDraft(journey.context, item.id, {
      commandId: "conflicting-draft", expectedVersion: 0, patch: { caption: "changed content" },
    })).rejects.toMatchObject({ code: "command_conflict" });

    const directRpcWorkItem = journey.workspace.workItems[1]!;
    const forgedRequestHash = "caller-controlled-hash-must-not-authorize-replay";
    const { data: directRpcResult, error: directRpcCreateError } = await userForJwt(journey.owner.jwt).rpc("creator_studio_save_draft", {
      p_submission_id: journey.context.submissionId,
      p_workspace_id: journey.context.workspaceId,
      p_work_item_id: directRpcWorkItem.id,
      p_command_id: "direct-rpc-conflicting-draft",
      p_request_hash: forgedRequestHash,
      p_expected_version: 0,
      p_patch: { caption: "direct RPC original payload" },
    });
    expect(directRpcCreateError).toBeNull();
    expect(directRpcResult).toMatchObject({ replayed: false });

    const { error: directRpcConflictError } = await userForJwt(journey.owner.jwt).rpc("creator_studio_save_draft", {
      p_submission_id: journey.context.submissionId,
      p_workspace_id: journey.context.workspaceId,
      p_work_item_id: directRpcWorkItem.id,
      p_command_id: "direct-rpc-conflicting-draft",
      p_request_hash: forgedRequestHash,
      p_expected_version: 0,
      p_patch: { caption: "direct RPC changed payload" },
    });
    expect(directRpcConflictError?.message).toContain("command_conflict");
  });

  it("rejects finalization when stored object metadata size differs from the reservation", async () => {
    const journey = await createJourney();
    const item = journey.workspace.workItems[0]!;
    const grant = await journey.repository.createUploadGrant(journey.context, item.id, {
      commandId: "metadata-mismatch-grant", fileName: "metadata-mismatch.png", mimeType: "image/png", byteSize: 2,
    });
    ownedStoragePaths.add(grant.value.path);
    const { error: uploadError } = await userForJwt(journey.owner.jwt)
      .storage.from(grant.value.bucket).upload(grant.value.path, new Uint8Array([1]), { contentType: "image/png", upsert: false });
    if (uploadError) throw uploadError;

    await expect(journey.repository.finalizeAsset(journey.context, item.id, grant.value.assetId, {
      commandId: "metadata-mismatch-finalize", byteSize: 2, mimeType: "image/png", checksumSha256: null,
    })).rejects.toMatchObject({ code: "asset_not_uploaded" });

    const { data: asset, error: assetError } = await serviceForTests().from("mission_draft_assets")
      .select("upload_state").eq("id", grant.value.assetId).single();
    if (assetError) throw assetError;
    expect(asset.upload_state).toBe("pending");
  });

  it("submits a complete finalized deliverable and rejects missing prerequisites", async () => {
    const journey = await createJourney();
    const item = journey.workspace.workItems[0]!;
    await expect(journey.repository.submitWorkItem(journey.context, item.id, {
      commandId: "missing-prerequisites", expectedVersion: 0,
    })).rejects.toMatchObject({ code: "invalid_transition" });

    const draft = await saveCompleteDraft(journey.repository, journey.context, item.id, "submit-draft");
    await finalizeRequiredAsset(journey, item.id, "submit-asset");
    await expect(journey.repository.submitWorkItem(journey.context, item.id, {
      commandId: "submit-complete", expectedVersion: draft.value.draft.version,
    })).resolves.toMatchObject({ value: { workItem: { state: "submitted" } } });
  });

  it("allows resubmission after changes and locks approved work to creator commands", async () => {
    const journey = await createJourney();
    const item = journey.workspace.workItems[0]!;
    const draft = await saveCompleteDraft(journey.repository, journey.context, item.id, "review-draft");
    await finalizeRequiredAsset(journey, item.id, "review-asset");
    await journey.repository.submitWorkItem(journey.context, item.id, { commandId: "initial-submit", expectedVersion: draft.value.draft.version });
    const svc = serviceForTests();
    const { data: workflow, error: workflowError } = await svc.from("mission_workflows").select("id").eq("mission_submission_id", journey.context.submissionId).single();
    if (workflowError) throw workflowError;
    const { data: round, error: roundError } = await svc.from("mission_review_rounds").insert({
      mission_workflow_id: workflow.id, mission_submission_id: journey.context.submissionId, creator_id: journey.owner.userId, workspace_id: DEMO_WS, outcome: "changes_requested",
    }).select("id").single();
    if (roundError) throw roundError;
    const { error: reviewError } = await svc.from("mission_review_items").insert({
      mission_review_round_id: round.id, mission_work_item_id: item.id, mission_workflow_id: workflow.id,
      mission_submission_id: journey.context.submissionId, creator_id: journey.owner.userId, workspace_id: DEMO_WS,
      outcome: "changes_requested", message: "Please revise",
    });
    if (reviewError) throw reviewError;
    const { error: changeError } = await svc.from("mission_work_items").update({ state: "changes_requested" }).eq("id", item.id);
    if (changeError) throw changeError;

    await expect(journey.repository.submitWorkItem(journey.context, item.id, {
      commandId: "resubmit", expectedVersion: draft.value.draft.version,
    })).resolves.toMatchObject({ value: { workItem: { state: "resubmitted" } } });
    const { error: approvalError } = await svc.from("mission_work_items").update({ state: "approved" }).eq("id", item.id);
    if (approvalError) throw approvalError;
    await expect(journey.repository.saveDraft(journey.context, item.id, {
      commandId: "approved-write", expectedVersion: draft.value.draft.version, patch: { caption: "locked" },
    })).rejects.toMatchObject({ code: "invalid_transition" });
  });

  it("keeps ordinary deliverable assets out of the publication-proof lane", async () => {
    const journey = await createJourney();
    const item = journey.workspace.workItems[0]!;
    const proofFixturePath = `${journey.owner.userId}/${journey.workspace.workflow.id}/${item.id}/proof-evidence/00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}.png`;
    const { error: proofFixtureError } = await serviceForTests().rpc("create_publication_proof_asset", {
      p_submission: journey.context.submissionId,
      p_creator: journey.owner.userId,
      p_workspace: DEMO_WS,
      p_work_item: item.id,
      p_filename: "publication-proof.png",
      p_mime_type: "image/png",
      p_byte_size: 1,
      p_storage_object_path: proofFixturePath,
    });
    if (proofFixtureError) throw proofFixtureError;
    const grant = await journey.repository.createUploadGrant(journey.context, item.id, {
      commandId: "ordinary-asset", fileName: "ordinary.png", mimeType: "image/png", byteSize: 1,
    });
    const proofWritePath = `${journey.owner.userId}/${journey.workspace.workflow.id}/${item.id}/proof-evidence/not-ordinary.png`;
    const { error: proofWriteError } = await userForJwt(journey.owner.jwt)
      .storage.from("mission-publication-proof-assets").upload(proofWritePath, new Uint8Array([1]), { contentType: "image/png", upsert: false });
    const projectedWorkspace = await journey.repository.getWorkspace(journey.context);
    if (!projectedWorkspace) throw new Error("Creator Studio workspace disappeared while checking publication-proof isolation");

    expect(grant.value.bucket).toBe("creator-studio-assets");
    expect(grant.value.path).not.toContain("proof-evidence");
    expect(projectedWorkspace.workItems.find((workItem) => workItem.id === item.id)?.assets)
      .not.toContainEqual(expect.objectContaining({ storagePath: proofFixturePath }));
    expect(proofWriteError).toBeTruthy();
    await expect(journey.repository.finalizeAsset(journey.context, item.id, "publication-proof-asset", {
      commandId: "ordinary-finalize-proof", byteSize: 1, mimeType: "image/png", checksumSha256: null,
    })).rejects.toMatchObject({ code: "asset_not_found" });
  });
});
