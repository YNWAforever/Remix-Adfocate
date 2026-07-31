import { describe, expect, expectTypeOf, it } from "vitest";
import type { CompletionDecision as ServerCompletionDecision } from "../../server/lib/activeMission/types";
import {
  deriveNextAction,
  publicationStatePresentation,
  type ActiveMissionWorkspace,
  type CompletionDecision,
  type PublicationProofReviewView,
  type WorkItemState,
} from "./activeMission";

function workspace(options: {
  workflowState?: ActiveMissionWorkspace["workflow"]["state"];
  fulfillment?: ActiveMissionWorkspace["fulfillment"];
  items?: Array<{ id: string; state: WorkItemState; deadline?: string | null; required?: boolean }>;
} = {}): ActiveMissionWorkspace {
  return {
    workflow: {
      id: "workflow-1",
      submissionId: "sub-1",
      state: options.workflowState ?? "drafting",
      acceptedAt: "2026-07-15T00:00:00Z",
      deadline: "2026-07-20T00:00:00Z",
      revision: 0,
      fulfillmentRequired: options.fulfillment !== undefined,
      revisionLimit: 2,
      reviewSlaHours: 48,
      revisionResponseHours: 48,
      createdAt: "2026-07-15T00:00:00Z",
      updatedAt: "2026-07-15T00:00:00Z",
    },
    mission: {
      id: "mission-1",
      slug: "mission-one",
      title: "Mission one",
      missionType: "content",
      brief: {
        description: null,
        deliverables: [],
        requirements: [],
        platforms: [],
        effort: null,
        targetAudience: null,
        dos: [],
        donts: [],
        keyMessages: [],
        referenceLinks: [],
      },
    },
    fulfillment: options.fulfillment ?? null,
    workItems: (options.items ?? [{ id: "item-1", state: "drafting" }]).map((item, position) => ({
      id: item.id,
      title: `Item ${position + 1}`,
      platform: "instagram",
      requirements: [],
      required: item.required ?? true,
      position,
      deadline: Object.prototype.hasOwnProperty.call(item, "deadline") ? item.deadline! : "2026-07-17T00:00:00Z",
      state: item.state,
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
    nextAction: { kind: "ignored-server-hint", workItemId: null, deadline: null, blockedReason: null },
  };
}

const fulfillment = (status: "preparing" | "shipped" | "received"): NonNullable<ActiveMissionWorkspace["fulfillment"]> => ({
  id: "fulfillment-1",
  status,
  shippedAt: status === "preparing" ? null : "2026-07-16T00:00:00Z",
  receivedAt: status === "received" ? "2026-07-16T01:00:00Z" : null,
  operationalNote: null,
});

describe("reward handoff shared types", () => {
  it("keeps the creator-safe completion decision contract identical on client and server", () => {
    const decision = {
      id: "decision-1",
      missionWorkflowId: "workflow-1",
      decisionKind: "approved" as const,
      rewardContractId: "contract-1",
      pendingRewardId: "pending-1",
      supersedesDecisionId: null,
      workflowRevision: 3,
      requiredItemCount: 2,
      verifiedRequiredItemCount: 2,
      evidenceSnapshot: { proof: "verified" },
      decidedAt: "2026-07-31T00:00:00Z",
    } satisfies CompletionDecision;

    expectTypeOf<CompletionDecision>().toEqualTypeOf<ServerCompletionDecision>();
    expect(decision).toMatchObject({
      decisionKind: "approved",
      workflowRevision: 3,
      verifiedRequiredItemCount: 2,
    });
  });

  it("requires all three reward projections on every workspace response", () => {
    type IsOptional<Key extends keyof ActiveMissionWorkspace> = Pick<
      ActiveMissionWorkspace, Key
    > extends Required<Pick<ActiveMissionWorkspace, Key>> ? false : true;
    expectTypeOf<IsOptional<"rewardContract">>().toEqualTypeOf<false>();
    expectTypeOf<IsOptional<"completionEligibility">>().toEqualTypeOf<false>();
    expectTypeOf<IsOptional<"pendingReward">>().toEqualTypeOf<false>();
  });
});
describe("deriveNextAction", () => {
  it("defines stable label keys and owners for every publication state", () => {
    expect(publicationStatePresentation).toEqual({
      approved_to_publish: { labelKey: "activeMission.state.approvedToPublish", owner: "creator" },
      proof_submitted: { labelKey: "activeMission.state.proofSubmitted", owner: "operator" },
      proof_under_review: { labelKey: "activeMission.state.proofUnderReview", owner: "operator" },
      proof_correction_requested: { labelKey: "activeMission.state.proofCorrectionRequested", owner: "creator" },
      proof_verified: { labelKey: "activeMission.state.proofVerified", owner: "none" },
    });
  });

  it("models the server correction decision as rejected", () => {
    const review: PublicationProofReviewView = {
      id: "review-1",
      state: "correction_requested",
      decision: "rejected",
      reviewedAt: "2026-07-26T00:00:00Z",
      createdAt: "2026-07-25T00:00:00Z",
      creatorResponseDeadline: null,
    };
    expect(review.decision).toBe("rejected");
  });

  it.each([
    ["approved_to_publish", "publish_and_submit_proof", "creator"],
    ["proof_submitted", "await_proof_review", "operator"],
    ["proof_under_review", "await_proof_review", "operator"],
    ["proof_correction_requested", "revise_publication_proof", "creator"],
    ["proof_verified", "proof_verified", "none"],
  ] as const)("maps publication item %s to %s", (state, kind, owner) => {
    const workflowState = state === "approved_to_publish" || state === "proof_verified"
      ? state
      : "publication_in_progress";
    expect(deriveNextAction(workspace({
      workflowState,
      items: [{ id: "publication-item", state, deadline: "2026-07-19T00:00:00Z" }],
    }))).toMatchObject({ kind, owner, workItemId: "publication-item" });
  });

  it("prioritizes a revision request over other editable work", () => {
    expect(deriveNextAction(workspace({
      workflowState: "revision_requested",
      items: [
        { id: "item-1", state: "drafting" },
        { id: "item-2", state: "revision_requested", deadline: "2026-07-16T00:00:00Z" },
      ],
    }))).toEqual({
      kind: "revise",
      workItemId: "item-2",
      deadline: "2026-07-16T00:00:00Z",
      blockedReason: null,
    });
  });

  it("selects the earliest editable draft deterministically", () => {
    expect(deriveNextAction(workspace({ items: [
      { id: "later", state: "drafting", deadline: "2026-07-19T00:00:00Z" },
      { id: "earlier", state: "drafting", deadline: "2026-07-17T00:00:00Z" },
    ] }))).toMatchObject({ kind: "draft", workItemId: "earlier" });
  });

  it("blocks on product preparation and asks for receipt once shipped", () => {
    expect(deriveNextAction(workspace({
      workflowState: "fulfillment_pending",
      fulfillment: fulfillment("preparing"),
      items: [{ id: "item-1", state: "blocked_by_fulfillment" }],
    }))).toEqual({
      kind: "wait_for_shipment",
      workItemId: "item-1",
      deadline: "2026-07-17T00:00:00Z",
      blockedReason: "fulfillment_not_shipped",
    });
    expect(deriveNextAction(workspace({
      workflowState: "fulfillment_pending",
      fulfillment: fulfillment("shipped"),
      items: [{ id: "item-1", state: "blocked_by_fulfillment" }],
    }))).toEqual({
      kind: "confirm_receipt",
      workItemId: "item-1",
      deadline: "2026-07-17T00:00:00Z",
      blockedReason: "fulfillment_receipt_required",
    });
  });

  it("assigns waiting states to review and publication", () => {
    expect(deriveNextAction(workspace({
      workflowState: "in_review",
      items: [{ id: "item-1", state: "under_review", deadline: null }],
    }))).toEqual({ kind: "await_review", workItemId: "item-1", deadline: null, blockedReason: "operator_review" });
    expect(deriveNextAction(workspace({
      workflowState: "approved_to_publish",
      items: [{ id: "item-1", state: "approved_to_publish", deadline: null }],
    }))).toEqual({
      kind: "publish_and_submit_proof", workItemId: "item-1", deadline: null,
      blockedReason: null, owner: "creator",
    });
  });

  it("does not reopen optional drafting after the overall workflow is approved", () => {
    expect(deriveNextAction(workspace({
      workflowState: "approved_to_publish",
      items: [{ id: "optional-item", state: "drafting", required: false }],
    }))).toEqual({
      kind: "await_publication",
      workItemId: null,
      deadline: "2026-07-20T00:00:00Z",
      blockedReason: "approval_is_not_completion",
    });
  });

  it.each([
    ["cancelled", "workflow_cancelled"],
    ["expired", "workflow_expired"],
  ] as const)("maps terminal %s workflows to support", (workflowState, blockedReason) => {
    expect(deriveNextAction(workspace({ workflowState, items: [{ id: "item-1", state: workflowState }] }))).toEqual({
      kind: "contact_support",
      workItemId: null,
      deadline: "2026-07-20T00:00:00Z",
      blockedReason,
    });
  });

  it("covers accepted setup and impossible no-item states", () => {
    expect(deriveNextAction(workspace({ workflowState: "accepted", items: [] }))).toEqual({
      kind: "wait_for_setup",
      workItemId: null,
      deadline: "2026-07-20T00:00:00Z",
      blockedReason: "work_items_not_ready",
    });
    expect(deriveNextAction(workspace({ workflowState: "drafting", items: [] }))).toEqual({
      kind: "contact_support",
      workItemId: null,
      deadline: "2026-07-20T00:00:00Z",
      blockedReason: "workflow_has_no_work_items",
    });
  });
});
