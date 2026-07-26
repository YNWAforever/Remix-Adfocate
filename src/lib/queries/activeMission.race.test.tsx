import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import * as api from "@/lib/api";
import type { ActiveMissionWorkspace, MissionDraft, MissionPublicationView } from "../activeMission";
import {
  activeMissionQueryKey, missionPublicationQueryKey, useSaveMissionDraft, useSubmitPublicationProof,
} from "./activeMission";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

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

function draft(queryClient: QueryClient, workItemId = "item-1") {
  return queryClient.getQueryData<ActiveMissionWorkspace>(activeMissionQueryKey("sub-1"))
    ?.workItems.find((item) => item.id === workItemId)?.draft;
}

function withChecklist(): ActiveMissionWorkspace {
  const initial = workspace();
  initial.workItems[0].draft = {
    ...initial.workItems[0].draft!,
    externalUrl: "https://example.com/draft",
    checklist: { disclosure: true },
  };
  return initial;
}

function savedDraft(overrides: Partial<MissionDraft>): MissionDraft {
  return { ...workspace().workItems[0].draft!, ...overrides };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("useSaveMissionDraft overlapping requests", () => {
  it("keeps a newer optimistic draft when the older success arrives", async () => {
    const older = deferred<{ draft: MissionDraft }>();
    const newer = deferred<{ draft: MissionDraft }>();
    vi.spyOn(api, "apiFetch").mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise);
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useSaveMissionDraft("sub-1"), { wrapper });

    let olderSave!: Promise<{ draft: MissionDraft }>;
    act(() => { olderSave = result.current.mutateAsync({ workItemId: "item-1", revision: 3, caption: "older" }); });
    await waitFor(() => expect(draft(queryClient)).toMatchObject({ caption: "older", revision: 4 }));
    let newerSave!: Promise<{ draft: MissionDraft }>;
    act(() => { newerSave = result.current.mutateAsync({ workItemId: "item-1", revision: 4, caption: "newer" }); });
    await waitFor(() => expect(draft(queryClient)).toMatchObject({ caption: "newer", revision: 5 }));

    older.resolve({ draft: { ...workspace().workItems[0].draft!, caption: "older", revision: 4 } });
    await act(async () => { await olderSave; });
    expect(draft(queryClient)).toMatchObject({ caption: "newer", revision: 5 });

    newer.resolve({ draft: { ...workspace().workItems[0].draft!, caption: "newer", revision: 5 } });
    await act(async () => { await newerSave; });
  });

  it("keeps a newer completed save when the older success arrives", async () => {
    const older = deferred<{ draft: MissionDraft }>();
    const newer = deferred<{ draft: MissionDraft }>();
    vi.spyOn(api, "apiFetch").mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise);
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useSaveMissionDraft("sub-1"), { wrapper });

    let olderSave!: Promise<{ draft: MissionDraft }>;
    let newerSave!: Promise<{ draft: MissionDraft }>;
    act(() => { olderSave = result.current.mutateAsync({ workItemId: "item-1", revision: 3, caption: "older" }); });
    await waitFor(() => expect(draft(queryClient)?.revision).toBe(4));
    act(() => { newerSave = result.current.mutateAsync({ workItemId: "item-1", revision: 4, caption: "newer" }); });
    await waitFor(() => expect(draft(queryClient)?.revision).toBe(5));

    newer.resolve({ draft: { ...workspace().workItems[0].draft!, caption: "newer saved", revision: 5 } });
    await act(async () => { await newerSave; });
    older.resolve({ draft: { ...workspace().workItems[0].draft!, caption: "older saved", revision: 4 } });
    await act(async () => { await olderSave; });

    expect(draft(queryClient)).toMatchObject({ caption: "newer saved", revision: 5 });
  });

  it.each([
    ["network", new TypeError("offline")],
    ["validation", new ApiError(400, "VALIDATION_FAILED", "caption invalid")],
  ])("does not let an older %s error roll back a newer optimistic draft", async (_kind, failure) => {
    const older = deferred<{ draft: MissionDraft }>();
    const newer = deferred<{ draft: MissionDraft }>();
    vi.spyOn(api, "apiFetch").mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise);
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useSaveMissionDraft("sub-1"), { wrapper });

    let olderSave!: Promise<{ draft: MissionDraft }>;
    let newerSave!: Promise<{ draft: MissionDraft }>;
    act(() => { olderSave = result.current.mutateAsync({ workItemId: "item-1", revision: 3, caption: "older" }); });
    await waitFor(() => expect(draft(queryClient)?.revision).toBe(4));
    act(() => { newerSave = result.current.mutateAsync({ workItemId: "item-1", revision: 4, caption: "newer" }); });
    await waitFor(() => expect(draft(queryClient)?.revision).toBe(5));

    older.reject(failure);
    await act(async () => { await expect(olderSave).rejects.toBe(failure); });
    expect(draft(queryClient)).toMatchObject({ caption: "newer", revision: 5 });

    newer.resolve({ draft: { ...workspace().workItems[0].draft!, caption: "newer", revision: 5 } });
    await act(async () => { await newerSave; });
  });

  it("does not let an older stale response replace a newer draft or install a conflict", async () => {
    const older = deferred<{ draft: MissionDraft }>();
    const newer = deferred<{ draft: MissionDraft }>();
    vi.spyOn(api, "apiFetch").mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise);
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useSaveMissionDraft("sub-1"), { wrapper });

    let olderSave!: Promise<{ draft: MissionDraft }>;
    let newerSave!: Promise<{ draft: MissionDraft }>;
    act(() => { olderSave = result.current.mutateAsync({ workItemId: "item-1", revision: 3, caption: "older local" }); });
    await waitFor(() => expect(draft(queryClient)?.revision).toBe(4));
    act(() => { newerSave = result.current.mutateAsync({ workItemId: "item-1", revision: 4, caption: "newer local" }); });
    await waitFor(() => expect(draft(queryClient)?.revision).toBe(5));

    const serverDraft = { ...workspace().workItems[0].draft!, caption: "older server", revision: 4 };
    const stale = new ApiError(409, "WORKFLOW_STALE", "Draft revision is stale", { currentDraft: serverDraft });
    older.reject(stale);
    await act(async () => { await expect(olderSave).rejects.toBe(stale); });
    expect(draft(queryClient)).toMatchObject({ caption: "newer local", revision: 5 });
    expect(result.current.conflict).toBeNull();

    newer.resolve({ draft: { ...workspace().workItems[0].draft!, caption: "newer local", revision: 5 } });
    await act(async () => { await newerSave; });
  });

  it("rolls the newest failed work item back without replacing unrelated cache changes", async () => {
    const failure = new TypeError("offline");
    const request = deferred<{ draft: MissionDraft }>();
    vi.spyOn(api, "apiFetch").mockImplementation(() => request.promise);
    const initial = workspace();
    initial.workItems.push({
      ...initial.workItems[0],
      id: "item-2",
      draft: { ...initial.workItems[0].draft!, id: "draft-2", caption: "second" },
    });
    const { queryClient, wrapper } = setup(initial);
    const { result } = renderHook(() => useSaveMissionDraft("sub-1"), { wrapper });

    let save!: Promise<{ draft: MissionDraft }>;
    act(() => { save = result.current.mutateAsync({ workItemId: "item-1", revision: 3, caption: "will fail" }); });
    await waitFor(() => expect(draft(queryClient)?.revision).toBe(4));
    queryClient.setQueryData<ActiveMissionWorkspace>(activeMissionQueryKey("sub-1"), (current) => current && ({
      ...current,
      mission: { ...current.mission, title: "refreshed title" },
      workItems: current.workItems.map((item) => item.id === "item-2" && item.draft
        ? { ...item, draft: { ...item.draft, caption: "second changed elsewhere" } }
        : item),
    }));

    request.reject(failure);
    await act(async () => { await expect(save).rejects.toBe(failure); });
    const cached = queryClient.getQueryData<ActiveMissionWorkspace>(activeMissionQueryKey("sub-1"));
    expect(cached?.workItems.find((item) => item.id === "item-1")?.draft).toEqual(initial.workItems[0].draft);
    expect(cached?.workItems.find((item) => item.id === "item-2")?.draft?.caption).toBe("second changed elsewhere");
    expect(cached?.mission.title).toBe("refreshed title");
  });

  it("keeps equal-base save B as the recoverable local conflict when A succeeds first", async () => {
    const saveARequest = deferred<{ draft: MissionDraft }>();
    const saveBRequest = deferred<{ draft: MissionDraft }>();
    vi.spyOn(api, "apiFetch")
      .mockImplementationOnce(() => saveARequest.promise)
      .mockImplementationOnce(() => saveBRequest.promise);
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useSaveMissionDraft("sub-1"), { wrapper });
    const saveAInput = { workItemId: "item-1", revision: 3, caption: "local A" };
    const saveBInput = { workItemId: "item-1", revision: 3, caption: "local B" };

    let saveA!: Promise<{ draft: MissionDraft }>;
    let saveB!: Promise<{ draft: MissionDraft }>;
    act(() => { saveA = result.current.mutateAsync(saveAInput); });
    await waitFor(() => expect(draft(queryClient)).toMatchObject({ caption: "local A", revision: 4 }));
    act(() => { saveB = result.current.mutateAsync(saveBInput); });
    await waitFor(() => expect(draft(queryClient)).toMatchObject({ caption: "local B", revision: 4 }));

    const canonicalA = savedDraft({ caption: "local A", revision: 4, lastSavedAt: "2026-07-16T00:00:00Z" });
    saveARequest.resolve({ draft: canonicalA });
    await act(async () => { await saveA; });
    expect(draft(queryClient)).toMatchObject({ caption: "local B", revision: 4 });

    const stale = new ApiError(409, "WORKFLOW_STALE", "Draft revision is stale", { currentDraft: canonicalA });
    saveBRequest.reject(stale);
    await act(async () => { await expect(saveB).rejects.toBe(stale); });
    expect(draft(queryClient)).toEqual(canonicalA);
    expect(result.current.conflict).toEqual({
      workItemId: "item-1",
      localDraft: saveBInput,
      currentDraft: canonicalA,
    });
  });

  it("keeps equal-base save B canonical when B succeeds before A becomes stale", async () => {
    const saveARequest = deferred<{ draft: MissionDraft }>();
    const saveBRequest = deferred<{ draft: MissionDraft }>();
    vi.spyOn(api, "apiFetch")
      .mockImplementationOnce(() => saveARequest.promise)
      .mockImplementationOnce(() => saveBRequest.promise);
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useSaveMissionDraft("sub-1"), { wrapper });

    let saveA!: Promise<{ draft: MissionDraft }>;
    let saveB!: Promise<{ draft: MissionDraft }>;
    act(() => { saveA = result.current.mutateAsync({ workItemId: "item-1", revision: 3, caption: "local A" }); });
    await waitFor(() => expect(draft(queryClient)?.caption).toBe("local A"));
    act(() => { saveB = result.current.mutateAsync({ workItemId: "item-1", revision: 3, caption: "local B" }); });
    await waitFor(() => expect(draft(queryClient)).toMatchObject({ caption: "local B", revision: 4 }));

    const canonicalB = savedDraft({ caption: "local B", revision: 4, lastSavedAt: "2026-07-16T00:00:00Z" });
    saveBRequest.resolve({ draft: canonicalB });
    await act(async () => { await saveB; });
    const stale = new ApiError(409, "WORKFLOW_STALE", "Draft revision is stale", { currentDraft: canonicalB });
    saveARequest.reject(stale);
    await act(async () => { await expect(saveA).rejects.toBe(stale); });

    expect(draft(queryClient)).toEqual(canonicalB);
    expect(result.current.conflict).toBeNull();
  });

  it.each([
    ["network", new TypeError("offline")],
    ["validation", new ApiError(400, "VALIDATION_FAILED", "caption invalid")],
  ])("rolls newest equal-base %s failure back to the preceding local intent", async (_kind, failure) => {
    const saveARequest = deferred<{ draft: MissionDraft }>();
    const saveBRequest = deferred<{ draft: MissionDraft }>();
    vi.spyOn(api, "apiFetch")
      .mockImplementationOnce(() => saveARequest.promise)
      .mockImplementationOnce(() => saveBRequest.promise);
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useSaveMissionDraft("sub-1"), { wrapper });

    let saveA!: Promise<{ draft: MissionDraft }>;
    let saveB!: Promise<{ draft: MissionDraft }>;
    act(() => { saveA = result.current.mutateAsync({ workItemId: "item-1", revision: 3, caption: "local A" }); });
    await waitFor(() => expect(draft(queryClient)?.caption).toBe("local A"));
    act(() => { saveB = result.current.mutateAsync({ workItemId: "item-1", revision: 3, caption: "local B" }); });
    await waitFor(() => expect(draft(queryClient)).toMatchObject({ caption: "local B", revision: 4 }));

    saveBRequest.reject(failure);
    await act(async () => { await expect(saveB).rejects.toBe(failure); });
    expect(draft(queryClient)).toMatchObject({ caption: "local A", revision: 4 });
    expect(result.current.conflict).toBeNull();

    saveARequest.resolve({ draft: savedDraft({ caption: "local A", revision: 4 }) });
    await act(async () => { await saveA; });
    expect(draft(queryClient)).toMatchObject({ caption: "local A", revision: 4 });
  });

  it("applies already-stale input as the latest local intent before exposing its conflict", async () => {
    const request = deferred<{ draft: MissionDraft }>();
    vi.spyOn(api, "apiFetch").mockImplementation(() => request.promise);
    const initial = workspace();
    initial.workItems[0].draft = savedDraft({ caption: "cached server", revision: 5 });
    const { queryClient, wrapper } = setup(initial);
    const { result } = renderHook(() => useSaveMissionDraft("sub-1"), { wrapper });
    const localInput = { workItemId: "item-1", revision: 3, caption: "latest local intent" };

    let save!: Promise<{ draft: MissionDraft }>;
    act(() => { save = result.current.mutateAsync(localInput); });
    await waitFor(() => expect(draft(queryClient)).toMatchObject({ caption: "latest local intent", revision: 5 }));

    const currentDraft = savedDraft({ caption: "newer server", revision: 6, lastSavedAt: "2026-07-17T00:00:00Z" });
    const stale = new ApiError(409, "WORKFLOW_STALE", "Draft revision is stale", { currentDraft });
    request.reject(stale);
    await act(async () => { await expect(save).rejects.toBe(stale); });
    expect(draft(queryClient)).toEqual(currentDraft);
    expect(result.current.conflict).toEqual({ workItemId: "item-1", localDraft: localInput, currentDraft });
  });

  it("applies canonical success for an unchanged full draft with a deep-equal checklist", async () => {
    const request = deferred<{ draft: MissionDraft }>();
    vi.spyOn(api, "apiFetch").mockImplementation(() => request.promise);
    const initial = withChecklist();
    const { queryClient, wrapper } = setup(initial);
    const { result } = renderHook(() => useSaveMissionDraft("sub-1"), { wrapper });
    const input = {
      workItemId: "item-1", revision: 3, caption: "old",
      externalUrl: "https://example.com/draft", checklist: { disclosure: true },
    };

    let save!: Promise<{ draft: MissionDraft }>;
    act(() => { save = result.current.mutateAsync(input); });
    await waitFor(() => expect(draft(queryClient)?.revision).toBe(4));
    const canonical = {
      ...initial.workItems[0].draft!, revision: 4, lastSavedAt: "2026-07-16T00:00:00Z",
    };
    request.resolve({ draft: canonical });
    await act(async () => { await save; });

    expect(draft(queryClient)).toEqual(canonical);
  });

  it("rolls back an unchanged full draft with a deep-equal checklist after an error", async () => {
    const failure = new TypeError("offline");
    const request = deferred<{ draft: MissionDraft }>();
    vi.spyOn(api, "apiFetch").mockImplementation(() => request.promise);
    const initial = withChecklist();
    const { queryClient, wrapper } = setup(initial);
    const { result } = renderHook(() => useSaveMissionDraft("sub-1"), { wrapper });

    let save!: Promise<{ draft: MissionDraft }>;
    act(() => { save = result.current.mutateAsync({
      workItemId: "item-1", revision: 3, caption: "old",
      externalUrl: "https://example.com/draft", checklist: { disclosure: true },
    }); });
    await waitFor(() => expect(draft(queryClient)?.revision).toBe(4));
    request.reject(failure);
    await act(async () => { await expect(save).rejects.toBe(failure); });

    expect(draft(queryClient)).toEqual(initial.workItems[0].draft);
  });

  it("installs stale canonical draft for an unchanged full draft with a deep-equal checklist", async () => {
    const request = deferred<{ draft: MissionDraft }>();
    vi.spyOn(api, "apiFetch").mockImplementation(() => request.promise);
    const initial = withChecklist();
    const { queryClient, wrapper } = setup(initial);
    const { result } = renderHook(() => useSaveMissionDraft("sub-1"), { wrapper });
    const input = {
      workItemId: "item-1", revision: 3, caption: "old",
      externalUrl: "https://example.com/draft", checklist: { disclosure: true },
    };

    let save!: Promise<{ draft: MissionDraft }>;
    act(() => { save = result.current.mutateAsync(input); });
    await waitFor(() => expect(draft(queryClient)?.revision).toBe(4));
    const currentDraft = {
      ...initial.workItems[0].draft!, caption: "server", revision: 4, lastSavedAt: "2026-07-16T00:00:00Z",
    };
    const stale = new ApiError(409, "WORKFLOW_STALE", "Draft revision is stale", { currentDraft });
    request.reject(stale);
    await act(async () => { await expect(save).rejects.toBe(stale); });

    expect(draft(queryClient)).toEqual(currentDraft);
    expect(result.current.conflict).toEqual({ workItemId: "item-1", localDraft: input, currentDraft });
  });

  it.each([
    ["newer revision", { caption: "external revision", revision: 5 }],
    ["changed content", { caption: "external content", revision: 4 }],
  ])("does not roll back externally refreshed %s", async (_kind, externalUpdate) => {
    const failure = new TypeError("offline");
    const request = deferred<{ draft: MissionDraft }>();
    vi.spyOn(api, "apiFetch").mockImplementation(() => request.promise);
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useSaveMissionDraft("sub-1"), { wrapper });

    let save!: Promise<{ draft: MissionDraft }>;
    act(() => { save = result.current.mutateAsync({ workItemId: "item-1", revision: 3, caption: "local" }); });
    await waitFor(() => expect(draft(queryClient)?.revision).toBe(4));
    const externalDraft = savedDraft({ ...externalUpdate, lastSavedAt: "2026-07-18T00:00:00Z" });
    queryClient.setQueryData<ActiveMissionWorkspace>(activeMissionQueryKey("sub-1"), (current) =>
      current && replaceDraftForTest(current, externalDraft));

    request.reject(failure);
    await act(async () => { await expect(save).rejects.toBe(failure); });
    expect(draft(queryClient)).toEqual(externalDraft);
  });

  it("immediately hides and clears a conflict when the hook switches submissions", async () => {
    const request = deferred<{ draft: MissionDraft }>();
    vi.spyOn(api, "apiFetch").mockImplementation(() => request.promise);
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(activeMissionQueryKey("sub-2"), workspaceFor("sub-2", "B cached"));
    const { result, rerender } = renderHook(
      ({ submissionId }) => useSaveMissionDraft(submissionId),
      { wrapper, initialProps: { submissionId: "sub-1" } },
    );
    const localInput = { workItemId: "item-1", revision: 3, caption: "A local" };

    let save!: Promise<{ draft: MissionDraft }>;
    act(() => { save = result.current.mutateAsync(localInput); });
    await waitFor(() => expect(draftFor(queryClient, "sub-1")?.caption).toBe("A local"));
    const currentDraft = savedDraft({ caption: "A server", revision: 4 });
    const stale = new ApiError(409, "WORKFLOW_STALE", "Draft revision is stale", { currentDraft });
    request.reject(stale);
    await act(async () => { await expect(save).rejects.toBe(stale); });
    expect(result.current.conflict).toEqual({ workItemId: "item-1", localDraft: localInput, currentDraft });

    act(() => { rerender({ submissionId: "sub-2" }); });
    expect(result.current.conflict).toBeNull();

    act(() => { rerender({ submissionId: "sub-1" }); });
    expect(result.current.conflict).toBeNull();
  });

  it.each(["success", "error", "stale"] as const)(
    "ignores a deferred submission A %s after switching to submission B",
    async (outcome) => {
      const submissionARequest = deferred<{ draft: MissionDraft }>();
      const submissionBRequest = deferred<{ draft: MissionDraft }>();
      const fetchSpy = vi.spyOn(api, "apiFetch")
        .mockImplementationOnce(() => submissionARequest.promise)
        .mockImplementationOnce(() => submissionBRequest.promise);
      const { queryClient, wrapper } = setup();
      const cancelSpy = vi.spyOn(queryClient, "cancelQueries");
      const { result, rerender } = renderHook(
        ({ submissionId }) => useSaveMissionDraft(submissionId),
        { wrapper, initialProps: { submissionId: "sub-1" } },
      );

      let save!: Promise<{ draft: MissionDraft }>;
      act(() => {
        save = result.current.mutateAsync({ workItemId: "item-1", revision: 3, caption: "A local" });
      });
      await waitFor(() => expect(draftFor(queryClient, "sub-1")).toMatchObject({ caption: "A local", revision: 4 }));
      await waitFor(() => expect(result.current.status).toBe("pending"));
      expect(fetchSpy).toHaveBeenCalledWith(
        "/my-missions/sub-1/work-items/item-1/draft",
        expect.objectContaining({ method: "PATCH" }),
      );
      expect(cancelSpy).toHaveBeenCalledWith({ queryKey: activeMissionQueryKey("sub-1") });
      const optimisticA = queryClient.getQueryData<ActiveMissionWorkspace>(activeMissionQueryKey("sub-1"));
      const optimisticDraftA = draftFor(queryClient, "sub-1");
      const matchingB = workspaceFor("sub-2", "B cached");
      queryClient.setQueryData<ActiveMissionWorkspace>(activeMissionQueryKey("sub-2"), {
        ...matchingB,
        workItems: matchingB.workItems.map((item) =>
          item.id === "item-1" ? { ...item, draft: optimisticDraftA ?? null } : item),
      });
      const cachedB = queryClient.getQueryData<ActiveMissionWorkspace>(activeMissionQueryKey("sub-2"));

      act(() => { rerender({ submissionId: "sub-2" }); });
      expect(result.current).toMatchObject({
        status: "idle",
        data: undefined,
        error: null,
        variables: undefined,
        isIdle: true,
        isPending: false,
        isSuccess: false,
        isError: false,
      });
      if (outcome === "success") {
        submissionARequest.resolve({ draft: savedDraft({ caption: "A canonical", revision: 4 }) });
        await act(async () => { await save; });
      } else {
        const failure = outcome === "stale"
          ? new ApiError(409, "WORKFLOW_STALE", "Draft revision is stale", {
              currentDraft: savedDraft({ caption: "A server", revision: 4 }),
            })
          : new TypeError("offline");
        submissionARequest.reject(failure);
        await act(async () => { await expect(save).rejects.toBe(failure); });
      }

      expect(queryClient.getQueryData(activeMissionQueryKey("sub-1"))).toEqual(optimisticA);
      expect(queryClient.getQueryData(activeMissionQueryKey("sub-2"))).toEqual(cachedB);
      expect(result.current.conflict).toBeNull();
      expect(result.current).toMatchObject({
        status: "idle",
        data: undefined,
        error: null,
        variables: undefined,
        isIdle: true,
        isPending: false,
        isSuccess: false,
        isError: false,
      });

      let saveB!: Promise<{ draft: MissionDraft }>;
      act(() => {
        saveB = result.current.mutateAsync({ workItemId: "item-1", revision: 3, caption: "B local" });
      });
      await waitFor(() => expect(result.current.status).toBe("pending"));
      submissionBRequest.resolve({ draft: savedDraft({ id: "draft-sub-2", caption: "B canonical", revision: 4 }) });
      await act(async () => { await saveB; });
      await waitFor(() => expect(result.current).toMatchObject({ status: "success", isSuccess: true, error: null }));
    },
  );
});

