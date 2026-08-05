import type { CreatorPendingReward, WorkflowState } from "./activeMission";

export type CreatorRewardHandoffKind = "reward_pending" | "reward_reassessment";

export function creatorRewardHandoffKind(
  pendingReward: CreatorPendingReward | null,
): CreatorRewardHandoffKind | null {
  if (!pendingReward) return null;
  return pendingReward.status === "cancelled"
    || pendingReward.decisionState.kind === "cancelled"
    ? "reward_reassessment"
    : "reward_pending";
}

export function creatorRewardExperience(
  workflowState: WorkflowState,
  pendingReward: CreatorPendingReward | null,
): CreatorRewardHandoffKind | null {
  const kind = creatorRewardHandoffKind(pendingReward);
  if (!kind) return null;
  if (workflowState === "reward_pending") return kind;
  if (workflowState === "proof_verified" && kind === "reward_reassessment") return kind;
  return null;
}
