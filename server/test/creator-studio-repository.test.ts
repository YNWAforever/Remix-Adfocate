import { describe, expect, it } from "vitest";
import { InMemoryCreatorStudioRepository } from "../lib/creatorStudio/inMemoryRepository.js";
import type { CreatorStudioContext, SaveDraftInput, SubmissionWorkspace } from "../lib/creatorStudio/types.js";

const creatorContext = (): CreatorStudioContext => ({
  actorId: "creator-1",
  workspaceId: "workspace-1",
  submissionId: "submission-1",
});

const makeWorkspace = (creatorId = "creator-1"): SubmissionWorkspace => ({
  submission: { id: "submission-1", creatorId, workspaceId: "workspace-1", missionId: "mission-1", status: "joined" },
  brief: { missionId: "mission-1", title: "Launch mission", deliverables: ["Story", "Reel"], requirements: ["Disclosure"], platforms: ["instagram"] },
  workflow: { id: "workflow-1", state: "not_started", revision: 0 },
  workItems: [
    {
      id: "work-item-1", position: 1, title: "Story", instructions: "Create a story", requirements: { caption: true, externalUrl: true, checklist: ["disclosure", "brandTag"] }, requiresAsset: false,
      state: "not_started", validation: { caption: false, externalUrl: false, checklist: false, assets: true }, draft: null, assets: [],
      reviewFeedback: { status: "available", value: [] },
    },
    {
      id: "work-item-2", position: 2, title: "Reel", instructions: "Create a reel", requirements: { caption: true, externalUrl: false, checklist: [] }, requiresAsset: true,
      state: "changes_requested", validation: { caption: false, externalUrl: true, checklist: true, assets: false }, draft: null, assets: [],
      reviewFeedback: { status: "available", value: [{ id: "review-item-1", state: "changes_requested", message: "Add a clearer disclosure" }] },
    },
  ],
  nextAction: { workItemId: "work-item-1", state: "not_started", label: "Start Story" },
});

const makeRepository = (options: { creatorId?: string } = {}) => new InMemoryCreatorStudioRepository({
  workspace: makeWorkspace(options.creatorId),
});

describe("InMemoryCreatorStudioRepository", () => {
  it("creates a draft, advances the item to ready_to_submit, and replays the same command", async () => {
    const repository = makeRepository();
    const context = creatorContext();
    const input = {
      commandId: "draft-command-1",
      expectedVersion: 0,
      patch: {
        caption: "Launch copy",
        externalUrl: "https://example.com/post",
        checklist: { disclosure: true, brandTag: true },
      },
    } satisfies SaveDraftInput;

    const first = await repository.saveDraft(context, "work-item-1", input);
    const replay = await repository.saveDraft(context, "work-item-1", input);

    expect(first.replayed).toBe(false);
    expect(replay).toEqual({ ...first, replayed: true });
    expect(first.value.draft.version).toBe(1);
    expect(first.value.workItem.state).toBe("ready_to_submit");
    expect(repository.events()).toHaveLength(1);
    await expect(repository.getWorkspace(context)).resolves.toMatchObject({
      nextAction: { workItemId: "work-item-1", state: "ready_to_submit", label: "Submit Story" },
    });
  });

  it("rejects a changed payload that reuses a command id without changing state", async () => {
    const repository = makeRepository();
    const context = creatorContext();
    const input = { commandId: "same-command", expectedVersion: 0, patch: { caption: "First" } } satisfies SaveDraftInput;

    await repository.saveDraft(context, "work-item-1", input);
    await expect(repository.saveDraft(context, "work-item-1", {
      ...input,
      patch: { caption: "Different" },
    })).rejects.toMatchObject({ code: "command_conflict" });
    expect(repository.getDraft("work-item-1")?.caption).toBe("First");
  });

  it("rejects a command for the exact submission when the creator does not own it", async () => {
    const repository = makeRepository();
    const mismatchedCreator = { ...creatorContext(), actorId: "other-creator" };
    await expect(repository.getWorkspace(mismatchedCreator)).resolves.toBeNull();
    await expect(repository.saveDraft(mismatchedCreator, "work-item-1", {
      commandId: "cross-owner",
      expectedVersion: 0,
      patch: { caption: "Must not write" },
    })).rejects.toMatchObject({ code: "submission_not_found" });
  });

  it("resubmits a changed-request work item after editing and completing its required asset", async () => {
    const repository = makeRepository();
    const context = creatorContext();

    const edited = await repository.saveDraft(context, "work-item-2", {
      commandId: "revision-edit",
      expectedVersion: 0,
      patch: { caption: "Updated reel copy" },
    });
    const grant = await repository.createUploadGrant(context, "work-item-2", {
      commandId: "revision-asset-grant",
      fileName: "updated-reel.jpg",
      mimeType: "image/jpeg",
      byteSize: 1024,
    });
    const finalized = await repository.finalizeAsset(context, "work-item-2", grant.value.asset.id, {
      commandId: "revision-asset-finalize",
      byteSize: 1024,
      mimeType: "image/jpeg",
      checksumSha256: null,
    });
    const resubmitted = await repository.submitWorkItem(context, "work-item-2", {
      commandId: "revision-resubmit",
      expectedVersion: 1,
    });

    expect(edited.value.workItem.state).toBe("changes_requested");
    expect(finalized.value.workItem.state).toBe("changes_requested");
    expect(resubmitted.value.workItem.state).toBe("resubmitted");
  });

  it("makes a complete draft submittable when its required asset is finalized", async () => {
    const workspace = makeWorkspace();
    workspace.workItems[0].requiresAsset = true;
    workspace.workItems[0].validation.assets = false;
    const repository = new InMemoryCreatorStudioRepository({ workspace });
    const context = creatorContext();

    const drafted = await repository.saveDraft(context, "work-item-1", {
      commandId: "draft-before-finalization",
      expectedVersion: 0,
      patch: {
        caption: "Launch copy",
        externalUrl: "https://example.com/post",
        checklist: { disclosure: true, brandTag: true },
      },
    });
    const grant = await repository.createUploadGrant(context, "work-item-1", {
      commandId: "finalization-grant",
      fileName: "launch.jpg",
      mimeType: "image/jpeg",
      byteSize: 1024,
    });
    const finalized = await repository.finalizeAsset(context, "work-item-1", grant.value.asset.id, {
      commandId: "finalization-command",
      byteSize: 1024,
      mimeType: "image/jpeg",
      checksumSha256: null,
    });

    expect(drafted.value.workItem.state).toBe("drafting");
    expect(finalized.value.workItem.state).toBe("ready_to_submit");
    expect(finalized.value.workflow.state).toBe("ready_to_submit");
  });

  it("uses a server-controlled asset path with an allowlisted extension", async () => {
    const repository = makeRepository();
    const grant = await repository.createUploadGrant(creatorContext(), "work-item-1", {
      commandId: "path-grant",
      fileName: "..\\untrusted/name.JPG",
      mimeType: "image/jpeg",
      byteSize: 1024,
    });

    expect(grant.value.asset.storagePath).toBe("creator-1/workflow-1/work-item-1/asset-1.jpg");
    expect(grant.value.asset.storagePath).not.toContain("untrusted");
  });
});
