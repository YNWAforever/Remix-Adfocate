import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ActiveMissionError } from "./errors.js";

export const PUBLICATION_PROOF_ASSET_BUCKET = "mission-publication-proof-assets";
export const PUBLICATION_PROOF_UPLOAD_GRANT_SECONDS = 600;
export const PUBLICATION_PROOF_MAX_BYTES = 20_971_520;

const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
} as const;

export type PublicationProofOwner = {
  submissionId: string;
  creatorId: string;
  workspaceId: string;
  workflowId: string;
  workItemId: string;
};

export type ProofMutationContext = { expectedState?: string; expectedRevision?: number; idempotencyKey?: string };

export type ProofEvidenceUploadInput = {
  fileName: string;
  contentType: keyof typeof EXTENSIONS;
  sizeBytes: number;
};

export type ProofEvidenceFinalizeInput = { checksum: string };

type AssetRow = {
  id: string;
  storage_object_path: string;
  upload_state: string;
  mime_type: string;
  byte_size: number | string;
  content_checksum?: string | null;
  upload_grant_expires_at?: string | null;
};

function validation(message: string): never {
  throw new ActiveMissionError("VALIDATION_FAILED", message);
}

export function validateProofEvidenceUploadInput(value: unknown): ProofEvidenceUploadInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) validation("Request body must be a JSON object");
  const input = value as Record<string, unknown>;
  if (typeof input.fileName !== "string" || !input.fileName.trim()) validation("fileName is required");
  if (typeof input.contentType !== "string" || !(input.contentType in EXTENSIONS)) validation("Unsupported upload contentType");
  if (!Number.isInteger(input.sizeBytes) || (input.sizeBytes as number) < 1 || (input.sizeBytes as number) > PUBLICATION_PROOF_MAX_BYTES) {
    validation(`sizeBytes must be between 1 and ${PUBLICATION_PROOF_MAX_BYTES}`);
  }
  return {
    fileName: input.fileName.trim(),
    contentType: input.contentType as ProofEvidenceUploadInput["contentType"],
    sizeBytes: input.sizeBytes as number,
  };
}

export function validateProofEvidenceFinalizeInput(value: unknown): ProofEvidenceFinalizeInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) validation("Request body must be a JSON object");
  const checksum = (value as Record<string, unknown>).checksum;
  if (typeof checksum !== "string" || !checksum.trim() || checksum.trim().length > 256) validation("checksum is required");
  return { checksum: checksum.trim() };
}

function asset(row: AssetRow) {
  return {
    id: row.id,
    storageObjectPath: row.storage_object_path,
    path: row.storage_object_path,
    uploadState: row.upload_state,
    checksum: row.content_checksum ?? null,
    contentType: row.mime_type,
    sizeBytes: Number(row.byte_size),
    expiresAt: row.upload_grant_expires_at ?? null,
  };
}

function rpcFailure(error: { message?: string | null }): never {
  const message = error.message ?? "publication_proof_asset_failed";
  if (message.includes("not_found") || message.includes("not_authorized")) {
    throw new ActiveMissionError("WORKFLOW_NOT_FOUND", "Publication evidence asset not found");
  }
  if (message.includes("wrong_state") || message.includes("already_finalized") || message.includes("already_assigned")) {
    throw new ActiveMissionError("WRONG_STATE", "Publication evidence asset is no longer available");
  }
  if (message.includes("validation_failed") || message.includes("asset_limit")) {
    throw new ActiveMissionError("VALIDATION_FAILED", "Publication evidence asset is invalid");
  }
  throw new ActiveMissionError("UNKNOWN", "Publication evidence request failed", error);
}

