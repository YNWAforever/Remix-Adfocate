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
  type BackfillRewardContractInput,
  type CancelRewardHandoffInput,
  type CompletionReview,
  type RewardHandoffListResponse,
  type RewardHandoffMutationResult,
  type RewardHandoffQueueItem,
} from "./adminRewardHandoff";
import type {
  ActiveMissionWorkspace,
  CompletionEligibility,
  CreatorPendingReward,
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

    const transportExtras = {
      workspaceSlug: "spoofed",
      workspace_id: "spoofed-id",
      notes: "must not cross the client boundary",
      arbitrary: { unsafe: true },
    };
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
      ...transportExtras,
    } as BackfillRewardContractInput);
    await approveMissionCompletion("workflow-1", {
      workspace: "alpha",
      expectedState: "proof_verified",
      expectedRevision: 7,
      idempotencyKey,
      ...transportExtras,
    } as ApproveCompletionInput);
    await cancelRewardHandoff("workflow-1", {
      workspace: "alpha",
      expectedState: "reward_pending",
      expectedRevision: 8,
      idempotencyKey,
      reasonCategory: "other",
      reasonNote: "Needs finance reassessment.",
      ...transportExtras,
    } as CancelRewardHandoffInput);
    await setRewardProcessingWindow({
      workspace: " alpha ",
      days: null,
      ...transportExtras,
    } as Parameters<typeof setRewardProcessingWindow>[0]);

    const request = (path: string, method: string, body: Record<string, unknown>) => {
      const { idempotencyKey: key, ...safeBody } = body;
      return [
        path,
        expect.objectContaining({
          method,
          headers: expect.objectContaining({
            "X-Workspace-Slug": "alpha",
            ...(key ? { "Idempotency-Key": key } : {}),
          }),
          body: JSON.stringify(safeBody),
        }),
      ] as const;
    };    expect(fetch).toHaveBeenNthCalledWith(1, ...request(
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
      const body = JSON.parse(String(init?.body ?? "{}"));
      for (const key of ["workspace", "workspaceSlug", "workspace_id", "notes", "arbitrary"]) {
        expect(body).not.toHaveProperty(key);
      }
    }
  });

  it("uses the Idempotency-Key header and never serializes it in mutation bodies", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response());
    await approveMissionCompletion("workflow-1", {
      workspace: "alpha",
      expectedState: "proof_verified",
      expectedRevision: 7,
      idempotencyKey,
    });
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers).toEqual(expect.objectContaining({
      "X-Workspace-Slug": "alpha",
      "Idempotency-Key": idempotencyKey,
    }));
    expect(JSON.parse(String(init?.body))).toEqual({
      expectedState: "proof_verified",
      expectedRevision: 7,
    });
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

  it("serializes bounded pagination and continuation cursor deterministically", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({
      items: [], rewardProcessingWindowDays: null,
      pageInfo: { hasMore: false, nextCursor: null, limit: 25 },
    }));
    await fetchRewardHandoffs({ workspace: "alpha", status: "pending", limit: 25, cursor: "cursor-token" });
    expect(fetch).toHaveBeenCalledWith(
      "/api/admin/reward-handoffs?status=pending&limit=25&cursor=cursor-token",
      expect.any(Object),
    );
  });
  it("uses the same canonical mutation values in headers and bodies", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response());

    await backfillRewardContract(" workflow-1 ", {
      workspace: " alpha ",
      pointsAmount: 500,
      cashAmount: 125,
      currency: " hkd ",
      xpAmount: 0,
      sourceMissionUpdatedAt: "   ",
      confirmationEvidenceSource: " OPERATOR_RECORD " as "operator_record",
      confirmationReason: " Confirmed ",
      idempotencyKey,
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/admin/active-missions/workflow-1/reward-contract",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Workspace-Slug": "alpha", "Idempotency-Key": idempotencyKey }),
        body: JSON.stringify({
          pointsAmount: 500, cashAmount: 125, currency: "HKD", xpAmount: 0,
          sourceMissionUpdatedAt: null, confirmationEvidenceSource: "operator_record",
          confirmationReason: "Confirmed",
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
    type CreatorForbiddenKeys = "workflowId" | "submissionId" | "creatorId" | "missionId"
      | "rewardContractId" | "completionDecisionId" | "cancellationDecisionId"
      | "reasonNote" | "reasonCategory" | "decidedBy" | "actorId" | "operatorId"
      | "evidence" | "idempotencyKey" | "requestHash" | "proofUrl" | "primaryUrl"
      | "signedUrl" | "storageObjectPath";
    type AdminForbiddenKeys = "actorId" | "operatorId" | "idempotencyKey"
      | "requestHash" | "proofUrl" | "primaryUrl" | "signedUrl" | "storageObjectPath";
    type ForbiddenCreatorKeys = Extract<keyof CreatorPendingReward, CreatorForbiddenKeys>;
    type ForbiddenAdminDecisionKeys = Extract<keyof AdminCompletionDecision, AdminForbiddenKeys>;
    type ForbiddenAdminEvidenceKeys = Extract<
      keyof AdminCompletionEvidenceItem,
      AdminForbiddenKeys
    >;
    expectTypeOf<ForbiddenCreatorKeys>().toEqualTypeOf<never>();
    expectTypeOf<ForbiddenAdminDecisionKeys>().toEqualTypeOf<never>();
    expectTypeOf<ForbiddenAdminEvidenceKeys>().toEqualTypeOf<never>();
  });

  it("keeps the nested admin decision and evidence key sets exact", () => {
    type DecisionKeys = "id" | "kind" | "workflowRevision" | "requiredItemCount"
      | "verifiedRequiredItemCount" | "evidence" | "reasonCategory" | "reasonNote"
      | "decidedBy" | "decidedAt";
    type EvidenceKeys = "workItemId" | "proofAttemptId" | "proofReviewId"
      | "attemptNumber" | "submittedAt" | "contentChecksum" | "metadataStatus"
      | "reviewNumber" | "reviewedAt" | "reviewDecision";
    expectTypeOf<keyof AdminCompletionDecision>().toEqualTypeOf<DecisionKeys>();
    expectTypeOf<AdminCompletionDecision["reasonCategory"]>().toEqualTypeOf<
      "contract_error" | "eligibility_error" | "duplicate" | "other" | null
    >();
    expectTypeOf<AdminCompletionDecision["reasonNote"]>().toEqualTypeOf<string | null>();
    expectTypeOf<AdminCompletionDecision["decidedBy"]>().toEqualTypeOf<string>();
    expectTypeOf<keyof AdminCompletionDecision["evidence"]>()
      .toEqualTypeOf<"requiredItems">();
    expectTypeOf<keyof AdminCompletionEvidenceItem>().toEqualTypeOf<EvidenceKeys>();
  });

  it("models the exact creator pending-reward projection separately from admin data", () => {
    type CreatorKeys = "id" | "status" | "reward" | "processingWindowDays"
      | "targetAt" | "createdAt" | "cancelledAt" | "decisionState";
    const pending = {
      id: null,
      status: "pending" as const,
      reward: { pointsAmount: 500, cashAmount: 125, currency: "HKD", xpAmount: 0 },
      processingWindowDays: 7,
      targetAt: "2026-08-07T00:00:00.000Z",
      createdAt: "2026-07-31T00:00:00.000Z",
      cancelledAt: null,
      decisionState: {
        kind: "approved" as const,
        decidedAt: "2026-07-31T00:00:00.000Z",
      },
    } satisfies CreatorPendingReward;

    expectTypeOf<keyof CreatorPendingReward>().toEqualTypeOf<CreatorKeys>();
    expectTypeOf<CreatorPendingReward["id"]>().toEqualTypeOf<null>();
    expectTypeOf<CreatorPendingReward["decisionState"]>().toEqualTypeOf<
      Readonly<{ kind: "approved" | "cancelled"; decidedAt: string }>
    >();
    expectTypeOf<ActiveMissionWorkspace["pendingReward"]>()
      .toEqualTypeOf<CreatorPendingReward | null>();
    expect(pending.decisionState.kind).toBe("approved");
  });

  it("models the exact bounded mutation decision shape", () => {
    const decision = {
      id: "decision-1",
      kind: "approved" as const,
      workflowRevision: 8,
      requiredItemCount: 2,
      verifiedRequiredItemCount: 2,
      evidence: { requiredItems: [] },
      reasonCategory: null,
      reasonNote: null,
      decidedBy: "operator-1",
      decidedAt: "2026-07-31T10:00:00.000Z",
    } satisfies AdminCompletionDecision;
    expect(decision).toEqual({
      id: "decision-1", kind: "approved", workflowRevision: 8,
      requiredItemCount: 2, verifiedRequiredItemCount: 2,
      evidence: { requiredItems: [] }, reasonCategory: null, reasonNote: null,
      decidedBy: "operator-1", decidedAt: "2026-07-31T10:00:00.000Z",
    });
  });
});
