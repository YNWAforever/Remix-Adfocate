import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import * as api from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { AdminAuthError, AdminRequestError } from "@/lib/admin";
import {
  refreshPublicationProofMetadata,
  requestPublicationProofCorrection,
  startPublicationProofReview,
  fetchActiveMissionQueue,
  verifyPublicationProof,
} from "@/lib/admin";
import type { ActiveMissionWorkspace, MissionDraft, MissionPublicationView } from "../activeMission";
import {
  __resetRewardMutationRegistryForTests,
  activeMissionQueryKey,
  rewardMutationSignature,
  missionPublicationQueryKey,
  useActiveMissionWorkspace,
  useApproveMissionCompletion,
  useBackfillRewardContract,
  useCancelRewardHandoff,
  useConfirmMissionReceipt,
  useCreateDraftAssetGrant,
  useFinalizeDraftAsset,
  useMissionPublication,
  useProofEvidenceUpload,
  useRefreshProofMetadata,
  useRewardHandoffs,
  useRequestProofCorrection,
  useSaveMissionDraft,
  useStartProofReview,
  useSubmitPublicationProof,
  useSubmitMissionWorkItem,
  useVerifyProof,
} from "./activeMission";

function workspace(): ActiveMissionWorkspace {
  return {
    workflow: {
      id: "workflow-1", submissionId: "sub-1", state: "drafting", acceptedAt: "2026-07-15T00:00:00Z",
      deadline: null, revision: 0, fulfillmentRequired: false, revisionLimit: 2, reviewSlaHours: 48,
      revisionResponseHours: 48, createdAt: "2026-07-15T00:00:00Z", updatedAt: "2026-07-15T00:00:00Z",
    },
    mission: {
      id: "mission-1", slug: "mission-one", title: "Mission one", missionType: "content",
      brief: { description: null, deliverables: [], requirements: [], platforms: [], effort: null,
        targetAudience: null, dos: [], donts: [], keyMessages: [], referenceLinks: [] },
    },
    fulfillment: null,
    workItems: [{
      id: "item-1", title: "Reel", platform: "instagram", requirements: [], required: true, position: 0,
      deadline: null, state: "drafting",
      draft: { id: "draft-1", caption: "old", externalUrl: null, checklist: {}, revision: 3, lastSavedAt: "2026-07-15T00:00:00Z" },
      currentSubmittedVersionId: null, approvedVersionId: null, reviewStartedAt: null, reviewDueAt: null,
    }],
    events: [],
    rewardContract: null,
    completionEligibility: { eligible: false, blockers: ["reward_contract_required"],
      requiredItemCount: 1, verifiedRequiredItemCount: 0 },
    pendingReward: null,
    nextAction: { kind: "continue_draft", workItemId: "item-1", deadline: null, blockedReason: null },
  };
}

function setup(initial = workspace()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  queryClient.setQueryData(activeMissionQueryKey("sub-1"), initial);
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return { queryClient, wrapper };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ApiError details", () => {
  it("keeps the three-argument constructor backward compatible", () => {
    expect(new ApiError(400, "VALIDATION_FAILED", "invalid")).toMatchObject({
      status: 400, code: "VALIDATION_FAILED", message: "invalid", details: undefined,
    });
  });

  it("preserves structured error fields returned by apiFetch", async () => {
    const currentDraft = workspace().workItems[0].draft;
    vi.spyOn(supabase.auth, "getSession").mockResolvedValue({ data: { session: null }, error: null } as never);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: "Conflict",
      json: async () => ({ code: "WORKFLOW_STALE", error: "Draft revision is stale", currentDraft }),
    }));

    const error = await api.apiFetch("/my-missions/sub-1/workspace").catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: "WORKFLOW_STALE",
      message: "Draft revision is stale",
      details: { currentDraft },
    });
  });
});

