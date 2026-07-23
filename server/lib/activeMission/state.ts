import { ActiveMissionError } from "./errors.js";
import type {
  DraftPatch,
  ProofChecklist,
  ProofInput,
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
  approved_to_publish: ["proof_submitted", "cancelled"],
  proof_submitted: ["proof_under_review", "cancelled", "expired"],
  proof_under_review: [
    "proof_correction_requested",
    "proof_verified",
    "cancelled",
    "expired",
  ],
  proof_correction_requested: ["proof_submitted", "cancelled", "expired"],
  proof_verified: ["cancelled"],
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

  const requiredItems = items.filter((item) => item.required);
  if (requiredItems.every((item) => item.state === "proof_verified")) {
    return "proof_verified";
  }
  if (
    requiredItems.some(
      (item) =>
        item.state === "proof_submitted" ||
        item.state === "proof_under_review" ||
        item.state === "proof_correction_requested",
    )
  ) {
    return "publication_in_progress";
  }
  if (requiredItems.every((item) => item.state === "approved_to_publish")) {
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
    Number(right.submittedLate) - Number(left.submittedLate) ||
    compareTimestamp(left.deadline, right.deadline) ||
    compareTimestamp(left.reviewDueAt, right.reviewDueAt) ||
    compareTimestamp(left.submittedAt, right.submittedAt)
  );
}

export function validateProofChecklist(
  checklist: unknown,
): asserts checklist is ProofChecklist {
  if (
    checklist === null ||
    typeof checklist !== "object" ||
    Array.isArray(checklist)
  ) {
    invalid("proof checklist must be an object");
  }

  const value = checklist as Record<string, unknown>;
  const keys: (keyof ProofChecklist)[] = [
    "publicly_accessible",
    "platform_matches",
    "account_matches",
    "content_matches_approved_version",
    "timing_acceptable",
    "disclosures_present",
  ];
  if (Object.keys(value).length !== keys.length) {
    invalid("proof checklist must contain exactly the required keys");
  }
  for (const key of keys) {
    if (typeof value[key] !== "boolean") {
      invalid(`proof checklist value for ${key} must be boolean`);
    }
  }
}

export function normalizeProofInput(input: unknown): ProofInput {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    invalid("proof input must be an object");
  }

  const value = input as Record<string, unknown>;
  const primaryUrl = normalizeNonBlankString(value.primaryUrl, "primaryUrl");
  const additionalUrls = normalizeOptionalStringArray(
    value.additionalUrls,
    "additionalUrls",
  );
  if (additionalUrls.length > 4) {
    invalid("additionalUrls may contain at most four URLs");
  }

  const allUrls = [primaryUrl, ...additionalUrls];
  if (new Set(allUrls).size !== allUrls.length) {
    invalid("proof URLs must be unique");
  }

  const evidenceAssetIds = normalizeOptionalStringArray(
    value.evidenceAssetIds,
    "evidenceAssetIds",
  );
  if (new Set(evidenceAssetIds).size !== evidenceAssetIds.length) {
    invalid("evidenceAssetIds must be unique");
  }

  return { primaryUrl, additionalUrls, evidenceAssetIds };
}

function normalizeNonBlankString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    invalid(`${field} must be a non-blank string`);
  }
  return value.trim();
}

function normalizeOptionalStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    invalid(`${field} must be an array of strings`);
  }
  return value.map((entry) => normalizeNonBlankString(entry, field));
}

function invalid(message: string): never {
  throw new ActiveMissionError(
    "VALIDATION_FAILED",
    `VALIDATION_FAILED: ${message}`,
  );
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
