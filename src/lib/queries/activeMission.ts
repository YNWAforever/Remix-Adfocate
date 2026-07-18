import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch } from "@/lib/api";
import type { ActiveMissionWorkspace, MissionDraft, MissionWorkflow } from "../activeMission";

export const activeMissionQueryKey = (submissionId: string) => ["active-mission", submissionId] as const;

export type SaveMissionDraftInput = {
  workItemId: string;
  revision: number;
  caption?: string;
  externalUrl?: string | null;
  checklist?: Record<string, boolean>;
};

export type MissionDraftConflict = {
  workItemId: string;
  localDraft: SaveMissionDraftInput;
  currentDraft: MissionDraft;
};

type ScopedMissionDraftConflict = MissionDraftConflict & {
  submissionId: string;
  generation: number;
};

type MissionDraftScope = {
  submissionId: string;
  generation: number;
};

type SaveMissionDraftContext = {
  submissionId: string;
  generation: number;
  queryKey: ReturnType<typeof activeMissionQueryKey>;
  mutationToken: number;
  workItemId: string;
  previousDraft: MissionDraft | null;
  optimisticDraft: MissionDraft | null;
  localDraft: SaveMissionDraftInput;
};

export type CreateDraftAssetGrantInput = {
  workItemId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

export type FinalizeDraftAssetInput = {
  workItemId: string;
  assetId: string;
  checksum: string;
};

export type SubmitMissionWorkItemInput = {
  workItemId: string;
  expectedRevision: number;
  idempotencyKey: string;
};

// Task 5's approved design locks these requests and paths, but not the response
// property names. Keep the response opaque until the server contract lands.
export type DraftAssetMutationResult = Readonly<Record<string, unknown>>;
export type SubmitMissionWorkItemResult = Readonly<{ version: unknown; workItem: unknown }>;

function workItemDraft(
  workspace: ActiveMissionWorkspace | undefined,
  workItemId: string,
): MissionDraft | null {
  return workspace?.workItems.find((item) => item.id === workItemId)?.draft ?? null;
}

function replaceWorkItemDraft(
  workspace: ActiveMissionWorkspace | undefined,
  workItemId: string,
  draft: MissionDraft | null,
): ActiveMissionWorkspace | undefined {
  if (!workspace) return workspace;
  return {
    ...workspace,
    workItems: workspace.workItems.map((item) =>
      item.id === workItemId ? { ...item, draft } : item),
  };
}

function checklistsEqual(left: Record<string, boolean>, right: Record<string, boolean>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && left[key] === right[key]);
}

function draftsEqual(left: MissionDraft | null, right: MissionDraft | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.id === right.id
    && left.caption === right.caption
    && left.externalUrl === right.externalUrl
    && checklistsEqual(left.checklist, right.checklist)
    && left.revision === right.revision
    && left.lastSavedAt === right.lastSavedAt;
}

function optimisticDraft(previousDraft: MissionDraft | null, input: SaveMissionDraftInput): MissionDraft | null {
  if (!previousDraft) return null;
  return {
    ...previousDraft,
    ...(Object.prototype.hasOwnProperty.call(input, "caption") ? { caption: input.caption! } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "externalUrl") ? { externalUrl: input.externalUrl! } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "checklist") ? { checklist: input.checklist! } : {}),
    revision: Math.max(previousDraft.revision, input.revision + 1),
  };
}

function currentDraftFrom(error: unknown): MissionDraft | null {
  if (!(error instanceof ApiError) || error.code !== "WORKFLOW_STALE") return null;
  const details = error.details;
  if (!details || typeof details !== "object" || !("currentDraft" in details)) return null;
  const draft = (details as { currentDraft?: unknown }).currentDraft;
  return draft && typeof draft === "object" ? draft as MissionDraft : null;
}

function invalidateMissionCollections(queryClient: ReturnType<typeof useQueryClient>, submissionId: string) {
  void queryClient.invalidateQueries({ queryKey: activeMissionQueryKey(submissionId) });
  void queryClient.invalidateQueries({ queryKey: ["my-missions"] });
  void queryClient.invalidateQueries({ queryKey: ["missions"] });
}

export function useActiveMissionWorkspace(submissionId: string) {
  return useQuery({
    queryKey: activeMissionQueryKey(submissionId),
    queryFn: () => apiFetch<ActiveMissionWorkspace>(`/my-missions/${submissionId}/workspace`),
    enabled: Boolean(submissionId),
  });
}

