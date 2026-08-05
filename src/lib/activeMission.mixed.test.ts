import { describe, expect, it } from "vitest";
import { deriveNextAction, type ActiveMissionWorkspace, type WorkItemState } from "./activeMission";

function workspace(
  workflowState: ActiveMissionWorkspace["workflow"]["state"],
  items: Array<{ id: string; state: WorkItemState; required: boolean; deadline: string | null }>,
  fulfillment: ActiveMissionWorkspace["fulfillment"] = null,
): ActiveMissionWorkspace {
  return {
    workflow: {
      id: "workflow-1", submissionId: "sub-1", state: workflowState, acceptedAt: "2026-07-15T00:00:00Z",
      deadline: "2026-07-20T00:00:00Z", revision: 0, fulfillmentRequired: fulfillment !== null, revisionLimit: 2,
      reviewSlaHours: 48, revisionResponseHours: 48, createdAt: "2026-07-15T00:00:00Z", updatedAt: "2026-07-15T00:00:00Z",
    },
    mission: {
      id: "mission-1", slug: "mission-one", title: "Mission one", missionType: "content",
      brief: { description: null, deliverables: [], requirements: [], platforms: [], effort: null,
        targetAudience: null, dos: [], donts: [], keyMessages: [], referenceLinks: [] },
    },
    fulfillment,
    workItems: items.map((item, position) => ({
      ...item,
      title: item.id,
      platform: "instagram",
      requirements: [],
      position,
      draft: null,
      currentSubmittedVersionId: null,
      approvedVersionId: null,
      reviewStartedAt: null,
      reviewDueAt: null,
    })),
    events: [],
    rewardContract: null,
    completionEligibility: { eligible: false, blockers: ["reward_contract_required"],
      requiredItemCount: 1, verifiedRequiredItemCount: 0 },
    pendingReward: null,
    nextAction: { kind: "ignored", workItemId: null, deadline: null, blockedReason: null },
  };
}

describe("deriveNextAction mixed workflow states", () => {
  it("selects the remaining required publication action after another item is verified", () => {
    expect(deriveNextAction(workspace("publication_in_progress", [
      { id: "verified", state: "proof_verified", required: true, deadline: "2026-07-15T00:00:00Z" },
      { id: "publish-next", state: "approved_to_publish", required: true, deadline: "2026-07-17T00:00:00Z" },
    ]))).toMatchObject({
      kind: "publish_and_submit_proof",
      owner: "creator",
      workItemId: "publish-next",
    });
  });

  it("prioritizes required proof corrections over optional proof review", () => {
    expect(deriveNextAction(workspace("publication_in_progress", [
      { id: "optional-review", state: "proof_under_review", required: false, deadline: "2026-07-15T00:00:00Z" },
      { id: "required-correction", state: "proof_correction_requested", required: true, deadline: "2026-07-17T00:00:00Z" },
    ]))).toMatchObject({
      kind: "revise_publication_proof",
      owner: "creator",
      workItemId: "required-correction",
    });
  });

  it("does not treat optional unverified proof as blocking a verified required set", () => {
    expect(deriveNextAction(workspace("proof_verified", [
      { id: "required", state: "proof_verified", required: true, deadline: null },
      { id: "optional", state: "approved_to_publish", required: false, deadline: null },
    ]))).toMatchObject({ kind: "proof_verified", owner: "none", workItemId: "required" });
  });

  it("keeps review as the overall action when an optional item is still drafting", () => {
    expect(deriveNextAction(workspace("in_review", [
      { id: "required-review", state: "submitted", required: true, deadline: "2026-07-18T00:00:00Z" },
      { id: "optional-draft", state: "drafting", required: false, deadline: "2026-07-16T00:00:00Z" },
    ]))).toEqual({
      kind: "await_review",
      workItemId: "required-review",
      deadline: "2026-07-18T00:00:00Z",
      blockedReason: "operator_review",
    });
  });

  it("chooses required drafts before optional drafts, then orders required work by deadline", () => {
    expect(deriveNextAction(workspace("drafting", [
      { id: "optional-first", state: "drafting", required: false, deadline: "2026-07-15T00:00:00Z" },
      { id: "required-later", state: "drafting", required: true, deadline: "2026-07-19T00:00:00Z" },
      { id: "required-sooner", state: "drafting", required: true, deadline: "2026-07-17T00:00:00Z" },
    ]))).toMatchObject({ kind: "draft", workItemId: "required-sooner", deadline: "2026-07-17T00:00:00Z" });
  });

  it.each([
    ["approved_to_publish", "publish_and_submit_proof", "overall"],
    ["cancelled", "contact_support", null],
    ["expired", "contact_support", null],
    ["revision_requested", "revise", "revision"],
    ["in_review", "await_review", "review"],
  ] as const)("honors %s workflow precedence over unrelated drafting work", (state, kind, workItemId) => {
    const stateItem: WorkItemState = state === "revision_requested"
      ? "revision_requested"
      : state === "in_review"
        ? "under_review"
        : state;
    const items = [
      { id: workItemId ?? "overall", state: stateItem, required: true, deadline: "2026-07-18T00:00:00Z" },
      { id: "optional-draft", state: "drafting" as const, required: false, deadline: "2026-07-15T00:00:00Z" },
    ];
    expect(deriveNextAction(workspace(state, items))).toMatchObject({ kind, workItemId });
  });

  it("honors fulfillment precedence over editable work", () => {
    expect(deriveNextAction(workspace("fulfillment_pending", [
      { id: "blocked", state: "blocked_by_fulfillment", required: true, deadline: "2026-07-18T00:00:00Z" },
      { id: "optional-draft", state: "drafting", required: false, deadline: "2026-07-15T00:00:00Z" },
    ], {
      id: "fulfillment-1", status: "shipped", shippedAt: "2026-07-16T00:00:00Z",
      receivedAt: null, operationalNote: null,
    }))).toMatchObject({ kind: "confirm_receipt", workItemId: "blocked" });
  });
});