function workspaceFor(submissionId: string, caption: string): ActiveMissionWorkspace {
  const value = workspace();
  return {
    ...value,
    workflow: { ...value.workflow, id: `workflow-${submissionId}`, submissionId },
    mission: { ...value.mission, id: `mission-${submissionId}`, slug: `mission-${submissionId}` },
    workItems: value.workItems.map((item) => ({
      ...item,
      id: "item-1",
      draft: item.draft ? { ...item.draft, id: `draft-${submissionId}`, caption } : null,
    })),
  };
}

function draftFor(queryClient: QueryClient, submissionId: string) {
  return queryClient.getQueryData<ActiveMissionWorkspace>(activeMissionQueryKey(submissionId))
    ?.workItems.find((item) => item.id === "item-1")?.draft;
}

function replaceDraftForTest(workspaceValue: ActiveMissionWorkspace, nextDraft: MissionDraft): ActiveMissionWorkspace {
  return {
    ...workspaceValue,
    workItems: workspaceValue.workItems.map((item) =>
      item.id === "item-1" ? { ...item, draft: nextDraft } : item),
  };
}
describe("useSubmitPublicationProof request scoping", () => {
  it("does not expose a deferred stale conflict after switching submissions", async () => {
    const request = deferred<{ attempt: never }>();
    vi.spyOn(api, "apiFetch").mockImplementation(() => request.promise);
    const { queryClient, wrapper } = setup();
    const publicationB = {
      workItemId: "item-1", revision: 9, attempts: [],
    } as unknown as MissionPublicationView;
    queryClient.setQueryData(missionPublicationQueryKey("sub-2", "item-1"), publicationB);
    const { result, rerender } = renderHook(
      ({ submissionId }) => useSubmitPublicationProof(submissionId),
      { wrapper, initialProps: { submissionId: "sub-1" } },
    );
    const localProof = {
      workItemId: "item-1", expectedState: "approved_to_publish", expectedRevision: 4,
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      primaryUrl: "https://instagram.com/p/local",
    };
    let submit!: Promise<unknown>;
    act(() => { submit = result.current.mutateAsync(localProof); });
    await waitFor(() => expect(result.current.isPending).toBe(true));
    act(() => { rerender({ submissionId: "sub-2" }); });

    const currentPublication = {
      workItemId: "item-1", revision: 5, attempts: [{ id: "server-attempt" }],
    } as unknown as MissionPublicationView;
    const stale = new ApiError(409, "WORKFLOW_STALE", "Proof state is stale", { currentPublication });
    request.reject(stale);
    await act(async () => { await expect(submit).rejects.toBe(stale); });

    expect(result.current.conflict).toBeNull();
    expect(queryClient.getQueryData(missionPublicationQueryKey("sub-2", "item-1"))).toBe(publicationB);
  });
});
