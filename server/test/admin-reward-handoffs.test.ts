import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../app";
import type { StaffIdentity } from "../lib/staffAuth";
import {
  RewardHandoffError,
  createRewardHandoffRepository,
  decodeRewardHandoffCursor,
  encodeRewardHandoffCursor,
  normalizeCreatorRewardHandoffProjection,
  validateBackfillPayload,
  type AdminRewardHandoffRepository,
} from "../lib/activeMission/rewardHandoff";
import { createAdminRewardHandoffRoutes } from "../routes/adminRewardHandoffs";

const workflowId = "11111111-1111-4111-8111-111111111111";
const operatorId = "22222222-2222-4222-8222-222222222222";
const idempotencyKey = "33333333-3333-4333-8333-333333333333";

function mounted(
  repository: AdminRewardHandoffRepository,
  identity: () => StaffIdentity = () => ({ userId: operatorId, email: "operator@example.com" }),
) {
  const app = new Hono<Env>();
  app.route("/api/admin", createAdminRewardHandoffRoutes(repository, identity));
  return app;
}

describe("admin reward handoff route contracts", () => {
  it("is mounted beneath the existing staff middleware", () => {
    const source = readFileSync(resolve("server/routes/admin.ts"), "utf8");
    expect(source).toContain('adminRoutes.route("/", adminRewardHandoffRoutes)');
    expect(source.indexOf('adminRoutes.use("*"')).toBeLessThan(
      source.indexOf('adminRoutes.route("/", adminRewardHandoffRoutes)'),
    );
  });

  it("approves completion from authenticated header context and ignores body workspace claims", async () => {
    const approveCompletion = vi.fn(async () => ({ workflow: { state: "reward_pending" } }));
    const repository = { approveCompletion } as unknown as AdminRewardHandoffRepository;
    const response = await mounted(repository).request(
      `/api/admin/active-missions/${workflowId}/completion`,
      {
        method: "POST",
        headers: { "X-Workspace-Slug": "alpha", "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          workspaceSlug: "forged",
          workspaceId: "44444444-4444-4444-8444-444444444444",
          expectedState: "proof_verified",
          expectedRevision: 7,
          idempotencyKey,
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(approveCompletion).toHaveBeenCalledWith({
      workflowId,
      workspaceSlug: "alpha",
      operatorId,
      expectedState: "proof_verified",
      expectedRevision: 7,
      idempotencyKey,
    });
  });

  it("parses completion, backfill, cancellation, and settings payloads at the route boundary", async () => {
    const repository = {
      getCompletion: vi.fn(async () => ({ rewardContract: null })),
      backfillRewardContract: vi.fn(async () => ({ rewardContract: { source: "operator_backfill" } })),
      cancelRewardHandoff: vi.fn(async () => ({ workflow: { state: "proof_verified" } })),
      updateSettings: vi.fn(async () => ({ rewardProcessingWindowDays: null })),
    } as unknown as AdminRewardHandoffRepository;
    const app = mounted(repository);
    const headers = { "X-Workspace-Slug": "alpha", "Content-Type": "application/json", "Idempotency-Key": idempotencyKey };

    expect((await app.request(`/api/admin/active-missions/${workflowId}/completion`, { headers })).status).toBe(200);
    expect(repository.getCompletion).toHaveBeenCalledWith({ workflowId, workspaceSlug: "alpha", operatorId });

    const backfill = {
      pointsAmount: 500,
      cashAmount: 125.5,
      currency: "hkd",
      xpAmount: 0,
      sourceMissionUpdatedAt: "2026-07-30T10:00:00.000Z",
      confirmationEvidenceSource: "operator_record",
      confirmationReason: "  Confirmed against the signed operator record.  ",
      idempotencyKey,
    };
    expect((await app.request(`/api/admin/active-missions/${workflowId}/reward-contract`, {
      method: "POST", headers, body: JSON.stringify(backfill),
    })).status).toBe(200);
    expect(repository.backfillRewardContract).toHaveBeenCalledWith({
      workflowId,
      workspaceSlug: "alpha",
      operatorId,
      ...backfill,
      currency: "HKD",
      confirmationReason: "Confirmed against the signed operator record.",
    });

    expect((await app.request(`/api/admin/active-missions/${workflowId}/reward-handoff/cancel`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        expectedState: "reward_pending",
        expectedRevision: 8,
        idempotencyKey,
        reasonCategory: "other",
        reasonNote: "  Needs finance reassessment.  ",
      }),
    })).status).toBe(200);
    expect(repository.cancelRewardHandoff).toHaveBeenCalledWith({
      workflowId,
      workspaceSlug: "alpha",
      operatorId,
      expectedState: "reward_pending",
      expectedRevision: 8,
      idempotencyKey,
      reasonCategory: "other",
      reasonNote: "Needs finance reassessment.",
    });

    expect((await app.request("/api/admin/reward-handoffs/settings", {
      method: "PUT", headers, body: JSON.stringify({ days: null }),
    })).status).toBe(200);
    expect(repository.updateSettings).toHaveBeenCalledWith({
      workspaceSlug: "alpha", operatorId, days: null,
    });
  });

  it.each([undefined, "0", -1, 1, 0.5])(
    "rejects non-zero or non-numeric backfill XP before repository access: %s",
    async (xpAmount) => {
      const backfillRewardContract = vi.fn();
      const response = await mounted({
        backfillRewardContract,
      } as unknown as AdminRewardHandoffRepository).request(
        `/api/admin/active-missions/${workflowId}/reward-contract`,
        {
          method: "POST",
          headers: { "X-Workspace-Slug": "alpha", "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({
            pointsAmount: 500,
            cashAmount: 125,
            currency: "HKD",
            xpAmount,
            sourceMissionUpdatedAt: "2026-07-30T10:00:00.000Z",
            confirmationEvidenceSource: "operator_record",
            confirmationReason: "Confirmed from operator record",
            idempotencyKey,
          }),
        },
      );
      expect(response.status).toBe(400);
      expect(backfillRewardContract).not.toHaveBeenCalled();
    },
  );

  it("normalizes bounded list filters and defaults to pending-only", async () => {
    const listRewardHandoffs = vi.fn(async () => ({ items: [], rewardProcessingWindowDays: null }));
    const repository = { listRewardHandoffs } as unknown as AdminRewardHandoffRepository;
    const app = mounted(repository);
    const headers = { "X-Workspace-Slug": "alpha" };

    expect((await app.request(
      "/api/admin/reward-handoffs?due=%20DUE_SOON%20&component=%20Cash%20&status=%20CANCELLED%20",
      { headers },
    )).status).toBe(200);
    expect(listRewardHandoffs).toHaveBeenLastCalledWith({
      workspaceSlug: "alpha", operatorId, due: "due_soon", component: "cash", status: "cancelled", cursor: undefined, limit: 50,
    });
    expect((await app.request("/api/admin/reward-handoffs", { headers })).status).toBe(200);
    expect(listRewardHandoffs).toHaveBeenLastCalledWith({
      workspaceSlug: "alpha", operatorId, due: undefined, component: undefined, status: "pending", cursor: undefined, limit: 50,
    });
  });

  it("routes a bounded notification retry to the exact pending reward", async () => {
    const retryNotification = vi.fn(async () => ({ delivered: true, idempotent: false }));
    const response = await mounted({ retryNotification } as unknown as AdminRewardHandoffRepository)
      .request("/api/admin/reward-handoffs/" + workflowId + "/notifications/retry", {
        method: "POST",
        headers: { "X-Workspace-Slug": "alpha", "Content-Type": "application/json" },
        body: JSON.stringify({ notificationType: "mission_reward_pending" }),
      });
    expect(response.status).toBe(200);
    expect(retryNotification).toHaveBeenCalledWith({
      workspaceSlug: "alpha",
      operatorId,
      pendingRewardId: workflowId,
      notificationType: "mission_reward_pending",
    });

    const invalid = await mounted({ retryNotification } as unknown as AdminRewardHandoffRepository)
      .request("/api/admin/reward-handoffs/" + workflowId + "/notifications/retry", {
        method: "POST",
        headers: { "X-Workspace-Slug": "alpha", "Content-Type": "application/json" },
        body: JSON.stringify({ notificationType: "custom_message" }),
      });
    expect(invalid.status).toBe(400);
    expect(retryNotification).toHaveBeenCalledTimes(1);
  });
  it("rejects missing staff, malformed IDs, invalid revisions, states, notes, SLA, and filters", async () => {
    const repository = {
      approveCompletion: vi.fn(),
      cancelRewardHandoff: vi.fn(),
      updateSettings: vi.fn(),
      listRewardHandoffs: vi.fn(),
    } as unknown as AdminRewardHandoffRepository;
    const noStaff = mounted(repository, () => ({ userId: null, email: "shared-secret" }));
    expect((await noStaff.request(`/api/admin/active-missions/${workflowId}/completion`, {
      headers: { "X-Workspace-Slug": "alpha" },
    })).status).toBe(401);

    const app = mounted(repository);
    const headers = { "X-Workspace-Slug": "alpha", "Content-Type": "application/json", "Idempotency-Key": idempotencyKey };
    const invalidRequests: Array<[string, RequestInit]> = [
      ["/api/admin/active-missions/not-a-uuid/completion", { method: "GET", headers }],
      [`/api/admin/active-missions/${workflowId}/completion`, {
        method: "POST", headers, body: JSON.stringify({
          expectedState: "drafting", expectedRevision: -1, idempotencyKey: "bad",
        }),
      }],
      [`/api/admin/active-missions/${workflowId}/reward-handoff/cancel`, {
        method: "POST", headers, body: JSON.stringify({
          expectedState: "proof_verified", expectedRevision: 1, idempotencyKey,
          reasonCategory: "secret", reasonNote: " ",
        }),
      }],
      ["/api/admin/reward-handoffs/settings", {
        method: "PUT", headers, body: JSON.stringify({ days: 366 }),
      }],
      ["/api/admin/reward-handoffs?due=tomorrow", { headers }],
    ];
    for (const [path, init] of invalidRequests) {
      expect((await app.request(path, init)).status).toBe(400);
    }
    for (const method of Object.values(repository)) expect(method).not.toHaveBeenCalled();
  });

  it("maps forbidden records without enumeration and bounded conflicts to safe statuses", async () => {
    const cases = [
      ["FORBIDDEN", 403],
      ["WORKFLOW_STALE", 409],
      ["WRONG_STATE", 409],
      ["IDEMPOTENCY_CONFLICT", 409],
      ["REWARD_CONTRACT_EXISTS", 409],
      ["REWARD_CONTRACT_REQUIRED", 422],
      ["COMPLETION_NOT_ELIGIBLE", 422],
    ] as const;
    for (const [code, status] of cases) {
      const getCompletion = vi.fn(async () => {
        throw new RewardHandoffError(code, code === "FORBIDDEN" ? "secret database detail" : code);
      });
      const response = await mounted({ getCompletion } as unknown as AdminRewardHandoffRepository)
        .request(`/api/admin/active-missions/${workflowId}/completion`, {
          headers: { "X-Workspace-Slug": "alpha" },
        });
      expect(response.status).toBe(status);
      const body = await response.json() as { code: string; error: string };
      expect(body.code).toBe(code);
      if (code === "FORBIDDEN") {
        expect(body.error).toBe("forbidden");
        expect(JSON.stringify(body)).not.toContain("secret database detail");
      }
    }
  });

  it("redacts unknown repository failures at the mounted route boundary", async () => {
    const getCompletion = vi.fn(async () => {
      throw new RewardHandoffError("UNKNOWN", "violates secret_constraint with internal SQL");
    });
    const response = await mounted({
      getCompletion,
    } as unknown as AdminRewardHandoffRepository).request(
      `/api/admin/active-missions/${workflowId}/completion`,
      { headers: { "X-Workspace-Slug": "alpha" } },
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Reward handoff request failed",
      code: "UNKNOWN",
    });
  });
});

