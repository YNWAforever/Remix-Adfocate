import { adminFetch } from "./admin";
import type {
  CompletionEligibility,
  PendingReward,
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

export type CompletionReview = {
  rewardContract: AdminRewardContract | null;
  completionEligibility: CompletionEligibility;
  pendingReward: PendingReward | null;
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

export type RewardHandoffQueueItem = PendingReward & {
  workflowId: string;
  submissionId: string;
  creatorId: string;
  missionId: string;
  rewardContractId: string;
  completionDecisionId: string;
  cancellationDecisionId: string | null;
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
  pendingReward: PendingReward | null;
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

function workspaceHeader(workspace: string) {
  return { "X-Workspace-Slug": workspace.trim() };
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
    `/admin/active-missions/${encodeURIComponent(workflowId)}/completion`,
    { headers: workspaceHeader(workspace) },
  );
}

export function backfillRewardContract(
  workflowId: string,
  input: BackfillRewardContractInput,
): Promise<BackfillRewardContractResult> {
  return mutation(
    `/admin/active-missions/${encodeURIComponent(workflowId)}/reward-contract`,
    input,
  );
}

export function approveMissionCompletion(
  workflowId: string,
  input: ApproveCompletionInput,
): Promise<RewardHandoffMutationResult> {
  return mutation(
    `/admin/active-missions/${encodeURIComponent(workflowId)}/completion`,
    input,
  );
}

export function cancelRewardHandoff(
  workflowId: string,
  input: CancelRewardHandoffInput,
): Promise<RewardHandoffMutationResult> {
  return mutation(
    `/admin/active-missions/${encodeURIComponent(workflowId)}/reward-handoff/cancel`,
    input,
  );
}

export function fetchRewardHandoffs(
  filters: RewardHandoffListFilters,
): Promise<RewardHandoffListResponse> {
  const params = new URLSearchParams();
  if (filters.due) params.set("due", filters.due);
  if (filters.component) params.set("component", filters.component);
  if (filters.status) params.set("status", filters.status);
  const query = params.toString();
  return adminFetch<RewardHandoffListResponse>(
    `/admin/reward-handoffs${query ? `?${query}` : ""}`,
    { headers: workspaceHeader(filters.workspace) },
  );
}

export function setRewardProcessingWindow(input: {
  workspace: string;
  days: number | null;
}): Promise<RewardProcessingWindowResult> {
  return mutation("/admin/reward-handoffs/settings", input, "PUT");
}
