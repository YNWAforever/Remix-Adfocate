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

export type CompletionEligibility = {
  eligible: boolean;
  blockers: Array<
    | "wrong_state"
    | "required_proof_incomplete"
    | "reward_contract_required"
    | "pending_reward_exists"
  >;
  requiredItemCount: number;
  verifiedRequiredItemCount: number;
};

export type CompletionDecision = {
  id: string;
  missionWorkflowId: string;
  decisionKind: "approved" | "cancelled";
  rewardContractId: string;
  pendingRewardId: string | null;
  supersedesDecisionId: string | null;
  workflowRevision: number;
  requiredItemCount: number;
  verifiedRequiredItemCount: number;
  evidenceSnapshot: Readonly<Record<string, unknown>>;
  decidedAt: string;
};

export type PendingReward = {
  id: string | null;
  status: RewardHandoffStatus;
  reward: Pick<RewardContract, "pointsAmount" | "cashAmount" | "currency" | "xpAmount">;
  processingWindowDays: number | null;
  targetAt: string | null;
  createdAt: string;
  cancelledAt: string | null;
  decisionState?: Readonly<{ kind: "approved" | "cancelled"; decidedAt: string }>;
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

export type MissionBriefSnapshot = {
  description: string | null;
  deliverables: string[];
  requirements: string[];
  platforms: string[];
  effort: string | null;
  targetAudience: string | null;
  dos: string[];
  donts: string[];
  keyMessages: string[];
  referenceLinks: string[];
};

export type MissionWorkflow = {
  id: string;
  submissionId: string;
  state: WorkflowState;
  acceptedAt: string;
  deadline: string | null;
  revision: number;
  fulfillmentRequired: boolean;
  revisionLimit: number;
  reviewSlaHours: number;
  revisionResponseHours: number;
  createdAt: string;
  updatedAt: string;
};

export type MissionDraft = {
  id: string;
  caption: string;
  externalUrl: string | null;
  checklist: Record<string, boolean>;
  revision: number;
  lastSavedAt: string;
};

export type MissionDraftAssetView = {
  id: string;
  versionId: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string | null;
  uploadState: string;
  signedUrl: string | null;
};

export type MissionRequiredChangeView = {
  id: string;
  requirementId: string | null;
  category: string;
  text: string;
  required: boolean;
  position: number;
  createdAt: string;
};

export type MissionReviewRoundView = {
  id: string;
  versionId: string;
  roundNumber: number;
  state: string;
  reviewerId: string | null;
  reviewStartedAt: string | null;
  decisionAt: string | null;
  creatorResponseDeadline: string | null;
  requiredChanges: MissionRequiredChangeView[];
};

export type MissionDraftVersionView = {
  id: string;
  versionNumber: number;
  caption: string;
  externalUrl: string | null;
  checklist: Record<string, boolean>;
  contentChecksum: string;
  submittedAt: string;
  state: "submitted" | "under_review" | "revision_requested" | "approved_to_publish";
  decisionAt: string | null;
  assets: MissionDraftAssetView[];
};

export type PublicationProofChecklist = Readonly<{
  publiclyAccessible: boolean;
  platformMatches: boolean;
  accountMatches: boolean;
  contentMatchesApprovedVersion: boolean;
  timingAcceptable: boolean;
  disclosuresPresent: boolean;
}>;

export type PublicationProofCorrectionView = Readonly<{
  id: string;
  category: "access" | "platform" | "account" | "content" | "timing" | "disclosure" | "evidence" | "other";
  text: string;
  position: number;
  passed?: boolean | null;
  createdAt?: string;
}>;

export type PublicationProofReviewView = Readonly<{
  id: string;
  state: "open" | "correction_requested" | "verified";
  decision: "rejected" | "verified" | null;
  reviewedAt: string | null;
  createdAt: string;
  creatorResponseDeadline: string | null;
}>;

export type PublicationProofEvidenceView = Readonly<{
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  signedUrl: string;
}>;

export type PublicationProofAttemptView = Readonly<{
  id: string;
  attemptNumber: number;
  primaryUrl: string;
  additionalUrls: readonly string[];
  submittedAt: string;
  submittedLate: boolean;
  metadataStatus: "available" | "unavailable" | "unsafe";
  metadataSnapshot: Readonly<Record<string, unknown>>;
  metadataErrorCategory: string | null;
  evidence: readonly PublicationProofEvidenceView[];
  review: PublicationProofReviewView | null;
  corrections: readonly PublicationProofCorrectionView[];
}>;

export type MissionPublicationInstructionsView = Readonly<{
  publicationInstructions: string;
  requiredDisclosures: readonly string[];
  expectedAccount: string | null;
  proofEvidencePolicy: Readonly<Record<string, unknown>>;
  publishDueAt: string;
  frozenAt: string | null;
}>;

export type MissionPublicationView = Readonly<{
  workItemId: string;
  platform: string;
  state: WorkItemState;
  revision: number;
  approvedVersionId: string | null;
  instructions: MissionPublicationInstructionsView;
  attempts: readonly PublicationProofAttemptView[];
  currentAttempt: PublicationProofAttemptView | null;
  acceptedAttempt: PublicationProofAttemptView | null;
}>;
export function publicationEvidenceRequired(policy: Readonly<Record<string, unknown>>): boolean {
  return Object.keys(policy).length > 0;
}


export type PublicationStateOwner = "creator" | "operator" | "none";

export const publicationStatePresentation = {
  approved_to_publish: { labelKey: "activeMission.state.approvedToPublish", owner: "creator" },
  proof_submitted: { labelKey: "activeMission.state.proofSubmitted", owner: "operator" },
  proof_under_review: { labelKey: "activeMission.state.proofUnderReview", owner: "operator" },
  proof_correction_requested: { labelKey: "activeMission.state.proofCorrectionRequested", owner: "creator" },
  proof_verified: { labelKey: "activeMission.state.proofVerified", owner: "none" },
} as const satisfies Record<
  Extract<WorkItemState, "approved_to_publish" | "proof_submitted" | "proof_under_review" | "proof_correction_requested" | "proof_verified">,
  { labelKey: string; owner: PublicationStateOwner }
>;

export type MissionWorkItemView = {
  id: string;
  title: string;
  platform: string;
  requirements: Array<Record<string, unknown>>;
  required: boolean;
  position: number;
  deadline: string | null;
  state: WorkItemState;
  draft: MissionDraft | null;
  currentSubmittedVersionId: string | null;
  approvedVersionId: string | null;
  reviewStartedAt: string | null;
  reviewDueAt: string | null;
  draftAssets?: MissionDraftAssetView[];
  versions?: MissionDraftVersionView[];
  reviewRounds?: MissionReviewRoundView[];
  requiredChanges?: MissionRequiredChangeView[];
  revisionDeadline?: string | null;
};

export type MissionFulfillment = {
  id: string;
  status: FulfillmentState;
  shippedAt: string | null;
  receivedAt: string | null;
  operationalNote: string | null;
};

export type MissionWorkflowEvent = {
  id: string;
  workItemId: string | null;
  actorType: "creator" | "operator" | "system";
  actorId: string | null;
  eventType: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ServerNextAction = {
  kind: string;
  workItemId: string | null;
  deadline: string | null;
  blockedReason: string | null;
};

export type ActiveMissionWorkspace = {
  workflow: MissionWorkflow;
  mission: { id: string; slug: string; title: string; missionType: string; brief: MissionBriefSnapshot };
  fulfillment: MissionFulfillment | null;
  workItems: MissionWorkItemView[];
  events: MissionWorkflowEvent[];
  nextAction: ServerNextAction;
  rewardContract?: RewardContract | null;
  completionEligibility?: CompletionEligibility;
  pendingReward?: PendingReward | null;
};

export type ActiveMissionNextAction = {
  kind:
    | "wait_for_setup"
    | "wait_for_shipment"
    | "confirm_receipt"
    | "draft"
    | "revise"
    | "await_review"
    | "await_publication"
    | "publish_and_submit_proof"
    | "await_proof_review"
    | "revise_publication_proof"
    | "proof_verified"
    | "contact_support";
  workItemId: string | null;
  deadline: string | null;
  blockedReason: string | null;
  owner?: PublicationStateOwner;
};

function deadlineValue(value: string | null): number {
  if (value === null) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function firstByDeadline(items: MissionWorkItemView[]): MissionWorkItemView | undefined {
  return [...items].sort((left, right) => {
    const deadlineDifference = deadlineValue(left.deadline) - deadlineValue(right.deadline);
    if (deadlineDifference !== 0) return deadlineDifference;
    const positionDifference = left.position - right.position;
    return positionDifference !== 0 ? positionDifference : left.id.localeCompare(right.id);
  })[0];
}

function actionForItem(
  kind: ActiveMissionNextAction["kind"],
  item: MissionWorkItemView,
  blockedReason: string | null = null,
): ActiveMissionNextAction {
  return { kind, workItemId: item.id, deadline: item.deadline, blockedReason };
}

export function deriveNextAction(workspace: ActiveMissionWorkspace): ActiveMissionNextAction {
  const { workflow, fulfillment, workItems } = workspace;
  if (workflow.state === "cancelled" || workflow.state === "expired") {
    return {
      kind: "contact_support",
      workItemId: null,
      deadline: workflow.deadline,
      blockedReason: workflow.state === "cancelled" ? "workflow_cancelled" : "workflow_expired",
    };
  }
  const publicationItem = (state: WorkItemState, requiredOnly = false) =>
    firstByDeadline(workItems.filter((item) => item.state === state && (!requiredOnly || item.required)));
  if (workflow.state === "proof_verified") {
    const verified = publicationItem("proof_verified", true) ?? publicationItem("proof_verified");
    return verified
      ? { ...actionForItem("proof_verified", verified), owner: "none" }
      : { kind: "contact_support", workItemId: null, deadline: workflow.deadline, blockedReason: "workflow_state_inconsistent" };
  }
  if (workflow.state === "approved_to_publish") {
    const approved = publicationItem("approved_to_publish", true) ?? publicationItem("approved_to_publish");
    return approved
      ? { ...actionForItem("publish_and_submit_proof", approved), owner: "creator" }
      : { kind: "await_publication", workItemId: null, deadline: workflow.deadline, blockedReason: "approval_is_not_completion" };
  }
  if (workflow.state === "publication_in_progress") {
    const correction = publicationItem("proof_correction_requested", true)
      ?? publicationItem("proof_correction_requested");
    if (correction) {
      return { ...actionForItem("revise_publication_proof", correction), owner: "creator" };
    }
    const approved = publicationItem("approved_to_publish", true) ?? publicationItem("approved_to_publish");
    if (approved) {
      return { ...actionForItem("publish_and_submit_proof", approved), owner: "creator" };
    }
    const submitted = publicationItem("proof_submitted", true)
      ?? publicationItem("proof_under_review", true)
      ?? publicationItem("proof_submitted")
      ?? publicationItem("proof_under_review");
    if (submitted) {
      return {
        ...actionForItem("await_proof_review", submitted, "operator_proof_review"),
        owner: "operator",
      };
    }
    return {
      kind: "contact_support",
      workItemId: null,
      deadline: workflow.deadline,
      blockedReason: "workflow_state_inconsistent",
    };
  }

  if (workItems.length === 0) {
    return {
      kind: workflow.state === "accepted" ? "wait_for_setup" : "contact_support",
      workItemId: null,
      deadline: workflow.deadline,
      blockedReason: workflow.state === "accepted" ? "work_items_not_ready" : "workflow_has_no_work_items",
    };
  }

  const blockedItem = firstByDeadline(workItems.filter((item) => item.state === "blocked_by_fulfillment"));
  if (workflow.state === "fulfillment_pending") {
    if (fulfillment?.status === "preparing") {
      return blockedItem
        ? actionForItem("wait_for_shipment", blockedItem, "fulfillment_not_shipped")
        : { kind: "wait_for_shipment", workItemId: null, deadline: workflow.deadline, blockedReason: "fulfillment_not_shipped" };
    }
    if (fulfillment?.status === "shipped") {
      return blockedItem
        ? actionForItem("confirm_receipt", blockedItem, "fulfillment_receipt_required")
        : { kind: "confirm_receipt", workItemId: null, deadline: workflow.deadline, blockedReason: "fulfillment_receipt_required" };
    }
    return blockedItem
      ? actionForItem("contact_support", blockedItem, "fulfillment_state_inconsistent")
      : { kind: "contact_support", workItemId: null, deadline: workflow.deadline, blockedReason: "fulfillment_state_inconsistent" };
  }

  const revision = firstByDeadline(workItems.filter((item) => item.state === "revision_requested"));
  if (workflow.state === "revision_requested") {
    return revision
      ? actionForItem("revise", revision)
      : { kind: "contact_support", workItemId: null, deadline: workflow.deadline, blockedReason: "workflow_state_inconsistent" };
  }

  const waiting = firstByDeadline(workItems.filter((item) => item.state === "submitted" || item.state === "under_review"));
  if (workflow.state === "in_review") {
    return waiting
      ? actionForItem("await_review", waiting, "operator_review")
      : { kind: "contact_support", workItemId: null, deadline: workflow.deadline, blockedReason: "workflow_state_inconsistent" };
  }

  const requiredDraft = firstByDeadline(workItems.filter((item) => item.required && item.state === "drafting"));
  if (requiredDraft) return actionForItem("draft", requiredDraft);

  const draft = firstByDeadline(workItems.filter((item) => !item.required && item.state === "drafting"));
  if (draft) return actionForItem("draft", draft);

  if (waiting) return actionForItem("await_review", waiting, "operator_review");

  const requiredItems = workItems.filter((item) => item.required);
  const allRequiredApproved = requiredItems.length > 0
    && requiredItems.every((item) => item.state === "approved_to_publish");
  if (allRequiredApproved) {
    return {
      kind: "await_publication",
      workItemId: null,
      deadline: workflow.deadline,
      blockedReason: "approval_is_not_completion",
    };
  }

  if (blockedItem) return actionForItem("contact_support", blockedItem, "fulfillment_state_inconsistent");
  return { kind: "contact_support", workItemId: null, deadline: workflow.deadline, blockedReason: "workflow_state_inconsistent" };
}
