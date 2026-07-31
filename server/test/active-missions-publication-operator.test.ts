import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../app";
import { refreshPublicationProofMetadata } from "../lib/activeMission/publicationProof";
import {
  createAdminActiveMissionRoutes,
  sortActiveMissionQueue,
  type AdminActiveMissionRepository,
} from "../routes/adminActiveMissions";
import { normalizeOperatorRewardHandoffProjection } from "../lib/activeMission/rewardHandoff";

describe("publication proof operator routes", () => {
  const workflowId = "11111111-1111-4111-8111-111111111111";
  const workItemId = "22222222-2222-4222-8222-222222222222";
  const missionId = "33333333-3333-4333-8333-333333333333";
  const reviewerId = "44444444-4444-4444-8444-444444444444";
  const idempotencyKey = "55555555-5555-4555-8555-555555555555";
  const attemptId = "66666666-6666-4666-8666-666666666666";

  it("keeps operator provenance and bounded evidence while stripping proof URLs", () => {
    const projection = normalizeOperatorRewardHandoffProjection({
      workspaceId: "workspace-1",
      workflow: { state: "proof_verified" },
      contract: {
        id: "contract-1", points_amount: 500, cash_amount: "125.00", currency: "HKD",
        xp_amount: 0, source: "operator_backfill", source_mission_updated_at: null,
        confirmed_by: reviewerId, confirmation_evidence_source: "operator_record",
        confirmation_reason: "Confirmed from operator record",
        created_at: "2026-07-31T10:00:00.000Z",
      },
      requiredItems: [{
        id: workItemId, required: true, state: "proof_verified",
        current_proof_attempt_id: attemptId, verified_proof_attempt_id: attemptId,
      }],
      proofReviews: [{
        id: "review-1", workspace_id: "workspace-1",
        mission_publication_proof_attempt_id: attemptId,
        state: "verified", decision: "verified", reviewer_id: reviewerId,
        reviewed_at: "2026-07-31T09:59:00.000Z",
        created_at: "2026-07-31T09:58:00.000Z",
        primary_url: "https://instagram.com/private",
        summary: "private review note",
      }],      pendingReward: {
        id: "pending-1", mission_workflow_id: workflowId, mission_submission_id: "submission-1",
        creator_id: "creator-1", mission_id: missionId, reward_contract_id: "contract-1",
        completion_decision_id: "decision-1", points_amount: 500, cash_amount: 125,
        currency: "HKD", xp_amount: 0, status: "pending", processing_window_days: 7,
        target_at: null, cancellation_decision_id: null,
        created_at: "2026-07-31T10:00:00.000Z", cancelled_at: null,
      },
      decision: {
        id: "decision-1", decision_kind: "approved", workflow_revision: 7,
        required_item_count: 1, verified_required_item_count: 1,
        evidence_snapshot: { requiredItems: [{
          workItemId, proofAttemptId: attemptId, proofReviewId: "review-1",
          attemptNumber: 1, contentChecksum: "checksum", reviewedAt: "2026-07-31T09:59:00.000Z", reviewDecision: "verified",
          primaryUrl: "https://instagram.com/private",
          signedUrl: "https://signed.example/proof",
        }] },
        reason_category: null, reason_note: null, decided_by: reviewerId,
        decided_at: "2026-07-31T10:00:00.000Z",
      },
    });
    expect(projection.rewardContract).toMatchObject({
      source: "operator_backfill",
      confirmedBy: reviewerId,
      confirmationEvidenceSource: "operator_record",
    });
    expect(projection.completionEligibility).toEqual({
      eligible: false,
      blockers: ["pending_reward_exists"],
      requiredItemCount: 1,
      verifiedRequiredItemCount: 1,
    });
    expect(projection.acceptedProofAnchors).toEqual([{
      workItemId, proofAttemptId: attemptId, proofReviewId: "review-1",
      reviewerId, createdAt: "2026-07-31T09:58:00.000Z",
    }]);
    expect(projection.pendingReward?.decision).toMatchObject({
      decidedBy: reviewerId,
      evidence: { requiredItems: [{ proofAttemptId: attemptId, contentChecksum: "checksum" }] },
    });
    expect(JSON.stringify(projection)).not.toMatch(/primaryUrl|signedUrl|proofUrl|private review note/i);
  });

  it("rejects a proof anchor when the terminal review does not match the accepted attempt", () => {
    expect(() => normalizeOperatorRewardHandoffProjection({
      workspaceId: "workspace-1",
      workflow: { state: "proof_verified" },
      contract: null,
      requiredItems: [{
        id: workItemId, required: true, state: "proof_verified",
        current_proof_attempt_id: attemptId, verified_proof_attempt_id: attemptId,
      }],
      pendingReward: null,
      approvalDecision: {
        decision_kind: "approved",
        evidence_snapshot: { requiredItems: [{
          workItemId, proofAttemptId: attemptId, proofReviewId: "review-accepted",
          reviewedAt: "2026-07-31T09:59:00.000Z", reviewDecision: "verified",
        }] },
      },
      proofReviews: [{
        id: "review-other", workspace_id: "workspace-1",
        mission_publication_proof_attempt_id: attemptId,
        state: "verified", decision: "verified", reviewer_id: reviewerId,
        reviewed_at: "2026-07-31T09:59:00.000Z", created_at: "2026-07-31T09:58:00.000Z",
      }],
    })).toThrowError(expect.objectContaining({ code: "FORBIDDEN", message: "forbidden" }));
  });
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
      workspaceSlug: "demo", operatorId: "operator-1", state: undefined, reviewerId, missionId,
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
