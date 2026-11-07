import type { SupportedImageMime } from "./assetPolicy.js";
import type { ImageAnalysisResult } from "./imageAnalysis.js";
import type { GrowthSkillId } from "../../../src/lib/creatorGrowth/skillManifest.js";
import type { PublicImageVisibility } from "./mediaMatch.js";
import type { GrowthEvidenceReport } from "./report.js";
import type { GrowthSkillResult } from "./skillRunner.js";

export const CREATOR_GROWTH_STORAGE_BUCKET = "creator-growth-private";

export type GrowthOwner = Readonly<{
  workspaceId: string;
  creatorId: string;
}>;

export type GrowthMutationContext = Readonly<{
  idempotencyKey: string;
}>;

export type GrowthAssetInput = Readonly<{
  id: string;
  threadId: string;
  bytes: Uint8Array;
  sha256: string;
  mime: SupportedImageMime;
  byteSize: number;
  width: number;
  height: number;
  rightsConfirmed: true;
  sourceKind: "creator-upload" | "synthetic-fixture";
  sampleOnly: boolean;
  fixtureId?: string | null;
  createdAt?: string;
}>;

export type GrowthAssetRecord = Readonly<{
  id: string;
  threadId: string;
  sha256: string;
  mime: SupportedImageMime;
  byteSize: number;
  width: number;
  height: number;
  rightsConfirmed: true;
  sourceKind: "creator-upload" | "synthetic-fixture";
  sampleOnly: boolean;
  fixtureId: string | null;
  uploadState: "pending" | "uploaded";
  createdAt: string;
  expiresAt: string;
}>;

export type GrowthMediaSourceInput = Readonly<{
  id: string;
  threadId: string;
  assetId?: string | null;
  connectionId?: string | null;
  generation?: number | null;
  sourceKind: "official_instagram" | "public_image_mock" | "creator_upload";
  sourceRef: string;
  subject: string | null;
  mediaId: string | null;
  permalink: string | null;
  rights: "allowed" | "unknown" | "denied";
  visibility: PublicImageVisibility;
  matchStatus: "matched" | "unverified" | "rejected";
  sampleOnly: boolean;
  observedAt: string;
  fetchedAt: string;
  createdAt?: string;
}>;

export type GrowthMediaSourceRecord = GrowthMediaSourceInput &
  Readonly<{
    invalidatedAt: string | null;
    revokedAt: string | null;
  }>;

export type GrowthConsentInput = Readonly<{
  id: string;
  processor: string;
  consentVersion: string;
  grantedAt: string;
  expiresAt: string;
  connectionId?: string | null;
  generation?: number | null;
}>;

export type GrowthConsentRecord = GrowthConsentInput &
  Readonly<{
    revokedAt: string | null;
  }>;

export type GrowthAnalysisInput = Readonly<{
  id: string;
  threadId: string;
  mediaSourceId?: string | null;
  assetId: string;
  consentId?: string | null;
  connectionId?: string | null;
  generation?: number | null;
  processor: string;
  processorVersion: string;
  result: ImageAnalysisResult;
  createdAt?: string;
}>;

export type GrowthAnalysisRecord = GrowthAnalysisInput &
  Readonly<{
    invalidatedAt: string | null;
    createdAt: string;
  }>;

export type GrowthSkillInvocationInput = Readonly<{
  id: string;
  threadId: string;
  analysisId: string;
  mediaSourceIds: readonly string[];
  skillId: GrowthSkillId;
  report: GrowthEvidenceReport;
  result: GrowthSkillResult;
  createdAt?: string;
}>;

export type GrowthSkillInvocationRecord = GrowthSkillInvocationInput &
  Readonly<{
    invalidatedAt: string | null;
    createdAt: string;
  }>;

export type GrowthDraftInput = Readonly<{
  id: string;
  threadId: string;
  assetId?: string | null;
  analysisId?: string | null;
  skillInvocationId?: string | null;
  expectedRevision: number;
  caption: string;
  manualDescription: string;
  status: "private" | "completed" | "cancelled" | "invalidated";
}>;