export async function createProofEvidenceUploadGrant(
  client: SupabaseClient,
  owner: PublicationProofOwner,
  input: ProofEvidenceUploadInput,
  context: ProofMutationContext = {},
) {
  if (typeof context.expectedState !== "string" || !context.expectedState.trim() || !Number.isInteger(context.expectedRevision) || (context.expectedRevision as number) < 0 || typeof context.idempotencyKey !== "string" || !context.idempotencyKey.trim()) validation("expectedState, expectedRevision, and Idempotency-Key are required");
  const extension = EXTENSIONS[input.contentType];
  const workflowNamespace = owner.workflowId;
  const storageObjectPath = `${owner.creatorId}/${workflowNamespace}/${owner.workItemId}/proof-evidence/${randomUUID()}.${extension}`;
  const idempotencyKey = context.idempotencyKey;
  const result = await client.rpc("create_publication_proof_asset", {
    p_submission: owner.submissionId,
    p_creator: owner.creatorId,
    p_workspace: owner.workspaceId,
    p_work_item: owner.workItemId,
    p_filename: input.fileName,
    p_mime_type: input.contentType,
    p_byte_size: input.sizeBytes,
    p_storage_object_path: storageObjectPath,
    p_grant_seconds: PUBLICATION_PROOF_UPLOAD_GRANT_SECONDS,
    p_expected_state: context.expectedState,
    p_expected_revision: context.expectedRevision,
    p_idempotency_key: idempotencyKey,
  });
  if (result.error) rpcFailure(result.error);
  const row = result.data as AssetRow | null;
  if (!row) throw new ActiveMissionError("WORKFLOW_NOT_FOUND", "Publication evidence work item not found");

  let signed: { data: { token: string } | null; error: { message: string } | null };
  try {
    signed = await client.storage.from(PUBLICATION_PROOF_ASSET_BUCKET).createSignedUploadUrl(row.storage_object_path, { upsert: false });
  } catch (error) {
    signed = { data: null, error: { message: error instanceof Error ? error.message : "Unable to create upload grant" } };
  }
  if (signed.error || !signed.data) {
    try {
      await client.rpc("abandon_publication_proof_asset", {
        p_submission: owner.submissionId,
        p_creator: owner.creatorId,
        p_workspace: owner.workspaceId,
        p_work_item: owner.workItemId,
        p_asset: row.id,
        p_storage_object_path: row.storage_object_path,
      });
    } catch {
      // Cleanup is best effort; preserve the actionable signing failure.
    }
    throw new ActiveMissionError("UNKNOWN", signed.error?.message ?? "Unable to create upload grant");
  }
  const expiresAt = row.upload_grant_expires_at ?? null;
  return {
    asset: asset(row),
    token: signed.data.token,
    expiresAt,
    expiresInSeconds: PUBLICATION_PROOF_UPLOAD_GRANT_SECONDS,
    upload: {
      path: row.storage_object_path,
      token: signed.data.token,
      expiresAt,
      expiresInSeconds: PUBLICATION_PROOF_UPLOAD_GRANT_SECONDS,
      upsert: false,
    },
  };
}

export async function finalizeProofEvidence(
  client: SupabaseClient,
  owner: PublicationProofOwner & { assetId: string },
  input: ProofEvidenceFinalizeInput,
  context: ProofMutationContext = {},
) {
  if (typeof context.expectedState !== "string" || !context.expectedState.trim() || !Number.isInteger(context.expectedRevision) || (context.expectedRevision as number) < 0 || typeof context.idempotencyKey !== "string" || !context.idempotencyKey.trim()) validation("expectedState, expectedRevision, and Idempotency-Key are required");
  const result = await client.rpc("finalize_publication_proof_asset", {
    p_submission: owner.submissionId,
    p_creator: owner.creatorId,
    p_workspace: owner.workspaceId,
    p_work_item: owner.workItemId,
    p_asset: owner.assetId,
    p_checksum: input.checksum,
    p_expected_state: context.expectedState,
    p_expected_revision: context.expectedRevision,
    p_idempotency_key: context.idempotencyKey,
  });
  if (result.error) rpcFailure(result.error);
  if (!result.data) throw new ActiveMissionError("WORKFLOW_NOT_FOUND", "Publication evidence asset not found");
  return asset(result.data as AssetRow);
}