describe("useActiveMissionWorkspace", () => {
  it("loads the exact creator workspace route", async () => {
    vi.spyOn(api, "apiFetch").mockResolvedValue(workspace());
    const { wrapper } = setup();
    const { result } = renderHook(() => useActiveMissionWorkspace("sub-2"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.apiFetch).toHaveBeenCalledWith("/my-missions/sub-2/workspace");
  });
});

describe("useSaveMissionDraft", () => {
  it("optimistically applies changed fields and the next revision", async () => {
    let resolve!: (value: { draft: MissionDraft }) => void;
    vi.spyOn(api, "apiFetch").mockImplementation(() => new Promise((done) => { resolve = done as typeof resolve; }));
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useSaveMissionDraft("sub-1"), { wrapper });

    act(() => result.current.mutate({ workItemId: "item-1", revision: 3, caption: "copy", externalUrl: null, checklist: {} }));
    await waitFor(() => expect(queryClient.getQueryData<ActiveMissionWorkspace>(activeMissionQueryKey("sub-1"))?.workItems[0].draft)
      .toMatchObject({ caption: "copy", revision: 4 }));
    expect(api.apiFetch).toHaveBeenCalledWith("/my-missions/sub-1/work-items/item-1/draft", {
      method: "PATCH",
      body: JSON.stringify({ revision: 3, caption: "copy", externalUrl: null, checklist: {} }),
    });
    resolve({ draft: { ...workspace().workItems[0].draft!, caption: "copy", revision: 4 } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it.each([
    new TypeError("offline"),
    new ApiError(400, "VALIDATION_FAILED", "caption invalid"),
  ])("rolls optimistic cache back for network and validation failures", async (failure) => {
    vi.spyOn(api, "apiFetch").mockRejectedValue(failure);
    const initial = workspace();
    const { queryClient, wrapper } = setup(initial);
    const { result } = renderHook(() => useSaveMissionDraft("sub-1"), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({ workItemId: "item-1", revision: 3, caption: "local" })).rejects.toBe(failure);
    });
    expect(queryClient.getQueryData(activeMissionQueryKey("sub-1"))).toEqual(initial);
    expect(result.current.conflict).toBeNull();
  });

  it("replaces the cache with currentDraft and exposes recoverable conflict data on WORKFLOW_STALE", async () => {
    const serverDraft: MissionDraft = {
      id: "draft-1", caption: "server", externalUrl: null, checklist: {}, revision: 5, lastSavedAt: "2026-07-16T00:00:00Z",
    };
    const stale = new ApiError(409, "WORKFLOW_STALE", "Draft revision is stale", { currentDraft: serverDraft });
    vi.spyOn(api, "apiFetch").mockRejectedValue(stale);
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useSaveMissionDraft("sub-1"), { wrapper });
    const localDraft = { workItemId: "item-1", revision: 3, caption: "local unsaved" };

    await act(async () => { await expect(result.current.mutateAsync(localDraft)).rejects.toBe(stale); });
    expect(queryClient.getQueryData<ActiveMissionWorkspace>(activeMissionQueryKey("sub-1"))?.workItems[0].draft).toEqual(serverDraft);
    expect(result.current.conflict).toEqual({ workItemId: "item-1", localDraft, currentDraft: serverDraft });
    act(() => result.current.clearConflict());
    expect(result.current.conflict).toBeNull();
  });
});

describe("active mission action mutations", () => {
  it("confirms receipt and invalidates mission collections without invalidating me", async () => {
    vi.spyOn(api, "apiFetch").mockResolvedValue({ workflow: workspace().workflow });
    const { queryClient, wrapper } = setup();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useConfirmMissionReceipt("sub-1"), { wrapper });
    await act(async () => { await result.current.mutateAsync(); });
    expect(api.apiFetch).toHaveBeenCalledWith("/my-missions/sub-1/fulfillment/received", { method: "POST" });
    expect(invalidate.mock.calls.map(([filter]) => filter?.queryKey)).toEqual([
      ["active-mission", "sub-1"], ["my-missions"], ["missions"],
    ]);
    expect(invalidate).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["me"] }));
  });

  it("uses the locked asset grant and finalize routes without assuming undocumented response fields", async () => {
    const fetch = vi.spyOn(api, "apiFetch").mockResolvedValue({});
    const { wrapper } = setup();
    const grant = renderHook(() => useCreateDraftAssetGrant("sub-1"), { wrapper });
    await act(async () => { await grant.result.current.mutateAsync({
      workItemId: "item-1", fileName: "draft.mp4", contentType: "video/mp4", sizeBytes: 123,
    }); });
    expect(fetch).toHaveBeenLastCalledWith("/my-missions/sub-1/work-items/item-1/assets/upload-grant", {
      method: "POST", body: JSON.stringify({ fileName: "draft.mp4", contentType: "video/mp4", sizeBytes: 123 }),
    });

    const finalize = renderHook(() => useFinalizeDraftAsset("sub-1"), { wrapper });
    await act(async () => { await finalize.result.current.mutateAsync({ workItemId: "item-1", assetId: "asset-1", checksum: "sha256" }); });
    expect(fetch).toHaveBeenLastCalledWith("/my-missions/sub-1/work-items/item-1/assets/asset-1/finalize", {
      method: "POST", body: JSON.stringify({ checksum: "sha256" }),
    });
  });

  it("submits the expected revision and invalidates mission collections but never me", async () => {
    vi.spyOn(api, "apiFetch").mockResolvedValue({ version: { id: "version-1" }, workItem: { id: "item-1" } });
    const { queryClient, wrapper } = setup();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSubmitMissionWorkItem("sub-1"), { wrapper });
    await act(async () => { await result.current.mutateAsync({ workItemId: "item-1", expectedRevision: 4, idempotencyKey: "submit-1" }); });
    expect(api.apiFetch).toHaveBeenCalledWith("/my-missions/sub-1/work-items/item-1/submit", {
      method: "POST",
      headers: { "Idempotency-Key": "submit-1" },
      body: JSON.stringify({ expectedRevision: 4 }),
    });
    expect(invalidate.mock.calls.map(([filter]) => filter?.queryKey)).toEqual([
      ["active-mission", "sub-1"], ["my-missions"], ["missions"],
    ]);
    expect(invalidate).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["me"] }));
  });

  it("loads the exact creator publication route", async () => {
    const publication = { workItemId: "item-1", attempts: [] } as unknown as MissionPublicationView;
    vi.spyOn(api, "apiFetch").mockResolvedValue({ publication });
    const { wrapper } = setup();
    const { result } = renderHook(() => useMissionPublication("sub-1", "item-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.apiFetch).toHaveBeenCalledWith("/my-missions/sub-1/publication/item-1");
    expect(result.current.data).toBe(publication);
  });

  it("uses exact publication evidence routes and mutation guards", async () => {
    const fetch = vi.spyOn(api, "apiFetch").mockResolvedValue({});
    const { wrapper } = setup();
    const upload = renderHook(() => useProofEvidenceUpload("sub-1"), { wrapper });
    const context = {
      workItemId: "item-1", expectedState: "approved_to_publish", expectedRevision: 4,
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    };
    await act(async () => { await upload.result.current.createGrant.mutateAsync({
      ...context, fileName: "proof.png", contentType: "image/png", sizeBytes: 123,
    }); });
    expect(fetch).toHaveBeenLastCalledWith("/my-missions/sub-1/publication/item-1/assets/upload-grant", {
      method: "POST",
      headers: { "Idempotency-Key": context.idempotencyKey },
      body: JSON.stringify({
        expectedState: context.expectedState, expectedRevision: 4,
        fileName: "proof.png", contentType: "image/png", sizeBytes: 123,
      }),
    });
    await act(async () => { await upload.result.current.finalize.mutateAsync({
      ...context, assetId: "asset-1", checksum: "sha256",
    }); });
    expect(fetch).toHaveBeenLastCalledWith("/my-missions/sub-1/publication/item-1/assets/asset-1/finalize", {
      method: "POST",
      headers: { "Idempotency-Key": context.idempotencyKey },
      body: JSON.stringify({ expectedState: context.expectedState, expectedRevision: 4, checksum: "sha256" }),
    });
  });

  it("submits proof, invalidates scoped collections, and never invalidates me", async () => {
    vi.spyOn(api, "apiFetch").mockResolvedValue({ attempt: { id: "attempt-1" } });
    const { queryClient, wrapper } = setup();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSubmitPublicationProof("sub-1"), { wrapper });
    const input = {
      workItemId: "item-1", expectedState: "approved_to_publish", expectedRevision: 4,
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      primaryUrl: "https://instagram.com/p/one", additionalUrls: [], evidenceAssetIds: [],
    };
    await act(async () => { await result.current.mutateAsync(input); });
    expect(api.apiFetch).toHaveBeenCalledWith("/my-missions/sub-1/publication/item-1/proofs", {
      method: "POST",
      headers: { "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({
        expectedState: input.expectedState, expectedRevision: 4,
        primaryUrl: input.primaryUrl, additionalUrls: [], evidenceAssetIds: [],
      }),
    });
    expect(invalidate.mock.calls.map(([filter]) => filter?.queryKey)).toEqual([
      ["mission-publication", "sub-1", "item-1"], ["active-mission", "sub-1"],
      ["my-missions"], ["missions"],
    ]);
    expect(invalidate).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["me"] }));
  });

  it("replaces stale publication cache and exposes the untouched submitted form", async () => {
    const currentPublication = {
      workItemId: "item-1", revision: 5, attempts: [{ id: "server-attempt" }],
    } as unknown as MissionPublicationView;
    const stale = new ApiError(409, "WORKFLOW_STALE", "Proof state is stale", { currentPublication });
    vi.spyOn(api, "apiFetch").mockRejectedValue(stale);
    const { queryClient, wrapper } = setup();
    const { result, rerender } = renderHook(() => useSubmitPublicationProof("sub-1"), { wrapper });
    const localProof = {
      workItemId: "item-1", expectedState: "approved_to_publish", expectedRevision: 4,
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      primaryUrl: "https://instagram.com/p/local", additionalUrls: ["https://instagram.com/p/two"],
      evidenceAssetIds: ["asset-1"],
    };
    await act(async () => { await expect(result.current.mutateAsync(localProof)).rejects.toBe(stale); });
    expect(queryClient.getQueryData(missionPublicationQueryKey("sub-1", "item-1"))).toBe(currentPublication);
    expect(result.current.conflict).toEqual({ localProof, currentPublication });
    const clearConflict = result.current.clearConflict;
    rerender();
    expect(result.current.clearConflict).toBe(clearConflict);
  });
});

