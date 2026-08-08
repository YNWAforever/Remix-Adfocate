export const CREATOR_STUDIO_STATES = [
  "not_started", "drafting", "ready_to_submit", "submitted",
  "changes_requested", "resubmitted", "approved",
] as const;

export type CreatorStudioState = (typeof CREATOR_STUDIO_STATES)[number];
export type WorkItemState = CreatorStudioState;

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

export type OptionalSection<T> =
  | { status: "available"; value: T }
  | { status: "unavailable"; reason: "not_configured" | "temporarily_unavailable" };

export type SubmissionSummary = {
  id: string;
  creatorId: string;
  workspaceId: string;
  missionId: string;
  status: MissionSubmissionStatus;
};

export type MissionBrief = {
  missionId: string;
  title: string;
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
  state: WorkItemState;
  validation: WorkItemValidation;
  draft: WorkingDraft | null;
  assets: DraftAsset[];
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
  asset: DraftAsset;
  uploadUrl: string;
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
  type: "draft.saved" | "asset.reserved" | "asset.finalized" | "work_item.submitted";
  workItemId: string;
  workflowId: string;
  metadata: Record<string, string | number | boolean | null>;
};
