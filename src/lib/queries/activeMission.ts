import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch } from "@/lib/api";
import {
  refreshPublicationProofMetadata,
  requestPublicationProofCorrection,
  startPublicationProofReview,
  verifyPublicationProof,
} from "../admin";
import type {
  ActiveMissionWorkspace, MissionDraft, MissionPublicationView,
  MissionWorkflow, PublicationProofAttemptView,
} from "../activeMission";

export const activeMissionQueryKey = (submissionId: string) => ["active-mission", submissionId] as const;
export const missionPublicationQueryKey = (submissionId: string, workItemId: string) =>
  ["mission-publication", submissionId, workItemId] as const;

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
export type DraftAssetUploadGrant = Readonly<{
  asset: Readonly<{ id: string; storageObjectPath: string }>;
  token: string;
}>;
export type DraftAssetMutationResult = DraftAssetUploadGrant | Readonly<Record<string, unknown>>;
export type SubmitMissionWorkItemResult = Readonly<{ version: unknown; workItem: unknown }>;
type ProofMutationInput = {
  workItemId: string;
  expectedState: string;
  expectedRevision: number;
  idempotencyKey: string;
};

export type CreateProofEvidenceGrantInput = ProofMutationInput & {
  fileName: string;
  contentType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "video/mp4" | "video/quicktime" | "video/webm";
  sizeBytes: number;
};

export type FinalizeProofEvidenceInput = ProofMutationInput & {
  assetId: string;
  checksum: string;
};

export type SubmitPublicationProofInput = ProofMutationInput & {
  primaryUrl: string;
  additionalUrls?: string[];
  evidenceAssetIds?: string[];
};

export type PublicationProofConflict = {
  localProof: SubmitPublicationProofInput;
  currentPublication: MissionPublicationView;
};

type ScopedPublicationProofConflict = PublicationProofConflict & {
  submissionId: string;
  generation: number;
};

function currentPublicationFrom(error: unknown): MissionPublicationView | null {
  if (!(error instanceof ApiError) || error.code !== "WORKFLOW_STALE") return null;
  const details = error.details;
  if (!details || typeof details !== "object" || !("currentPublication" in details)) return null;
  const publication = (details as { currentPublication?: unknown }).currentPublication;
  return publication && typeof publication === "object" ? publication as MissionPublicationView : null;
}

function invalidatePublicationCollections(
  queryClient: ReturnType<typeof useQueryClient>,
  submissionId: string,
  workItemId: string,
) {
  void queryClient.invalidateQueries({ queryKey: missionPublicationQueryKey(submissionId, workItemId) });
  invalidateMissionCollections(queryClient, submissionId);
}

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
export function useMissionPublication(submissionId: string, workItemId: string) {
  return useQuery({
    queryKey: missionPublicationQueryKey(submissionId, workItemId),
    queryFn: async () => {
      const result = await apiFetch<{ publication: MissionPublicationView }>(
        `/my-missions/${submissionId}/publication/${workItemId}`,
      );
      return result.publication;
    },
    enabled: Boolean(submissionId && workItemId),
  });
}


