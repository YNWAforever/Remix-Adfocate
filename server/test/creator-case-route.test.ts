import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreatorCaseError } from "../lib/creatorCase/errors";
import { InMemoryCreatorCaseRepository } from "../lib/creatorCase/inMemoryRepository";
import type { CreatorCaseRepository } from "../lib/creatorCase/repository";
import type { CreatorCaseReadModel } from "../lib/creatorCase/types";
import type { AdminEnv } from "../lib/staffAuth";
import { createAdminOperatorCrmRoutes } from "../routes/adminOperatorCrm";

const missionShortlistSpies = vi.hoisted(() => ({
  serviceClient: vi.fn(() => ({ source: "mission-shortlist-route-test" })),
  listMissionShortlist: vi.fn(),
  upsertMissionShortlist: vi.fn(),
  updateMissionShortlistStatus: vi.fn(),
}));

vi.mock("../lib/supabase.js", () => ({ serviceClient: missionShortlistSpies.serviceClient }));

vi.mock("../lib/operatorCrm/repo.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/operatorCrm/repo")>();
  return {
    ...actual,
    listMissionShortlist: missionShortlistSpies.listMissionShortlist,
    upsertMissionShortlist: missionShortlistSpies.upsertMissionShortlist,
    updateMissionShortlistStatus: missionShortlistSpies.updateMissionShortlistStatus,
  };
});

const makeCase = (overrides: Partial<CreatorCaseReadModel["creator"]> = {}): CreatorCaseReadModel => ({
  creator: {
    id: "creator-1",
    workspaceId: "workspace-1",
    displayName: "Ada Creator",
    avatarUrl: null,
    level: "L1",
    categories: ["beauty"],
    scores: {},
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

function routeFor(repository: CreatorCaseRepository) {
  const app = new Hono<AdminEnv>();
  app.use("*", async (c, next) => {
    c.set("staff", { userId: "staff-1", email: "staff@example.com" });
    await next();
  });
  app.route("/", createAdminOperatorCrmRoutes({
    creatorCaseRepository: repository,
    creatorShortlistProjection: async () => [],
  }));
  return app;
}

function reviewRequest(commandId = "command-1", body: Record<string, unknown> = {}) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      command_id: commandId,
      status: "approved",
      risk_level: "low",
      summary: "Approved",
      note: "Reviewed",
      ...body,
    }),
  } satisfies RequestInit;
}

