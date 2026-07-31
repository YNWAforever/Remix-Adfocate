import type { SupabaseClient } from "@supabase/supabase-js";

type JsonRow = Record<string, unknown>;

export type RewardHandoffErrorCode =
  | "VALIDATION_FAILED"
  | "NOT_AUTHENTICATED"
  | "FORBIDDEN"
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
};

export type AdminRewardHandoffRepository = {
  getCompletion(input: { workflowId: string; workspaceSlug: string; operatorId: string }): Promise<RewardHandoffProjection>;
  backfillRewardContract(input: BackfillRewardContractInput): Promise<unknown>;
  approveCompletion(input: ApproveCompletionInput): Promise<unknown>;
  cancelRewardHandoff(input: CancelRewardHandoffInput): Promise<unknown>;
  listRewardHandoffs(input: RewardHandoffListFilters): Promise<unknown>;
  updateSettings(input: { workspaceSlug: string; operatorId: string; days: number | null }): Promise<unknown>;
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

function validation(message: string): never {
  throw new RewardHandoffError("VALIDATION_FAILED", message);
}

export function validateUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) validation(`${field} must be a UUID`);
  return value;
}

export function validateCompletionPayload(value: unknown) {
  const body = record(value);
  const expectedState = text(body.expectedState);
  const expectedRevision = integer(body.expectedRevision);
  if (expectedState !== "proof_verified") validation("expectedState must be proof_verified");
  if (expectedRevision < 0) validation("expectedRevision must be a non-negative integer");
  return {
    expectedState,
    expectedRevision,
    idempotencyKey: validateUuid(body.idempotencyKey, "idempotencyKey"),
  } as const;
}

export function validateCancellationPayload(value: unknown) {
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
    idempotencyKey: validateUuid(body.idempotencyKey, "idempotencyKey"),
    reasonCategory: reasonCategory as CancellationInput["reasonCategory"],
    reasonNote,
  } as const;
}