export function useSaveMissionDraft(submissionId: string) {
  const queryClient = useQueryClient();
  const [conflict, setConflict] = useState<ScopedMissionDraftConflict | null>(null);
  const scopeRef = useRef<MissionDraftScope>({ submissionId, generation: 0 });
  const activeMutationGeneration = useRef<number | null>(null);
  const mutationTokens = useRef(new Map<string, number>());
  if (scopeRef.current.submissionId !== submissionId) {
    scopeRef.current = {
      submissionId,
      generation: scopeRef.current.generation + 1,
    };
    mutationTokens.current.clear();
  }
  const renderScope = scopeRef.current;
  const resetGeneration = useRef(renderScope.generation);
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

  useEffect(() => {
    if (resetGeneration.current === renderScope.generation) return;
    resetGeneration.current = renderScope.generation;
    activeMutationGeneration.current = null;
    mutation.reset();
  }, [mutation.reset, renderScope.generation]);

  const mutate: typeof mutation.mutate = (input, options) => {
    activeMutationGeneration.current = renderScope.generation;
    mutation.mutate(input, options);
  };
  const mutateAsync: typeof mutation.mutateAsync = (input, options) => {
    activeMutationGeneration.current = renderScope.generation;
    return mutation.mutateAsync(input, options);
  };
  const observer = activeMutationGeneration.current === renderScope.generation
    ? mutation
    : {
        ...mutation,
        context: undefined,
        data: undefined,
        error: null,
        failureCount: 0,
        failureReason: null,
        isError: false,
        isIdle: true,
        isPaused: false,
        isPending: false,
        isSuccess: false,
        status: "idle" as const,
        submittedAt: 0,
        variables: undefined,
      };
  const visibleConflict = conflict
    && conflict.submissionId === renderScope.submissionId
    && conflict.generation === renderScope.generation
    ? {
        workItemId: conflict.workItemId,
        localDraft: conflict.localDraft,
        currentDraft: conflict.currentDraft,
      }
    : null;
  return {
    ...observer,
    mutate,
    mutateAsync,
    conflict: visibleConflict,
    clearConflict: () => setConflict(null),
  };
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
export function useProofEvidenceUpload(submissionId: string) {
  const queryClient = useQueryClient();
  const createGrant = useMutation({
    mutationFn: ({
      workItemId, idempotencyKey, expectedState, expectedRevision, ...upload
    }: CreateProofEvidenceGrantInput) =>
      apiFetch<Record<string, unknown>>(
        `/my-missions/${submissionId}/publication/${workItemId}/assets/upload-grant`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({ expectedState, expectedRevision, ...upload }),
        },
      ),
    onSuccess: (_data, input) =>
      invalidatePublicationCollections(queryClient, submissionId, input.workItemId),
  });
  const finalize = useMutation({
    mutationFn: ({
      workItemId, assetId, idempotencyKey, expectedState, expectedRevision, checksum,
    }: FinalizeProofEvidenceInput) =>
      apiFetch<Record<string, unknown>>(
        `/my-missions/${submissionId}/publication/${workItemId}/assets/${assetId}/finalize`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({ expectedState, expectedRevision, checksum }),
        },
      ),
    onSuccess: (_data, input) =>
      invalidatePublicationCollections(queryClient, submissionId, input.workItemId),
  });
  return { createGrant, finalize };
}
export function useSubmitPublicationProof(submissionId: string) {
  const queryClient = useQueryClient();
  const [conflict, setConflict] = useState<ScopedPublicationProofConflict | null>(null);
  const scopeRef = useRef({ submissionId, generation: 0 });
  if (scopeRef.current.submissionId !== submissionId) {
    scopeRef.current = {
      submissionId,
      generation: scopeRef.current.generation + 1,
    };
  }
  const renderScope = scopeRef.current;
  const isCurrent = (context: { submissionId: string; generation: number } | undefined) =>
    context?.submissionId === scopeRef.current.submissionId
    && context.generation === scopeRef.current.generation;
  const mutation = useMutation({
    retry: false,
    mutationFn: ({
      workItemId, idempotencyKey, expectedState, expectedRevision,
      primaryUrl, additionalUrls, evidenceAssetIds,
    }: SubmitPublicationProofInput) =>
      apiFetch<{ attempt: PublicationProofAttemptView; workItem?: unknown }>(
        `/my-missions/${submissionId}/publication/${workItemId}/proofs`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({
            expectedState,
            expectedRevision,
            primaryUrl,
            additionalUrls: additionalUrls ?? [],
            evidenceAssetIds: evidenceAssetIds ?? [],
          }),
        },
      ),
    onMutate: () => {
      setConflict(null);
      return renderScope;
    },
    onError: (error, localProof, context) => {
      if (!isCurrent(context)) return;
      const currentPublication = currentPublicationFrom(error);
      if (!currentPublication) return;
      queryClient.setQueryData(
        missionPublicationQueryKey(submissionId, localProof.workItemId),
        currentPublication,
      );
      setConflict({
        submissionId: context!.submissionId,
        generation: context!.generation,
        localProof,
        currentPublication,
      });
    },
    onSuccess: (_data, input, context) => {
      if (!isCurrent(context)) return;
      setConflict(null);
      invalidatePublicationCollections(queryClient, submissionId, input.workItemId);
    },
  });
  const visibleConflict = conflict
    && conflict.submissionId === renderScope.submissionId
    && conflict.generation === renderScope.generation
    ? { localProof: conflict.localProof, currentPublication: conflict.currentPublication }
    : null;
  return {
    ...mutation,
    conflict: visibleConflict,
    clearConflict: () => setConflict(null),
  };
}

type OperatorProofMutationBase = {
  workflowId: string;
  workItemId: string;
  workspace: string;
  expectedState: string;
  expectedRevision: number;
  attemptId: string;
  idempotencyKey: string;
};

function useInvalidateOperatorProof() {
  const queryClient = useQueryClient();
  return (input: OperatorProofMutationBase) => {
    void queryClient.invalidateQueries({
      queryKey: ["admin-active-mission", input.workspace, input.workflowId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["admin-active-missions", input.workspace],
    });
  };
}

export function useStartProofReview() {
  const invalidate = useInvalidateOperatorProof();
  return useMutation({
    mutationFn: ({ workflowId, workItemId, ...body }: OperatorProofMutationBase) =>
      startPublicationProofReview(workflowId, workItemId, body),
    onSuccess: (_data, input) => invalidate(input),
  });
}

export function useRequestProofCorrection() {
  const invalidate = useInvalidateOperatorProof();
  return useMutation({
    mutationFn: ({
      workflowId, workItemId, ...body
    }: OperatorProofMutationBase & {
      checklist: Parameters<typeof requestPublicationProofCorrection>[2]["checklist"];
      corrections: Parameters<typeof requestPublicationProofCorrection>[2]["corrections"];
      summary?: string | null;
    }) => requestPublicationProofCorrection(workflowId, workItemId, body),
    onSuccess: (_data, input) => invalidate(input),
  });
}

export function useVerifyProof() {
  const invalidate = useInvalidateOperatorProof();
  return useMutation({
    mutationFn: ({
      workflowId, workItemId, ...body
    }: OperatorProofMutationBase & {
      checklist: Parameters<typeof verifyPublicationProof>[2]["checklist"];
      summary?: string | null;
    }) => verifyPublicationProof(workflowId, workItemId, body),
    onSuccess: (_data, input) => invalidate(input),
  });
}

export function useRefreshProofMetadata() {
  const invalidate = useInvalidateOperatorProof();
  return useMutation({
    mutationFn: ({ workflowId, workItemId, ...body }: OperatorProofMutationBase) =>
      refreshPublicationProofMetadata(workflowId, workItemId, body),
    onSuccess: (_data, input) => invalidate(input),
  });
}
