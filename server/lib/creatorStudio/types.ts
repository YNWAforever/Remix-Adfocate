import type {
  PublicationProofRequirement,
  PublicationProofSnapshot,
} from "./publicationProof.js";

export type {
  PublicationProofAttempt,
  PublicationProofEvidence,
  PublicationProofMetadata,
  PublicationProofRequirement,
  PublicationProofSnapshot,
} from "./publicationProof.js";

export const CREATOR_STUDIO_STATES = [
  "not_started", "drafting", "ready_to_submit", "submitted",
  "changes_requested", "resubmitted", "approved",
] as const;

export type CreatorStudioState = (typeof CREATOR_STUDIO_STATES)[number];
export type WorkItemState = CreatorStudioState;

export const CREATOR_STUDIO_MAX_COMMAND_ID_LENGTH = 128;
export const CREATOR_STUDIO_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const CREATOR_STUDIO_UPLOAD_MIME_TYPES = [
  "image/jpeg", "image/png", "image/webp", "video/mp4", "application/pdf",
] as const;
export type CreatorStudioUploadMimeType = (typeof CREATOR_STUDIO_UPLOAD_MIME_TYPES)[number];

export const isStrictHttpUrl = (value: string): boolean => {
  if (!value || value !== value.trim() || /\s/.test(value)) return false;

  const authority = value.slice(value.indexOf("://") + 3).split(/[/?#]/, 1)[0];
  if (!authority || authority.includes("@")) return false;

  if (authority.startsWith("[")) return false;
  const host = authority.match(/^([a-z0-9.-]+)(?::([0-9]{1,5}))?$/i);
  if (!host) return false;
  if (host[1].split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return false;
  const port = host[2];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return false;

  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && Boolean(url.hostname)
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
};

export const MISSION_SUBMISSION_STATUSES = [
  "applied", "joined", "submitted", "under_review", "approved", "rejected", "expired", "declined",
] as const;
export type MissionSubmissionStatus = (typeof MISSION_SUBMISSION_STATUSES)[number];

export type CreatorStudioContext = {
  actorId: string;
  workspaceId: string;
  submissionId: string;
};

export type DraftPatch = {
  caption?: string;
  externalUrl?: string | null;
  checklist?: Record<string, boolean>;
};

export type SaveDraftInput = {
  commandId: string;
  expectedVersion: number;
  patch: DraftPatch;
};

export type CreateUploadGrantInput = {
  commandId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
};

export type FinalizeAssetInput = {
  commandId: string;
  byteSize: number;
  mimeType: string;
  checksumSha256: string | null;
};

export type SubmitWorkItemInput = {
  commandId: string;
  expectedVersion: number;
};

export type CreatePublicationProofAttemptInput = {
  commandId: string;
  publishedUrl: string;
  platform: string;
};

export type CreateProofEvidenceGrantInput = {
  commandId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
};

export type FinalizeProofEvidenceInput = {
  commandId: string;
  byteSize: number;
  mimeType: string;
  checksumSha256: string | null;
};

export type SubmitPublicationProofInput = {
  commandId: string;
};

export type RefreshProofMetadataInput = {
  commandId: string;
};

export type OptionalSection<T> =
  | { status: "available"; value: T }
  | { status: "unavailable"; reason: "not_configured" | "temporarily_unavailable" };

export type SubmissionSummary = {
  id: string;
  creatorId: string;
  workspaceId: string;
  missionId: string;
  status: MissionSubmissionStatus;
  deadline: string | null;
};

export type MissionBrief = {
  missionId: string;
  title: string;
  description: string | null;
  deliverables: string[];
  requirements: string[];
  platforms: string[];
};

export type WorkflowSummary = {
  id: string;
  state: CreatorStudioState;
  revision: number;
};

export type WorkItemRequirements = {
  caption: boolean;
  externalUrl: boolean;
  checklist: string[];
};

export type WorkItemValidation = {
  caption: boolean;
  externalUrl: boolean;
  checklist: boolean;
  assets: boolean;
  publicationProof: boolean;
};

export type WorkingDraft = {
  caption: string | null;
  externalUrl: string | null;
  checklist: Record<string, boolean>;
  version: number;
  updatedAt: string;
};

export type DraftAsset = {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string | null;
  state: "pending" | "finalized";
  storagePath: string;
};

export type ReviewFeedback = {
  id: string;
  state: "changes_requested" | "approved";
  message: string;
};

export type WorkItem = {
  id: string;
  position: number;
  title: string;
  instructions: string;
  requirements: WorkItemRequirements;
  requiresAsset: boolean;
  proofRequirement: PublicationProofRequirement | null;
  state: WorkItemState;
  validation: WorkItemValidation;
  draft: WorkingDraft | null;
  assets: DraftAsset[];
  publicationProof: PublicationProofSnapshot;
  reviewFeedback: OptionalSection<ReviewFeedback[]>;
};

export type NextAction = {
  workItemId: string;
  state: WorkItemState;
  label: string;
};

export type SubmissionWorkspace = {
  submission: SubmissionSummary;
  brief: MissionBrief;
  workflow: WorkflowSummary;
  workItems: WorkItem[];
  nextAction: NextAction | null;
};

export type CommandResult<T> = { value: T; replayed: boolean };

export type DraftCommandResult = {
  draft: WorkingDraft;
  workItem: WorkItem;
  workflow: WorkflowSummary;
};

export type UploadGrant = {
  bucket: string;
  path: string;
  token: string;
  assetId: string;
  expiresAt: string;
};

export type FinalizedAsset = {
  asset: DraftAsset;
  workItem: WorkItem;
  workflow: WorkflowSummary;
};

export type SubmittedWorkItem = {
  workItem: WorkItem;
  workflow: WorkflowSummary;
};

export type CreatorStudioEvent = {
  id: string;
  type:
    | "draft.saved"
    | "asset.reserved"
    | "asset.finalized"
    | "work_item.submitted"
    | "proof.attempt_created"
    | "proof.evidence_reserved"
    | "proof.evidence_finalized"
    | "proof.submitted"
    | "proof.metadata_refreshed";
  workItemId: string;
  workflowId: string;
  metadata: Record<string, string | number | boolean | null>;
};
