import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { AdminRequestError } from "./admin";
import {
  approveMissionCompletion,
  backfillRewardContract,
  cancelRewardHandoff,
  fetchCompletionReview,
  fetchRewardHandoffs,
  setRewardProcessingWindow,
  type AdminRewardContract,
  type ApproveCompletionInput,
  type CancelRewardHandoffInput,
  type CompletionReview,
  type RewardHandoffListResponse,
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

  it("encodes bounded list filters in stable order and omits empty values", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({
      items: [],
      rewardProcessingWindowDays: 7,
    }));

    await fetchRewardHandoffs({
      workspace: "alpha",
      due: "due_soon",
      component: "cash",
      status: "cancelled",
    });
    await fetchRewardHandoffs({
      workspace: "alpha",
      due: "",
      component: undefined,
      status: "",
    });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/admin/reward-handoffs?due=due_soon&component=cash&status=cancelled",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Workspace-Slug": "alpha" }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/admin/reward-handoffs",
      expect.any(Object),
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
    expectTypeOf<Pick<AdminRewardContract, keyof RewardContract>>()
      .toEqualTypeOf<RewardContract>();
    expectTypeOf<CompletionReview["completionEligibility"]>().toEqualTypeOf<CompletionEligibility>();
    expectTypeOf<CompletionReview["pendingReward"]>().toEqualTypeOf<PendingReward | null>();
    expectTypeOf<Pick<RewardHandoffQueueItem, keyof PendingReward>>()
      .toEqualTypeOf<PendingReward>();
    expectTypeOf<RewardHandoffListResponse["items"][number]>().toEqualTypeOf<RewardHandoffQueueItem>();
    expectTypeOf<ApproveCompletionInput["expectedState"]>().toEqualTypeOf<"proof_verified">();
    expectTypeOf<CancelRewardHandoffInput["expectedState"]>().toEqualTypeOf<"reward_pending">();
  });

  it("keeps creator projections free of operator and proof transport fields", () => {
    type ForbiddenPendingKeys = Extract<
      keyof PendingReward,
      "reasonNote" | "operatorId" | "idempotencyKey" | "requestHash" | "proofUrl" | "signedUrl"
    >;
    expectTypeOf<ForbiddenPendingKeys>().toEqualTypeOf<never>();
  });
});
