import { ActiveMissionError } from "./errors.js";
import type {
  DraftPatch,
  QueueItem,
  WorkflowState,
  WorkflowStateInput,
  WorkItemState,
} from "./types.js";

const ALLOWED_TRANSITIONS: Record<WorkItemState, readonly WorkItemState[]> = {
  blocked_by_fulfillment: ["drafting", "cancelled", "expired"],
  drafting: ["submitted", "cancelled", "expired"],
  submitted: [
    "under_review",
    "revision_requested",
    "approved_to_publish",
    "cancelled",
    "expired",
  ],
  under_review: [
    "revision_requested",
    "approved_to_publish",
    "cancelled",
    "expired",
  ],
  revision_requested: ["submitted", "cancelled", "expired"],
  approved_to_publish: ["cancelled"],
  cancelled: [],
  expired: [],
};

export function deriveWorkflowState({
  fulfillment,
  items,
}: WorkflowStateInput): WorkflowState {
  if (fulfillment !== null && fulfillment !== "received") {
    return "fulfillment_pending";
  }
  if (
    items
      .filter((item) => item.required)
      .every((item) => item.state === "approved_to_publish")
  ) {
    return "approved_to_publish";
  }
  if (items.some((item) => item.state === "revision_requested")) {
    return "revision_requested";
  }
  if (
    items.some(
      (item) => item.state === "submitted" || item.state === "under_review",
    )
  ) {
    return "in_review";
  }
  return "drafting";
}

export function assertTransition(from: WorkItemState, to: WorkItemState): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new ActiveMissionError(
      "WRONG_STATE",
      `WRONG_STATE: cannot transition a work item from ${from} to ${to}`,
      { from, to },
    );
  }
}

export function validateDraftPatch(
  patch: unknown,
  knownRequirementIds: ReadonlySet<string> | readonly string[],
): asserts patch is DraftPatch {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    invalid("draft patch must be an object");
  }

  const value = patch as Record<string, unknown>;
  if (
    value.caption !== undefined &&
    (typeof value.caption !== "string" || value.caption.length > 10_000)
  ) {
    invalid("caption must be a string of at most 10000 characters");
  }

  if (
    value.externalUrl !== undefined &&
    value.externalUrl !== null &&
    !isHttpUrl(value.externalUrl)
  ) {
    invalid("externalUrl must be an HTTP(S) URL");
  }

  if (value.checklist !== undefined) {
    if (
      value.checklist === null ||
      typeof value.checklist !== "object" ||
      Array.isArray(value.checklist)
    ) {
      invalid("checklist must be an object of boolean values");
    }

    const known =
      knownRequirementIds instanceof Set
        ? knownRequirementIds
        : new Set(knownRequirementIds);
    for (const [requirementId, answer] of Object.entries(
      value.checklist as Record<string, unknown>,
    )) {
      if (!known.has(requirementId)) {
        invalid(`unknown checklist requirement ID: ${requirementId}`);
      }
      if (typeof answer !== "boolean") {
        invalid(`checklist value for ${requirementId} must be boolean`);
      }
    }
  }
}

export function compareQueueItems(left: QueueItem, right: QueueItem): number {
  return (
    compareTimestamp(left.deadline, right.deadline) ||
    compareTimestamp(left.reviewDueAt, right.reviewDueAt) ||
    compareTimestamp(left.submittedAt, right.submittedAt)
  );
}

function invalid(message: string): never {
  throw new ActiveMissionError("VALIDATION_FAILED", message);
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
}

function compareTimestamp(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const leftTime = timestampOrInfinity(left);
  const rightTime = timestampOrInfinity(right);
  return leftTime === rightTime ? 0 : leftTime < rightTime ? -1 : 1;
}

function timestampOrInfinity(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}
