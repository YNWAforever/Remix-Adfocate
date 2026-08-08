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

  it("does not disclose a work item owned by another creator", async () => {
    const repository = makeRepository({ creatorId: "other-creator" });
    await expect(repository.getWorkspace(creatorContext())).resolves.toBeNull();
    await expect(repository.saveDraft(creatorContext(), "work-item-1", {
      commandId: "cross-owner",
      expectedVersion: 0,
      patch: { caption: "Must not write" },
    })).rejects.toMatchObject({ code: "submission_not_found" });
  });
});