describe("operator publication proof mutations", () => {
  it("sends exact-attempt guarded start, correction, verify, and refresh requests", async () => {
    vi.spyOn(supabase.auth, "getSession").mockResolvedValue({ data: { session: null }, error: null } as never);
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetch);
    const base = {
      workspace: "acme", expectedState: "proof_under_review", expectedRevision: 7,
      attemptId: "22222222-2222-4222-8222-222222222222",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    };

    await startPublicationProofReview("workflow-1", "item-1", {
      ...base, expectedState: "proof_submitted",
    });
    expect(fetch).toHaveBeenLastCalledWith("/api/admin/active-missions/workflow-1/work-items/item-1/proof-review/start", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "X-Workspace-Slug": "acme", "Idempotency-Key": base.idempotencyKey }),
      body: JSON.stringify({
        expectedState: "proof_submitted", expectedRevision: 7, attemptId: base.attemptId,
      }),
    }));

    const checklist = {
      publiclyAccessible: true, platformMatches: true, accountMatches: false,
      contentMatchesApprovedVersion: true, timingAcceptable: true, disclosuresPresent: true,
    };
    const corrections = [{ category: "account" as const, text: "Use the approved account", position: 0 }];
    await requestPublicationProofCorrection("workflow-1", "item-1", {
      ...base, checklist, corrections, summary: "Correction required",
    });
    expect(fetch).toHaveBeenLastCalledWith("/api/admin/active-missions/workflow-1/work-items/item-1/proof-review/corrections", expect.objectContaining({
      body: JSON.stringify({
        expectedState: "proof_under_review", expectedRevision: 7, attemptId: base.attemptId,
        checklist: {
          publicly_accessible: true,
          platform_matches: true,
          account_matches: false,
          content_matches_approved_version: true,
          timing_acceptable: true,
          disclosures_present: true,
        },
        corrections, summary: "Correction required",
      }),
    }));

    await verifyPublicationProof("workflow-1", "item-1", {
      ...base, checklist: { ...checklist, accountMatches: true }, summary: "Verified",
    });
    expect(fetch).toHaveBeenLastCalledWith("/api/admin/active-missions/workflow-1/work-items/item-1/proof-review/verify", expect.objectContaining({
      headers: expect.objectContaining({ "Idempotency-Key": base.idempotencyKey }),
    }));

    await refreshPublicationProofMetadata("workflow-1", "item-1", {
      ...base, expectedState: "proof_verified",
    });
    expect(fetch).toHaveBeenLastCalledWith(
      `/api/admin/active-missions/workflow-1/work-items/item-1/proofs/${base.attemptId}/metadata-refresh`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          expectedState: "proof_verified", expectedRevision: 7, attemptId: base.attemptId,
        }),
      }),
    );
  });
});
describe("publication proof queue filters", () => {
  it("sends every proof queue filter without exposing creator content", async () => {
    vi.spyOn(supabase.auth, "getSession").mockResolvedValue({ data: { session: null }, error: null } as never);
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [] }) });
    vi.stubGlobal("fetch", fetch);
    await fetchActiveMissionQueue({
      workspace: "acme", proofState: "proof_submitted", late: true,
      metadataStatus: "unavailable", platform: "instagram",
      publicationDeadline: "overdue",
    });
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/admin/active-missions/queue?proofState=proof_submitted&late=true&metadataStatus=unavailable&platform=instagram&publicationDeadline=overdue",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Workspace-Slug": "acme" }),
      }),
    );
  });
});