describe("reward handoff service boundaries", () => {
  function serviceHarness(options?: {
    rpcError?: { message: string } | null;
    queueStatus?: "pending" | "cancelled";
    corruptMissionWorkspace?: boolean;
    corruptApprovalCycle?: boolean;
    corruptCancellationCycle?: boolean;
  }) {
    const calls: string[] = [];
    const selects: string[] = [];
    const orders: Array<[string, unknown]> = [];
    const decision = {
      id: "decision-1",
      workspace_id: "workspace-1",
      mission_workflow_id: workflowId,
      reward_contract_id: "contract-1",
      decision_kind: "approved",
      pending_reward_id: options?.corruptApprovalCycle ? "pending-other" : null,
      decided_at: "2026-07-31T10:00:00.000Z",
      required_item_count: 1,
      verified_required_item_count: 1,
      evidence_snapshot: { requiredItems: [{ proofAttemptId: "attempt-1" }] },
      reason_note: "private note",
      decided_by: operatorId,
      idempotency_key: idempotencyKey,
      request_hash: "secret",
    };
    const pending = {
      id: "pending-1",
      workspace_id: "workspace-1",
      mission_workflow_id: workflowId,
      mission_submission_id: "submission-1",
      creator_id: "creator-1",
      mission_id: "mission-1",
      reward_contract_id: "contract-1",
      completion_decision_id: "decision-1",
      points_amount: 500,
      cash_amount: 125,
      currency: "HKD",
      xp_amount: 0,
      status: options?.queueStatus ?? "pending",
      processing_window_days: 7,
      target_at: "2026-08-07T10:00:00.000Z",
      cancellation_decision_id: options?.queueStatus === "cancelled" ? "cancel-1" : null,
      created_at: "2026-07-31T10:00:00.000Z",
      cancelled_at: options?.queueStatus === "cancelled" ? "2026-08-01T10:00:00.000Z" : null,
      workflow: { id: workflowId, workspace_id: "workspace-1", mission_submission_id: "submission-1" },
      submission: { id: "submission-1", workspace_id: "workspace-1", creator_id: "creator-1", mission_id: "mission-1" },
      reward_contract: { id: "contract-1", workspace_id: "workspace-1", mission_workflow_id: workflowId, mission_submission_id: "submission-1", mission_id: "mission-1" },
      creators: { id: "creator-1", workspace_id: "workspace-1", display_name: "Creator" },
      missions: { id: "mission-1", workspace_id: options?.corruptMissionWorkspace ? "workspace-2" : "workspace-1", title: "Mission" },
      completion_decision: decision,
      cancellation_decision: options?.queueStatus === "cancelled" ? { id: "cancel-1", workspace_id: "workspace-1", mission_workflow_id: workflowId, reward_contract_id: "contract-1", pending_reward_id: options?.corruptCancellationCycle ? "pending-other" : "pending-1", supersedes_decision_id: options?.corruptCancellationCycle ? "decision-other" : "decision-1", decision_kind: "cancelled" } : null,
    };
    const dataFor = (table: string) => {
      if (table === "brand_users") return {
        workspace_id: "workspace-1",
        workspaces: {
          id: "workspace-1",
          slug: "alpha",
          reward_processing_window_days: 7,
        },
      };
      if (table === "mission_workflows") return { id: workflowId, workspace_id: "workspace-1", mission_submission_id: "submission-1", state: "proof_verified", revision: 7 };
      if (table === "mission_submissions") return { id: "submission-1", workspace_id: "workspace-1", creator_id: "creator-1", mission_id: "mission-1" };
      if (table === "mission_work_items") return [];
      if (table === "mission_reward_contracts") return { id: "contract-1", workspace_id: "workspace-1", mission_workflow_id: workflowId, mission_submission_id: "submission-1", mission_id: "mission-1", points_amount: 500, cash_amount: 125, currency: "HKD", xp_amount: 0, source: "join", created_at: "2026-07-31T10:00:00.000Z" };
      if (table === "mission_pending_rewards") return [pending];
      if (table === "mission_completion_decisions") return decision;
      return null;
    };
    const from = vi.fn((table: string) => {
      calls.push(table);
      const result = { data: dataFor(table), error: null };
      const chain: Record<string, unknown> = {};
      for (const op of ["eq", "lt", "lte", "gte", "gt", "is", "limit"]) {
        chain[op] = vi.fn(() => chain);
      }
      chain.select = vi.fn((selection: string) => {
        selects.push(selection);
        return chain;
      });
      chain.order = vi.fn((field: string, config: unknown) => {
        orders.push([field, config]);
        return chain;
      });
      chain.maybeSingle = vi.fn(async () => ({
        data: Array.isArray(result.data) ? result.data[0] ?? null : result.data,
        error: null,
      }));
      chain.then = (yes: (value: unknown) => unknown, no: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(yes, no);
      return chain;
    });
    const rpc = vi.fn(async (name: string, args: unknown) => {
      calls.push(`rpc:${name}`);
      return {
        data: name === "set_reward_processing_window"
          ? { workspaceId: "workspace-1", rewardProcessingWindowDays: 7 }
          : { contract: null, workflow: {}, decision: {}, pendingReward: {}, idempotent: false },
        error: options?.rpcError ?? null,
        args,
      };
    });
    return {
      repository: createRewardHandoffRepository({ from, rpc } as unknown as SupabaseClient),
      calls,
      selects,
      orders,
      rpc,
    };
  }

  it("verifies active membership before calling the exact service-role approval RPC", async () => {
    const calls: string[] = [];
    const rpc = vi.fn(async () => {
      calls.push("rpc");
      return { data: { workflow: {}, decision: {}, pendingReward: {}, idempotent: false }, error: null };
    });
    const builder = (data: unknown) => {
      const chain: Record<string, unknown> = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        maybeSingle: vi.fn(async () => ({ data, error: null })),
      };
      return chain;
    };
    const from = vi.fn((table: string) => {
      calls.push(table);
      if (table === "brand_users") return builder({
        workspace_id: "workspace-1",
        workspaces: { id: "workspace-1", slug: "alpha", reward_processing_window_days: null },
      });
      throw new Error(`unexpected table ${table}`);
    });
    const repository = createRewardHandoffRepository({ from, rpc } as unknown as SupabaseClient);
    await repository.approveCompletion({
      workflowId, workspaceSlug: "alpha", operatorId,
      expectedState: "proof_verified", expectedRevision: 7, idempotencyKey,
    });
    expect(calls.slice(0, 2)).toEqual(["brand_users", "rpc"]);
    expect(rpc).toHaveBeenCalledWith("approve_mission_completion", {
      p_workspace: "workspace-1",
      p_workflow: workflowId,
      p_operator: operatorId,
      p_expected_state: "proof_verified",
      p_expected_revision: 7,
      p_idempotency_key: idempotencyKey,
    });
  });

  it("does not call a service RPC when active membership is absent", async () => {
    const rpc = vi.fn();
    const builder = (data: unknown) => {
      const chain: Record<string, unknown> = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        maybeSingle: vi.fn(async () => ({ data, error: null })),
      };
      return chain;
    };
    const from = vi.fn(() => builder(null));
    const repository = createRewardHandoffRepository({ from, rpc } as unknown as SupabaseClient);
    await expect(repository.approveCompletion({
      workflowId, workspaceSlug: "alpha", operatorId,
      expectedState: "proof_verified", expectedRevision: 7, idempotencyKey,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["approval", "rpc:approve_mission_completion", (repo: AdminRewardHandoffRepository) => repo.approveCompletion({
      workflowId, workspaceSlug: "alpha", operatorId,
      expectedState: "proof_verified", expectedRevision: 7, idempotencyKey,
    })],
    ["backfill", "rpc:backfill_mission_reward_contract", (repo: AdminRewardHandoffRepository) => repo.backfillRewardContract({
      workflowId, workspaceSlug: "alpha", operatorId, pointsAmount: 500, cashAmount: 125,
      currency: "HKD", xpAmount: 0, sourceMissionUpdatedAt: null,
      confirmationEvidenceSource: "operator_record", confirmationReason: "Confirmed", idempotencyKey,
    })],
    ["cancellation", "rpc:cancel_mission_reward_handoff", (repo: AdminRewardHandoffRepository) => repo.cancelRewardHandoff({
      workflowId, workspaceSlug: "alpha", operatorId, expectedState: "reward_pending",
      expectedRevision: 8, idempotencyKey, reasonCategory: "other", reasonNote: "Reassess",
    })],
    ["settings", "rpc:set_reward_processing_window", (repo: AdminRewardHandoffRepository) => repo.updateSettings({
      workspaceSlug: "alpha", operatorId, days: 7,
    })],
    ["list", "mission_pending_rewards", (repo: AdminRewardHandoffRepository) => repo.listRewardHandoffs({
      workspaceSlug: "alpha", operatorId, status: "pending",
    })],
    ["detail", "mission_workflows", (repo: AdminRewardHandoffRepository) => repo.getCompletion({
      workflowId, workspaceSlug: "alpha", operatorId,
    })],
  ])("authorizes membership before %s target/config access", async (_label, target, action) => {
    const harness = serviceHarness();
    await action(harness.repository);
    expect(harness.calls[0]).toBe("brand_users");
    expect(harness.calls).not.toContain("workspaces");
    expect(harness.calls.indexOf(target)).toBeGreaterThan(0);
  });

  it("omits queue records whose canonical relation chain crosses a workspace boundary", async () => {
    const harness = serviceHarness({ corruptMissionWorkspace: true });
    const result = await harness.repository.listRewardHandoffs({
      workspaceSlug: "alpha", operatorId, status: "pending",
    }) as { items: unknown[] };
    expect(result.items).toEqual([]);
  });
  it("rejects detail and omits queue rows whose approval belongs to another pending cycle", async () => {
    const detailHarness = serviceHarness({ corruptApprovalCycle: true });
    await expect(detailHarness.repository.getCompletion({
      workflowId, workspaceSlug: "alpha", operatorId,
    })).rejects.toMatchObject({ code: "FORBIDDEN", message: "forbidden" });
    const queueHarness = serviceHarness({ corruptApprovalCycle: true });
    const result = await queueHarness.repository.listRewardHandoffs({
      workspaceSlug: "alpha", operatorId, status: "pending",
    }) as { items: unknown[] };
    expect(result.items).toEqual([]);
  });

  it("omits cancelled queue rows whose cancellation does not supersede the current approval", async () => {
    const harness = serviceHarness({ queueStatus: "cancelled", corruptCancellationCycle: true });
    const result = await harness.repository.listRewardHandoffs({
      workspaceSlug: "alpha", operatorId, status: "cancelled",
    }) as { items: unknown[] };
    expect(result.items).toEqual([]);
  });
  it("authorizes and invokes the exact notification retry RPC", async () => {
    const harness = serviceHarness();
    await harness.repository.retryNotification({
      workspaceSlug: "alpha",
      operatorId,
      pendingRewardId: workflowId,
      notificationType: "mission_reward_pending_cancelled",
    });
    expect(harness.rpc).toHaveBeenCalledWith("retry_reward_handoff_notification", {
      p_workspace: "workspace-1",
      p_operator: operatorId,
      p_pending_reward: workflowId,
      p_notification_type: "mission_reward_pending_cancelled",
    });
  });
  it("forces zero XP into the backfill RPC", async () => {
    const harness = serviceHarness();
    await harness.repository.backfillRewardContract({
      workflowId, workspaceSlug: "alpha", operatorId, pointsAmount: 500, cashAmount: 125,
      currency: "HKD", xpAmount: 0, sourceMissionUpdatedAt: null,
      confirmationEvidenceSource: "operator_record", confirmationReason: "Confirmed", idempotencyKey,
    });
    expect(harness.rpc).toHaveBeenCalledWith(
      "backfill_mission_reward_contract",
      expect.objectContaining({ p_xp_amount: 0 }),
    );
  });

  it.each([
    ["idempotency_conflict", "IDEMPOTENCY_CONFLICT"],
    ["workflow_stale", "WORKFLOW_STALE"],
    ["wrong_state", "WRONG_STATE"],
    ["reward_contract_required", "REWARD_CONTRACT_REQUIRED"],
    ["reward_contract_exists", "REWARD_CONTRACT_EXISTS"],
    ["completion_not_eligible", "COMPLETION_NOT_ELIGIBLE"],
    ["pending_reward_exists", "PENDING_REWARD_EXISTS"],
    ["pending_reward_not_found", "PENDING_REWARD_NOT_FOUND"],
    ["cancellation_not_allowed", "CANCELLATION_NOT_ALLOWED"],
    ["validation_failed", "VALIDATION_FAILED"],
    ["backfill_contract_invalid", "VALIDATION_FAILED"],
    ["backfill_reason_required", "VALIDATION_FAILED"],
    ["reward_contract_source_missing", "VALIDATION_FAILED"],
    ["reward_processing_window_invalid", "VALIDATION_FAILED"],
    ["not_authorized", "FORBIDDEN"],
    ["not_found", "FORBIDDEN"],
    ["reward_workflow_not_found", "FORBIDDEN"],
    ["workspace_not_found", "FORBIDDEN"],
  ])("maps expected RPC token %s to bounded code %s", async (message, code) => {
    const harness = serviceHarness({ rpcError: { message } });
    await expect(harness.repository.backfillRewardContract({
      workflowId, workspaceSlug: "alpha", operatorId, pointsAmount: 500, cashAmount: 125,
      currency: "HKD", xpAmount: 0, sourceMissionUpdatedAt: null,
      confirmationEvidenceSource: "operator_record", confirmationReason: "Confirmed", idempotencyKey,
    })).rejects.toMatchObject({ code });
  });

  it("redacts unknown SQL and constraint failures in the service", async () => {
    const harness = serviceHarness({
      rpcError: { message: "duplicate key violates secret_internal_constraint DETAIL hidden" },
    });
    await expect(harness.repository.backfillRewardContract({
      workflowId, workspaceSlug: "alpha", operatorId, pointsAmount: 500, cashAmount: 125,
      currency: "HKD", xpAmount: 0, sourceMissionUpdatedAt: null,
      confirmationEvidenceSource: "operator_record", confirmationReason: "Confirmed", idempotencyKey,
    })).rejects.toMatchObject({
      code: "UNKNOWN",
      message: "Reward handoff request failed",
    });
  });

  it.each(["pending", "cancelled"] as const)(
    "returns bounded %s queue decision facts, evidence availability, and stable ordering",
    async (status) => {
      const harness = serviceHarness({ queueStatus: status });
      const result = await harness.repository.listRewardHandoffs({
        workspaceSlug: "alpha", operatorId, status,
      }) as { items: Array<Record<string, unknown>> };
      expect(harness.selects.join(" ")).toContain(
        "mission_completion_decisions!mission_pending_rewards_completion_decision_id_fkey",
      );
      expect(result.items[0]).toMatchObject({
        status,
        completionDecision: {
          id: "decision-1",
          kind: "approved",
          decidedAt: "2026-07-31T10:00:00.000Z",
          requiredItemCount: 1,
          verifiedRequiredItemCount: 1,
          evidenceAvailable: true,
        },
      });
      expect(harness.orders).toEqual([
        ["target_at", { ascending: true, nullsFirst: false }],
        ["created_at", { ascending: true }],
        ["id", { ascending: true }],
      ]);
      expect(JSON.stringify(result)).not.toMatch(
        /reason|operator|actor|idempotency|requestHash|request_hash|primaryUrl|signedUrl|storage/i,
      );
    },
  );

  it.each([
    "2026-02-30T10:00:00Z",
    "2026-07-31 10:00:00Z",
    "2026-07-31T10:00:00",
    "2026-07-31T25:00:00Z",
  ])("rejects non-RFC3339 source mission timestamp %s", (sourceMissionUpdatedAt) => {
    expect(() => validateBackfillPayload({
      pointsAmount: 1,
      cashAmount: 0,
      currency: "HKD",
      xpAmount: 0,
      sourceMissionUpdatedAt,
      confirmationEvidenceSource: "operator_record",
      confirmationReason: "Confirmed",
      idempotencyKey,
    }, idempotencyKey)).toThrow(/RFC3339/);
  });
  it("round-trips a stable target-null-last queue cursor and rejects malformed input", () => {
    const cursor = encodeRewardHandoffCursor({
      targetAt: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      id: workflowId,
    });
    expect(decodeRewardHandoffCursor(cursor)).toEqual({
      targetAt: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      id: workflowId,
    });
    expect(() => decodeRewardHandoffCursor("not-a-cursor")).toThrow(/cursor/);
  });
  it("normalizes only the creator-safe RPC projection", () => {
    const projection = normalizeCreatorRewardHandoffProjection({
      reward: { pointsAmount: 500, cashAmount: 125, currency: "HKD", xpAmount: 0 },
      status: "pending",
      processingWindowDays: 7,
      targetAt: "2026-08-07T10:00:00.000Z",
      createdAt: "2026-07-31T10:00:00.000Z",
      cancelledAt: null,
      decisionState: { kind: "approved", decidedAt: "2026-07-31T10:00:00.000Z" },
      reasonNote: "private",
      actorId: operatorId,
      signedUrl: "https://signed.example/proof",
    });
    expect(projection).toEqual({
      id: null,
      reward: { pointsAmount: 500, cashAmount: 125, currency: "HKD", xpAmount: 0 },
      status: "pending",
      processingWindowDays: 7,
      targetAt: "2026-08-07T10:00:00.000Z",
      createdAt: "2026-07-31T10:00:00.000Z",
      cancelledAt: null,
      decisionState: { kind: "approved", decidedAt: "2026-07-31T10:00:00.000Z" },
    });
    expect(JSON.stringify(projection)).not.toMatch(
      /reason|actor|idempotency|requestHash|primaryUrl|proofUrl|signedUrl/i,
    );
  });
});
