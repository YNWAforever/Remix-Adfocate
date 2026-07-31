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
  normalizeCreatorRewardHandoffProjection,
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
        headers: { "X-Workspace-Slug": "alpha", "Content-Type": "application/json" },
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
    const headers = { "X-Workspace-Slug": "alpha", "Content-Type": "application/json" };

    expect((await app.request(`/api/admin/active-missions/${workflowId}/completion`, { headers })).status).toBe(200);
    expect(repository.getCompletion).toHaveBeenCalledWith({ workflowId, workspaceSlug: "alpha", operatorId });

    const backfill = {
      pointsAmount: 500,
      cashAmount: 125.5,
      currency: "hkd",
      xpAmount: 20,
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
      workspaceSlug: "alpha", operatorId, due: "due_soon", component: "cash", status: "cancelled",
    });
    expect((await app.request("/api/admin/reward-handoffs", { headers })).status).toBe(200);
    expect(listRewardHandoffs).toHaveBeenLastCalledWith({
      workspaceSlug: "alpha", operatorId, due: undefined, component: undefined, status: "pending",
    });
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
    const headers = { "X-Workspace-Slug": "alpha", "Content-Type": "application/json" };
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
});

describe("reward handoff service boundaries", () => {
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
      if (table === "workspaces") return builder({ id: "workspace-1" });
      if (table === "brand_users") return builder({ user_id: operatorId });
      throw new Error(`unexpected table ${table}`);
    });
    const repository = createRewardHandoffRepository({ from, rpc } as unknown as SupabaseClient);
    await repository.approveCompletion({
      workflowId, workspaceSlug: "alpha", operatorId,
      expectedState: "proof_verified", expectedRevision: 7, idempotencyKey,
    });
    expect(calls.slice(0, 3)).toEqual(["workspaces", "brand_users", "rpc"]);
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
    const from = vi.fn((table: string) =>
      table === "workspaces" ? builder({ id: "workspace-1" }) : builder(null));
    const repository = createRewardHandoffRepository({ from, rpc } as unknown as SupabaseClient);
    await expect(repository.approveCompletion({
      workflowId, workspaceSlug: "alpha", operatorId,
      expectedState: "proof_verified", expectedRevision: 7, idempotencyKey,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(rpc).not.toHaveBeenCalled();
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
