import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { AdminRequestError } from "./admin";
import {
  approveMissionCompletion,
  backfillRewardContract,
  cancelRewardHandoff,
  fetchCompletionReview,
  fetchRewardHandoffs,
  normalizeRewardHandoffListFilters,
  setRewardProcessingWindow,
  type AdminCompletionDecision,
  type AdminCompletionEvidenceItem,
  type AdminPendingReward,
  type AdminRewardContract,
  type ApproveCompletionInput,
  type CancelRewardHandoffInput,
  type CompletionReview,
  type RewardHandoffListResponse,
  type RewardHandoffMutationResult,
  type RewardHandoffQueueItem,
} from "./adminRewardHandoff";
import type {
  CompletionEligibility,
  PendingReward,
  RewardContract,
} from "./activeMission";
import { supabase } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

const idempotencyKey = "11111111-1111-4111-8111-111111111111";

function response(body: unknown = { ok: true }, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 409 ? "Conflict" : "OK",
    json: async () => body,
  } as Response;
}

describe("admin reward handoff client", () => {
  beforeEach(() => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: "jwt-123" } },
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the exact completion review route and workspace header", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({
      rewardContract: null,
      completionEligibility: {
        eligible: false,
        blockers: ["reward_contract_required"],
        requiredItemCount: 1,
        verifiedRequiredItemCount: 1,
      },
      pendingReward: null,
    }));

    const result = await fetchCompletionReview("workflow-1", " alpha ");

    expect(result.completionEligibility.verifiedRequiredItemCount).toBe(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/admin/active-missions/workflow-1/completion",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer jwt-123",
          "X-Workspace-Slug": "alpha",
        }),
      }),
    );
  });

  it("serializes backfill, approval, cancellation, and settings bodies without workspace authority", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response());

    await backfillRewardContract("workflow-1", {
      workspace: "alpha",
      pointsAmount: 500,
      cashAmount: 125.5,
      currency: "HKD",
      xpAmount: 0,
      sourceMissionUpdatedAt: "2026-07-30T10:00:00.000Z",
      confirmationEvidenceSource: "operator_record",
      confirmationReason: "Confirmed against the signed operator record.",
      idempotencyKey,
    });
    await approveMissionCompletion("workflow-1", {
      workspace: "alpha",
      expectedState: "proof_verified",
      expectedRevision: 7,
      idempotencyKey,
    });
    await cancelRewardHandoff("workflow-1", {
      workspace: "alpha",
      expectedState: "reward_pending",
      expectedRevision: 8,
      idempotencyKey,
      reasonCategory: "other",
      reasonNote: "Needs finance reassessment.",
    });
    await setRewardProcessingWindow({ workspace: "alpha", days: null });

    const request = (path: string, method: string, body: unknown) => [
      path,
      expect.objectContaining({
        method,
        headers: expect.objectContaining({ "X-Workspace-Slug": "alpha" }),
        body: JSON.stringify(body),
      }),
    ] as const;
    expect(fetch).toHaveBeenNthCalledWith(1, ...request(
      "/api/admin/active-missions/workflow-1/reward-contract",
      "POST",
      {
        pointsAmount: 500,
        cashAmount: 125.5,
        currency: "HKD",
        xpAmount: 0,
        sourceMissionUpdatedAt: "2026-07-30T10:00:00.000Z",
        confirmationEvidenceSource: "operator_record",
        confirmationReason: "Confirmed against the signed operator record.",
        idempotencyKey,
      },
    ));
    expect(fetch).toHaveBeenNthCalledWith(2, ...request(
      "/api/admin/active-missions/workflow-1/completion",
      "POST",
      { expectedState: "proof_verified", expectedRevision: 7, idempotencyKey },
    ));
    expect(fetch).toHaveBeenNthCalledWith(3, ...request(
      "/api/admin/active-missions/workflow-1/reward-handoff/cancel",
      "POST",
      {
        expectedState: "reward_pending",
        expectedRevision: 8,
        idempotencyKey,
        reasonCategory: "other",
        reasonNote: "Needs finance reassessment.",
      },
    ));
    expect(fetch).toHaveBeenNthCalledWith(4, ...request(
      "/api/admin/reward-handoffs/settings",
      "PUT",
      { days: null },
    ));
    for (const [, init] of fetch.mock.calls) {
      expect(JSON.parse(String(init?.body ?? "{}"))).not.toHaveProperty("workspace");
    }
  });

  it("canonicalizes bounded list filters, explicit pending defaults, and workspace transport", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({
      items: [],
      rewardProcessingWindowDays: 7,
    }));

    await fetchRewardHandoffs({
      workspace: " alpha ",
      due: " DUE_SOON " as "due_soon",
      component: " Cash " as "cash",
      status: " " as "",
    });
    await fetchRewardHandoffs({
      workspace: "alpha",
      due: "  " as "",
      component: undefined,
    });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/admin/reward-handoffs?due=due_soon&component=cash&status=pending",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Workspace-Slug": "alpha" }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/admin/reward-handoffs?status=pending",
      expect.any(Object),
    );
    expect(normalizeRewardHandoffListFilters({
      workspace: " alpha ",
      due: " " as "",
      status: undefined,
    })).toEqual({
      workspace: "alpha",
      due: undefined,
      component: undefined,
      status: "pending",
    });
  });

  it("uses the same canonical mutation values in headers and bodies", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response());

    await backfillRewardContract(" workflow-1 ", {
      workspace: " alpha ",
      pointsAmount: 500,
      cashAmount: 125,
      currency: " hkd ",
      xpAmount: 0,
      sourceMissionUpdatedAt: null,
      confirmationEvidenceSource: " OPERATOR_RECORD " as "operator_record",
      confirmationReason: " Confirmed ",
      idempotencyKey,
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/admin/active-missions/workflow-1/reward-contract",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Workspace-Slug": "alpha" }),
        body: JSON.stringify({
          pointsAmount: 500, cashAmount: 125, currency: "HKD", xpAmount: 0,
          sourceMissionUpdatedAt: null, confirmationEvidenceSource: "operator_record",
          confirmationReason: "Confirmed", idempotencyKey,
        }),
      }),
    );
  });

  it("propagates the stable server status and code through AdminRequestError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response({
      error: "Workflow state changed",
      code: "WORKFLOW_STALE",
    }, 409));

    const error = await approveMissionCompletion("workflow-1", {
      workspace: "alpha",
      expectedState: "proof_verified",
      expectedRevision: 7,
      idempotencyKey,
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(AdminRequestError);
    expect(error).toMatchObject({
      status: 409,
      code: "WORKFLOW_STALE",
      message: "Workflow state changed",
    });
  });

  it("keeps public response types tied to the active-mission projection", () => {
    expectTypeOf<CompletionReview["rewardContract"]>().toEqualTypeOf<AdminRewardContract | null>();
    expectTypeOf<CompletionReview["pendingReward"]>().toEqualTypeOf<AdminPendingReward | null>();
    expectTypeOf<RewardHandoffMutationResult["decision"]>()
      .toEqualTypeOf<AdminCompletionDecision | null>();
    expectTypeOf<Pick<AdminRewardContract, keyof RewardContract>>()
      .toEqualTypeOf<RewardContract>();
    expectTypeOf<CompletionReview["completionEligibility"]>().toEqualTypeOf<CompletionEligibility>();
    expectTypeOf<RewardHandoffListResponse["items"][number]>().toEqualTypeOf<RewardHandoffQueueItem>();
    expectTypeOf<RewardHandoffQueueItem["id"]>().toEqualTypeOf<string>();
    expectTypeOf<ApproveCompletionInput["expectedState"]>().toEqualTypeOf<"proof_verified">();
    expectTypeOf<CancelRewardHandoffInput["expectedState"]>().toEqualTypeOf<"reward_pending">();
  });

  it("keeps nested creator and bounded admin projections free of private transport fields", () => {
    type ForbiddenKeys = "reasonNote" | "reasonCategory" | "decidedBy" | "actorId"
      | "operatorId" | "idempotencyKey" | "requestHash" | "proofUrl" | "primaryUrl"
      | "signedUrl" | "storageObjectPath";
    type ForbiddenCreatorKeys = Extract<keyof PendingReward, ForbiddenKeys>;
    type ForbiddenAdminDecisionKeys = Extract<keyof AdminCompletionDecision, ForbiddenKeys>;
    type ForbiddenAdminEvidenceKeys = Extract<
      keyof AdminCompletionEvidenceItem,
      ForbiddenKeys
    >;
    expectTypeOf<ForbiddenCreatorKeys>().toEqualTypeOf<never>();
    expectTypeOf<ForbiddenAdminDecisionKeys>().toEqualTypeOf<never>();
    expectTypeOf<ForbiddenAdminEvidenceKeys>().toEqualTypeOf<never>();
  });

  it("keeps the nested admin decision and evidence key sets exact", () => {
    type DecisionKeys = "id" | "kind" | "workflowRevision" | "requiredItemCount"
      | "verifiedRequiredItemCount" | "evidence" | "decidedAt";
    type EvidenceKeys = "workItemId" | "proofAttemptId" | "proofReviewId"
      | "attemptNumber" | "submittedAt" | "contentChecksum" | "metadataStatus"
      | "reviewNumber" | "reviewedAt" | "reviewDecision";
    expectTypeOf<keyof AdminCompletionDecision>().toEqualTypeOf<DecisionKeys>();
    expectTypeOf<keyof AdminCompletionDecision["evidence"]>()
      .toEqualTypeOf<"requiredItems">();
    expectTypeOf<keyof AdminCompletionEvidenceItem>().toEqualTypeOf<EvidenceKeys>();
  });

  it("models the exact bounded mutation decision shape", () => {
    const decision = {
      id: "decision-1",
      kind: "approved" as const,
      workflowRevision: 8,
      requiredItemCount: 2,
      verifiedRequiredItemCount: 2,
      evidence: { requiredItems: [] },
      decidedAt: "2026-07-31T10:00:00.000Z",
    } satisfies AdminCompletionDecision;
    expect(decision).toEqual({
      id: "decision-1", kind: "approved", workflowRevision: 8,
      requiredItemCount: 2, verifiedRequiredItemCount: 2,
      evidence: { requiredItems: [] }, decidedAt: "2026-07-31T10:00:00.000Z",
    });
  });
});
