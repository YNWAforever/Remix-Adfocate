import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import * as api from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  refreshPublicationProofMetadata,
  requestPublicationProofCorrection,
  startPublicationProofReview,
  fetchActiveMissionQueue,
  verifyPublicationProof,
} from "@/lib/admin";
import type { ActiveMissionWorkspace, MissionDraft, MissionPublicationView } from "../activeMission";
import {
  activeMissionQueryKey,
  missionPublicationQueryKey,
  useActiveMissionWorkspace,
  useConfirmMissionReceipt,
  useCreateDraftAssetGrant,
  useFinalizeDraftAsset,
  useMissionPublication,
  useProofEvidenceUpload,
  useRefreshProofMetadata,
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
      deadline: null, fulfillmentRequired: false, revisionLimit: 2, reviewSlaHours: 48,
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
});
