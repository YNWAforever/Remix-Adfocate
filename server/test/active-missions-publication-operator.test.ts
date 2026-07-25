import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../app";
import { refreshPublicationProofMetadata } from "../lib/activeMission/publicationProof";
import {
  createAdminActiveMissionRoutes,
  sortActiveMissionQueue,
  type AdminActiveMissionRepository,
} from "../routes/adminActiveMissions";

describe("publication proof operator routes", () => {
  const workflowId = "11111111-1111-4111-8111-111111111111";
  const workItemId = "22222222-2222-4222-8222-222222222222";
  const missionId = "33333333-3333-4333-8333-333333333333";
  const reviewerId = "44444444-4444-4444-8444-444444444444";
  const idempotencyKey = "55555555-5555-4555-8555-555555555555";
  const attemptId = "66666666-6666-4666-8666-666666666666";

  function app(repository: AdminActiveMissionRepository) {
    const app = new Hono<Env>();
    app.route("/api/admin/active-missions", createAdminActiveMissionRoutes(
      repository,
      () => ({ userId: "operator-1", email: "op@example.com" }),
    ));
    return app;
  }

  it("orders late and overdue proof work before the nearest deadline, oldest attempt, and stable ID", () => {
    const rows = [
      { workItemId: "later-id", reviewDueAt: null, creatorDeadline: null, publicationDueAt: "2026-07-19T13:00:00.000Z", creatorResponseDeadline: null, submittedAt: "2026-07-18T11:00:00.000Z", submittedLate: false },
      { workItemId: "late", reviewDueAt: null, creatorDeadline: null, publicationDueAt: "2026-07-20T13:00:00.000Z", creatorResponseDeadline: null, submittedAt: "2026-07-18T10:00:00.000Z", submittedLate: true },
      { workItemId: "overdue", reviewDueAt: "2026-07-18T11:00:00.000Z", creatorDeadline: null, publicationDueAt: null, creatorResponseDeadline: null, submittedAt: "2026-07-18T09:00:00.000Z", submittedLate: false },
      { workItemId: "earlier-id", reviewDueAt: null, creatorDeadline: null, publicationDueAt: "2026-07-19T13:00:00.000Z", creatorResponseDeadline: null, submittedAt: "2026-07-18T11:00:00.000Z", submittedLate: false },
    ];
    expect(sortActiveMissionQueue(rows, new Date("2026-07-18T12:00:00.000Z")).map((row) => row.workItemId))
      .toEqual(["overdue", "late", "earlier-id", "later-id"]);
  });

  it("passes all proof filters to the tenant-scoped queue repository", async () => {
    const listQueue = vi.fn(async () => ({ items: [] }));
    const response = await app({ listQueue } as unknown as AdminActiveMissionRepository).request(
      `/api/admin/active-missions/queue?proofState=proof_submitted&late=true&metadataStatus=unavailable&platform=instagram&publicationDeadline=overdue&mission=${missionId}&reviewer=${reviewerId}`,
      { headers: { "X-Workspace-Slug": "demo" } },
    );
    expect(response.status).toBe(200);
    expect(listQueue).toHaveBeenCalledWith({
      workspaceSlug: "demo", state: undefined, reviewerId, missionId,
      risk: undefined, proofState: "proof_submitted", late: true,
      metadataStatus: "unavailable", platform: "instagram",
      publicationDeadline: "overdue",
    });
  });

  it("sends exact proof claim, correction, verification, and refresh inputs", async () => {
    const checklist = {
      publicly_accessible: true, platform_matches: true, account_matches: true,
      content_matches_approved_version: true, timing_acceptable: false,
      disclosures_present: true,
    };
    const repository = {
      startProofReview: vi.fn(async () => ({ workItem: { state: "proof_under_review" } })),
      requestProofCorrection: vi.fn(async () => ({ workItem: { state: "proof_correction_requested" } })),
      verifyProof: vi.fn(async () => ({ workItem: { state: "proof_verified" } })),
      refreshProofMetadata: vi.fn(async () => ({ attempt: { id: attemptId, metadataStatus: "available" } })),
    } as unknown as AdminActiveMissionRepository;
    const mounted = app(repository);
    const headers = { "Content-Type": "application/json", "X-Workspace-Slug": "demo", "Idempotency-Key": idempotencyKey };

    expect((await mounted.request(`/api/admin/active-missions/${workflowId}/work-items/${workItemId}/proof-review/start`, {
      method: "POST", headers,
      body: JSON.stringify({ attemptId, expectedState: "proof_submitted", expectedRevision: 2 }),
    })).status).toBe(200);
    expect(repository.startProofReview).toHaveBeenCalledWith({
      workflowId, workItemId, workspaceSlug: "demo", operatorId: "operator-1",
      attemptId, expectedState: "proof_submitted", expectedRevision: 2, idempotencyKey,
    });

    expect((await mounted.request(`/api/admin/active-missions/${workflowId}/work-items/${workItemId}/proof-review/corrections`, {
      method: "POST", headers,
      body: JSON.stringify({
        attemptId, expectedState: "proof_under_review", expectedRevision: 2, checklist,
        corrections: [{ category: "timing", text: "Publish within the approved window", position: 0 }],
        summary: "Timing correction",
      }),
    })).status).toBe(200);
    expect(repository.requestProofCorrection).toHaveBeenCalledWith(expect.objectContaining({
      attemptId, checklist,
      corrections: [{ category: "timing", text: "Publish within the approved window", position: 0 }],
      summary: "Timing correction", idempotencyKey,
    }));

    expect((await mounted.request(`/api/admin/active-missions/${workflowId}/work-items/${workItemId}/proof-review/verify`, {
      method: "POST", headers,
      body: JSON.stringify({
        attemptId, expectedState: "proof_under_review", expectedRevision: 2,
        checklist: { ...checklist, timing_acceptable: true },
      }),
    })).status).toBe(200);
    expect(repository.verifyProof).toHaveBeenCalledWith(expect.objectContaining({
      attemptId, checklist: { ...checklist, timing_acceptable: true }, idempotencyKey,
    }));

    expect((await mounted.request(`/api/admin/active-missions/${workflowId}/work-items/${workItemId}/proofs/${attemptId}/metadata-refresh`, {
      method: "POST", headers,
      body: JSON.stringify({ expectedState: "proof_under_review", expectedRevision: 2 }),
    })).status).toBe(200);
    expect(repository.refreshProofMetadata).toHaveBeenCalledWith({
      workflowId, workItemId, workspaceSlug: "demo", operatorId: "operator-1",
      attemptId, expectedState: "proof_under_review", expectedRevision: 2, idempotencyKey,
    });
    expect(JSON.stringify(await (repository.verifyProof as ReturnType<typeof vi.fn>).mock.results[0].value)).not.toMatch(/reward|points|xp|earnings|budget/i);
  });

  it("rejects malformed proof input before repository access", async () => {
    const repository = {
      startProofReview: vi.fn(), requestProofCorrection: vi.fn(),
      verifyProof: vi.fn(), refreshProofMetadata: vi.fn(),
    } as unknown as AdminActiveMissionRepository;
    const mounted = app(repository);
    const headers = { "Content-Type": "application/json", "X-Workspace-Slug": "demo", "Idempotency-Key": "not-a-uuid" };
    for (const [suffix, body] of [
      ["proof-review/start", { attemptId: "not-a-uuid", expectedState: "", expectedRevision: -1 }],
      ["proof-review/corrections", { attemptId, expectedState: "proof_under_review", expectedRevision: 1, checklist: {}, corrections: [] }],
      ["proof-review/verify", { attemptId, expectedState: "proof_under_review", expectedRevision: 1, checklist: {} }],
    ] as const) {
      const response = await mounted.request(`/api/admin/active-missions/${workflowId}/work-items/${workItemId}/${suffix}`, {
        method: "POST", headers, body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
    const refresh = await mounted.request(
      `/api/admin/active-missions/${workflowId}/work-items/${workItemId}/proofs/not-a-uuid/metadata-refresh`,
      { method: "POST", headers, body: "{}" },
    );
    expect(refresh.status).toBe(400);
    for (const method of Object.values(repository)) expect(method).not.toHaveBeenCalled();
  });

  it("refreshes an immutable URL and persists only bounded metadata fields", async () => {
    const inspect = vi.fn(async () => ({
      normalizedUrl: "https://www.instagram.com/p/abc",
      status: "unavailable" as const,
      metadata: {
        finalCanonicalUrl: "https://www.instagram.com/p/abc",
        httpStatusCategory: "client_error" as const,
        pageTitle: null, openGraphType: null, declaredPublicationTime: null,
        fetchedAt: "2026-07-18T12:00:00.000Z",
      },
      errorCategory: "platform_blocked" as const,
    }));
    const prepare = vi.fn(async () => ({
      primaryUrl: "https://www.instagram.com/p/abc", platform: "instagram" as const, idempotent: false,
    }));
    const complete = vi.fn(async (metadata) => ({ attempt: { id: attemptId, ...metadata } }));
    const result = await refreshPublicationProofMetadata({
      workspaceId: "workspace-1", workflowId, workItemId, attemptId,
      operatorId: "operator-1", expectedState: "proof_under_review",
      expectedRevision: 2, idempotencyKey,
    }, { prepare, inspect, complete });

    expect(prepare).toHaveBeenCalledOnce();
    expect(inspect).toHaveBeenCalledWith({ url: "https://www.instagram.com/p/abc", platform: "instagram" });
    expect(complete).toHaveBeenCalledWith({
      metadataStatus: "unavailable",
      metadataSnapshot: expect.objectContaining({ fetchedAt: "2026-07-18T12:00:00.000Z" }),
      metadataErrorCategory: "platform_blocked",
    });
    expect(result).toMatchObject({ attempt: { id: attemptId, metadataStatus: "unavailable" } });
    expect(JSON.stringify(complete.mock.calls)).not.toMatch(/primaryUrl|additionalUrls|checksum|decision|reward/i);
  });
});
