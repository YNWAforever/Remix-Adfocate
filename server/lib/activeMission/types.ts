export type WorkflowState =
  | "accepted"
  | "fulfillment_pending"
  | "drafting"
  | "in_review"
  | "revision_requested"
  | "approved_to_publish"
  | "cancelled"
  | "expired";

export type WorkItemState =
  | "blocked_by_fulfillment"
  | "drafting"
  | "submitted"
  | "under_review"
  | "revision_requested"
  | "approved_to_publish"
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

export interface QueueItem {
  deadline?: string | null;
  reviewDueAt?: string | null;
  submittedAt?: string | null;
}
