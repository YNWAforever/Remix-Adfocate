export type WorkflowState =
  | "accepted"
  | "fulfillment_pending"
  | "drafting"
  | "in_review"
  | "revision_requested"
  | "approved_to_publish"
  | "publication_in_progress"
  | "proof_verified"
  | "reward_pending"
  | "cancelled"
  | "expired";

export type RewardHandoffStatus = "pending" | "cancelled";

export type RewardContract = {
  id: string;
  pointsAmount: number;
  cashAmount: number;
  currency: string;
  xpAmount: number;
  source: "join" | "operator_backfill";
  createdAt: string;
};

export type PendingReward = {
  id: string;
  status: RewardHandoffStatus;
  reward: Pick<RewardContract, "pointsAmount" | "cashAmount" | "currency" | "xpAmount">;
  processingWindowDays: number | null;
  targetAt: string | null;
  createdAt: string;
  cancelledAt: string | null;
};

export type WorkItemState =
  | "blocked_by_fulfillment"
  | "drafting"
  | "submitted"
  | "under_review"
  | "revision_requested"
  | "approved_to_publish"
  | "proof_submitted"
  | "proof_under_review"
  | "proof_correction_requested"
  | "proof_verified"
  | "cancelled"
  | "expired";

export type FulfillmentState = "preparing" | "shipped" | "received";

export interface WorkflowStateInput {
  fulfillment: FulfillmentState | null;
  items: readonly {
    state: WorkItemState;
    required: boolean;
  }[];
}

export interface DraftPatch {
  caption?: string;
  externalUrl?: string | null;
  checklist?: Record<string, boolean>;
}

export type ProofReviewCategory =
  | "access"
  | "platform"
  | "account"
  | "content"
  | "timing"
  | "disclosure"
  | "evidence"
  | "other";

export interface ProofChecklist {
  publicly_accessible: boolean;
  platform_matches: boolean;
  account_matches: boolean;
  content_matches_approved_version: boolean;
  timing_acceptable: boolean;
  disclosures_present: boolean;
}

export interface ProofInput {
  primaryUrl: string;
  additionalUrls?: string[];
  evidenceAssetIds?: string[];
}

export interface ProofReviewItemInput {
  category: ProofReviewCategory;
  text: string;
  position: number;
}

export interface ProofMetadataSnapshot {
  finalCanonicalUrl: string | null;
  httpStatusCategory:
    | "success"
    | "redirect"
    | "client_error"
    | "server_error"
    | "unknown";
  pageTitle: string | null;
  openGraphType: string | null;
  declaredPublicationTime: string | null;
  fetchedAt: string;
}

export interface QueueItem {
  submittedLate?: boolean;
  deadline?: string | null;
  reviewDueAt?: string | null;
  submittedAt?: string | null;
  publicationDueAt?: string | null;
  creatorResponseDeadline?: string | null;
  workItemId?: string;
}
