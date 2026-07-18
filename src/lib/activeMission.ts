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
    | "contact_support";
  workItemId: string | null;
  deadline: string | null;
  blockedReason: string | null;
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
  if (workflow.state === "approved_to_publish") {
    return {
      kind: "await_publication",
      workItemId: null,
      deadline: workflow.deadline,
      blockedReason: "approval_is_not_completion",
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

  const revision = firstByDeadline(workItems.filter((item) => item.state === "revision_requested"));
  if (revision) return actionForItem("revise", revision);

  const draft = firstByDeadline(workItems.filter((item) => item.state === "drafting"));
  if (draft) return actionForItem("draft", draft);

  const waiting = firstByDeadline(workItems.filter((item) => item.state === "submitted" || item.state === "under_review"));
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