describe("operator publication proof hooks", () => {
  it("exports the four exact operator mutation hooks", () => {
    expect([
      useStartProofReview,
      useRequestProofCorrection,
      useVerifyProof,
      useRefreshProofMetadata,
    ]).toSatisfy((hooks: unknown[]) => hooks.every((hook) => typeof hook === "function"));
  });

  it("invalidates the exact slug-scoped proof detail and queue keys", async () => {
    vi.spyOn(supabase.auth, "getSession").mockResolvedValue({
      data: { session: null }, error: null,
    } as never);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ ok: true }),
    }));
    const { queryClient, wrapper } = setup();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRequestProofCorrection(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        workflowId: "workflow-1",
        workItemId: "item-1",
        workspace: "demo",
        expectedState: "proof_under_review",
        expectedRevision: 7,
        attemptId: "22222222-2222-4222-8222-222222222222",
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        checklist: {
          publiclyAccessible: true,
          platformMatches: true,
          accountMatches: false,
          contentMatchesApprovedVersion: true,
          timingAcceptable: true,
          disclosuresPresent: true,
        },
        corrections: [{ category: "account", text: "Use the approved account", position: 0 }],
        summary: null,
      });
    });

    expect(invalidate.mock.calls.map(([filter]) => filter?.queryKey)).toEqual([
      ["admin-active-mission", "demo", "workflow-1"],
      ["admin-active-missions", "demo"],
    ]);
  });
});

