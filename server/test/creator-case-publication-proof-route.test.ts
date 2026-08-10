import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { InMemoryCreatorCaseRepository } from "../lib/creatorCase/inMemoryRepository";
import type { CreatorCaseRepository } from "../lib/creatorCase/repository";
import type { CreatorCaseReadModel } from "../lib/creatorCase/types";
import type { AdminEnv } from "../lib/staffAuth";
import { createAdminOperatorCrmRoutes } from "../routes/adminOperatorCrm";

function makeCase(): CreatorCaseReadModel {
  return {
    creator: {
      id: "creator-1",
      workspaceId: "workspace-1",
      displayName: "Ada Creator",
      avatarUrl: null,
      level: "L1",
      categories: [],
      scores: {},
      socialHandles: {},
      createdAt: "2026-08-08T00:00:00.000Z",
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
    publicationProofs: [{
      submissionId: "submission-1",
      workflowId: "workflow-1",
      workItemId: "work-item-1",
      creatorId: "creator-1",
      workspaceId: "workspace-1",
      currentAttempt: {
        id: "attempt-1",
        submissionId: "submission-1",
        workflowId: "workflow-1",
        workItemId: "work-item-1",
        creatorId: "creator-1",
        workspaceId: "workspace-1",
        parentAttemptId: null,
        sequence: 1,
        publishedUrl: "https://example.com/post/one",
        platform: "instagram",
        state: "submitted",
        operatorMessage: null,
        submittedAt: "2026-08-09T00:00:00.000Z",
        decidedAt: null,
      },
      history: [],
    }],
  } as CreatorCaseReadModel;
}

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

describe("Creator Case publication-proof review route", () => {
  it("persists a verified decision through the workspace-scoped repository adapter", async () => {
    const repository = new InMemoryCreatorCaseRepository({ cases: [makeCase()] });
    const response = await routeFor(repository).request(
      "/creators/creator-1/publication-proof/review?workspace=workspace-1",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command_id: "proof-route-command-1",
          submission_id: "submission-1",
          work_item_id: "work-item-1",
          attempt_id: "attempt-1",
          decision: "verified",
          message: null,
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      publicationProof: {
        currentAttempt: { id: "attempt-1", state: "verified" },
      },
    });
  });

  it("requires operator feedback before requesting changes", async () => {
    const repository = new InMemoryCreatorCaseRepository({ cases: [makeCase()] });
    const response = await routeFor(repository).request(
      "/creators/creator-1/publication-proof/review?workspace=workspace-1",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command_id: "proof-route-command-2",
          submission_id: "submission-1",
          work_item_id: "work-item-1",
          attempt_id: "attempt-1",
          decision: "changes_requested",
          message: "   ",
        }),
      },
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "proof_message_required",
    });
    const unchanged = await repository.getCase(
      { workspaceId: "workspace-1", actorId: "staff-1", actorLabel: "staff@example.com" },
      "creator-1",
    );
    expect(unchanged.publicationProofs?.[0].currentAttempt.state).toBe("submitted");
  });

  it("rejects a proof review when submission lineage does not match", async () => {
    const repository = new InMemoryCreatorCaseRepository({ cases: [makeCase()] });
    const response = await routeFor(repository).request(
      "/creators/creator-1/publication-proof/review?workspace=workspace-1",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command_id: "proof-route-command-3",
          submission_id: "submission-other",
          work_item_id: "work-item-1",
          attempt_id: "attempt-1",
          decision: "verified",
          message: null,
        }),
      },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      code: "proof_lineage_mismatch",
    });
  });
});