export function useSaveMissionDraft(submissionId: string) {
  const queryClient = useQueryClient();
  const [conflict, setConflict] = useState<ScopedMissionDraftConflict | null>(null);
  const scopeRef = useRef<MissionDraftScope>({ submissionId, generation: 0 });
  const mutationTokens = useRef(new Map<string, number>());
  if (scopeRef.current.submissionId !== submissionId) {
    scopeRef.current = {
      submissionId,
      generation: scopeRef.current.generation + 1,
    };
    mutationTokens.current.clear();
  }
  const renderScope = scopeRef.current;
  const queryKey = activeMissionQueryKey(renderScope.submissionId);
  const isCurrent = (context: SaveMissionDraftContext) =>
    scopeRef.current.submissionId === context.submissionId
    && scopeRef.current.generation === context.generation
    && mutationTokens.current.get(context.workItemId) === context.mutationToken;

  useEffect(() => {
    setConflict((currentConflict) =>
      currentConflict
        && (currentConflict.submissionId !== renderScope.submissionId
          || currentConflict.generation !== renderScope.generation)
        ? null
        : currentConflict);
  }, [renderScope.generation, renderScope.submissionId]);

  const mutation = useMutation({
    mutationFn: ({ workItemId, ...draft }: SaveMissionDraftInput) =>
      apiFetch<{ draft: MissionDraft }>(`/my-missions/${renderScope.submissionId}/work-items/${workItemId}/draft`, {
        method: "PATCH",
        body: JSON.stringify(draft),
      }),
    onMutate: async (input) => {
      const mutationToken = (mutationTokens.current.get(input.workItemId) ?? 0) + 1;
      mutationTokens.current.set(input.workItemId, mutationToken);
      const contextQueryKey = queryKey;
      await queryClient.cancelQueries({ queryKey: contextQueryKey });
      const current = queryClient.getQueryData<ActiveMissionWorkspace>(contextQueryKey);
      const previousDraft = workItemDraft(current, input.workItemId);
      const nextDraft = optimisticDraft(previousDraft, input);
      const context = {
        submissionId: renderScope.submissionId,
        generation: renderScope.generation,
        queryKey: contextQueryKey,
        mutationToken,
        workItemId: input.workItemId,
        previousDraft,
        optimisticDraft: nextDraft,
        localDraft: input,
      } satisfies SaveMissionDraftContext;
      const contextIsCurrent = isCurrent(context);
      if (contextIsCurrent && nextDraft) {
        setConflict((currentConflict) =>
          currentConflict?.submissionId === context.submissionId
            && currentConflict.generation === context.generation
            && currentConflict.workItemId === input.workItemId
            ? null
            : currentConflict);
      }
      queryClient.setQueryData<ActiveMissionWorkspace>(context.queryKey, (currentWorkspace) =>
        contextIsCurrent && nextDraft
          ? replaceWorkItemDraft(currentWorkspace, input.workItemId, nextDraft)!
          : currentWorkspace);
      return context;
    },
    onError: (error, _input, context) => {
      if (!context || !isCurrent(context)) return;
      const cachedDraft = workItemDraft(
        queryClient.getQueryData<ActiveMissionWorkspace>(context.queryKey),
        context.workItemId,
      );
      if (!draftsEqual(cachedDraft, context.optimisticDraft)) return;
      const currentDraft = currentDraftFrom(error);
      if (currentDraft) {
        queryClient.setQueryData<ActiveMissionWorkspace>(context.queryKey, (currentWorkspace) =>
          replaceWorkItemDraft(currentWorkspace, context.workItemId, currentDraft)!);
        setConflict({
          submissionId: context.submissionId,
          generation: context.generation,
          workItemId: context.workItemId,
          localDraft: context.localDraft,
          currentDraft,
        });
        return;
      }
      queryClient.setQueryData<ActiveMissionWorkspace>(context.queryKey, (currentWorkspace) =>
        replaceWorkItemDraft(currentWorkspace, context.workItemId, context.previousDraft)!);
    },
    onSuccess: ({ draft }, _input, context) => {
      if (!context || !isCurrent(context)) return;
      queryClient.setQueryData<ActiveMissionWorkspace>(context.queryKey, (currentWorkspace) =>
        draftsEqual(workItemDraft(currentWorkspace, context.workItemId), context.optimisticDraft)
          ? replaceWorkItemDraft(currentWorkspace, context.workItemId, draft)!
          : currentWorkspace);
      setConflict((currentConflict) =>
        currentConflict?.submissionId === context.submissionId
          && currentConflict.generation === context.generation
          && currentConflict.workItemId === context.workItemId
          ? null
          : currentConflict);
    },
  });
  const visibleConflict = conflict
    && conflict.submissionId === renderScope.submissionId
    && conflict.generation === renderScope.generation
    ? {
        workItemId: conflict.workItemId,
        localDraft: conflict.localDraft,
        currentDraft: conflict.currentDraft,
      }
    : null;
  return { ...mutation, conflict: visibleConflict, clearConflict: () => setConflict(null) };
}

export function useConfirmMissionReceipt(submissionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ workflow: MissionWorkflow }>(`/my-missions/${submissionId}/fulfillment/received`, { method: "POST" }),
    onSuccess: () => invalidateMissionCollections(queryClient, submissionId),
  });
}

export function useCreateDraftAssetGrant(submissionId: string) {
  return useMutation({
    mutationFn: ({ workItemId, ...body }: CreateDraftAssetGrantInput) =>
      apiFetch<DraftAssetMutationResult>(`/my-missions/${submissionId}/work-items/${workItemId}/assets/upload-grant`, {
        method: "POST", body: JSON.stringify(body),
      }),
  });
}

export function useFinalizeDraftAsset(submissionId: string) {
  return useMutation({
    mutationFn: ({ workItemId, assetId, ...body }: FinalizeDraftAssetInput) =>
      apiFetch<DraftAssetMutationResult>(`/my-missions/${submissionId}/work-items/${workItemId}/assets/${assetId}/finalize`, {
        method: "POST", body: JSON.stringify(body),
      }),
  });
}

export function useSubmitMissionWorkItem(submissionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workItemId, idempotencyKey, ...body }: SubmitMissionWorkItemInput) =>
      apiFetch<SubmitMissionWorkItemResult>(`/my-missions/${submissionId}/work-items/${workItemId}/submit`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidateMissionCollections(queryClient, submissionId),
  });
}
