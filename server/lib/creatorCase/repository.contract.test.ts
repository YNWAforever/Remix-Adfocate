import { describe, expect, it } from "vitest";
import type { CreatorCaseReadModel } from "./types";
import { CreatorCaseError } from "./errors";
import { InMemoryCreatorCaseRepository } from "./inMemoryRepository";

const makeCase = (
  overrides: Partial<CreatorCaseReadModel["creator"]> = {},
): CreatorCaseReadModel => ({
  creator: {
    id: "creator-default",
    workspaceId: "workspace-default",
    displayName: "Ada Creator",
    avatarUrl: null,
    level: "rising",
    categories: ["video"],
    scores: { trust: 80 },
    socialHandles: {},
    createdAt: "2026-08-08T00:00:00.000Z",
    ...overrides,
  },
  review: {
    status: "needs_review",
    riskLevel: "unknown",
    summary: null,
    reviewedBy: null,
    lastReviewedAt: null,
    updatedAt: null,
  },
  notes: [],
  audit: [],
  social: { status: "unavailable", reason: "not_configured" },
  profile: { status: "unavailable", reason: "not_configured" },
  missionHistory: { status: "unavailable", reason: "not_configured" },
});

const context = {
  workspaceId: "workspace-1",
  actorId: "operator-1",
  actorLabel: "Operator",
  commandId: "command-1",
};

const approvedCommand = {
  creatorId: "creator-1",
  status: "approved" as const,
  riskLevel: "low" as const,
  summary: "Strong fit",
  note: { category: "other" as const, body: "Prior delivery was on brief." },
};

describe("InMemoryCreatorCaseRepository contract", () => {
  it("commits review, optional note, and audit as one logical command", async () => {
    const repo = new InMemoryCreatorCaseRepository({
      cases: [makeCase({ creatorId: "creator-1", workspaceId: "workspace-1" })],
    });

    const result = await repo.applyReview(context, approvedCommand);

    expect(result.review).toMatchObject({ status: "approved", riskLevel: "low", summary: "Strong fit" });
    expect(result.notes).toHaveLength(1);
    expect(result.audit.map((event) => event.eventType).sort()).toEqual([
      "creator_note.created",
      "creator_review.updated",
    ]);
  });

  it("rejects a workspace mismatch without changing the case", async () => {
    const repo = new InMemoryCreatorCaseRepository({ cases: [makeCase({ creatorId: "creator-1", workspaceId: "workspace-2" })] });

    await expect(repo.applyReview(context, approvedCommand)).rejects.toMatchObject({ code: "workspace_mismatch" });
    await expect(repo.getCase(context, "creator-1")).rejects.toMatchObject({ code: "workspace_mismatch" });
  });

  it("rejects a missing Creator", async () => {
    const repo = new InMemoryCreatorCaseRepository({ cases: [] });

    await expect(repo.applyReview(context, approvedCommand)).rejects.toMatchObject({ code: "creator_not_found" });
  });

  it("requires a note for flagged reviews", async () => {
    const repo = new InMemoryCreatorCaseRepository({ cases: [makeCase({ creatorId: "creator-1", workspaceId: "workspace-1" })] });

    await expect(repo.applyReview(context, { ...approvedCommand, status: "flagged", note: null })).rejects.toMatchObject({ code: "flagged_review_note_required" });
  });

  it("returns the stored result for an identical same-command replay", async () => {
    const repo = new InMemoryCreatorCaseRepository({ cases: [makeCase({ creatorId: "creator-1", workspaceId: "workspace-1" })] });

    const first = await repo.applyReview(context, approvedCommand);
    const replay = await repo.applyReview(context, approvedCommand);

    expect(replay).toEqual(first);
    expect(replay).not.toBe(first);
    expect(replay.notes).toHaveLength(1);
    expect(replay.audit).toHaveLength(2);
  });

  it("rejects a conflicting replay with the same command id", async () => {
    const repo = new InMemoryCreatorCaseRepository({ cases: [makeCase({ creatorId: "creator-1", workspaceId: "workspace-1" })] });

    await repo.applyReview(context, approvedCommand);
    await expect(repo.applyReview(context, { ...approvedCommand, summary: "Different" })).rejects.toMatchObject({ code: "command_conflict" });
  });

  it("appends a note without changing the review", async () => {
    const repo = new InMemoryCreatorCaseRepository({ cases: [makeCase({ creatorId: "creator-1", workspaceId: "workspace-1" })] });

    const result = await repo.appendNote({ ...context, commandId: "note-command-1" }, {
      creatorId: "creator-1",
      category: "fit",
      body: "Good audience fit.",
    });

    expect(result.review.status).toBe("needs_review");
    expect(result.notes).toHaveLength(1);
    expect(result.audit.map((event) => event.eventType)).toEqual(["creator_note.created"]);
  });

  it.each(["after_review", "after_note", "after_audit"] as const)("discards all state after strict-core failure at %s", async (failurePoint) => {
    const repo = new InMemoryCreatorCaseRepository({
      cases: [makeCase({ creatorId: "creator-1", workspaceId: "workspace-1" })],
      failurePoint,
    });

    await expect(repo.applyReview(context, approvedCommand)).rejects.toThrow("in-memory failure");
    const current = await repo.getCase(context, "creator-1");
    expect(current.review.status).toBe("needs_review");
    expect(current.notes).toEqual([]);
    expect(current.audit).toEqual([]);
  });

  it("returns unavailable for every optional enrichment", async () => {
    const repo = new InMemoryCreatorCaseRepository({ cases: [makeCase({ creatorId: "creator-1", workspaceId: "workspace-1" })] });

    const result = await repo.getCase(context, "creator-1");

    expect(result.social.status).toBe("unavailable");
    expect(result.profile.status).toBe("unavailable");
    expect(result.missionHistory.status).toBe("unavailable");
  });

  it("rejects invalid strict-core values before mutating state", async () => {
    const repo = new InMemoryCreatorCaseRepository({ cases: [makeCase({ creatorId: "creator-1", workspaceId: "workspace-1" })] });

    await expect(repo.applyReview(context, { ...approvedCommand, status: "bad" as never })).rejects.toMatchObject({ code: "bad_review_status" });
    await expect(repo.getCase(context, "creator-1")).resolves.toMatchObject({ review: { status: "needs_review" } });
  });

  it("exposes CreatorCaseError codes for validation failures", async () => {
    const repo = new InMemoryCreatorCaseRepository({ cases: [makeCase({ creatorId: "creator-1", workspaceId: "workspace-1" })] });

    try {
      await repo.applyReview({ ...context, workspaceId: "" }, approvedCommand);
    } catch (error) {
      expect(error).toBeInstanceOf(CreatorCaseError);
      expect((error as CreatorCaseError).code).toBe("workspace_required");
    }
  });
});
