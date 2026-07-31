import { adminFetch } from "./admin";
import type {
  CompletionEligibility,
  RewardContract,
  WorkflowState,
} from "./activeMission";

export type AdminRewardContract = RewardContract & {
  sourceMissionUpdatedAt: string | null;
  confirmedBy: string | null;
  confirmationEvidenceSource:
    | "mission_brief"
    | "signed_agreement"
    | "operator_record"
    | "other"
    | null;
  confirmationReason: string | null;
};

export type AdminCompletionEvidenceItem = {
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
};

export type AdminCompletionDecision = {
  id: string;
  kind: "approved" | "cancelled";
  workflowRevision: number;
  requiredItemCount: number;
  verifiedRequiredItemCount: number;
  evidence: {
    requiredItems: AdminCompletionEvidenceItem[];
  };
  decidedAt: string;
};

export type AdminPendingReward = {
  id: string;
  workflowId: string;
  submissionId: string;
  creatorId: string;
  missionId: string;
  rewardContractId: string;
  completionDecisionId: string;
  cancellationDecisionId: string | null;
  reward: Pick<RewardContract, "pointsAmount" | "cashAmount" | "currency" | "xpAmount">;
  status: "pending" | "cancelled";
  processingWindowDays: number | null;
  targetAt: string | null;
  createdAt: string;
  cancelledAt: string | null;
  decision: AdminCompletionDecision | null;
};

export type CompletionReview = {
  rewardContract: AdminRewardContract | null;
  completionEligibility: CompletionEligibility;
  pendingReward: AdminPendingReward | null;
};

export type BackfillRewardContractInput = {
  workspace: string;
  pointsAmount: number;
  cashAmount: number;
  currency: string;
  xpAmount: 0;
  sourceMissionUpdatedAt: string | null;
  confirmationEvidenceSource:
    | "mission_brief"
    | "signed_agreement"
    | "operator_record"
    | "other";
  confirmationReason: string;
  idempotencyKey: string;
};

export type ApproveCompletionInput = {
  workspace: string;
  expectedState: "proof_verified";
  expectedRevision: number;
  idempotencyKey: string;
};

export type CancelRewardHandoffInput = {
  workspace: string;
  expectedState: "reward_pending";
  expectedRevision: number;
  idempotencyKey: string;
  reasonCategory: "contract_error" | "eligibility_error" | "duplicate" | "other";
  reasonNote: string;
};

export type RewardHandoffListFilters = {
  workspace: string;
  due?: "overdue" | "due_soon" | "no_target" | "";
  component?: "points" | "cash" | "xp" | "";
  status?: "pending" | "cancelled" | "";
};

export type RewardHandoffQueueDecision = {
  id: string;
  kind: "approved" | "cancelled";
  decidedAt: string;
  requiredItemCount: number;
  verifiedRequiredItemCount: number;
  evidenceAvailable: boolean;
};

export type RewardHandoffQueueItem = AdminPendingReward & {
  creatorDisplayName: string | null;
  missionTitle: string | null;
  completionDecision: RewardHandoffQueueDecision | null;
};

export type RewardHandoffListResponse = {
  items: RewardHandoffQueueItem[];
  rewardProcessingWindowDays: number | null;
};

export type RewardHandoffMutationResult = {
  workflow: {
    id: string | null;
    state: WorkflowState | null;
    revision: number;
    updatedAt: string | null;
  };
  decision: AdminCompletionDecision | null;
  pendingReward: AdminPendingReward | null;
  idempotent: boolean;
};

export type BackfillRewardContractResult = {
  rewardContract: AdminRewardContract | null;
  idempotent: boolean;
};

export type RewardProcessingWindowResult = {
  workspaceId: string;
  rewardProcessingWindowDays: number | null;
};

export function normalizeIdentifier(value: string): string {
  return value.trim();
}

export function normalizeWorkspace(value: string): string {
  return value.trim();
}

function normalizeLower<T extends string>(value: T | "" | undefined): T | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized as T : undefined;
}

function normalizeRequiredLower<T extends string>(value: T): T {
  return value.trim().toLowerCase() as T;
}

