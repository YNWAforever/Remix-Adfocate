import { Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { CreatorStudioError } from "../lib/creatorStudio/errors.js";
import { InMemoryCreatorStudioRepository } from "../lib/creatorStudio/inMemoryRepository.js";
import type { CreatorStudioRepository } from "../lib/creatorStudio/repository.js";
import { SupabaseCreatorStudioRepository } from "../lib/creatorStudio/supabaseRepository.js";
import type { SubmissionWorkspace } from "../lib/creatorStudio/types.js";
import type { Env } from "../app.js";
import { createCreatorStudioRoutes } from "../routes/creatorStudio.js";

const makeWorkspace = (): SubmissionWorkspace => ({
  submission: { id: "submission-1", creatorId: "creator-1", workspaceId: "workspace-1", missionId: "mission-1", status: "joined", deadline: null },
  brief: { missionId: "mission-1", title: "Launch mission", description: null, deliverables: ["Story", "Reel"], requirements: ["Disclosure"], platforms: ["instagram"] },
  workflow: { id: "workflow-1", state: "not_started", revision: 0 },
  workItems: [
    {
      id: "work-item-1", position: 1, title: "Story", instructions: "Create a story", requirements: { caption: true, externalUrl: true, checklist: ["disclosure"] }, requiresAsset: false,
      proofRequirement: null, state: "not_started", validation: { caption: false, externalUrl: false, checklist: false, assets: true, publicationProof: true }, draft: null, assets: [],
      publicationProof: { required: false, currentAttempt: null, history: [] },
      reviewFeedback: { status: "available", value: [] },
    },
    {
      id: "work-item-2", position: 2, title: "Reel", instructions: "Create a reel", requirements: { caption: true, externalUrl: false, checklist: [] }, requiresAsset: true,
      proofRequirement: null, state: "not_started", validation: { caption: false, externalUrl: true, checklist: true, assets: false, publicationProof: true }, draft: null, assets: [],
      publicationProof: { required: false, currentAttempt: null, history: [] },
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
  async createPublicationProofAttempt() { throw new Error("not implemented"); },
  async createProofEvidenceGrant() { throw new Error("not implemented"); },
  async finalizeProofEvidence() { throw new Error("not implemented"); },
  async cancelProofEvidence() { throw new Error("not implemented"); },
  async submitPublicationProof() { throw new Error("not implemented"); },
  async refreshProofMetadata() { throw new Error("not implemented"); },
});

const unknownFailingRepository = (): CreatorStudioRepository => ({
  async getWorkspace() {
    throw new Error("private database details");
  },
  async saveDraft() { throw new Error("not implemented"); },
  async createUploadGrant() { throw new Error("not implemented"); },
  async finalizeAsset() { throw new Error("not implemented"); },
  async submitWorkItem() { throw new Error("not implemented"); },
  async createPublicationProofAttempt() { throw new Error("not implemented"); },
  async createProofEvidenceGrant() { throw new Error("not implemented"); },
  async finalizeProofEvidence() { throw new Error("not implemented"); },
  async cancelProofEvidence() { throw new Error("not implemented"); },
  async submitPublicationProof() { throw new Error("not implemented"); },
  async refreshProofMetadata() { throw new Error("not implemented"); },
});

const proofRepository = () => {
  const attempt = {
    id: "attempt-1", workItemId: "work-item-1", parentAttemptId: null, sequence: 1,
    publishedUrl: "https://example.com/published", platform: "instagram", state: "draft" as const,
    metadataState: "pending" as const, metadata: null, operatorMessage: null,
    submittedAt: null, decidedAt: null, evidence: [],
  };
  const evidence = {
    id: "evidence-1", attemptId: "attempt-1", storagePath: "creator-1/workflow-1/work-item-1/proof-evidence/evidence-1.png",
    mimeType: "image/png" as const, byteSize: 10, checksumSha256: null, status: "finalized" as const,
  };
  return {
    getWorkspace: vi.fn().mockResolvedValue(makeWorkspace()),
    saveDraft: vi.fn(),
    createUploadGrant: vi.fn(),
    finalizeAsset: vi.fn(),
    submitWorkItem: vi.fn(),
    createPublicationProofAttempt: vi.fn().mockResolvedValue({ value: attempt, replayed: false }),
    createProofEvidenceGrant: vi.fn().mockResolvedValue({
      value: { bucket: "mission-publication-proof-assets", path: evidence.storagePath, token: "signed-token", assetId: evidence.id, expiresAt: "2026-08-10T01:00:00.000Z" },
      replayed: false,
    }),
    finalizeProofEvidence: vi.fn().mockResolvedValue({ value: evidence, replayed: false }),
    cancelProofEvidence: vi.fn().mockResolvedValue({ value: { evidenceId: evidence.id }, replayed: false }),
    submitPublicationProof: vi.fn().mockResolvedValue({ value: { ...attempt, state: "submitted" as const, submittedAt: "2026-08-10T00:00:00.000Z" }, replayed: false }),
    refreshProofMetadata: vi.fn().mockResolvedValue({ value: { ...attempt, metadataState: "unavailable" as const }, replayed: false }),
  } as unknown as CreatorStudioRepository;
};

type QueryResult = { data: unknown; error: unknown };
type FakeQuery = {
  select: () => FakeQuery;
  eq: () => FakeQuery;
  in: () => FakeQuery;
  order: () => FakeQuery;
  maybeSingle: () => Promise<QueryResult>;
  then: Promise<QueryResult>["then"];
};

const fakeSupabaseClient = (results: Record<string, QueryResult>): SupabaseClient => {
  const queryFor = (table: string) => {
    const result = Promise.resolve(results[table] ?? { data: [], error: null });
    const query: FakeQuery = {
      select: () => query,
      eq: () => query,
      in: () => query,
      order: () => query,
      maybeSingle: () => result,
      then: result.then.bind(result),
    };
    return query;
  };

  return { from: queryFor } as unknown as SupabaseClient;
};

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
    expect(body).toEqual({
      error: "Unable to load Creator Studio workspace",
      code: "db_error",
      correlationId: "correlation-route-test",
    });
    expect(JSON.stringify(body)).not.toContain("private database details");
  });

  it("returns a safe correlated database response for unknown repository failures", async () => {
    const response = await appForRepository(unknownFailingRepository()).request("/my-missions/submission-1/workspace");
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      error: "Unable to load Creator Studio workspace",
      code: "db_error",
      correlationId: expect.any(String),
    });
    expect(JSON.stringify(body)).not.toContain("private database details");
  });

  it("maps persisted requirement arrays and sorts tied workspace projections deterministically", async () => {
    const repository = new SupabaseCreatorStudioRepository(fakeSupabaseClient({
      mission_submissions: {
        data: {
          id: "submission-1", creator_id: "creator-1", workspace_id: "workspace-1", mission_id: "mission-1", status: "joined",
          missions: { id: "mission-1", title: "Launch mission", deliverables: ["Story", "Reel"], requirements: ["Disclosure"], platforms: ["instagram"] },
        },
        error: null,
      },
      mission_workflows: { data: { id: "workflow-1", state: "drafting", revision: 3 }, error: null },
      mission_work_items: {
        data: [
          { id: "work-item-b", position: 1, title: "Reel", instructions: "Create a reel", requirements: { requirements: [], platforms: ["instagram"] }, requires_asset: false, proof_requirement: null, state: "not_started" },
          { id: "work-item-a", position: 1, title: "Story", instructions: "Create a story", requirements: { requirements: ["caption", "external_url", "disclosure"], platforms: ["instagram"] }, requires_asset: true, proof_requirement: null, state: "drafting" },
        ],
        error: null,
      },
      mission_working_drafts: {
        data: [{ mission_work_item_id: "work-item-a", caption: "Draft caption", external_url: null, checklist: { disclosure: true }, version: 1, updated_at: "2026-08-09T00:00:00.000Z" }],
        error: null,
      },
      mission_draft_assets: {
        data: [
          { id: "asset-b", mission_work_item_id: "work-item-a", original_filename: "b.png", mime_type: "image/png", byte_size: 2, checksum_sha256: null, upload_state: "finalized", storage_object_path: "b", created_at: "2026-08-09T00:00:00.000Z" },
          { id: "asset-a", mission_work_item_id: "work-item-a", original_filename: "a.png", mime_type: "image/png", byte_size: 1, checksum_sha256: null, upload_state: "finalized", storage_object_path: "a", created_at: "2026-08-09T00:00:00.000Z" },
        ],
        error: null,
      },
      mission_review_items: {
        data: [
          { id: "review-b", mission_work_item_id: "work-item-a", outcome: "changes_requested", message: "Second", created_at: "2026-08-09T00:00:00.000Z" },
          { id: "review-a", mission_work_item_id: "work-item-a", outcome: "changes_requested", message: "First", created_at: "2026-08-09T00:00:00.000Z" },
        ],
        error: null,
      },
    }));

    const workspace = await repository.getWorkspace({ actorId: "creator-1", workspaceId: "workspace-1", submissionId: "submission-1" });

    expect(workspace?.workItems.map((item) => item.id)).toEqual(["work-item-a", "work-item-b"]);
    expect(workspace?.workItems[0]).toMatchObject({
      requirements: { caption: true, externalUrl: true, checklist: ["disclosure"] },
      validation: { caption: true, externalUrl: false, checklist: true, assets: true },
    });
    expect(workspace?.workItems[0].assets.map((asset) => asset.id)).toEqual(["asset-a", "asset-b"]);
    expect(workspace?.workItems[0].reviewFeedback).toEqual({
      status: "available",
      value: [
        { id: "review-a", state: "changes_requested", message: "First" },
        { id: "review-b", state: "changes_requested", message: "Second" },
      ],
    });
    expect(workspace?.nextAction).toMatchObject({ workItemId: "work-item-a", state: "drafting" });
  });

  it("routes publication-proof commands through the repository adapter", async () => {
    const repository = proofRepository();
    const app = appForRepository(repository);
    const json = (value: unknown) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(value) });

    const attemptResponse = await app.request(
      "/my-missions/submission-1/work-items/work-item-1/publication-proof/attempts",
      { method: "POST", ...json({ command_id: "proof-create", published_url: "https://example.com/published", platform: "instagram" }) },
    );
    expect(attemptResponse.status).toBe(200);
    expect(repository.createPublicationProofAttempt).toHaveBeenCalledWith(
      { actorId: "creator-1", workspaceId: "workspace-1", submissionId: "submission-1" },
      "work-item-1",
      { commandId: "proof-create", publishedUrl: "https://example.com/published", platform: "instagram" },
    );

    const grantResponse = await app.request(
      "/my-missions/submission-1/work-items/work-item-1/publication-proof/attempts/attempt-1/evidence/upload-grant",
      { method: "POST", ...json({ command_id: "proof-grant", file_name: "proof.png", mime_type: "image/png", byte_size: 10 }) },
    );
    expect(grantResponse.status).toBe(200);
    expect(repository.createProofEvidenceGrant).toHaveBeenCalledWith(
      { actorId: "creator-1", workspaceId: "workspace-1", submissionId: "submission-1" },
      "work-item-1", "attempt-1",
      { commandId: "proof-grant", fileName: "proof.png", mimeType: "image/png", byteSize: 10 },
    );

    const finalizeResponse = await app.request(
      "/my-missions/submission-1/work-items/work-item-1/publication-proof/attempts/attempt-1/evidence/evidence-1/finalize",
      { method: "POST", ...json({ command_id: "proof-finalize", byte_size: 10, mime_type: "image/png", checksum_sha256: null }) },
    );
    expect(finalizeResponse.status).toBe(200);
    expect(repository.finalizeProofEvidence).toHaveBeenCalledWith(
      { actorId: "creator-1", workspaceId: "workspace-1", submissionId: "submission-1" },
      "work-item-1", "attempt-1", "evidence-1",
      { commandId: "proof-finalize", byteSize: 10, mimeType: "image/png", checksumSha256: null },
    );

    const cancelResponse = await app.request(
      "/my-missions/submission-1/work-items/work-item-1/publication-proof/attempts/attempt-1/evidence/evidence-1/cancel",
      { method: "POST", ...json({ command_id: "proof-cancel" }) },
    );
    expect(cancelResponse.status).toBe(200);
    expect(repository.cancelProofEvidence).toHaveBeenCalledWith(
      { actorId: "creator-1", workspaceId: "workspace-1", submissionId: "submission-1" },
      "work-item-1", "attempt-1", "evidence-1", { commandId: "proof-cancel" },
    );

    const submitResponse = await app.request(
      "/my-missions/submission-1/work-items/work-item-1/publication-proof/attempts/attempt-1/submit",
      { method: "POST", ...json({ command_id: "proof-submit" }) },
    );
    expect(submitResponse.status).toBe(200);
    expect(repository.submitPublicationProof).toHaveBeenCalledWith(
      { actorId: "creator-1", workspaceId: "workspace-1", submissionId: "submission-1" },
      "work-item-1", "attempt-1", { commandId: "proof-submit" },
    );

    const refreshResponse = await app.request(
      "/my-missions/submission-1/work-items/work-item-1/publication-proof/attempts/attempt-1/metadata/refresh",
      { method: "POST", ...json({ command_id: "proof-refresh" }) },
    );
    expect(refreshResponse.status).toBe(200);
    expect(repository.refreshProofMetadata).toHaveBeenCalledWith(
      { actorId: "creator-1", workspaceId: "workspace-1", submissionId: "submission-1" },
      "work-item-1", "attempt-1", { commandId: "proof-refresh" },
    );
  });

  it("rejects invalid proof commands before reaching the repository", async () => {
    const repository = proofRepository();
    const response = await appForRepository(repository).request(
      "/my-missions/submission-1/work-items/work-item-1/publication-proof/attempts",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command_id: "proof-create", published_url: "http://example.com", platform: "instagram" }) },
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "draft_invalid" });
    expect(repository.createPublicationProofAttempt).not.toHaveBeenCalled();
  });

  it("maps immutable proof transitions to a conflict response", async () => {
    const repository = proofRepository();
    (repository.submitPublicationProof as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new CreatorStudioError("proof_attempt_immutable", "Only the current draft proof attempt can be edited"),
    );
    const response = await appForRepository(repository).request(
      "/my-missions/submission-1/work-items/work-item-1/publication-proof/attempts/attempt-1/submit",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command_id: "proof-submit" }) },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Only the current draft proof attempt can be edited",
      code: "proof_attempt_immutable",
    });
  });
});
