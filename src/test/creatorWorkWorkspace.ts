import type { ActiveMissionWorkspace, WorkflowState, WorkItemState } from "@/lib/activeMission";

export function creatorWorkWorkspace(id: string, state: WorkflowState, itemState: WorkItemState): ActiveMissionWorkspace {
  return {
    workflow: { id: `workflow-${id}`, submissionId: id, state, acceptedAt: "2026-10-20T00:00:00Z", deadline: "2026-10-30T00:00:00Z", revision: 3,
      fulfillmentRequired: false, revisionLimit: 2, reviewSlaHours: 48, revisionResponseHours: 48, createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-23T00:00:00Z" },
    mission: { id: `mission-${id}`, slug: id, title: `Mission ${id}`, missionType: "ugc", brief: { description: null, deliverables: [], requirements: [], platforms: [], effort: null, targetAudience: null, dos: [], donts: [], keyMessages: [], referenceLinks: [] } },
    fulfillment: null,
    workItems: [{ id: `item-${id}`, title: "Required post", platform: "instagram", requirements: [], required: true, position: 0,
      deadline: "2026-10-28T00:00:00Z", state: itemState, draft: null, currentSubmittedVersionId: null, approvedVersionId: null, reviewStartedAt: null, reviewDueAt: null }],
    events: [], nextAction: { kind: "untrusted-hint", workItemId: null, deadline: null, blockedReason: null }, rewardContract: null,
    completionEligibility: { eligible: false, blockers: ["reward_contract_required"], requiredItemCount: 1, verifiedRequiredItemCount: 0 }, pendingReward: null,
  };
}
