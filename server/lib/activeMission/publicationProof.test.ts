import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  createProofEvidenceUploadGrant,
  finalizeProofEvidence,
  PUBLICATION_PROOF_ASSET_BUCKET,
  PUBLICATION_PROOF_UPLOAD_GRANT_SECONDS,
  validateProofEvidenceUploadInput,
} from "./publicationProof";

const owner = { submissionId: "submission-1", creatorId: "creator-1", workspaceId: "workspace-1", workflowId: "workflow-1", workItemId: "item-1" };

function clientFor(asset: Record<string, unknown> = {
  id: "asset-1", storage_object_path: "creator-1/submission-1/item-1/proof-evidence/asset-1.jpg",
  upload_state: "pending", mime_type: "image/jpeg", byte_size: 1024,
  upload_grant_expires_at: "2026-07-23T10:10:00.000Z",
}) {
  const rpc = vi.fn(async () => ({ data: asset, error: null }));
  const createSignedUploadUrl = vi.fn(async (): Promise<{ data: { token: string } | null; error: { message: string } | null }> => ({ data: { token: "proof-token" }, error: null }));
  const storageFrom = vi.fn(() => ({ createSignedUploadUrl }));
  return { client: { rpc, storage: { from: storageFrom } } as unknown as SupabaseClient, rpc, createSignedUploadUrl, storageFrom };
}

describe("publication proof evidence", () => {
  it("validates the private evidence MIME and 20 MB policy", () => {
    expect(validateProofEvidenceUploadInput({ fileName: "receipt.png", contentType: "image/png", sizeBytes: 1024 })).toMatchObject({ fileName: "receipt.png" });
    expect(validateProofEvidenceUploadInput({ fileName: "video.mp4", contentType: "video/mp4", sizeBytes: 1024 })).toMatchObject({ contentType: "video/mp4" });
    expect(() => validateProofEvidenceUploadInput({ fileName: "large.png", contentType: "image/png", sizeBytes: 20_971_521 })).toThrow("sizeBytes");
  });

  it("creates an owner-scoped ten-minute grant at the canonical proof-evidence path", async () => {
    const mocked = clientFor();
    const result = await createProofEvidenceUploadGrant(mocked.client, owner, { fileName: "proof.jpg", contentType: "image/jpeg", sizeBytes: 1024 }, { expectedState: "approved_to_publish", expectedRevision: 0, idempotencyKey: "11111111-1111-4111-8111-111111111111" });
    expect(result).toMatchObject({ token: "proof-token", expiresInSeconds: PUBLICATION_PROOF_UPLOAD_GRANT_SECONDS, asset: { uploadState: "pending" } });
    expect(result.upload.path).toMatch(/^creator-1\/submission-1\/item-1\/proof-evidence\/.+\.jpg$/);
    expect(mocked.rpc).toHaveBeenCalledWith("create_publication_proof_asset", expect.objectContaining({
      p_submission: owner.submissionId, p_creator: owner.creatorId, p_workspace: owner.workspaceId,
      p_work_item: owner.workItemId, p_grant_seconds: 600,
    }));
    expect(mocked.storageFrom).toHaveBeenCalledWith(PUBLICATION_PROOF_ASSET_BUCKET);
  });

  it("cleans up the pending row when signing fails", async () => {
    const mocked = clientFor();
    mocked.createSignedUploadUrl.mockResolvedValue({ data: null, error: { message: "storage unavailable" } });
    await expect(createProofEvidenceUploadGrant(mocked.client, owner, { fileName: "proof.png", contentType: "image/png", sizeBytes: 10 }, { expectedState: "approved_to_publish", expectedRevision: 0, idempotencyKey: "11111111-1111-4111-8111-111111111111" }))
      .rejects.toMatchObject({ code: "UNKNOWN", message: "storage unavailable" });
    expect(mocked.rpc).toHaveBeenNthCalledWith(2, "abandon_publication_proof_asset", expect.objectContaining({ p_asset: "asset-1", p_work_item: owner.workItemId }));
  });

  it("finalizes only through the owner/path-scoped RPC and is retry-safe", async () => {
    const mocked = clientFor({ id: "asset-1", storage_object_path: "path", upload_state: "ready", mime_type: "image/png", byte_size: 22, content_checksum: "sha256" });
    const result = await finalizeProofEvidence(mocked.client, { ...owner, assetId: "asset-1" }, { checksum: "sha256" }, { expectedState: "approved_to_publish", expectedRevision: 0, idempotencyKey: "11111111-1111-4111-8111-111111111111" });
    expect(result).toMatchObject({ id: "asset-1", uploadState: "ready", checksum: "sha256" });
    expect(mocked.rpc).toHaveBeenCalledWith("finalize_publication_proof_asset", expect.objectContaining({
      p_submission: owner.submissionId, p_creator: owner.creatorId, p_workspace: owner.workspaceId,
      p_work_item: owner.workItemId, p_asset: "asset-1", p_checksum: "sha256",
      p_expected_state: "approved_to_publish", p_expected_revision: 0, p_idempotency_key: "11111111-1111-4111-8111-111111111111",
    }));
  });

  it.each(["already_finalized", "already_assigned", "wrong_state"])("maps %s to a controlled state error", async (message) => {
    const rpc = vi.fn(async () => ({ data: null, error: { message } }));
    await expect(finalizeProofEvidence({ rpc } as unknown as SupabaseClient, { ...owner, assetId: "asset-1" }, { checksum: "sha256" }, { expectedState: "approved_to_publish", expectedRevision: 0, idempotencyKey: "11111111-1111-4111-8111-111111111111" }))
      .rejects.toMatchObject({ code: "WRONG_STATE" });
  });

  it("reuses a deterministic path for the same idempotency key", async () => {
    const mocked = clientFor();
    const context = { expectedState: "approved_to_publish", expectedRevision: 0, idempotencyKey: "44444444-4444-4444-8444-444444444444" };
    await createProofEvidenceUploadGrant(mocked.client, owner, { fileName: "proof.png", contentType: "image/png", sizeBytes: 10 }, context);
    await createProofEvidenceUploadGrant(mocked.client, owner, { fileName: "proof.png", contentType: "image/png", sizeBytes: 10 }, context);
    const calls = mocked.rpc.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
    expect(calls[0]?.[1].p_storage_object_path)
      .toBe(calls[1]?.[1].p_storage_object_path);
  });
});
