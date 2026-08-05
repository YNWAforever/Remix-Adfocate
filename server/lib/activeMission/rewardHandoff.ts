import type { SupabaseClient } from "@supabase/supabase-js";

type JsonRow = Record<string, unknown>;

export type RewardHandoffErrorCode =
  | "VALIDATION_FAILED"
  | "NOT_AUTHENTICATED"
  | "FORBIDDEN"
  | "REWARD_CONTRACT_EXISTS"
  | "REWARD_CONTRACT_REQUIRED"
  | "COMPLETION_NOT_ELIGIBLE"
  | "WORKFLOW_STALE"
  | "WRONG_STATE"
  | "PENDING_REWARD_EXISTS"
  | "PENDING_REWARD_NOT_FOUND"
  | "CANCELLATION_NOT_ALLOWED"
  | "IDEMPOTENCY_CONFLICT"
  | "UNKNOWN";

export class RewardHandoffError extends Error {
  constructor(
    public code: RewardHandoffErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export type CompletionInput = {
  workflowId: string;
  workspaceId: string;
  operatorId: string;
  expectedState: "proof_verified";
  expectedRevision: number;
  idempotencyKey: string;
};

export type CancellationInput = {
  workflowId: string;
  workspaceId: string;
  operatorId: string;
  expectedState: "reward_pending";
  expectedRevision: number;
  idempotencyKey: string;
  reasonCategory: "contract_error" | "eligibility_error" | "duplicate" | "other";
  reasonNote: string;
};

export type RewardBreakdown = {
  pointsAmount: number;
  cashAmount: number;
  currency: string;
  xpAmount: number;
};

export type RewardContract = RewardBreakdown & {
  id: string;
  source: "join" | "operator_backfill";
  sourceMissionUpdatedAt: string | null;
  confirmedBy: string | null;
  confirmationEvidenceSource: "mission_brief" | "signed_agreement" | "operator_record" | "other" | null;
  confirmationReason: string | null;
  createdAt: string;
};

export type CompletionEligibility = {
  eligible: boolean;
  blockers: Array<
    "wrong_state" | "required_proof_incomplete" | "reward_contract_required" | "pending_reward_exists"
  >;
  requiredItemCount: number;
  verifiedRequiredItemCount: number;
};

export type PendingRewardDecision = {
  id: string;
  kind: "approved" | "cancelled";
  workflowRevision: number;
  requiredItemCount: number;
  verifiedRequiredItemCount: number;
  evidence: {
    requiredItems: Array<{
      workItemId: string;
      proofAttemptId: string;
      proofReviewId: string;
      attemptNumber: number | null;
      submittedAt: string | null;
      contentChecksum: string | null;
      metadataStatus: string | null;
      reviewNumber: number | null;
      reviewedAt: string | null;
      reviewDecision: string | null;
    }>;
  };
  reasonCategory: string | null;
  reasonNote: string | null;
  decidedBy: string;
  decidedAt: string;
};

export type PendingReward = {
  id: string | null;
  workflowId?: string;
  submissionId?: string;
  creatorId?: string;
  missionId?: string;
  rewardContractId?: string;
  completionDecisionId?: string;
  reward: RewardBreakdown;
  status: "pending" | "cancelled";
  processingWindowDays: number | null;
  targetAt: string | null;
  cancellationDecisionId?: string | null;
  createdAt: string;
  cancelledAt: string | null;
  decisionState?: { kind: "approved" | "cancelled"; decidedAt: string };
  decision?: PendingRewardDecision | null;
};

export type RewardHandoffProjection = {
  rewardContract: RewardContract | null;
  completionEligibility: CompletionEligibility;
  pendingReward: PendingReward | null;
  acceptedProofAnchors: Array<{ workItemId: string; proofAttemptId: string; proofReviewId: string; reviewerId: string; createdAt: string }>;
  processingWindowDays: number | null;
  processingTargetAt: string | null;
};

export type BackfillRewardContractInput = {
  workflowId: string;
  workspaceSlug: string;
  operatorId: string;
  pointsAmount: number;
  cashAmount: number;
  currency: string;
  xpAmount: number;
  sourceMissionUpdatedAt: string | null;
  confirmationEvidenceSource: "mission_brief" | "signed_agreement" | "operator_record" | "other";
  confirmationReason: string;
  idempotencyKey: string;
};

export type ApproveCompletionInput = {
  workflowId: string;
  workspaceSlug: string;
  operatorId: string;
  expectedState: "proof_verified";
  expectedRevision: number;
  idempotencyKey: string;
};

export type CancelRewardHandoffInput = {
  workflowId: string;
  workspaceSlug: string;
  operatorId: string;
  expectedState: "reward_pending";
  expectedRevision: number;
  idempotencyKey: string;
  reasonCategory: CancellationInput["reasonCategory"];
  reasonNote: string;
};

export type RewardHandoffListFilters = {
  workspaceSlug: string;
  operatorId: string;
  due?: "overdue" | "due_soon" | "no_target";
  component?: "points" | "cash" | "xp";
  status: "pending" | "cancelled";
  cursor?: string;
  limit?: number;
};
export type AdminRewardHandoffRepository = {
  getCompletion(input: { workflowId: string; workspaceSlug: string; operatorId: string }): Promise<RewardHandoffProjection>;
  backfillRewardContract(input: BackfillRewardContractInput): Promise<unknown>;
  approveCompletion(input: ApproveCompletionInput): Promise<unknown>;
  cancelRewardHandoff(input: CancelRewardHandoffInput): Promise<unknown>;
  listRewardHandoffs(input: RewardHandoffListFilters): Promise<unknown>;
  updateSettings(input: { workspaceSlug: string; operatorId: string; days: number | null }): Promise<unknown>;
  retryNotification(input: { workspaceSlug: string; operatorId: string; pendingRewardId: string; notificationType: "mission_reward_pending" | "mission_reward_pending_cancelled" }): Promise<unknown>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVIDENCE_SOURCES = new Set(["mission_brief", "signed_agreement", "operator_record", "other"]);
const CANCELLATION_REASONS = new Set(["contract_error", "eligibility_error", "duplicate", "other"]);
const DUE_FILTERS = new Set(["overdue", "due_soon", "no_target"]);
const COMPONENT_FILTERS = new Set(["points", "cash", "xp"]);
const STATUS_FILTERS = new Set(["pending", "cancelled"]);

function record(value: unknown): JsonRow {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRow
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number {
  const normalized = typeof value === "number" ? value : Number(value);
  return Number.isFinite(normalized) ? normalized : 0;
}

function integer(value: unknown): number {
  return Number.isInteger(value) ? value as number : -1;
}

function isStrictRfc3339(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , offset] = match;
  const [y, mo, d, h, mi, sec] = [year, month, day, hour, minute, second].map(Number);
  if (h > 23 || mi > 59 || sec > 59) return false;
  if (offset !== "Z") {
    const [offsetHour, offsetMinute] = offset.slice(1).split(":").map(Number);
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  const calendar = new Date(Date.UTC(y, mo - 1, d, h, mi, sec));
  return calendar.getUTCFullYear() === y
    && calendar.getUTCMonth() === mo - 1
    && calendar.getUTCDate() === d
    && Number.isFinite(Date.parse(value));
}
export type RewardHandoffCursor = {
  targetAt: string | null;
  createdAt: string;
  id: string;
};

export function encodeRewardHandoffCursor(cursor: RewardHandoffCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeRewardHandoffCursor(value: string): RewardHandoffCursor {
  try {
    if (!value || value.length > 1_024) throw new Error("invalid");
    const row = record(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    const targetAt = row.targetAt === null ? null : text(row.targetAt);
    const createdAt = text(row.createdAt);
    const id = text(row.id);
    if ((targetAt !== null && !isStrictRfc3339(targetAt))
      || !createdAt || !isStrictRfc3339(createdAt) || !id || !UUID.test(id)) {
      throw new Error("invalid");
    }
    return { targetAt, createdAt, id };
  } catch {
    validation("cursor is invalid");
  }
}
function validation(message: string): never {
  throw new RewardHandoffError("VALIDATION_FAILED", message);
}

export function validateUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) validation(`${field} must be a UUID`);
  return value;
}

export function validateCompletionPayload(value: unknown, idempotencyKeyValue: unknown) {
  const body = record(value);
  const expectedState = text(body.expectedState);
  const expectedRevision = integer(body.expectedRevision);
  if (expectedState !== "proof_verified") validation("expectedState must be proof_verified");
  if (expectedRevision < 0) validation("expectedRevision must be a non-negative integer");
  return {
    expectedState,
    expectedRevision,
    idempotencyKey: validateUuid(idempotencyKeyValue, "Idempotency-Key"),
  } as const;
}

export function validateCancellationPayload(value: unknown, idempotencyKeyValue: unknown) {
  const body = record(value);
  const expectedState = text(body.expectedState);
  const expectedRevision = integer(body.expectedRevision);
  const reasonCategory = text(body.reasonCategory)?.toLowerCase() ?? "";
  const reasonNote = text(body.reasonNote);
  if (expectedState !== "reward_pending") validation("expectedState must be reward_pending");
  if (expectedRevision < 0) validation("expectedRevision must be a non-negative integer");
  if (!CANCELLATION_REASONS.has(reasonCategory)) validation("reasonCategory is invalid");
  if (!reasonNote || reasonNote.length > 2_000) validation("reasonNote is required and bounded");
  return {
    expectedState,
    expectedRevision,
    idempotencyKey: validateUuid(idempotencyKeyValue, "Idempotency-Key"),
    reasonCategory: reasonCategory as CancellationInput["reasonCategory"],
    reasonNote,
  } as const;
}

export function validateBackfillPayload(value: unknown, idempotencyKeyValue: unknown) {
  const body = record(value);
  const pointsAmount = integer(body.pointsAmount);
  const cashAmount = typeof body.cashAmount === "number" ? body.cashAmount : Number.NaN;
  const currency = text(body.currency)?.toUpperCase() ?? "";
  const xpAmount = body.xpAmount;
  const sourceMissionUpdatedAt = body.sourceMissionUpdatedAt == null
    ? null
    : text(body.sourceMissionUpdatedAt);
  const confirmationEvidenceSource = text(body.confirmationEvidenceSource)?.toLowerCase() ?? "";
  const confirmationReason = text(body.confirmationReason);
  if (pointsAmount < 0 || !Number.isFinite(cashAmount) || cashAmount < 0) {
    validation("Reward amounts must be non-negative");
  }
  if (typeof xpAmount !== "number" || !Number.isInteger(xpAmount) || xpAmount !== 0) {
    validation("xpAmount must be exactly zero");
  }
  if (!/^[A-Z]{3}$/.test(currency)) validation("currency must be an ISO-style three-letter code");
  if (sourceMissionUpdatedAt !== null && !isStrictRfc3339(sourceMissionUpdatedAt)) {
    validation("sourceMissionUpdatedAt must be a valid RFC3339 timestamp or null");
  }
  if (!EVIDENCE_SOURCES.has(confirmationEvidenceSource)) validation("confirmationEvidenceSource is invalid");
  if (!confirmationReason || confirmationReason.length > 2_000) {
    validation("confirmationReason is required and bounded");
  }
  return {
    pointsAmount,
    cashAmount,
    currency,
    xpAmount,
    sourceMissionUpdatedAt,
    confirmationEvidenceSource: confirmationEvidenceSource as BackfillRewardContractInput["confirmationEvidenceSource"],
    confirmationReason,
    idempotencyKey: validateUuid(idempotencyKeyValue, "Idempotency-Key"),
  };
}

function normalizedEnum(
  value: unknown,
  allowed: Set<string>,
  field: string,
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!allowed.has(normalized)) validation(`${field} is invalid`);
  return normalized;
}

export function normalizeListFilters(value: {
  due?: unknown;
  component?: unknown;
  status?: unknown;
  cursor?: unknown;
  limit?: unknown;
}) {
  const limit = value.limit === undefined || value.limit === "" ? 50 : Number(value.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) validation("limit is invalid");
  const cursor = value.cursor === undefined || value.cursor === ""
    ? undefined
    : typeof value.cursor === "string" ? value.cursor.trim() : "";
  if (cursor) decodeRewardHandoffCursor(cursor);
  else if (value.cursor !== undefined && value.cursor !== "") validation("cursor is invalid");
  return {
    due: normalizedEnum(value.due, DUE_FILTERS, "due") as RewardHandoffListFilters["due"],
    component: normalizedEnum(value.component, COMPONENT_FILTERS, "component") as RewardHandoffListFilters["component"],
    status: (normalizedEnum(value.status, STATUS_FILTERS, "status") ?? "pending") as RewardHandoffListFilters["status"],
    cursor,
    limit,
  };
}
export function validateNotificationRetryPayload(value: unknown): {
  notificationType: "mission_reward_pending" | "mission_reward_pending_cancelled";
} {
  const payload = record(value);
  const notificationType = text(payload.notificationType);
  if (notificationType !== "mission_reward_pending"
    && notificationType !== "mission_reward_pending_cancelled") {
    throw new RewardHandoffError("VALIDATION_FAILED", "notificationType is invalid");
  }
  return { notificationType };
}
export function validateSettingsPayload(value: unknown): { days: number | null } {
  const body = record(value);
  if (body.days === null) return { days: null };
  if (!Number.isInteger(body.days) || (body.days as number) < 0 || (body.days as number) > 365) {
    validation("days must be null or an integer from 0 to 365");
  }
  return { days: body.days as number };
}

function reward(row: JsonRow): RewardBreakdown {
  const nested = record(row.reward);
  return {
    pointsAmount: number(nested.pointsAmount ?? row.points_amount),
    cashAmount: number(nested.cashAmount ?? row.cash_amount),
    currency: text(nested.currency ?? row.currency) ?? "HKD",
    xpAmount: number(nested.xpAmount ?? row.xp_amount),
  };
}

function rewardContract(value: unknown): RewardContract | null {
  const row = record(value);
  const id = text(row.id);
  const source = text(row.source);
  const createdAt = text(row.created_at ?? row.createdAt);
  if (!id || (source !== "join" && source !== "operator_backfill") || !createdAt) return null;
  const evidence = text(row.confirmation_evidence_source ?? row.confirmationEvidenceSource);
  return {
    id,
    ...reward(row),
    source,
    sourceMissionUpdatedAt: nullableText(row.source_mission_updated_at ?? row.sourceMissionUpdatedAt),
    confirmedBy: nullableText(row.confirmed_by ?? row.confirmedBy),
    confirmationEvidenceSource: EVIDENCE_SOURCES.has(evidence ?? "")
      ? evidence as RewardContract["confirmationEvidenceSource"]
      : null,
    confirmationReason: nullableText(row.confirmation_reason ?? row.confirmationReason),
    createdAt,
  };
}

function safeEvidence(value: unknown): PendingRewardDecision["evidence"] {
  const requiredItems = record(value).requiredItems;
  return {
    requiredItems: (Array.isArray(requiredItems) ? requiredItems : []).map((entry) => {
      const row = record(entry);
      return {
        workItemId: text(row.workItemId) ?? "",
        proofAttemptId: text(row.proofAttemptId) ?? "",
        proofReviewId: text(row.proofReviewId) ?? "",
        attemptNumber: Number.isInteger(row.attemptNumber) ? row.attemptNumber as number : null,
        submittedAt: nullableText(row.submittedAt),
        contentChecksum: nullableText(row.contentChecksum),
        metadataStatus: nullableText(row.metadataStatus),
        reviewNumber: Number.isInteger(row.reviewNumber) ? row.reviewNumber as number : null,
        reviewedAt: nullableText(row.reviewedAt),
        reviewDecision: nullableText(row.reviewDecision),
      };
    }),
  };
}

function decision(value: unknown): PendingRewardDecision | null {
  const row = record(value);
  const id = text(row.id);
  const kind = text(row.decision_kind ?? row.kind);
  const decidedBy = text(row.decided_by ?? row.decidedBy);
  const decidedAt = text(row.decided_at ?? row.decidedAt);
  if (!id || (kind !== "approved" && kind !== "cancelled") || !decidedBy || !decidedAt) return null;
  return {
    id,
    kind,
    workflowRevision: Math.max(0, integer(row.workflow_revision ?? row.workflowRevision)),
    requiredItemCount: Math.max(0, integer(row.required_item_count ?? row.requiredItemCount)),
    verifiedRequiredItemCount: Math.max(0, integer(row.verified_required_item_count ?? row.verifiedRequiredItemCount)),
    evidence: safeEvidence(row.evidence_snapshot ?? row.evidence),
    reasonCategory: nullableText(row.reason_category ?? row.reasonCategory),
    reasonNote: nullableText(row.reason_note ?? row.reasonNote),
    decidedBy,
    decidedAt,
  };
}

function queueCompletionDecision(value: unknown) {
  const row = record(Array.isArray(value) ? value[0] : value);
  const id = text(row.id);
  const kind = text(row.decision_kind);
  const decidedAt = text(row.decided_at);
  if (!id || (kind !== "approved" && kind !== "cancelled") || !decidedAt) return null;
  const evidence = record(row.evidence_snapshot);
  const requiredItems = evidence.requiredItems ?? evidence.required_items;
  return {
    id,
    kind,
    decidedAt,
    requiredItemCount: Math.max(0, integer(row.required_item_count)),
    verifiedRequiredItemCount: Math.max(0, integer(row.verified_required_item_count)),
    evidenceAvailable: Array.isArray(requiredItems) && requiredItems.length > 0,
  };
}

function operatorPendingReward(value: unknown, decisionValue?: unknown): PendingReward | null {
  const row = record(value);
  const id = text(row.id);
  const status = text(row.status);
  const createdAt = text(row.created_at ?? row.createdAt);
  if (!id || (status !== "pending" && status !== "cancelled") || !createdAt) return null;
  const normalizedDecision = decision(decisionValue);
  return {
    id,
    workflowId: text(row.mission_workflow_id) ?? "",
    submissionId: text(row.mission_submission_id) ?? "",
    creatorId: text(row.creator_id) ?? "",
    missionId: text(row.mission_id) ?? "",
    rewardContractId: text(row.reward_contract_id) ?? "",
    completionDecisionId: text(row.completion_decision_id) ?? "",
    reward: reward(row),
    status,
    processingWindowDays: row.processing_window_days == null ? null : number(row.processing_window_days),
    targetAt: nullableText(row.target_at),
    cancellationDecisionId: nullableText(row.cancellation_decision_id),
    createdAt,
    cancelledAt: nullableText(row.cancelled_at),
    decision: normalizedDecision,
  };
}

export function normalizeCreatorRewardHandoffProjection(value: unknown): PendingReward | null {
  const row = record(value);
  const status = text(row.status);
  const createdAt = text(row.createdAt);
  const state = record(row.decisionState);
  const kind = text(state.kind);
  const decidedAt = text(state.decidedAt);
  if ((status !== "pending" && status !== "cancelled") || !createdAt
    || (kind !== "approved" && kind !== "cancelled") || !decidedAt) return null;
  return {
    id: null,
    reward: reward(row),
    status,
    processingWindowDays: row.processingWindowDays == null ? null : number(row.processingWindowDays),
    targetAt: nullableText(row.targetAt),
    createdAt,
    cancelledAt: nullableText(row.cancelledAt),
    decisionState: { kind, decidedAt },
  };
}

export function buildCompletionEligibility(input: {
  workflowState: unknown;
  requiredItems: unknown[];
  contract: RewardContract | null | true;
  pendingReward: PendingReward | null;
}): CompletionEligibility {
  const required = input.requiredItems.map(record).filter((item) => item.required === true);
  const verified = required.filter((item) => {
    const current = text(item.current_proof_attempt_id ?? item.currentProofAttemptId);
    const accepted = text(item.verified_proof_attempt_id ?? item.verifiedProofAttemptId);
    return item.state === "proof_verified" && current !== null && current === accepted;
  });
  const blockers: CompletionEligibility["blockers"] = [];
  if (input.workflowState !== "proof_verified") blockers.push("wrong_state");
  if (required.length === 0 || verified.length !== required.length) blockers.push("required_proof_incomplete");
  if (!input.contract) blockers.push("reward_contract_required");
  if (input.pendingReward?.status === "pending") blockers.push("pending_reward_exists");
  return {
    eligible: blockers.length === 0,
    blockers,
    requiredItemCount: required.length,
    verifiedRequiredItemCount: verified.length,
  };
}

function relation(value: unknown): JsonRow {
  return Array.isArray(value) ? record(value[0]) : record(value);
}

function same(row: JsonRow, field: string, expected: string | null): boolean {
  return expected !== null && text(row[field]) === expected;
}

function assertCanonicalRewardHandoff(input: {
  workspaceId: string;
  workflow: unknown;
  submission: unknown;
  contract: unknown;
  pendingReward: unknown;
  approvalDecision: unknown;
  cancellationDecision: unknown;
}) {
  const workflow = record(input.workflow);
  const submission = record(input.submission);
  const contract = record(input.contract);
  const pending = record(input.pendingReward);
  const approval = record(input.approvalDecision);
  const cancellation = record(input.cancellationDecision);
  const workflowId = text(workflow.id);
  const submissionId = text(submission.id);
  const creatorId = text(submission.creator_id);
  const missionId = text(submission.mission_id);
  const contractId = text(contract.id);
  if (!workflowId
    || !same(workflow, "workspace_id", input.workspaceId)
    || !same(workflow, "mission_submission_id", submissionId)
    || !same(submission, "workspace_id", input.workspaceId)) {
    throw new RewardHandoffError("FORBIDDEN", "forbidden");
  }
  if (Object.keys(contract).length > 0 && (
    !same(contract, "workspace_id", input.workspaceId)
    || !same(contract, "mission_workflow_id", workflowId)
    || !same(contract, "mission_submission_id", submissionId)
    || !same(contract, "mission_id", missionId)
  )) throw new RewardHandoffError("FORBIDDEN", "forbidden");
  if (Object.keys(pending).length === 0) {
    if (Object.keys(approval).length > 0 || Object.keys(cancellation).length > 0) {
      throw new RewardHandoffError("FORBIDDEN", "forbidden");
    }
    return;
  }
  const pendingId = text(pending.id);
  const approvalId = text(pending.completion_decision_id);
  const cancellationId = text(pending.cancellation_decision_id);
  const status = text(pending.status);
  if (!pendingId || !approvalId || (status !== "pending" && status !== "cancelled")
    || !same(pending, "workspace_id", input.workspaceId)
    || !same(pending, "mission_workflow_id", workflowId)
    || !same(pending, "mission_submission_id", submissionId)
    || !same(pending, "creator_id", creatorId)
    || !same(pending, "mission_id", missionId)
    || (text(pending.reward_contract_id) !== null && text(pending.reward_contract_id) !== contractId)
    || !same(approval, "id", approvalId)
    || !same(approval, "workspace_id", input.workspaceId)
    || !same(approval, "mission_workflow_id", workflowId)
    || !same(approval, "reward_contract_id", contractId)
    || text(approval.decision_kind) !== "approved"
    || text(approval.pending_reward_id) !== null) {
    throw new RewardHandoffError("FORBIDDEN", "forbidden");
  }
  if (status === "pending") {
    if (cancellationId !== null || Object.keys(cancellation).length > 0) {
      throw new RewardHandoffError("FORBIDDEN", "forbidden");
    }
    return;
  }
  if (!cancellationId
    || !same(cancellation, "id", cancellationId)
    || !same(cancellation, "workspace_id", input.workspaceId)
    || !same(cancellation, "mission_workflow_id", workflowId)
    || !same(cancellation, "reward_contract_id", contractId)
    || !same(cancellation, "pending_reward_id", pendingId)
    || !same(cancellation, "supersedes_decision_id", approvalId)
    || text(cancellation.decision_kind) !== "cancelled") {
    throw new RewardHandoffError("FORBIDDEN", "forbidden");
  }
}

export function canonicalRewardHandoffQueueItem(
  rowValue: unknown,
  workspaceId: string,
): ReturnType<typeof operatorPendingReward> & {
  creatorDisplayName: string | null;
  missionTitle: string | null;
  completionDecision: ReturnType<typeof queueCompletionDecision>;
} | null {
  const row = record(rowValue);
  const workflow = relation(row.workflow);
  const submission = relation(row.submission);
  const contract = relation(row.reward_contract);
  const creator = relation(row.creators);
  const mission = relation(row.missions);
  const approval = relation(row.completion_decision);
  const cancellation = relation(row.cancellation_decision);
  const workflowId = text(row.mission_workflow_id);
  const submissionId = text(row.mission_submission_id);
  const creatorId = text(row.creator_id);
  const missionId = text(row.mission_id);
  const contractId = text(row.reward_contract_id);
  const status = text(row.status);
  if (!workflowId || !submissionId || !creatorId || !missionId || !contractId
    || (status !== "pending" && status !== "cancelled")
    || !same(workflow, "id", workflowId) || !same(workflow, "workspace_id", workspaceId)
    || !same(workflow, "mission_submission_id", submissionId)
    || !same(submission, "id", submissionId) || !same(submission, "workspace_id", workspaceId)
    || !same(submission, "creator_id", creatorId) || !same(submission, "mission_id", missionId)
    || !same(contract, "id", contractId) || !same(contract, "workspace_id", workspaceId)
    || !same(contract, "mission_workflow_id", workflowId)
    || !same(contract, "mission_submission_id", submissionId)
    || !same(contract, "mission_id", missionId)
    || !same(creator, "id", creatorId) || !same(creator, "workspace_id", workspaceId)
    || !same(mission, "id", missionId) || !same(mission, "workspace_id", workspaceId)
    || !same(approval, "id", text(row.completion_decision_id))
    || !same(approval, "workspace_id", workspaceId)
    || !same(approval, "mission_workflow_id", workflowId)
    || !same(approval, "reward_contract_id", contractId)
    || text(approval.decision_kind) !== "approved"
    || text(approval.pending_reward_id) !== null) return null;
  if (status === "pending"
    && (text(row.cancellation_decision_id) !== null || Object.keys(cancellation).length > 0)) return null;
  if (status === "cancelled" && (
    !same(cancellation, "id", text(row.cancellation_decision_id))
    || !same(cancellation, "workspace_id", workspaceId)
    || !same(cancellation, "mission_workflow_id", workflowId)
    || !same(cancellation, "reward_contract_id", contractId)
    || !same(cancellation, "pending_reward_id", text(row.id))
    || !same(cancellation, "supersedes_decision_id", text(row.completion_decision_id))
    || text(cancellation.decision_kind) !== "cancelled"
  )) return null;
  const pending = operatorPendingReward(row);
  if (!pending) return null;
  return {
    ...pending,
    creatorDisplayName: text(creator.display_name),
    missionTitle: text(mission.title),
    completionDecision: queueCompletionDecision(approval),
  };
}
function acceptedProofAnchors(input: {
  workspaceId?: string;
  requiredItems: unknown[];
  proofAttempts?: unknown[];
  proofReviews?: unknown[];
  approvalDecision?: unknown;
}): RewardHandoffProjection["acceptedProofAnchors"] {
  const approval = record(input.approvalDecision);
  const hasApproval = text(approval.decision_kind ?? approval.kind) === "approved";
  const evidenceItems = hasApproval
    ? safeEvidence(approval.evidence_snapshot ?? approval.evidence).requiredItems
    : [];
  const attempts = (input.proofAttempts ?? []).map(record);
  const reviews = (input.proofReviews ?? []).map(record);
  return input.requiredItems.map(record).filter((item) => {
    const current = text(item.current_proof_attempt_id ?? item.currentProofAttemptId);
    return item.required === true && item.state === "proof_verified" && current !== null
      && current === text(item.verified_proof_attempt_id ?? item.verifiedProofAttemptId);
  }).map((item) => {
    const workItemId = text(item.id ?? item.workItemId);
    const proofAttemptId = text(item.verified_proof_attempt_id ?? item.verifiedProofAttemptId);
    const attempt = attempts.find((entry) => text(entry.id) === proofAttemptId
      && text(entry.mission_work_item_id ?? entry.workItemId) === workItemId
      && (input.workspaceId === undefined || text(entry.workspace_id) === input.workspaceId));
    const review = reviews.find((entry) => text(entry.mission_publication_proof_attempt_id ?? entry.attemptId) === proofAttemptId
      && text(entry.state) === "verified" && text(entry.decision) === "verified"
      && (input.workspaceId === undefined || text(entry.workspace_id) === input.workspaceId));
    const proofReviewId = text(review?.id);
    const reviewerId = text(review?.reviewer_id ?? review?.reviewerId);
    const createdAt = text(review?.created_at ?? review?.createdAt);
    const reviewedAt = text(review?.reviewed_at ?? review?.reviewedAt);
    if (!workItemId || !proofAttemptId || !attempt || !proofReviewId || !reviewerId || !createdAt) {
      if (hasApproval) throw new RewardHandoffError("FORBIDDEN", "forbidden");
      return null;
    }
    if (hasApproval) {
      const evidence = evidenceItems.find((entry) => entry.workItemId === workItemId
        && entry.proofAttemptId === proofAttemptId
        && entry.proofReviewId === proofReviewId
        && entry.reviewDecision === "verified");
      if (!evidence || (evidence.reviewedAt !== null && evidence.reviewedAt !== reviewedAt)) {
        throw new RewardHandoffError("FORBIDDEN", "forbidden");
      }
    }
    return { workItemId, proofAttemptId, proofReviewId, reviewerId, createdAt };
  }).filter((anchor): anchor is RewardHandoffProjection["acceptedProofAnchors"][number] => anchor !== null);
}
export function normalizeOperatorRewardHandoffProjection(input: {
  workspaceId?: string;
  workflow: unknown;
  contract: unknown;
  requiredItems: unknown[];
  pendingReward: unknown;
  decision?: unknown;
  approvalDecision?: unknown;
  proofAttempts?: unknown[];
  proofReviews?: unknown[];
  processingWindowDays?: number | null;
}): RewardHandoffProjection {
  const workflow = record(input.workflow);
  const contract = rewardContract(input.contract);
  const pending = operatorPendingReward(input.pendingReward, input.decision);
  const approval = input.approvalDecision ?? input.decision;
  return {
    rewardContract: contract,
    completionEligibility: (() => {
      const base = buildCompletionEligibility({
        workflowState: workflow.state,
        requiredItems: input.requiredItems,
        contract,
        pendingReward: pending,
      });
      const anchors = acceptedProofAnchors({
        workspaceId: input.workspaceId,
        requiredItems: input.requiredItems,
        approvalDecision: approval,
        proofAttempts: input.proofAttempts,
        proofReviews: input.proofReviews,
      });
      const blockers: CompletionEligibility["blockers"] = base.blockers.filter((blocker) => blocker !== "required_proof_incomplete");
      if (base.requiredItemCount === 0 || anchors.length !== base.requiredItemCount) {
        blockers.push("required_proof_incomplete");
      }
      return {
        ...base,
        eligible: blockers.length === 0,
        blockers,
        verifiedRequiredItemCount: anchors.length,
      };
    })(),
    pendingReward: pending,
    acceptedProofAnchors: acceptedProofAnchors({
      workspaceId: input.workspaceId,
      requiredItems: input.requiredItems,
      approvalDecision: approval,
      proofAttempts: input.proofAttempts,
      proofReviews: input.proofReviews,
    }),
    processingWindowDays: pending
      ? pending.processingWindowDays
      : input.processingWindowDays ?? null,
    processingTargetAt: pending?.targetAt ?? null,
  };
}
function mapDatabaseError(error: { message?: string | null } | null): never {
  const message = (error?.message ?? "").toLowerCase();
  type DatabaseErrorCode = Exclude<RewardHandoffErrorCode, "NOT_AUTHENTICATED" | "UNKNOWN">;
  const mappings: Array<[string, DatabaseErrorCode]> = [
    ["idempotency_conflict", "IDEMPOTENCY_CONFLICT"],
    ["workflow_stale", "WORKFLOW_STALE"],
    ["wrong_state", "WRONG_STATE"],
    ["reward_contract_required", "REWARD_CONTRACT_REQUIRED"],
    ["reward_contract_exists", "REWARD_CONTRACT_EXISTS"],
    ["completion_not_eligible", "COMPLETION_NOT_ELIGIBLE"],
    ["pending_reward_exists", "PENDING_REWARD_EXISTS"],
    ["pending_reward_not_found", "PENDING_REWARD_NOT_FOUND"],
    ["cancellation_not_allowed", "CANCELLATION_NOT_ALLOWED"],
    ["validation_failed", "VALIDATION_FAILED"],
    ["backfill_contract_invalid", "VALIDATION_FAILED"],
    ["backfill_reason_required", "VALIDATION_FAILED"],
    ["reward_contract_source_missing", "VALIDATION_FAILED"],
    ["reward_processing_window_invalid", "VALIDATION_FAILED"],
    ["not_authorized", "FORBIDDEN"],
    ["not_found", "FORBIDDEN"],
    ["reward_workflow_not_found", "FORBIDDEN"],
    ["workspace_not_found", "FORBIDDEN"],
  ];
  const code = mappings.find(([token]) => message.includes(token))?.[1];
  if (!code) throw new RewardHandoffError("UNKNOWN", "Reward handoff request failed");
  const safeMessages: Record<DatabaseErrorCode, string> = {
    VALIDATION_FAILED: "Reward handoff request is invalid",
    FORBIDDEN: "forbidden",
    REWARD_CONTRACT_EXISTS: "Reward contract already exists",
    REWARD_CONTRACT_REQUIRED: "Reward contract is required",
    COMPLETION_NOT_ELIGIBLE: "Mission completion is not eligible",
    WORKFLOW_STALE: "Mission workflow is stale",
    WRONG_STATE: "Mission workflow is in the wrong state",
    PENDING_REWARD_EXISTS: "Pending reward already exists",
    PENDING_REWARD_NOT_FOUND: "Pending reward was not found",
    CANCELLATION_NOT_ALLOWED: "Reward cancellation is not allowed",
    IDEMPOTENCY_CONFLICT: "Idempotency key conflicts with an earlier request",
  };
  throw new RewardHandoffError(code, safeMessages[code]);
}

async function authorizedWorkspace(client: SupabaseClient, workspaceSlug: string, operatorId: string) {
  const membership = await client.from("brand_users")
    .select("workspace_id, workspaces!brand_users_workspace_id_fkey!inner(id, slug, reward_processing_window_days)")
    .eq("user_id", operatorId)
    .eq("active", true)
    .eq("workspaces.slug", workspaceSlug)
    .maybeSingle();
  if (membership.error || !membership.data) throw new RewardHandoffError("FORBIDDEN", "forbidden");
  const membershipRow = membership.data as JsonRow;
  const workspaceValue = membershipRow.workspaces;
  const workspace = Array.isArray(workspaceValue) ? record(workspaceValue[0]) : record(workspaceValue);
  const workspaceId = text(membershipRow.workspace_id);
  if (!workspaceId || text(workspace.id) !== workspaceId || text(workspace.slug) !== workspaceSlug) {
    throw new RewardHandoffError("FORBIDDEN", "forbidden");
  }
  return {
    id: workspaceId,
    rewardProcessingWindowDays: workspace.reward_processing_window_days == null
      ? null
      : number(workspace.reward_processing_window_days),
  };
}

export async function getOperatorRewardHandoffProjection(
  client: SupabaseClient,
  workspaceId: string,
  workflowId: string,
  known?: { workflow: unknown; submission: unknown; requiredItems: unknown[]; proofAttempts?: unknown[]; proofReviews?: unknown[] },
  processingWindowDays?: number | null,
) {
  let workflowResult: { data: unknown; error: { message?: string | null } | null };
  let itemsResult: { data: unknown[] | null; error: { message?: string | null } | null };
  let submissionResult: { data: unknown; error: { message?: string | null } | null };
  if (known) {
    workflowResult = { data: known.workflow, error: null };
    itemsResult = { data: known.requiredItems, error: null };
    submissionResult = { data: known.submission, error: null };
  } else {
    workflowResult = await client.from("mission_workflows")
      .select("id, workspace_id, mission_submission_id, state, revision")
      .eq("id", workflowId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const workflowRow = record(workflowResult.data);
    submissionResult = await client.from("mission_submissions")
      .select("id, workspace_id, creator_id, mission_id")
      .eq("workspace_id", workspaceId)
      .eq("id", text(workflowRow.mission_submission_id) ?? "")
      .maybeSingle();
    itemsResult = await client.from("mission_work_items")
      .select("id, required, state, current_proof_attempt_id, verified_proof_attempt_id")
      .eq("workspace_id", workspaceId)
      .eq("mission_workflow_id", workflowId);
  }
  if (workflowResult.error) mapDatabaseError(workflowResult.error);
  if (!workflowResult.data) throw new RewardHandoffError("FORBIDDEN", "forbidden");
  if (itemsResult.error) mapDatabaseError(itemsResult.error);
  if (submissionResult.error) mapDatabaseError(submissionResult.error);
  if (!submissionResult.data) throw new RewardHandoffError("FORBIDDEN", "forbidden");
  const acceptedAttemptIds = (itemsResult.data ?? []).map(record)
    .filter((item) => item.required === true && item.state === "proof_verified")
    .map((item) => text(item.verified_proof_attempt_id ?? item.verifiedProofAttemptId))
    .filter((id): id is string => id !== null);
  let proofAttempts: unknown[] = known?.proofAttempts ?? [];
  let proofReviews: unknown[] = known?.proofReviews ?? [];
  if (!known && acceptedAttemptIds.length > 0) {
    const [attemptsResult, reviewsResult] = await Promise.all([
      client.from("mission_publication_proof_attempts").select("id, workspace_id, mission_work_item_id")
        .eq("workspace_id", workspaceId).in("id", acceptedAttemptIds),
      client.from("mission_publication_proof_reviews").select("*")
        .eq("workspace_id", workspaceId)
        .in("mission_publication_proof_attempt_id", acceptedAttemptIds),
    ]);
    if (attemptsResult.error) mapDatabaseError(attemptsResult.error);
    if (reviewsResult.error) mapDatabaseError(reviewsResult.error);
    proofAttempts = (attemptsResult.data ?? []) as unknown[];
    proofReviews = (reviewsResult.data ?? []) as unknown[];
  }
  const [contractResult, pendingResult] = await Promise.all([
    client.from("mission_reward_contracts").select("*")
      .eq("workspace_id", workspaceId).eq("mission_workflow_id", workflowId).maybeSingle(),
    client.from("mission_pending_rewards").select("*")
      .eq("workspace_id", workspaceId).eq("mission_workflow_id", workflowId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  for (const result of [contractResult, pendingResult]) {
    if (result.error) mapDatabaseError(result.error);
  }
  const pending = pendingResult.data as JsonRow | null;
  const emptyDecision = { data: null, error: null as { message?: string | null } | null };
  let approvalResult: { data: unknown; error: { message?: string | null } | null } = emptyDecision;
  let cancellationResult: { data: unknown; error: { message?: string | null } | null } = emptyDecision;
  if (typeof pending?.completion_decision_id === "string") {
    approvalResult = await client.from("mission_completion_decisions").select("*")
      .eq("workspace_id", workspaceId).eq("id", pending.completion_decision_id).maybeSingle();
    if (approvalResult.error) mapDatabaseError(approvalResult.error);
  }
  if (typeof pending?.cancellation_decision_id === "string") {
    cancellationResult = await client.from("mission_completion_decisions").select("*")
      .eq("workspace_id", workspaceId).eq("id", pending.cancellation_decision_id).maybeSingle();
    if (cancellationResult.error) mapDatabaseError(cancellationResult.error);
  }
  let resolvedProcessingWindowDays = processingWindowDays;
  if (resolvedProcessingWindowDays === undefined) {
    const settingsResult = await client.from("workspaces")
      .select("reward_processing_window_days")
      .eq("id", workspaceId)
      .maybeSingle();
    if (settingsResult.error) mapDatabaseError(settingsResult.error);
    const settings = record(settingsResult.data);
    resolvedProcessingWindowDays = settings.reward_processing_window_days == null
      ? null
      : number(settings.reward_processing_window_days);
  }
  assertCanonicalRewardHandoff({
    workspaceId,
    workflow: workflowResult.data,
    submission: submissionResult.data,
    contract: contractResult.data,
    pendingReward: pending,
    approvalDecision: approvalResult.data,
    cancellationDecision: cancellationResult.data,
  });
  return normalizeOperatorRewardHandoffProjection({
    workspaceId,
    workflow: workflowResult.data,
    contract: contractResult.data,
    requiredItems: (itemsResult.data ?? []) as unknown[],
    pendingReward: pending,
    decision: cancellationResult.data ?? approvalResult.data,
    approvalDecision: approvalResult.data,
    proofAttempts,
    proofReviews,
    processingWindowDays: resolvedProcessingWindowDays,
  });
}

function normalizeMutationResult(value: unknown) {
  const payload = record(value);
  const workflow = record(payload.workflow);
  const decisionRow = record(payload.decision);
  const pending = operatorPendingReward(payload.pendingReward, decisionRow);
  return {
    workflow: {
      id: text(workflow.id),
      state: text(workflow.state),
      revision: integer(workflow.revision),
      updatedAt: nullableText(workflow.updated_at ?? workflow.updatedAt),
    },
    decision: decision(decisionRow),
    pendingReward: pending,
    idempotent: payload.idempotent === true,
  };
}

export function createRewardHandoffRepository(client: SupabaseClient): AdminRewardHandoffRepository {
  return {
    async getCompletion(input) {
      const workspace = await authorizedWorkspace(client, input.workspaceSlug, input.operatorId);
      return getOperatorRewardHandoffProjection(
        client, workspace.id, input.workflowId, undefined, workspace.rewardProcessingWindowDays,
      );
    },

    async backfillRewardContract(input) {
      const workspace = await authorizedWorkspace(client, input.workspaceSlug, input.operatorId);
      const result = await client.rpc("backfill_mission_reward_contract", {
        p_workspace: workspace.id,
        p_workflow: input.workflowId,
        p_operator: input.operatorId,
        p_points_amount: input.pointsAmount,
        p_cash_amount: input.cashAmount,
        p_currency: input.currency,
        p_xp_amount: 0,
        p_source_mission_updated_at: input.sourceMissionUpdatedAt,
        p_confirmation_evidence_source: input.confirmationEvidenceSource,
        p_confirmation_reason: input.confirmationReason,
        p_idempotency_key: input.idempotencyKey,
      });
      if (result.error) mapDatabaseError(result.error);
      const payload = record(result.data);
      return {
        rewardContract: rewardContract(payload.contract),
        idempotent: payload.idempotent === true,
      };
    },

    async approveCompletion(input) {
      const workspace = await authorizedWorkspace(client, input.workspaceSlug, input.operatorId);
      const result = await client.rpc("approve_mission_completion", {
        p_workspace: workspace.id,
        p_workflow: input.workflowId,
        p_operator: input.operatorId,
        p_expected_state: input.expectedState,
        p_expected_revision: input.expectedRevision,
        p_idempotency_key: input.idempotencyKey,
      });
      if (result.error) mapDatabaseError(result.error);
      return normalizeMutationResult(result.data);
    },

    async cancelRewardHandoff(input) {
      const workspace = await authorizedWorkspace(client, input.workspaceSlug, input.operatorId);
      const result = await client.rpc("cancel_mission_reward_handoff", {
        p_workspace: workspace.id,
        p_workflow: input.workflowId,
        p_operator: input.operatorId,
        p_expected_state: input.expectedState,
        p_expected_revision: input.expectedRevision,
        p_idempotency_key: input.idempotencyKey,
        p_reason_category: input.reasonCategory,
        p_reason_note: input.reasonNote,
      });
      if (result.error) mapDatabaseError(result.error);
      return normalizeMutationResult(result.data);
    },

    async listRewardHandoffs(input) {
      const workspace = await authorizedWorkspace(client, input.workspaceSlug, input.operatorId);
      let query = client.from("mission_pending_rewards")
        .select("*, workflow:mission_workflows!mission_pending_rewards_mission_workflow_id_fkey(id, workspace_id, mission_submission_id), submission:mission_submissions!mission_pending_rewards_mission_submission_id_fkey(id, workspace_id, creator_id, mission_id), reward_contract:mission_reward_contracts!mission_pending_rewards_reward_contract_id_fkey(id, workspace_id, mission_workflow_id, mission_submission_id, mission_id), creators!mission_pending_rewards_creator_id_fkey(id, workspace_id, display_name), missions!mission_pending_rewards_mission_id_fkey(id, workspace_id, title), completion_decision:mission_completion_decisions!mission_pending_rewards_completion_decision_id_fkey(id, workspace_id, mission_workflow_id, reward_contract_id, pending_reward_id, supersedes_decision_id, decision_kind, decided_at, required_item_count, verified_required_item_count, evidence_snapshot), cancellation_decision:mission_completion_decisions!mission_pending_rewards_cancellation_decision_id_fkey(id, workspace_id, mission_workflow_id, reward_contract_id, pending_reward_id, supersedes_decision_id, decision_kind)")
        .eq("workspace_id", workspace.id)
        .eq("status", input.status);
      const now = new Date();
      if (input.due === "overdue") query = query.lt("target_at", now.toISOString());
      if (input.due === "due_soon") {
        query = query.gte("target_at", now.toISOString())
          .lte("target_at", new Date(now.getTime() + 7 * 86_400_000).toISOString());
      }
      if (input.due === "no_target") query = query.is("target_at", null);
      if (input.component === "points") query = query.gt("points_amount", 0);
      if (input.component === "cash") query = query.gt("cash_amount", 0);
      if (input.component === "xp") query = query.gt("xp_amount", 0);
      const limit = input.limit ?? 50;
      if (input.cursor) {
        const cursor = decodeRewardHandoffCursor(input.cursor);
        query = cursor.targetAt === null
          ? query.or(`and(target_at.is.null,created_at.gt.${cursor.createdAt}),and(target_at.is.null,created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`)
          : query.or(`target_at.gt.${cursor.targetAt},and(target_at.eq.${cursor.targetAt},created_at.gt.${cursor.createdAt}),and(target_at.eq.${cursor.targetAt},created_at.eq.${cursor.createdAt},id.gt.${cursor.id}),target_at.is.null`);
      }
      const result = await query
        .order("target_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(limit + 1);
      if (result.error) mapDatabaseError(result.error);
      const rows = (result.data ?? []) as JsonRow[];
      const hasMore = rows.length > limit;
      const pageRows = rows.slice(0, limit);
      const items = pageRows
        .map((row) => canonicalRewardHandoffQueueItem(row, workspace.id))
        .filter((item): item is NonNullable<typeof item> => item !== null);
      const last = pageRows.at(-1);
      return {
        items,
        rewardProcessingWindowDays: workspace.rewardProcessingWindowDays,
        pageInfo: {
          hasMore,
          nextCursor: hasMore && last ? encodeRewardHandoffCursor({
            targetAt: nullableText(last.target_at),
            createdAt: text(last.created_at) ?? "",
            id: text(last.id) ?? "",
          }) : null,
          limit,
        },
      };
    },

    async retryNotification(input) {
      const workspace = await authorizedWorkspace(client, input.workspaceSlug, input.operatorId);
      const result = await client.rpc("retry_reward_handoff_notification", {
        p_workspace: workspace.id,
        p_operator: input.operatorId,
        p_pending_reward: input.pendingRewardId,
        p_notification_type: input.notificationType,
      });
      if (result.error) mapDatabaseError(result.error);
      return result.data;
    },
    async updateSettings(input) {
      const workspace = await authorizedWorkspace(client, input.workspaceSlug, input.operatorId);
      const result = await client.rpc("set_reward_processing_window", {
        p_workspace: workspace.id,
        p_operator: input.operatorId,
        p_days: input.days,
      });
      if (result.error) mapDatabaseError(result.error);
      const payload = record(result.data);
      return {
        workspaceId: text(payload.workspaceId) ?? workspace.id,
        rewardProcessingWindowDays: payload.rewardProcessingWindowDays == null
          ? null
          : number(payload.rewardProcessingWindowDays),
      };
    },
  };
}

export function rewardHandoffStatus(code: RewardHandoffErrorCode): 400 | 401 | 403 | 409 | 422 | 500 {
  if (code === "VALIDATION_FAILED") return 400;
  if (code === "NOT_AUTHENTICATED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "WORKFLOW_STALE" || code === "WRONG_STATE" || code === "IDEMPOTENCY_CONFLICT"
    || code === "PENDING_REWARD_EXISTS" || code === "PENDING_REWARD_NOT_FOUND"
    || code === "CANCELLATION_NOT_ALLOWED" || code === "REWARD_CONTRACT_EXISTS") return 409;
  if (code === "REWARD_CONTRACT_REQUIRED" || code === "COMPLETION_NOT_ELIGIBLE") return 422;
  return 500;
}
