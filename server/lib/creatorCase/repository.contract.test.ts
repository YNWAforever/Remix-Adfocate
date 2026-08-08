import { describe, expect, it } from "vitest";
import type { CreatorCaseReadModel } from "./types";
import { CreatorCaseError } from "./errors";
import { InMemoryCreatorCaseRepository } from "./inMemoryRepository";
import { newestRowsByCreator } from "./supabaseRepository";
import { getProfileMediaForWorkspace } from "../profileMedia/repo";

const makeCase = (
  overrides: Partial<CreatorCaseReadModel["creator"]> = {},
  caseOverrides: Partial<Omit<CreatorCaseReadModel, "creator">> = {},
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
  ...caseOverrides,
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
  it("keeps the first newest shortlist row for a creator", () => {
    const shortlists = newestRowsByCreator([
      { creator_id: "creator-1", updated_at: "2026-08-10T00:00:00.000Z" },
      { creator_id: "creator-1", updated_at: "2026-08-03T00:00:00.000Z" },
    ]);

    expect(shortlists.get("creator-1")?.updated_at).toBe("2026-08-10T00:00:00.000Z");
  });

  it("requires a workspace for the workspace-scoped profile-media reader", async () => {
    await expect(getProfileMediaForWorkspace({} as never, "creator-1", "")).rejects.toMatchObject({
      code: "db_error",
    });
  });

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

  it.each([
    ["workspaceId", "", "workspace_required"],
    ["workspaceId", "   ", "workspace_required"],
    ["actorId", "", "actor_required"],
    ["actorId", " \t", "actor_required"],
    ["actorLabel", "", "actor_label_required"],
    ["actorLabel", "  ", "actor_label_required"],
  ] as const)("rejects blank %s before reading case data", async (field, value, code) => {
    const repo = new InMemoryCreatorCaseRepository({ cases: [] });
    const invalidContext = { ...context, [field]: value };

    await expect(repo.getCase(invalidContext, "creator-1")).rejects.toMatchObject({ code });
    await expect(repo.listReviewQueue(invalidContext, { page: 1, pageSize: 25, sort: "last_activity" })).rejects.toMatchObject({ code });
  });

  it.each([
    ["workspaceId", "", "workspace_required"],
    ["actorId", "", "actor_required"],
    ["actorLabel", "", "actor_label_required"],
    ["commandId", "", "command_required"],
    ["commandId", "  ", "command_required"],
  ] as const)("rejects invalid command context %s before data access", async (field, value, code) => {
    const repo = new InMemoryCreatorCaseRepository({ cases: [] });
    const invalidContext = { ...context, [field]: value };

    await expect(repo.applyReview(invalidContext, approvedCommand)).rejects.toMatchObject({ code });
    await expect(repo.appendNote(invalidContext, { creatorId: "creator-1", category: "other", body: "Note" })).rejects.toMatchObject({ code });
  });

  it("maps a missing commandId to command_required before data access", async () => {
    const repo = new InMemoryCreatorCaseRepository({ cases: [] });
    const { commandId: _commandId, ...missingCommandId } = context;

    await expect(repo.applyReview(missingCommandId as never, approvedCommand)).rejects.toMatchObject({ code: "command_required" });
    await expect(repo.appendNote(missingCommandId as never, { creatorId: "creator-1", category: "other", body: "Note" })).rejects.toMatchObject({ code: "command_required" });
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

  it("replays an equivalent command when object properties were inserted in a different order", async () => {
    const repo = new InMemoryCreatorCaseRepository({ cases: [makeCase({ creatorId: "creator-1", workspaceId: "workspace-1" })] });
    const reorderedContext = {
      commandId: context.commandId,
      actorLabel: context.actorLabel,
      actorId: context.actorId,
      workspaceId: context.workspaceId,
    };
    const reorderedCommand = {
      note: approvedCommand.note,
      summary: approvedCommand.summary,
      riskLevel: approvedCommand.riskLevel,
      status: approvedCommand.status,
      creatorId: approvedCommand.creatorId,
    };

    const first = await repo.applyReview(context, approvedCommand);
    const replay = await repo.applyReview(reorderedContext, reorderedCommand);

    expect(replay).toEqual(first);
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
    expect(result.insertedNote).toEqual(result.notes[0]);
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

  it.each(["social", "profile"] as const)("keeps queue rows readable when the %s reader fails", async (failedEnrichment) => {
    const repo = new InMemoryCreatorCaseRepository({
      cases: [makeCase({ creatorId: "creator-1", workspaceId: "workspace-1" }, {
        social: { status: "available", value: { accounts: [], summary: { platforms: ["instagram"], syncStatus: "synced", followerCount: 100, engagementRate: 2, apiSyncedAt: "2026-08-09T00:00:00.000Z", label: "API-synced", ownershipLabel: "Ownership not verified" } } },
        profile: { status: "available", value: { avatarUrl: null, portfolioLinks: [], publicHighlights: [], published: {}, completeness: { score: 80, items: [] } } },
      })],
      enrichmentReaders: {
        [failedEnrichment]: async () => { throw new Error(`${failedEnrichment} unavailable`); },
      },
    });

    const result = await repo.listReviewQueue(context, { page: 1, pageSize: 25, sort: "last_activity" });
    const row = result.creators[0]!;

    expect(row.enrichment[failedEnrichment]).toMatchObject({ status: "unavailable", reason: "source_error" });
    expect(row.enrichment[failedEnrichment === "social" ? "profile" : "social"].status).toBe("available");
    expect(row.social).toMatchObject(failedEnrichment === "social" ? { platforms: [], label: "Not synced" } : { platforms: ["instagram"] });
  });

  it("uses the newest shortlist row and includes it in queue activity", async () => {
    const repo = new InMemoryCreatorCaseRepository({
      cases: [makeCase({ creatorId: "creator-1", workspaceId: "workspace-1", createdAt: "2026-08-01T00:00:00.000Z" }, {
        review: { status: "approved", riskLevel: "low", summary: null, reviewedBy: null, lastReviewedAt: null, updatedAt: "2026-08-02T00:00:00.000Z" },
      })],
      shortlists: [
        { creatorId: "creator-1", status: "invited", source: "manual", notes: "Newest", updatedAt: "2026-08-10T00:00:00.000Z" },
        { creatorId: "creator-1", status: "shortlisted", source: "manual", notes: "Older", updatedAt: "2026-08-03T00:00:00.000Z" },
      ],
    });

    const result = await repo.listReviewQueue(context, { page: 1, pageSize: 25, sort: "last_activity" });

    expect(result.creators[0]).toMatchObject({
      shortlist: { status: "invited", notes: "Newest", updatedAt: "2026-08-10T00:00:00.000Z" },
      lastActivityAt: "2026-08-10T00:00:00.000Z",
    });
  });

  it.each(["social", "profile", "missionHistory"] as const)("isolates a failed %s enrichment from strict case data", async (failedEnrichment) => {
    const repo = new InMemoryCreatorCaseRepository({
      cases: [makeCase({ creatorId: "creator-1", workspaceId: "workspace-1" }, {
        review: { status: "approved", riskLevel: "low", summary: "Ready", reviewedBy: "operator-1", lastReviewedAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:00.000Z" },
        social: { status: "available", value: { accounts: [], summary: { platforms: [], syncStatus: "synced", followerCount: 100, engagementRate: 2, apiSyncedAt: "2026-08-08T00:00:00.000Z", label: "API-synced", ownershipLabel: "Ownership not verified" } } },
        profile: { status: "available", value: { avatarUrl: null, portfolioLinks: [], publicHighlights: [], published: {}, completeness: { score: 80, items: [] } } },
        missionHistory: { status: "available", value: [] },
      })],
      enrichmentReaders: {
        [failedEnrichment]: async () => { throw new Error(`${failedEnrichment} unavailable`); },
      },
    });

    const result = await repo.getCase(context, "creator-1");

    expect(result[failedEnrichment].status).toBe("unavailable");
    expect(result[failedEnrichment]).toMatchObject({ status: "unavailable", reason: "source_error" });
    expect(result.social.status).toBe(failedEnrichment === "social" ? "unavailable" : "available");
    expect(result.profile.status).toBe(failedEnrichment === "profile" ? "unavailable" : "available");
    expect(result.missionHistory.status).toBe(failedEnrichment === "missionHistory" ? "unavailable" : "available");
    expect(result.review.status).toBe("approved");
  });

  it("propagates a strict-core read failure as CreatorCaseError", async () => {
    const repo = new InMemoryCreatorCaseRepository({
      cases: [makeCase({ creatorId: "creator-1", workspaceId: "workspace-1" })],
      failurePoint: "before_get_case",
    });

    await expect(repo.getCase(context, "creator-1")).rejects.toBeInstanceOf(CreatorCaseError);
  });

  it("rejects invalid strict-core values before mutating state", async () => {
    const repo = new InMemoryCreatorCaseRepository({ cases: [makeCase({ creatorId: "creator-1", workspaceId: "workspace-1" })] });

    await expect(repo.applyReview(context, { ...approvedCommand, status: "bad" as never })).rejects.toMatchObject({ code: "bad_review_status" });
    await expect(repo.getCase(context, "creator-1")).resolves.toMatchObject({ review: { status: "needs_review" } });
  });

  it("exposes CreatorCaseError codes for validation failures", async () => {
    const repo = new InMemoryCreatorCaseRepository({ cases: [makeCase({ creatorId: "creator-1", workspaceId: "workspace-1" })] });

    await expect(repo.applyReview({ ...context, workspaceId: "" }, approvedCommand)).rejects.toMatchObject({
      code: "workspace_required",
    });
  });

  it("preserves queue filters, requested sort, bounded pagination, totals, and metadata", async () => {
    const repo = new InMemoryCreatorCaseRepository({
      cases: [
        makeCase({ creatorId: "creator-high", workspaceId: "workspace-1", displayName: "High Match", level: "L4", scores: { trust: 90 } }, {
          review: { status: "approved", riskLevel: "low", summary: null, reviewedBy: null, lastReviewedAt: null, updatedAt: "2026-08-05T00:00:00.000Z" },
        }),
        makeCase({ creatorId: "creator-low", workspaceId: "workspace-1", displayName: "Low Match", level: "L2", scores: { trust: 40 } }, {
          review: { status: "approved", riskLevel: "high", summary: null, reviewedBy: null, lastReviewedAt: null, updatedAt: "2026-08-06T00:00:00.000Z" },
        }),
        makeCase({ creatorId: "creator-other", workspaceId: "workspace-1", displayName: "Other", level: "L9", scores: { trust: 100 } }, {
          review: { status: "needs_review", riskLevel: "low", summary: null, reviewedBy: null, lastReviewedAt: null, updatedAt: "2026-08-07T00:00:00.000Z" },
        }),
      ],
    });

    const result = await repo.listReviewQueue(context, {
      status: "approved",
      riskLevel: "low",
      q: "match",
      page: 0,
      pageSize: 500,
      sort: "trust_score",
    });

    expect(result.creators.map((creator) => creator.id)).toEqual(["creator-high"]);
    expect(result).toMatchObject({ page: 1, pageSize: 100, total: 1 });
  });

  it("applies mission queue priority and excludes flagged cases without an explicit status", async () => {
    const repo = new InMemoryCreatorCaseRepository({
      cases: [
        makeCase({ creatorId: "creator-flagged", workspaceId: "workspace-1", displayName: "Flagged" }, {
          review: { status: "flagged", riskLevel: "high", summary: null, reviewedBy: null, lastReviewedAt: null, updatedAt: "2026-08-08T00:00:00.000Z" },
        }),
        makeCase({ creatorId: "creator-approved", workspaceId: "workspace-1", displayName: "Approved" }, {
          review: { status: "approved", riskLevel: "low", summary: null, reviewedBy: null, lastReviewedAt: null, updatedAt: "2026-08-01T00:00:00.000Z" },
        }),
        makeCase({ creatorId: "creator-needs-review", workspaceId: "workspace-1", displayName: "Needs review" }, {
          review: { status: "needs_review", riskLevel: "unknown", summary: null, reviewedBy: null, lastReviewedAt: null, updatedAt: "2026-08-09T00:00:00.000Z" },
        }),
      ],
    });

    const result = await repo.listReviewQueue(context, {
      missionId: "mission-1",
      page: 1,
      pageSize: 25,
      sort: "last_activity",
    });

    expect(result.creators.map((creator) => creator.id)).toEqual(["creator-approved", "creator-needs-review"]);
    expect(result.total).toBe(2);
  });

  it("rejects an unknown mission before listing a mission queue", async () => {
    const repo = new InMemoryCreatorCaseRepository({
      cases: [makeCase({ creatorId: "creator-1", workspaceId: "workspace-1" })],
      knownMissionIds: ["mission-1"],
    });

    await expect(repo.listReviewQueue(context, {
      missionId: "missing-mission",
      page: 1,
      pageSize: 25,
      sort: "last_activity",
    })).rejects.toMatchObject({ code: "mission_not_found" });
  });

  it.each([
    ["last_activity", "creator-newest"],
    ["trust_score", "creator-high-score"],
    ["level", "creator-high-level"],
    ["social_freshness", "creator-fresh-social"],
  ] as const)("supports %s queue ordering", async (sort, firstId) => {
    const cases = sort === "last_activity"
      ? [
          makeCase({ creatorId: "creator-old", workspaceId: "workspace-1" }, { review: { status: "needs_review", riskLevel: "unknown", summary: null, reviewedBy: null, lastReviewedAt: null, updatedAt: "2026-08-01T00:00:00.000Z" } }),
          makeCase({ creatorId: "creator-newest", workspaceId: "workspace-1" }, { review: { status: "needs_review", riskLevel: "unknown", summary: null, reviewedBy: null, lastReviewedAt: null, updatedAt: "2026-08-09T00:00:00.000Z" } }),
        ]
      : sort === "trust_score"
        ? [makeCase({ creatorId: "creator-low-score", workspaceId: "workspace-1", scores: { trust: 10 } }), makeCase({ creatorId: "creator-high-score", workspaceId: "workspace-1", scores: { trust: 99 } })]
        : sort === "level"
          ? [makeCase({ creatorId: "creator-low-level", workspaceId: "workspace-1", level: "L1" }), makeCase({ creatorId: "creator-high-level", workspaceId: "workspace-1", level: "L9" })]
          : [
              makeCase({ creatorId: "creator-stale-social", workspaceId: "workspace-1", socialHandles: {} }),
              makeCase({ creatorId: "creator-fresh-social", workspaceId: "workspace-1", socialHandles: {} }, { social: { status: "available", value: { accounts: [], summary: { platforms: [], syncStatus: "synced", followerCount: 1, engagementRate: 1, apiSyncedAt: "2026-08-10T00:00:00.000Z", label: "API-synced", ownershipLabel: "Ownership not verified" } } } }),
            ];

    const repo = new InMemoryCreatorCaseRepository({
      cases,
    });

    const result = await repo.listReviewQueue(context, { page: 1, pageSize: 1, sort });

    expect(result.creators[0]?.id).toBe(firstId);
  });
});