export type GrowthDraftRecord = Readonly<{
  id: string;
  threadId: string;
  assetId: string | null;
  analysisId: string | null;
  skillInvocationId: string | null;
  revision: number;
  caption: string;
  manualDescription: string;
  status: "private" | "completed" | "cancelled" | "invalidated";
  terminalAt: string | null;
  invalidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type GrowthDraftStatusInput = Readonly<{
  expectedRevision: number;
  status: "private" | "completed" | "cancelled";
  changedAt: string;
}>;

export type GrowthEventInput = Readonly<{
  id: string;
  code:
    | "asset_created"
    | "asset_confirmed"
    | "analysis_saved"
    | "skill_saved"
    | "draft_saved"
    | "draft_completed"
    | "draft_cancelled"
    | "generation_revoked"
    | "retention"
    | "owner_purge"
    | "storage_cleanup_completed"
    | "storage_cleanup_failed";
  createdAt: string;
  entityId: string | null;
}>;

export type GrowthEventRecord = GrowthEventInput &
  Readonly<{ workspaceId: string; creatorId: string }>;

export type GrowthStorageCleanupRecord = Readonly<{
  id: string;
  bucket: string;
  objectPath: string;
  reason: "retention" | "owner_purge" | "upload_abandoned";
  state: "queued" | "processing" | "completed" | "exhausted";
  availableAt: string;
  completedAt: string | null;
  attempts: number;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  lastError: string | null;
}>;

export type GrowthRetentionResult = Readonly<{
  now: string;
  assetsQueued: number;
  draftsDeleted: number;
  eventsDeleted: number;
  cleanupQueued: number;
  receiptsDeleted: number;
}>;

export type GrowthPurgeReceipt = Readonly<{
  state: "pending_physical_cleanup";
  cleanupQueued: number;
  metadataRowsDeleted: number;
}>;

export type GrowthCleanupResult = Readonly<{
  claimed: number;
  completed: number;
  failed: number;
  exhausted: number;
}>;

export type GrowthOwnerExport = Readonly<{
  assets: readonly GrowthAssetRecord[];
  mediaSources: readonly GrowthMediaSourceRecord[];
  consents: readonly GrowthConsentRecord[];
  analyses: readonly GrowthAnalysisRecord[];
  skillInvocations: readonly GrowthSkillInvocationRecord[];
  drafts: readonly GrowthDraftRecord[];
  events: readonly GrowthEventRecord[];
}>;

// Server-only preparation, separate from browser DTOs and mutation receipts.
// It is written once before any multi-write side effects; no upload bytes or
// raw caller-authored reports enter this record.
export type GrowthRouteCommandInput = Readonly<{
  operation: "analyse" | "skills" | "media/select";
  threadId: string;
  requestHash: string;
  assetId: string | null;
  analysisId: string | null;
  mediaSourceIds: readonly string[];
  connectionId: string | null;
  generation: number | null;
}>;

export type GrowthRoutePlan =
  | Readonly<{ operation: "media/select"; official: GrowthMediaSourceInput; publicImage: GrowthMediaSourceInput; reason: string }>
  | Readonly<{ operation: "analyse"; source: GrowthMediaSourceInput | null; consent: GrowthConsentInput; analysis: GrowthAnalysisInput }>
  | Readonly<{ operation: "skills"; invocation: GrowthSkillInvocationInput }>;

export type GrowthRouteCommand = Readonly<{
  startedAt: string;
  plan: GrowthRoutePlan | null;
}>;

export type GrowthRepository = Readonly<{
  routeCommand(
    owner: GrowthOwner,
    input: GrowthRouteCommandInput,
    context: GrowthMutationContext,
    plan?: GrowthRoutePlan,
  ): Promise<GrowthRouteCommand>;
  putAsset(
    owner: GrowthOwner,
    asset: GrowthAssetInput,
    context: GrowthMutationContext,
  ): Promise<GrowthAssetRecord>;
  getAssetBytes(owner: GrowthOwner, assetId: string): Promise<Uint8Array>;
  saveMediaSource(
    owner: GrowthOwner,
    source: GrowthMediaSourceInput,
    context: GrowthMutationContext,
  ): Promise<GrowthMediaSourceRecord>;
  saveConsent(
    owner: GrowthOwner,
    consent: GrowthConsentInput,
    context: GrowthMutationContext,
  ): Promise<GrowthConsentRecord>;
  saveAnalysis(
    owner: GrowthOwner,
    analysis: GrowthAnalysisInput,
    context: GrowthMutationContext,
  ): Promise<GrowthAnalysisRecord>;
  saveSkillInvocation(
    owner: GrowthOwner,
    invocation: GrowthSkillInvocationInput,
    context: GrowthMutationContext,
  ): Promise<GrowthSkillInvocationRecord>;
  saveDraft(
    owner: GrowthOwner,
    draft: GrowthDraftInput,
    context: GrowthMutationContext,
  ): Promise<GrowthDraftRecord>;
  getPrivateDraft(
    owner: GrowthOwner,
    draftId: string,
  ): Promise<GrowthDraftRecord | null>;
  setDraftStatus(
    owner: GrowthOwner,
    draftId: string,
    input: GrowthDraftStatusInput,
    context: GrowthMutationContext,
  ): Promise<GrowthDraftRecord>;
  recordEvent(
    owner: GrowthOwner,
    event: GrowthEventInput,
    context: GrowthMutationContext,
  ): Promise<GrowthEventRecord>;
  applyRetention(
    owner: GrowthOwner,
    now: Date,
    context: GrowthMutationContext,
  ): Promise<GrowthRetentionResult>;
  purgeOwner(
    owner: GrowthOwner,
    context: GrowthMutationContext,
  ): Promise<GrowthPurgeReceipt>;
  listStorageCleanup(
    owner: GrowthOwner,
  ): Promise<readonly GrowthStorageCleanupRecord[]>;
  processStorageCleanup(
    owner: GrowthOwner,
    context: GrowthMutationContext,
    limit?: number,
  ): Promise<GrowthCleanupResult>;
  exportOwner(owner: GrowthOwner): Promise<GrowthOwnerExport>;
}>;

export type GrowthRepositoryErrorCode =
  | "GENERATION_REVOKED"
  | "IDEMPOTENCY_CONFLICT"
  | "IDEMPOTENCY_EXPIRED"
  | "INVALID_IDEMPOTENCY_CONTEXT"
  | "INVALID_OWNER"
  | "INVALID_STORAGE_PATH"
  | "NOT_ACTIVE_CREATOR"
  | "NOT_FOUND"
  | "PERSISTENCE_DISABLED"
  | "REVISION_CONFLICT"
  | "SOURCE_INVALIDATED"
  | "STORAGE_UNAVAILABLE";

export class GrowthRepositoryError extends Error {
  constructor(
    readonly code: GrowthRepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GrowthRepositoryError";
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertGrowthOwner(owner: GrowthOwner): void {
  if (
    owner === null ||
    typeof owner !== "object" ||
    !UUID.test(owner.workspaceId) ||
    !UUID.test(owner.creatorId)
  ) {
    throw new GrowthRepositoryError("INVALID_OWNER", "A valid server owner is required.");
  }
}

export function assertGrowthMutationContext(
  context: GrowthMutationContext,
): void {
  if (
    context === null ||
    typeof context !== "object" ||
    !UUID.test(context.idempotencyKey)
  ) {
    throw new GrowthRepositoryError(
      "INVALID_IDEMPOTENCY_CONTEXT",
      "A valid server idempotency context is required.",
    );
  }
}

export function assertGrowthId(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new GrowthRepositoryError("NOT_FOUND", `${label} is invalid.`);
  }
  return value;
}

export function ownerStoragePrefix(owner: GrowthOwner): string {
  return `${owner.workspaceId}/${owner.creatorId}/`;
}
