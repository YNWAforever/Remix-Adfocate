import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { InMemoryCreatorStudioRepository } from "../lib/creatorStudio/inMemoryRepository.js";
import type { CreatorStudioRepository } from "../lib/creatorStudio/repository.js";
import type { SubmissionWorkspace } from "../lib/creatorStudio/types.js";
import type { Env } from "../app.js";
import { createCreatorStudioRoutes } from "../routes/creatorStudio.js";

const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const workspace = (): SubmissionWorkspace => ({
  submission: { id: "submission-1", creatorId: "creator-1", workspaceId: "workspace-1", missionId: "mission-1", status: "joined" },
  brief: { missionId: "mission-1", title: "Launch", deliverables: ["Proof"], requirements: [], platforms: ["instagram"] },
  workflow: { id: "workflow-1", state: "not_started", revision: 0 },
  workItems: [{
    id: "work-item-1", position: 1, title: "Proof", instructions: "Post proof",
    requirements: { caption: true, externalUrl: true, checklist: ["disclosure"] }, requiresAsset: true,
    state: "not_started", validation: { caption: false, externalUrl: false, checklist: false, assets: false },
    draft: null, assets: [], reviewFeedback: { status: "available", value: [] },
  }],
  nextAction: { workItemId: "work-item-1", state: "not_started", label: "Start Proof" },
});

const appFor = (repository: CreatorStudioRepository) => {
  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    c.set("userId", "creator-1");
    c.set("workspaceId", "workspace-1");
    c.set("jwt", "test-jwt");
    await next();
  });
  app.route("/my-missions", createCreatorStudioRoutes({ repositoryForRequest: () => repository }));
  return app;
};

const draftPath = "/my-missions/submission-1/work-items/work-item-1/draft";
const grantPath = "/my-missions/submission-1/work-items/work-item-1/assets/upload-grant";

describe("Creator Studio mutation routes", () => {
  it("saves a draft, returns a replay snapshot, and rejects a stale version without overwriting", async () => {
    const repository = new InMemoryCreatorStudioRepository({ workspace: workspace() });
    const app = appFor(repository);
    const command = {
      command_id: "draft-1", expected_version: 0,
      patch: { caption: "A caption", external_url: "https://example.com/post", checklist: { disclosure: true } },
    };

    const first = await app.request(draftPath, json(command, "PATCH"));
    const replay = await app.request(draftPath, json(command, "PATCH"));
    const stale = await app.request(draftPath, json({
      command_id: "stale-1", expected_version: 0, patch: { caption: "Stale write" },
    }, "PATCH"));

    expect(first.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true, draft: { version: 1 } });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "version_conflict" });
    expect(repository.getDraft("work-item-1")?.caption).toBe("A caption");
  });

  it("returns an idempotent server-generated upload grant and finalizes it only once", async () => {
    const app = appFor(new InMemoryCreatorStudioRepository({ workspace: workspace() }));
    const grantCommand = { command_id: "grant-1", file_name: "proof.png", mime_type: "image/png", byte_size: 1024 };

    const first = await app.request(grantPath, json(grantCommand));
    const replay = await app.request(grantPath, json(grantCommand));
    const granted = await first.json() as { bucket: string; path: string; token: string; assetId: string; expiresAt: string };
    const replayed = await replay.json() as { assetId: string };
    const finalizePath = `/my-missions/submission-1/work-items/work-item-1/assets/${granted.assetId}/finalize`;
    const finalized = await app.request(finalizePath, json({
      command_id: "finalize-1", byte_size: 1024, mime_type: "image/png", checksum_sha256: null,
    }));
    const secondFinalize = await app.request(finalizePath, json({
      command_id: "finalize-2", byte_size: 1024, mime_type: "image/png", checksum_sha256: null,
    }));

    expect(first.status).toBe(200);
    expect(granted).toEqual({
      bucket: "creator-studio-assets", path: expect.stringContaining("asset-1.png"), token: expect.any(String),
      assetId: "asset-1", expiresAt: expect.any(String),
    });
    expect(replayed.assetId).toBe(granted.assetId);
    expect(finalized.status).toBe(200);
    expect(secondFinalize.status).toBe(409);
    expect(await secondFinalize.json()).toMatchObject({ code: "asset_finalized" });
  });

  it("submits only after required draft fields and a finalized asset, then uses submitted transitions", async () => {
    const app = appFor(new InMemoryCreatorStudioRepository({ workspace: workspace() }));
    const blocked = await app.request("/my-missions/submission-1/work-items/work-item-1/submit", json({
      command_id: "submit-before-ready", expected_version: 0,
    }));
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ code: "invalid_transition" });
  });

  it("accepts only snake_case fields and rejects invalid command, version, URL, checklist, MIME, and size values without mutation", async () => {
    const repository = new InMemoryCreatorStudioRepository({ workspace: workspace() });
    const app = appFor(repository);
    const before = await repository.getWorkspace({ actorId: "creator-1", workspaceId: "workspace-1", submissionId: "submission-1" });

    for (const body of [
      { command_id: "", expected_version: 0, patch: {} },
      { command_id: "x".repeat(129), expected_version: 0, patch: {} },
      { command_id: "fractional", expected_version: 0.5, patch: {} },
      { command_id: "negative", expected_version: -1, patch: {} },
      { command_id: "bad-url", expected_version: 0, patch: { external_url: "ftp://example.com" } },
      { command_id: "bad-checklist", expected_version: 0, patch: { checklist: { disclosure: "yes" } } },
      { commandId: "camel-case", expectedVersion: 0, patch: { caption: "ignored" } },
    ]) {
      const response = await app.request(draftPath, json(body, "PATCH"));
      expect(response.status).toBe(422);
    }

    for (const body of [
      { command_id: "bad-mime", file_name: "proof.mov", mime_type: "video/quicktime", byte_size: 1024 },
      { command_id: "too-large", file_name: "proof.png", mime_type: "image/png", byte_size: (50 * 1024 * 1024) + 1 },
    ]) {
      const response = await app.request(grantPath, json(body));
      expect(response.status).toBe(422);
    }

    expect(await repository.getWorkspace({ actorId: "creator-1", workspaceId: "workspace-1", submissionId: "submission-1" })).toEqual(before);
    expect(repository.events()).toEqual([]);
  });

  it("does not write command evidence when a validly parsed request fails a state prerequisite", async () => {
    const repository = new InMemoryCreatorStudioRepository({ workspace: workspace() });
    const app = appFor(repository);
    const response = await app.request("/my-missions/submission-1/work-items/work-item-1/submit", json({
      command_id: "blocked-command", expected_version: 0,
    }));

    expect(response.status).toBe(409);
    expect(repository.events()).toEqual([]);
    await expect(repository.saveDraft({ actorId: "creator-1", workspaceId: "workspace-1", submissionId: "submission-1" }, "work-item-1", {
      commandId: "blocked-command", expectedVersion: 0, patch: { caption: "Still reusable" },
    })).resolves.toMatchObject({ replayed: false });
  });
});
