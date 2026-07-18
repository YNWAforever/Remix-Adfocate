import { useState } from "react";
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

function updateWorkItemDraft(
  workspace: ActiveMissionWorkspace | undefined,
  workItemId: string,
  update: (draft: MissionDraft) => MissionDraft,
): ActiveMissionWorkspace | undefined {
  if (!workspace) return workspace;
  return {
    ...workspace,
    workItems: workspace.workItems.map((item) =>
      item.id === workItemId && item.draft ? { ...item, draft: update(item.draft) } : item),
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
  const mutation = useMutation({
    mutationFn: ({ workItemId, ...draft }: SaveMissionDraftInput) =>
      apiFetch<{ draft: MissionDraft }>(`/my-missions/${submissionId}/work-items/${workItemId}/draft`, {
        method: "PATCH",
        body: JSON.stringify(draft),
      }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ActiveMissionWorkspace>(queryKey);
      setConflict(null);
      queryClient.setQueryData<ActiveMissionWorkspace>(queryKey, (current) =>
        updateWorkItemDraft(current, input.workItemId, (draft) => ({
          ...draft,
          ...(Object.prototype.hasOwnProperty.call(input, "caption") ? { caption: input.caption! } : {}),
          ...(Object.prototype.hasOwnProperty.call(input, "externalUrl") ? { externalUrl: input.externalUrl! } : {}),
          ...(Object.prototype.hasOwnProperty.call(input, "checklist") ? { checklist: input.checklist! } : {}),
          revision: input.revision + 1,
        }))!);
      return { previous };
    },
    onError: (error, input, context) => {
      const currentDraft = currentDraftFrom(error);
      if (currentDraft) {
        queryClient.setQueryData<ActiveMissionWorkspace>(queryKey, (current) =>
          updateWorkItemDraft(current, input.workItemId, () => currentDraft)!);
        setConflict({ workItemId: input.workItemId, localDraft: input, currentDraft });
        return;
      }
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSuccess: ({ draft }, input) => {
      queryClient.setQueryData<ActiveMissionWorkspace>(queryKey, (current) =>
        updateWorkItemDraft(current, input.workItemId, () => draft)!);
      setConflict(null);
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