export function normalizeRewardHandoffListFilters(
  filters: RewardHandoffListFilters,
): Required<Pick<RewardHandoffListFilters, "workspace" | "status">>
  & Pick<RewardHandoffListFilters, "due" | "component"> {
  return {
    workspace: normalizeWorkspace(filters.workspace),
    due: normalizeLower(filters.due),
    component: normalizeLower(filters.component),
    status: normalizeLower(filters.status) ?? "pending",
  };
}

export function normalizeBackfillRewardContractInput(
  input: BackfillRewardContractInput,
): BackfillRewardContractInput {
  return {
    ...input,
    workspace: normalizeWorkspace(input.workspace),
    currency: input.currency.trim().toUpperCase(),
    confirmationEvidenceSource: normalizeRequiredLower(input.confirmationEvidenceSource),
    confirmationReason: input.confirmationReason.trim(),
    sourceMissionUpdatedAt: input.sourceMissionUpdatedAt?.trim() ?? null,
  };
}

export function normalizeApproveCompletionInput(
  input: ApproveCompletionInput,
): ApproveCompletionInput {
  return {
    ...input,
    workspace: normalizeWorkspace(input.workspace),
    expectedState: normalizeRequiredLower(input.expectedState),
  };
}

export function normalizeCancelRewardHandoffInput(
  input: CancelRewardHandoffInput,
): CancelRewardHandoffInput {
  return {
    ...input,
    workspace: normalizeWorkspace(input.workspace),
    expectedState: normalizeRequiredLower(input.expectedState),
    reasonCategory: normalizeRequiredLower(input.reasonCategory),
    reasonNote: input.reasonNote.trim(),
  };
}

export function normalizeRewardProcessingWindowInput(input: {
  workspace: string;
  days: number | null;
}) {
  return { ...input, workspace: normalizeWorkspace(input.workspace) };
}

function workspaceHeader(workspace: string) {
  return { "X-Workspace-Slug": normalizeWorkspace(workspace) };
}

function mutation<TInput extends { workspace: string }, TResult>(
  path: string,
  input: TInput,
  method: "POST" | "PUT" = "POST",
): Promise<TResult> {
  const { workspace, ...body } = input;
  return adminFetch<TResult>(path, {
    method,
    headers: workspaceHeader(workspace),
    body: JSON.stringify(body),
  });
}

export function fetchCompletionReview(
  workflowId: string,
  workspace: string,
): Promise<CompletionReview> {
  return adminFetch<CompletionReview>(
    `/admin/active-missions/${encodeURIComponent(normalizeIdentifier(workflowId))}/completion`,
    { headers: workspaceHeader(workspace) },
  );
}

export function backfillRewardContract(
  workflowId: string,
  input: BackfillRewardContractInput,
): Promise<BackfillRewardContractResult> {
  return mutation(
    `/admin/active-missions/${encodeURIComponent(normalizeIdentifier(workflowId))}/reward-contract`,
    normalizeBackfillRewardContractInput(input),
  );
}

export function approveMissionCompletion(
  workflowId: string,
  input: ApproveCompletionInput,
): Promise<RewardHandoffMutationResult> {
  return mutation(
    `/admin/active-missions/${encodeURIComponent(normalizeIdentifier(workflowId))}/completion`,
    normalizeApproveCompletionInput(input),
  );
}

export function cancelRewardHandoff(
  workflowId: string,
  input: CancelRewardHandoffInput,
): Promise<RewardHandoffMutationResult> {
  return mutation(
    `/admin/active-missions/${encodeURIComponent(normalizeIdentifier(workflowId))}/reward-handoff/cancel`,
    normalizeCancelRewardHandoffInput(input),
  );
}

export function fetchRewardHandoffs(
  filters: RewardHandoffListFilters,
): Promise<RewardHandoffListResponse> {
  const normalized = normalizeRewardHandoffListFilters(filters);
  const params = new URLSearchParams();
  if (normalized.due) params.set("due", normalized.due);
  if (normalized.component) params.set("component", normalized.component);
  params.set("status", normalized.status);
  const query = params.toString();
  return adminFetch<RewardHandoffListResponse>(
    `/admin/reward-handoffs?${query}`,
    { headers: workspaceHeader(normalized.workspace) },
  );
}

export function setRewardProcessingWindow(input: {
  workspace: string;
  days: number | null;
}): Promise<RewardProcessingWindowResult> {
  return mutation(
    "/admin/reward-handoffs/settings", normalizeRewardProcessingWindowInput(input), "PUT",
  );
}