describe("reward handoff mutation hooks", () => {
  const approval = {
    workflowId: "workflow-1",
    submissionId: "sub-1",
    workspace: "alpha",
    expectedState: "proof_verified" as const,
    expectedRevision: 7,
  };

  beforeEach(() => {
    __resetRewardMutationRegistryForTests();
    vi.spyOn(supabase.auth, "getSession").mockResolvedValue({
      data: { session: null }, error: null,
    } as never);
  });

  it("retains only ambiguous failures and clears every definitive HTTP response", async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce({
        ok: false, status: 503, statusText: "Unavailable",
        json: async () => ({ error: "unavailable", code: "UNKNOWN" }),
      })
      .mockResolvedValueOnce({
        ok: false, status: 409, statusText: "Conflict",
        json: async () => ({ error: "conflict", code: "IDEMPOTENCY_CONFLICT" }),
      })
      .mockResolvedValueOnce({
        ok: false, status: 422, statusText: "Unprocessable Entity",
        json: async () => ({ error: "validation", code: "VALIDATION_FAILED" }),
      })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetch);
    const randomUUID = vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
      .mockReturnValueOnce("22222222-2222-4222-8222-222222222222")
      .mockReturnValueOnce("33333333-3333-4333-8333-333333333333")
      .mockReturnValueOnce("44444444-4444-4444-8444-444444444444");
    const { wrapper } = setup();
    const { result } = renderHook(() => useApproveMissionCompletion(), { wrapper });

    const approvalWithExtras = {
      ...approval,
      workflowId: " workflow-1 ",
      submissionId: " sub-1 ",
      workspace: " alpha ",
      expectedState: " PROOF_VERIFIED " as "proof_verified",
      workspaceSlug: "spoofed",
      workspace_id: "spoofed-id",
      notes: "must not enter the signature",
      arbitrary: { unsafe: true },
    } as typeof approval & {
      workspaceSlug: string;
      workspace_id: string;
      notes: string;
      arbitrary: { unsafe: boolean };
    };

    await act(async () => {
      await expect(result.current.mutateAsync(approvalWithExtras)).rejects.toThrow("offline");
      await expect(result.current.mutateAsync({
        expectedRevision: 7,
        expectedState: "proof_verified",
        workspace: "alpha",
        submissionId: "sub-1",
        workflowId: "workflow-1",
      })).rejects.toBeInstanceOf(AdminRequestError);
      await expect(result.current.mutateAsync(approval)).rejects.toMatchObject({ status: 409 });
      await expect(result.current.mutateAsync(approval)).rejects.toMatchObject({ status: 422 });
      await result.current.mutateAsync(approval);
    });
    expect(fetch.mock.calls.slice(0, 5).map(([, init]) =>
      JSON.parse((init as RequestInit).body as string).idempotencyKey)).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "11111111-1111-4111-8111-111111111111",
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ]);

    await act(async () => { await result.current.mutateAsync(approval); });
    expect(JSON.parse((fetch.mock.calls[5][1] as RequestInit).body as string).idempotencyKey)
      .toBe("44444444-4444-4444-8444-444444444444");
    expect(randomUUID).toHaveBeenCalledTimes(4);
  });

  it("clears the retry key after a confirmed 401 AdminAuthError", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false, status: 401, statusText: "Unauthorized",
        json: async () => ({ error: "unauthorized" }),
      })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
      .mockReturnValueOnce("22222222-2222-4222-8222-222222222222");
    const { wrapper } = setup();
    const { result } = renderHook(() => useApproveMissionCompletion(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(approval)).rejects
        .toBeInstanceOf(AdminAuthError);
      await result.current.mutateAsync(approval);
    });

    expect(fetch.mock.calls.map(([, init]) =>
      JSON.parse((init as RequestInit).body as string).idempotencyKey)).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
  });

  it("coordinates concurrent identical mutations across hook instances", async () => {
    let resolveFirst!: (value: Response) => void;
    let rejectSecond!: (reason: unknown) => void;
    const fetch = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => { rejectSecond = reject; }))
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
      .mockReturnValueOnce("22222222-2222-4222-8222-222222222222");
    const { wrapper } = setup();
    const first = renderHook(() => useApproveMissionCompletion(), { wrapper });
    const second = renderHook(() => useApproveMissionCompletion(), { wrapper });

    let firstRequest!: Promise<unknown>;
    let secondRequest!: Promise<unknown>;
    act(() => {
      firstRequest = first.result.current.mutateAsync(approval);
      secondRequest = second.result.current.mutateAsync({ ...approval });
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls.slice(0, 2).map(([, init]) =>
      JSON.parse((init as RequestInit).body as string).idempotencyKey)).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "11111111-1111-4111-8111-111111111111",
    ]);

    resolveFirst({ ok: true, status: 200, json: async () => ({ ok: true }) } as Response);
    await firstRequest;
    rejectSecond(new TypeError("offline"));
    await expect(secondRequest).rejects.toThrow("offline");
    await act(async () => { await first.result.current.mutateAsync(approval); });
    expect(JSON.parse((fetch.mock.calls[2][1] as RequestInit).body as string).idempotencyKey)
      .toBe("11111111-1111-4111-8111-111111111111");

    await act(async () => { await first.result.current.mutateAsync(approval); });
    expect(JSON.parse((fetch.mock.calls[3][1] as RequestInit).body as string).idempotencyKey)
      .toBe("22222222-2222-4222-8222-222222222222");
  });

  it("force-clears a concurrent batch after a definitive 4xx", async () => {
    let resolveDefinitive!: (value: Response) => void;
    let rejectAmbiguous!: (reason: unknown) => void;
    const fetch = vi.fn()
      .mockImplementationOnce(() =>
        new Promise<Response>((resolve) => { resolveDefinitive = resolve; }))
      .mockImplementationOnce(() =>
        new Promise<Response>((_resolve, reject) => { rejectAmbiguous = reject; }))
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
      .mockReturnValueOnce("22222222-2222-4222-8222-222222222222");
    const { wrapper } = setup();
    const first = renderHook(() => useApproveMissionCompletion(), { wrapper });
    const second = renderHook(() => useApproveMissionCompletion(), { wrapper });

    let definitiveRequest!: Promise<unknown>;
    let ambiguousRequest!: Promise<unknown>;
    act(() => {
      definitiveRequest = first.result.current.mutateAsync(approval);
      ambiguousRequest = second.result.current.mutateAsync({ ...approval });
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    resolveDefinitive({
      ok: false, status: 422, statusText: "Unprocessable Entity",
      json: async () => ({ error: "validation", code: "VALIDATION_FAILED" }),
    } as Response);
    await expect(definitiveRequest).rejects.toMatchObject({ status: 422 });
    rejectAmbiguous(new TypeError("offline"));
    await expect(ambiguousRequest).rejects.toThrow("offline");

    await act(async () => { await first.result.current.mutateAsync(approval); });
    expect(fetch.mock.calls.map(([, init]) =>
      JSON.parse((init as RequestInit).body as string).idempotencyKey)).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
  });

  it("isolates simultaneous actions, workflows, submissions, workspaces, and payloads", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
      .mockReturnValueOnce("22222222-2222-4222-8222-222222222222")
      .mockReturnValueOnce("33333333-3333-4333-8333-333333333333")
      .mockReturnValueOnce("44444444-4444-4444-8444-444444444444")
      .mockReturnValueOnce("55555555-5555-4555-8555-555555555555")
      .mockReturnValueOnce("66666666-6666-4666-8666-666666666666");
    const { wrapper } = setup();
    const approve = renderHook(() => useApproveMissionCompletion(), { wrapper });
    const backfill = renderHook(() => useBackfillRewardContract(), { wrapper });

    await act(async () => {
      await Promise.all([
        approve.result.current.mutateAsync(approval),
        approve.result.current.mutateAsync({ ...approval, workflowId: "workflow-2" }),
        approve.result.current.mutateAsync({ ...approval, submissionId: "sub-2" }),
        approve.result.current.mutateAsync({ ...approval, workspace: "beta" }),
        approve.result.current.mutateAsync({ ...approval, expectedRevision: 8 }),
        backfill.result.current.mutateAsync({
          workflowId: "workflow-1", submissionId: "sub-1", workspace: "alpha",
          pointsAmount: 500, cashAmount: 125, currency: "HKD", xpAmount: 0,
          sourceMissionUpdatedAt: null, confirmationEvidenceSource: "operator_record",
          confirmationReason: "Confirmed",
        }),
      ]);
    });

    expect(new Set(fetch.mock.calls.map(([, init]) =>
      JSON.parse((init as RequestInit).body as string).idempotencyKey)).size).toBe(6);
  });

  it("builds canonical signatures without collapsing meaningful JSON distinctions", () => {
    const first = {
      workflowId: "workflow-1", submissionId: "sub-1", workspace: "alpha",
      expectedState: "proof_verified", expectedRevision: 7,
    };
    const reordered = {
      expectedRevision: 7, workspace: "alpha", submissionId: "sub-1",
      workflowId: "workflow-1", expectedState: "proof_verified",
    };
    expect(rewardMutationSignature("approve-completion", first))
      .toBe(rewardMutationSignature("approve-completion", reordered));
    expect(rewardMutationSignature("x", { value: undefined }))
      .not.toBe(rewardMutationSignature("x", {}));
    expect(rewardMutationSignature("x", { value: null }))
      .not.toBe(rewardMutationSignature("x", { value: undefined }));
    expect(rewardMutationSignature("x", { value: [1] }))
      .not.toBe(rewardMutationSignature("x", { value: 1 }));
  });

  it("uses one canonical queue query key for equivalent filter inputs", () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ items: [], rewardProcessingWindowDays: 7 }),
    });
    vi.stubGlobal("fetch", fetch);
    const { queryClient, wrapper } = setup();
    renderHook(() => useRewardHandoffs({
      workspace: " alpha ", due: " DUE_SOON " as "due_soon", status: " " as "",
    }), { wrapper });
    renderHook(() => useRewardHandoffs({
      workspace: "alpha", due: "due_soon", status: "pending",
    }), { wrapper });
    expect(queryClient.getQueryCache().findAll({
      queryKey: ["admin-reward-handoffs"],
    })).toHaveLength(1);
  });

  it.each(["WORKFLOW_STALE", "WRONG_STATE"] as const)(
    "clears the approval key after definitive %s",
    async (code) => {
      const fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false, status: 409, statusText: "Conflict",
          json: async () => ({ error: code, code }),
        })
        .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
      vi.stubGlobal("fetch", fetch);
      vi.spyOn(globalThis.crypto, "randomUUID")
        .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
        .mockReturnValueOnce("22222222-2222-4222-8222-222222222222");
      const { wrapper } = setup();
      const { result } = renderHook(() => useApproveMissionCompletion(), { wrapper });

      await act(async () => {
        await expect(result.current.mutateAsync(approval)).rejects.toMatchObject({
          status: 409, code,
        });
        await result.current.mutateAsync(approval);
      });
      expect(fetch.mock.calls.map(([, init]) =>
        JSON.parse((init as RequestInit).body as string).idempotencyKey)).toEqual([
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ]);
    },
  );

  it("invalidates exactly four scoped query families after approve, backfill, and cancel success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ ok: true }),
    }));
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("11111111-1111-4111-8111-111111111111");
    const { queryClient, wrapper } = setup();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const approve = renderHook(() => useApproveMissionCompletion(), { wrapper });
    const backfill = renderHook(() => useBackfillRewardContract(), { wrapper });
    const cancel = renderHook(() => useCancelRewardHandoff(), { wrapper });

    await act(async () => {
      await approve.result.current.mutateAsync({ ...approval, workspace: " alpha " });
      await backfill.result.current.mutateAsync({
        workflowId: " workflow-1 ", submissionId: " sub-1 ", workspace: " alpha ",
        pointsAmount: 500, cashAmount: 125, currency: "HKD", xpAmount: 0,
        sourceMissionUpdatedAt: null, confirmationEvidenceSource: "operator_record",
        confirmationReason: "Confirmed",
      });
      await cancel.result.current.mutateAsync({
        workflowId: " workflow-1 ", submissionId: " sub-1 ", workspace: " alpha ",
        expectedState: "reward_pending", expectedRevision: 8,
        reasonCategory: "other", reasonNote: "Reassess",
      });
    });

    const expected = [
      ["admin-active-mission", "alpha", "workflow-1"],
      ["admin-reward-handoffs", "alpha"],
      ["active-mission", "sub-1"],
      ["notifications"],
    ];
    expect(invalidate.mock.calls.map(([filter]) => filter?.queryKey)).toEqual([
      ...expected, ...expected, ...expected,
    ]);
  });
});
