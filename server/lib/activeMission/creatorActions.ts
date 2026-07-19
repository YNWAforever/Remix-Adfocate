import type { SupabaseClient } from "@supabase/supabase-js";
import { ActiveMissionError } from "./errors.js";
import type { ActiveMissionOwner } from "./repo.js";

export const MISSION_DRAFT_ASSET_BUCKET = "mission-draft-assets";
export const CREATOR_UPLOAD_GRANT_SECONDS = 600;

const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
} as const;

export type UploadGrantInput = {
  fileName: string;
  contentType: keyof typeof EXTENSIONS;
  sizeBytes: number;
};

export type FinalizeAssetInput = { checksum: string };
export type SubmitDraftInput = { expectedRevision: number; idempotencyKey: string };

type JsonRow = {
  id: string;
  storage_object_path: string;
  upload_state: string;
  checksum?: string | null;
  mime_type: string;
  byte_size: number | string;
  upload_grant_expires_at?: string;
  version?: unknown;
  work_item?: unknown;
};


function validation(message: string): never {
  throw new ActiveMissionError("VALIDATION_FAILED", message);
}

export function validateUploadGrantInput(value: unknown): UploadGrantInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) validation("Request body must be a JSON object");
  const input = value as Record<string, unknown>;
  if (typeof input.fileName !== "string" || !input.fileName.trim()) validation("fileName is required");
  if (typeof input.contentType !== "string" || !(input.contentType in EXTENSIONS)) validation("Unsupported upload contentType");
  if (!Number.isInteger(input.sizeBytes) || (input.sizeBytes as number) < 1 || (input.sizeBytes as number) > 20_971_520) {
    validation("sizeBytes must be between 1 and 20971520");
  }
  return {
    fileName: input.fileName.trim(),
    contentType: input.contentType as UploadGrantInput["contentType"],
    sizeBytes: input.sizeBytes as number,
  };
}

export function validateFinalizeInput(value: unknown): FinalizeAssetInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) validation("Request body must be a JSON object");
  const checksum = (value as Record<string, unknown>).checksum;
  if (typeof checksum !== "string" || !checksum.trim() || checksum.trim().length > 256) validation("checksum is required");
  return { checksum: checksum.trim() };
}

export function validateSubmitInput(value: unknown, idempotencyKey: string | undefined): SubmitDraftInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) validation("Request body must be a JSON object");
  const expectedRevision = (value as Record<string, unknown>).expectedRevision;
  if (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 0) validation("expectedRevision must be a non-negative integer");
  if (typeof idempotencyKey !== "string" || !idempotencyKey.trim() || idempotencyKey.trim().length > 200) validation("Idempotency-Key is required");
  return { expectedRevision: expectedRevision as number, idempotencyKey: idempotencyKey.trim() };
}

function rpcFailure(error: { message?: string | null }): never {
  const message = error.message ?? "creator_action_failed";
  if (message.includes("not_found")) throw new ActiveMissionError("WORKFLOW_NOT_FOUND", "Active mission not found");
  if (message.includes("stale_revision")) throw new ActiveMissionError("WORKFLOW_STALE", "Draft revision is stale");
  if (message.includes("wrong_state") || message.includes("assets_not_ready") || message.includes("upload_grant_expired")) {
    throw new ActiveMissionError("WRONG_STATE", message);
  }
  if (message.includes("asset_limit")) throw new ActiveMissionError("VALIDATION_FAILED", "A work item can have at most 5 assets");
  throw new ActiveMissionError("UNKNOWN", message, error);
}

function asset(row: JsonRow) {
  return {
    id: row.id as string,
    storageObjectPath: row.storage_object_path as string,
    path: row.storage_object_path as string,
    uploadState: row.upload_state as string,
    checksum: row.checksum ?? null,
    contentType: row.mime_type as string,
    sizeBytes: Number(row.byte_size),
  };
}

export async function createUploadGrant(
  client: SupabaseClient,
  owner: ActiveMissionOwner & { workItemId: string },
  input: UploadGrantInput,
) {
  const result = await client.rpc("create_active_mission_asset", {
    p_submission: owner.submissionId,
    p_creator: owner.creatorId,
    p_workspace: owner.workspaceId,
    p_work_item: owner.workItemId,
    p_filename: input.fileName,
    p_mime_type: input.contentType,
    p_byte_size: input.sizeBytes,
    p_extension: EXTENSIONS[input.contentType],
    p_grant_seconds: CREATOR_UPLOAD_GRANT_SECONDS,
  });
  if (result.error) rpcFailure(result.error);
  const row = result.data as JsonRow | null;
  if (!row) throw new ActiveMissionError("WORKFLOW_NOT_FOUND", "Active mission not found");

  const signed = await client.storage
    .from(MISSION_DRAFT_ASSET_BUCKET)
    .createSignedUploadUrl(row.storage_object_path as string, { upsert: false });
  if (signed.error || !signed.data) throw new ActiveMissionError("UNKNOWN", signed.error?.message ?? "Unable to create upload grant");
  const expiresAt = row.upload_grant_expires_at as string;
  return {
    asset: asset(row),
    token: signed.data.token,
    expiresAt,
    expiresInSeconds: CREATOR_UPLOAD_GRANT_SECONDS,
    upload: {
      path: row.storage_object_path as string,
      token: signed.data.token,
      expiresAt,
      expiresInSeconds: CREATOR_UPLOAD_GRANT_SECONDS,
      upsert: false,
    },
  };
}

export async function finalizeAsset(
  client: SupabaseClient,
  owner: ActiveMissionOwner & { workItemId: string; assetId: string },
  input: FinalizeAssetInput,
) {
  const result = await client.rpc("finalize_active_mission_asset", {
    p_submission: owner.submissionId,
    p_creator: owner.creatorId,
    p_workspace: owner.workspaceId,
    p_work_item: owner.workItemId,
    p_asset: owner.assetId,
    p_checksum: input.checksum,
  });
  if (result.error) rpcFailure(result.error);
  if (!result.data) throw new ActiveMissionError("WORKFLOW_NOT_FOUND", "Asset not found");
  return asset(result.data as JsonRow);
}

export async function submitDraft(
  client: SupabaseClient,
  owner: ActiveMissionOwner & { workItemId: string },
  input: SubmitDraftInput,
) {
  const result = await client.rpc("submit_active_mission_draft", {
    p_submission: owner.submissionId,
    p_creator: owner.creatorId,
    p_workspace: owner.workspaceId,
    p_work_item: owner.workItemId,
    p_expected_revision: input.expectedRevision,
    p_idempotency_key: input.idempotencyKey,
  });
  if (result.error) rpcFailure(result.error);
  const payload = result.data as JsonRow | null;
  if (!payload) throw new ActiveMissionError("WORKFLOW_NOT_FOUND", "Draft not found");
  return { version: payload.version, workItem: payload.work_item };
}