export function validateBackfillPayload(value: unknown) {
  const body = record(value);
  const pointsAmount = integer(body.pointsAmount);
  const cashAmount = typeof body.cashAmount === "number" ? body.cashAmount : Number.NaN;
  const currency = text(body.currency)?.toUpperCase() ?? "";
  const xpAmount = integer(body.xpAmount);
  const sourceMissionUpdatedAt = body.sourceMissionUpdatedAt == null
    ? null
    : text(body.sourceMissionUpdatedAt);
  const confirmationEvidenceSource = text(body.confirmationEvidenceSource)?.toLowerCase() ?? "";
  const confirmationReason = text(body.confirmationReason);
  if (pointsAmount < 0 || !Number.isFinite(cashAmount) || cashAmount < 0 || xpAmount < 0) {
    validation("Reward amounts must be non-negative");
  }
  if (!/^[A-Z]{3}$/.test(currency)) validation("currency must be an ISO-style three-letter code");
  if (sourceMissionUpdatedAt !== null && !Number.isFinite(Date.parse(sourceMissionUpdatedAt))) {
    validation("sourceMissionUpdatedAt must be an ISO timestamp or null");
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
    idempotencyKey: validateUuid(body.idempotencyKey, "idempotencyKey"),
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
}) {
  return {
    due: normalizedEnum(value.due, DUE_FILTERS, "due") as RewardHandoffListFilters["due"],
    component: normalizedEnum(value.component, COMPONENT_FILTERS, "component") as RewardHandoffListFilters["component"],
    status: (normalizedEnum(value.status, STATUS_FILTERS, "status") ?? "pending") as RewardHandoffListFilters["status"],
  };
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

export function normalizeOperatorRewardHandoffProjection(input: {
  workflow: unknown;
  contract: unknown;
  requiredItems: unknown[];
  pendingReward: unknown;
  decision?: unknown;
}): RewardHandoffProjection {
  const workflow = record(input.workflow);
  const contract = rewardContract(input.contract);
  const pending = operatorPendingReward(input.pendingReward, input.decision);
  return {
    rewardContract: contract,
    completionEligibility: buildCompletionEligibility({
      workflowState: workflow.state,
      requiredItems: input.requiredItems,
      contract,
      pendingReward: pending,
    }),
    pendingReward: pending,
  };
}

function mapDatabaseError(error: { message?: string | null } | null): never {
  const message = (error?.message ?? "reward handoff database error").toLowerCase();
  const mappings: Array<[string, RewardHandoffErrorCode]> = [
    ["idempotency_conflict", "IDEMPOTENCY_CONFLICT"],
    ["workflow_stale", "WORKFLOW_STALE"],
    ["wrong_state", "WRONG_STATE"],
    ["reward_contract_required", "REWARD_CONTRACT_REQUIRED"],
    ["reward_contract_exists", "REWARD_CONTRACT_REQUIRED"],
    ["completion_not_eligible", "COMPLETION_NOT_ELIGIBLE"],
    ["pending_reward_exists", "PENDING_REWARD_EXISTS"],
    ["pending_reward_not_found", "PENDING_REWARD_NOT_FOUND"],
    ["cancellation_not_allowed", "CANCELLATION_NOT_ALLOWED"],
    ["validation_failed", "VALIDATION_FAILED"],
    ["backfill_contract_invalid", "VALIDATION_FAILED"],
    ["backfill_reason_required", "VALIDATION_FAILED"],
    ["reward_processing_window_invalid", "VALIDATION_FAILED"],
    ["not_authorized", "FORBIDDEN"],
    ["not_found", "FORBIDDEN"],
    ["reward_workflow_not_found", "FORBIDDEN"],
    ["workspace_not_found", "FORBIDDEN"],
  ];
  const code = mappings.find(([token]) => message.includes(token))?.[1] ?? "UNKNOWN";
  throw new RewardHandoffError(code, code === "FORBIDDEN" ? "forbidden" : message);
}

async function authorizedWorkspace(client: SupabaseClient, workspaceSlug: string, operatorId: string) {
  const workspace = await client.from("workspaces")
    .select("id, reward_processing_window_days")
    .eq("slug", workspaceSlug)
    .maybeSingle();
  if (workspace.error) mapDatabaseError(workspace.error);
  if (!workspace.data) throw new RewardHandoffError("FORBIDDEN", "forbidden");
  const workspaceId = (workspace.data as JsonRow).id;
  if (typeof workspaceId !== "string") throw new RewardHandoffError("FORBIDDEN", "forbidden");
  const membership = await client.from("brand_users")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", operatorId)
    .eq("active", true)
    .maybeSingle();
  if (membership.error || !membership.data) throw new RewardHandoffError("FORBIDDEN", "forbidden");
  return {
    id: workspaceId,
    rewardProcessingWindowDays: (workspace.data as JsonRow).reward_processing_window_days == null
      ? null
      : number((workspace.data as JsonRow).reward_processing_window_days),
  };
}

export async function getOperatorRewardHandoffProjection(
  client: SupabaseClient,
  workspaceId: string,
  workflowId: string,
  known?: { workflow: unknown; requiredItems: unknown[] },
) {
  let workflowResult: { data: unknown; error: { message?: string | null } | null };
  let itemsResult: { data: unknown[] | null; error: { message?: string | null } | null };
  if (known) {
    workflowResult = { data: known.workflow, error: null };
    itemsResult = { data: known.requiredItems, error: null };
  } else {
    workflowResult = await client.from("mission_workflows")
      .select("id, state, revision")
      .eq("id", workflowId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    itemsResult = await client.from("mission_work_items")
      .select("required, state, current_proof_attempt_id, verified_proof_attempt_id")
      .eq("workspace_id", workspaceId)
      .eq("mission_workflow_id", workflowId);
  }
  if (workflowResult.error) mapDatabaseError(workflowResult.error);
  if (!workflowResult.data) throw new RewardHandoffError("FORBIDDEN", "forbidden");
  if (itemsResult.error) mapDatabaseError(itemsResult.error);
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
  const decisionId = pending?.cancellation_decision_id ?? pending?.completion_decision_id;
  let decisionResult: { data: unknown; error: { message?: string | null } | null } = { data: null, error: null };
  if (typeof decisionId === "string") {
    decisionResult = await client.from("mission_completion_decisions").select("*")
      .eq("workspace_id", workspaceId).eq("id", decisionId).maybeSingle();
    if (decisionResult.error) mapDatabaseError(decisionResult.error);
  }
  return normalizeOperatorRewardHandoffProjection({
    workflow: workflowResult.data,
    contract: contractResult.data,
    requiredItems: (itemsResult.data ?? []) as unknown[],
    pendingReward: pending,
    decision: decisionResult.data,
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
      return getOperatorRewardHandoffProjection(client, workspace.id, input.workflowId);
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
        p_xp_amount: input.xpAmount,
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
        .select("*, creators!mission_pending_rewards_creator_id_fkey(display_name), missions!mission_pending_rewards_mission_id_fkey(title)")
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
      const result = await query
        .order("target_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (result.error) mapDatabaseError(result.error);
      return {
        items: ((result.data ?? []) as JsonRow[]).map((row) => ({
          ...operatorPendingReward(row),
          creatorDisplayName: text(record(row.creators).display_name),
          missionTitle: text(record(row.missions).title),
        })),
        rewardProcessingWindowDays: workspace.rewardProcessingWindowDays,
      };
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
    || code === "CANCELLATION_NOT_ALLOWED") return 409;
  if (code === "REWARD_CONTRACT_REQUIRED" || code === "COMPLETION_NOT_ELIGIBLE") return 422;
  return 500;
}
