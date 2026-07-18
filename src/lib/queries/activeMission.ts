import { useRef, useState } from "react";
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

type SaveMissionDraftContext = {
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
  const queryKey = activeMissionQueryKey(submissionId);
  const [conflict, setConflict] = useState<MissionDraftConflict | null>(null);
  const mutationTokens = useRef(new Map<string, number>());
  const mutation = useMutation({
    mutationFn: ({ workItemId, ...draft }: SaveMissionDraftInput) =>
      apiFetch<{ draft: MissionDraft }>(`/my-missions/${submissionId}/work-items/${workItemId}/draft`, {
        method: "PATCH",
        body: JSON.stringify(draft),
      }),
    onMutate: async (input) => {
      const mutationToken = (mutationTokens.current.get(input.workItemId) ?? 0) + 1;
      mutationTokens.current.set(input.workItemId, mutationToken);
      await queryClient.cancelQueries({ queryKey });
      const current = queryClient.getQueryData<ActiveMissionWorkspace>(queryKey);
      const previousDraft = workItemDraft(current, input.workItemId);
      const nextDraft = optimisticDraft(previousDraft, input);
      const context = {
        mutationToken,
        workItemId: input.workItemId,
        previousDraft,
        optimisticDraft: nextDraft,
        localDraft: input,
      } satisfies SaveMissionDraftContext;
      const isLatest = mutationTokens.current.get(input.workItemId) === mutationToken;
      if (isLatest && nextDraft) {
        setConflict((currentConflict) =>
          currentConflict?.workItemId === input.workItemId ? null : currentConflict);
      }
      queryClient.setQueryData<ActiveMissionWorkspace>(queryKey, (current) =>
        isLatest && nextDraft ? replaceWorkItemDraft(current, input.workItemId, nextDraft)! : current);
      return context;
    },
    onError: (error, _input, context) => {
      if (!context || mutationTokens.current.get(context.workItemId) !== context.mutationToken) return;
      const cachedDraft = workItemDraft(
        queryClient.getQueryData<ActiveMissionWorkspace>(queryKey),
        context.workItemId,
      );
      if (!draftsEqual(cachedDraft, context.optimisticDraft)) return;
      const currentDraft = currentDraftFrom(error);
      if (currentDraft) {
        queryClient.setQueryData<ActiveMissionWorkspace>(queryKey, (current) =>
          replaceWorkItemDraft(current, context.workItemId, currentDraft)!);
        setConflict({
          workItemId: context.workItemId,
          localDraft: context.localDraft,
          currentDraft,
        });
        return;
      }
      queryClient.setQueryData<ActiveMissionWorkspace>(queryKey, (current) =>
        replaceWorkItemDraft(current, context.workItemId, context.previousDraft)!);
    },
    onSuccess: ({ draft }, _input, context) => {
      if (!context || mutationTokens.current.get(context.workItemId) !== context.mutationToken) return;
      queryClient.setQueryData<ActiveMissionWorkspace>(queryKey, (current) =>
        draftsEqual(workItemDraft(current, context.workItemId), context.optimisticDraft)
          ? replaceWorkItemDraft(current, context.workItemId, draft)!
          : current);
      setConflict((currentConflict) =>
        currentConflict?.workItemId === context.workItemId ? null : currentConflict);
    },
  });
  return { ...mutation, conflict, clearConflict: () => setConflict(null) };
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
