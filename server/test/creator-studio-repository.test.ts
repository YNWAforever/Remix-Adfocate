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
    const finalized = await repository.finalizeAsset(context, "work-item-2", grant.value.assetId, {
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

  it("rejects a submit without changing the workspace, event log, draft, or command ledger", async () => {
    const workspace = makeWorkspace();
    const workItem = workspace.workItems[0];
    workItem.state = "drafting";
    workItem.draft = {
      caption: "Complete launch copy",
      externalUrl: "https://example.com/post",
      checklist: { disclosure: true, brandTag: true },
      version: 0,
      updatedAt: "2026-08-09T00:00:00.000Z",
    };
    const repository = new InMemoryCreatorStudioRepository({ workspace });
    const context = creatorContext();
    const before = {
      workspace: await repository.getWorkspace(context),
      events: repository.events(),
      draft: repository.getDraft(workItem.id),
    };

    await expect(repository.submitWorkItem(context, workItem.id, {
      commandId: "rejected-submit-command",
      expectedVersion: 0,
    })).rejects.toMatchObject({ code: "invalid_transition" });

    expect({
      workspace: await repository.getWorkspace(context),
      events: repository.events(),
      draft: repository.getDraft(workItem.id),
    }).toEqual(before);
    await expect(repository.saveDraft(context, workItem.id, {
      commandId: "rejected-submit-command",
      expectedVersion: 0,
      patch: { caption: "Corrected launch copy" },
    })).resolves.toMatchObject({ replayed: false, value: { draft: { version: 1 } } });
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
    const finalized = await repository.finalizeAsset(context, "work-item-1", grant.value.assetId, {
      commandId: "finalization-command",
      byteSize: 1024,
      mimeType: "image/jpeg",
      checksumSha256: null,
    });

    expect(drafted.value.workItem.state).toBe("drafting");
    expect(finalized.value.workItem.state).toBe("ready_to_submit");
    expect(finalized.value.workflow.state).toBe("changes_requested");
  });

  it("returns the exact server-generated upload grant contract", async () => {
    const repository = makeRepository();
    const grant = await repository.createUploadGrant(creatorContext(), "work-item-1", {
      commandId: "path-grant",
      fileName: "..\\untrusted/name.JPG",
      mimeType: "image/jpeg",
      byteSize: 1024,
    });

    expect(grant.value).toEqual({
      bucket: "creator-studio-assets",
      path: "creator-1/workflow-1/work-item-1/asset-1.jpg",
      token: "memory-upload-token-asset-1",
      assetId: "asset-1",
      expiresAt: expect.any(String),
    });
    expect(grant.value.path).not.toContain("untrusted");
    expect(new Date(grant.value.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("accepts video/mp4 at the 50 MiB upload limit without allocating upload bytes", async () => {
    const repository = makeRepository();
    const maxUploadBytes = 50 * 1024 * 1024;

    const grant = await repository.createUploadGrant(creatorContext(), "work-item-1", {
      commandId: "video-max-size-grant",
      fileName: "launch-reel.mp4",
      mimeType: "video/mp4",
      byteSize: maxUploadBytes,
    });

    expect(grant.value).toMatchObject({
      bucket: "creator-studio-assets",
      path: "creator-1/workflow-1/work-item-1/asset-1.mp4",
      assetId: "asset-1",
    });
  });

  it("rejects unsupported MIME types and byte sizes above the 50 MiB upload limit", async () => {
    const repository = makeRepository();
    const maxUploadBytes = 50 * 1024 * 1024;

    await expect(repository.createUploadGrant(creatorContext(), "work-item-1", {
      commandId: "unsupported-mime-grant",
      fileName: "launch-reel.mov",
      mimeType: "video/quicktime",
      byteSize: 1024,
    })).rejects.toMatchObject({ code: "file_not_allowed" });
    await expect(repository.createUploadGrant(creatorContext(), "work-item-1", {
      commandId: "over-limit-grant",
      fileName: "launch.jpg",
      mimeType: "image/jpeg",
      byteSize: maxUploadBytes + 1,
    })).rejects.toMatchObject({ code: "file_too_large" });

    expect(repository.events()).toEqual([]);
  });

  it.each(["submitted", "resubmitted", "approved"] as const)("rejects asset reservations and finalization for %s work without changing it", async (state) => {
    const workspace = makeWorkspace();
    const workItem = workspace.workItems[0];
    workItem.state = state;
    workItem.assets = [{
      id: "pending-asset",
      fileName: "pending.jpg",
      mimeType: "image/jpeg",
      byteSize: 1024,
      checksumSha256: null,
      state: "pending",
      storagePath: "creator-1/workflow-1/work-item-1/pending-asset.jpg",
    }];
    workspace.workflow.state = state;
    workspace.nextAction = { workItemId: workItem.id, state, label: `Await review for ${workItem.title}` };
    const repository = new InMemoryCreatorStudioRepository({ workspace });
    const context = creatorContext();
    const before = await repository.getWorkspace(context);

    await expect(repository.createUploadGrant(context, workItem.id, {
      commandId: `locked-grant-${state}`,
      fileName: "late.jpg",
      mimeType: "image/jpeg",
      byteSize: 1024,
    })).rejects.toMatchObject({ code: "invalid_transition" });
    await expect(repository.finalizeAsset(context, workItem.id, "pending-asset", {
      commandId: `locked-finalize-${state}`,
      byteSize: 1024,
      mimeType: "image/jpeg",
      checksumSha256: null,
    })).rejects.toMatchObject({ code: "invalid_transition" });

    expect(await repository.getWorkspace(context)).toEqual(before);
    expect(repository.events()).toEqual([]);
  });

  it("rejects non-JSON commands before any mutation and leaves the command id reusable", async () => {
    const context = creatorContext();
    const invalidPatches: unknown[] = [
      { caption: undefined },
      { caption: () => "not JSON" },
    ];
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    invalidPatches.push({ checklist: cyclic });

    for (const [index, patch] of invalidPatches.entries()) {
      const repository = makeRepository();
      const commandId = `invalid-command-${index}`;
      const before = await repository.getWorkspace(context);

      await expect(repository.saveDraft(context, "work-item-1", {
        commandId,
        expectedVersion: 0,
        patch,
      } as unknown as SaveDraftInput)).rejects.toThrow("JSON serializable");

      expect(repository.getDraft("work-item-1")).toBeUndefined();
      expect(repository.events()).toEqual([]);
      expect(await repository.getWorkspace(context)).toEqual(before);

      await expect(repository.saveDraft(context, "work-item-1", {
        commandId,
        expectedVersion: 0,
        patch: { caption: "Valid after rejection" },
      })).resolves.toMatchObject({ replayed: false, value: { draft: { version: 1 } } });
    }
  });
});
