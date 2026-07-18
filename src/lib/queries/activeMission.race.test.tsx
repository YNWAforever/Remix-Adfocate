import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import * as api from "@/lib/api";
import type { ActiveMissionWorkspace, MissionDraft } from "../activeMission";
import { activeMissionQueryKey, useSaveMissionDraft } from "./activeMission";

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
});