describe("Creator case admin routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes Creator queue, detail, and note reads through the injected seam", async () => {
    const repo = new InMemoryCreatorCaseRepository({ cases: [makeCase()] });
    const appendNote = vi.spyOn(repo, "appendNote");
    const app = routeFor(repo);

    const queue = await app.request("/creators/review?workspace=workspace-1");
    expect(queue.status).toBe(200);
    expect((await queue.json()).creators).toHaveLength(1);

    const detail = await app.request("/creators/creator-1?workspace=workspace-1");
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ creator: { id: "creator-1" }, shortlists: [] });

    const note = await app.request("/creators/creator-1/notes?workspace=workspace-1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command_id: "note-command-1", category: "fit", body: "Good audience fit." }),
    });
    expect(note.status).toBe(200);
    expect(await note.json()).toMatchObject({ note: { category: "fit", body: "Good audience fit." } });
    expect(appendNote).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace-1", actorId: "staff-1", commandId: "note-command-1" }),
      expect.objectContaining({ creatorId: "creator-1", category: "fit", body: "Good audience fit." }),
    );
  });

  it("returns the repository-provided inserted note when timestamps tie", async () => {
    const insertedNote = {
      id: "inserted-note",
      creatorId: "creator-1",
      workspaceId: "workspace-1",
      operatorId: "staff-1",
      category: "fit" as const,
      body: "Inserted note",
      createdAt: "2026-08-08T00:00:00.000Z",
    };
    const trailingNote = { ...insertedNote, id: "trailing-note", body: "Trailing note" };
    const repository: CreatorCaseRepository = {
      listReviewQueue: async () => ({ creators: [], page: 1, pageSize: 25, total: 0 }),
      getCase: async () => makeCase(),
      applyReview: async () => makeCase(),
      appendNote: async () => ({ ...makeCase(), notes: [insertedNote, trailingNote], insertedNote }),
    };

    const response = await routeFor(repository).request("/creators/creator-1/notes?workspace=workspace-1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command_id: "note-command-1", category: "fit", body: "Inserted note" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ note: insertedNote });
  });

  it("routes review commands through the injected workspace-scoped repository", async () => {
    const repo = new InMemoryCreatorCaseRepository({ cases: [makeCase()] });
    const applyReview = vi.spyOn(repo, "applyReview");
    const response = await routeFor(repo).request(
      "/creators/creator-1/review?workspace=workspace-1",
      reviewRequest(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ review: { status: "approved", riskLevel: "low" } });
    expect(applyReview).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace-1", actorId: "staff-1", commandId: "command-1" }),
      expect.objectContaining({ creatorId: "creator-1", status: "approved", riskLevel: "low" }),
    );
    expect(
      (await repo.getCase({ workspaceId: "workspace-1", actorId: "staff-1", actorLabel: "staff@example.com" }, "creator-1"))
        .review.reviewedBy,
    ).toBe("staff-1");
  });

  it("keeps mission shortlist routes delegated to the existing shortlist repository", async () => {
    missionShortlistSpies.listMissionShortlist.mockResolvedValue({ mission: { id: "mission-1" }, shortlists: [] });
    missionShortlistSpies.upsertMissionShortlist.mockResolvedValue({ mission_id: "mission-1", creator_id: "creator-1" });
    missionShortlistSpies.updateMissionShortlistStatus.mockResolvedValue({ mission_id: "mission-1", creator_id: "creator-1", status: "invited" });
    const app = routeFor(new InMemoryCreatorCaseRepository({ cases: [makeCase()] }));

    expect((await app.request("/missions/mission-1/shortlist")).status).toBe(200);
    expect(
      (await app.request("/missions/mission-1/shortlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creator_id: "creator-1", source: "manual" }),
      })).status,
    ).toBe(200);
    expect(
      (await app.request("/missions/mission-1/shortlist/creator-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "invited" }),
      })).status,
    ).toBe(200);

    expect(missionShortlistSpies.listMissionShortlist).toHaveBeenCalledWith(expect.anything(), "mission-1");
    expect(missionShortlistSpies.upsertMissionShortlist).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      missionId: "mission-1",
      creatorId: "creator-1",
      context: { operatorId: "staff-1", actorLabel: "staff@example.com" },
    }));
    expect(missionShortlistSpies.updateMissionShortlistStatus).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      missionId: "mission-1",
      creatorId: "creator-1",
      status: "invited",
      context: { operatorId: "staff-1", actorLabel: "staff@example.com" },
    }));
  });

  it("requires an explicit workspace before invoking any Creator case repository method", async () => {
    const repo = new InMemoryCreatorCaseRepository({ cases: [makeCase()] });
    const listReviewQueue = vi.spyOn(repo, "listReviewQueue");
    const getCase = vi.spyOn(repo, "getCase");
    const applyReview = vi.spyOn(repo, "applyReview");
    const appendNote = vi.spyOn(repo, "appendNote");
    const app = routeFor(repo);
    const response = await app.request("/creators/creator-1/review", reviewRequest());

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "workspace_required" });
    expect((await app.request("/creators/review")).status).toBe(422);
    expect((await app.request("/creators/creator-1")).status).toBe(422);
    expect((await app.request("/creators/creator-1/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command_id: "note-command-1", category: "fit", body: "No workspace." }),
    })).status).toBe(422);
    expect(listReviewQueue).not.toHaveBeenCalled();
    expect(getCase).not.toHaveBeenCalled();
    expect(applyReview).not.toHaveBeenCalled();
    expect(appendNote).not.toHaveBeenCalled();
  });

  it("requires a command id for Creator case mutations", async () => {
    const repo = new InMemoryCreatorCaseRepository({ cases: [makeCase()] });
    const response = await routeFor(repo).request(
      "/creators/creator-1/review?workspace=workspace-1",
      reviewRequest("", { command_id: undefined }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "command_conflict" });
  });

  it("does not disclose workspace mismatches", async () => {
    const repo = new InMemoryCreatorCaseRepository({ cases: [makeCase({ workspaceId: "workspace-2" })] });
    const response = await routeFor(repo).request(
      "/creators/creator-1/review?workspace=workspace-1",
      reviewRequest(),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "creator_not_found" });
  });

  it("rejects flagged reviews without a note", async () => {
    const repo = new InMemoryCreatorCaseRepository({ cases: [makeCase()] });
    const response = await routeFor(repo).request(
      "/creators/creator-1/review?workspace=workspace-1",
      reviewRequest("command-flagged", { status: "flagged", risk_level: "high", note: "" }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "flagged_review_note_required" });
  });

  it("maps conflicting command replays to 409", async () => {
    const repo = new InMemoryCreatorCaseRepository({ cases: [makeCase()] });
    const app = routeFor(repo);

    expect((await app.request("/creators/creator-1/review?workspace=workspace-1", reviewRequest())).status).toBe(200);
    const conflict = await app.request(
      "/creators/creator-1/review?workspace=workspace-1",
      reviewRequest("command-1", { summary: "Different summary" }),
    );

    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "command_conflict" });
  });

  it("returns a safe correlated error for repository failures", async () => {
    const repository: CreatorCaseRepository = {
      listReviewQueue: async () => { throw new CreatorCaseError("db_error", "private database details", "correlation-1"); },
      getCase: async () => { throw new CreatorCaseError("db_error", "private database details", "correlation-1"); },
      applyReview: async () => { throw new CreatorCaseError("db_error", "private database details", "correlation-1"); },
      appendNote: async () => { throw new CreatorCaseError("db_error", "private database details", "correlation-1"); },
    };

    const response = await routeFor(repository).request(
      "/creators/creator-1/review?workspace=workspace-1",
      reviewRequest(),
    );
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ code: "db_error", correlationId: "correlation-1" });
    expect(JSON.stringify(body)).not.toContain("private database details");
  });
});
