import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CreatorStudioError } from "../lib/creatorStudio/errors.js";
import { InMemoryCreatorStudioRepository } from "../lib/creatorStudio/inMemoryRepository.js";
import type { CreatorStudioRepository } from "../lib/creatorStudio/repository.js";
import type { SubmissionWorkspace } from "../lib/creatorStudio/types.js";
import type { Env } from "../app.js";
import { createCreatorStudioRoutes } from "../routes/creatorStudio.js";

const makeWorkspace = (): SubmissionWorkspace => ({
  submission: { id: "submission-1", creatorId: "creator-1", workspaceId: "workspace-1", missionId: "mission-1", status: "joined" },
  brief: { missionId: "mission-1", title: "Launch mission", deliverables: ["Story", "Reel"], requirements: ["Disclosure"], platforms: ["instagram"] },
  workflow: { id: "workflow-1", state: "not_started", revision: 0 },
  workItems: [
    {
      id: "work-item-1", position: 1, title: "Story", instructions: "Create a story", requirements: { caption: true, externalUrl: true, checklist: ["disclosure"] }, requiresAsset: false,
      state: "not_started", validation: { caption: false, externalUrl: false, checklist: false, assets: true }, draft: null, assets: [],
      reviewFeedback: { status: "available", value: [] },
    },
    {
      id: "work-item-2", position: 2, title: "Reel", instructions: "Create a reel", requirements: { caption: true, externalUrl: false, checklist: [] }, requiresAsset: true,
      state: "not_started", validation: { caption: false, externalUrl: true, checklist: true, assets: false }, draft: null, assets: [],
      reviewFeedback: { status: "available", value: [] },
    },
  ],
  nextAction: { workItemId: "work-item-1", state: "not_started", label: "Start Story" },
});

const appForRepository = (repository: CreatorStudioRepository, userId = "creator-1") => {
  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    c.set("userId", userId);
    c.set("workspaceId", "workspace-1");
    c.set("jwt", "test-jwt");
    await next();
  });
  app.route("/my-missions", createCreatorStudioRoutes({ repositoryForRequest: () => repository }));
  return app;
};

const failingRepository = (): CreatorStudioRepository => ({
  async getWorkspace() {
    throw new CreatorStudioError("db_error", "private database details", "correlation-route-test");
  },
  async saveDraft() { throw new Error("not implemented"); },
  async createUploadGrant() { throw new Error("not implemented"); },
  async finalizeAsset() { throw new Error("not implemented"); },
  async submitWorkItem() { throw new Error("not implemented"); },
});

describe("Creator Studio workspace route", () => {
  it("returns one stable workspace projection in position order", async () => {
    const repository = new InMemoryCreatorStudioRepository({ workspace: makeWorkspace() });
    const response = await appForRepository(repository).request("/my-missions/submission-1/workspace");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      submission: { id: "submission-1" },
      workflow: { state: "not_started" },
      workItems: [
        { id: "work-item-1", position: 1 },
        { id: "work-item-2", position: 2 },
      ],
    });
  });

  it("does not disclose a cross-owner submission", async () => {
    const repository = new InMemoryCreatorStudioRepository({ workspace: makeWorkspace() });
    const response = await appForRepository(repository, "other-creator").request("/my-missions/submission-1/workspace");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "submission_not_found", code: "submission_not_found" });
  });

  it("returns safe correlated errors without private database details", async () => {
    const response = await appForRepository(failingRepository()).request("/my-missions/submission-1/workspace");
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ code: "db_error", correlationId: "correlation-route-test" });
    expect(JSON.stringify(body)).not.toContain("private database details");
  });
});
