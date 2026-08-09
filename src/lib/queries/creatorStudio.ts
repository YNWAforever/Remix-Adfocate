import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";

export type CreatorStudioState =
  | "not_started"
  | "drafting"
  | "ready_to_submit"
  | "submitted"
  | "changes_requested"
  | "resubmitted"
  | "approved";

export type MissionSubmissionStatus =
  | "applied"
  | "joined"
  | "submitted"
  | "under_review"
  | "approved"
  | "rejected"
  | "expired"
  | "declined";

export type OptionalSection<T> =
  | { status: "available"; value: T }
  | { status: "unavailable"; reason: "not_configured" | "temporarily_unavailable" };

export type SubmissionSummary = {
  id: string;
  creatorId: string;
  workspaceId: string;
  missionId: string;
  status: MissionSubmissionStatus;
  deadline: string | null;
};

export type MissionBrief = {
  missionId: string;
  title: string;
  description: string | null;
  deliverables: string[];
  requirements: string[];
  platforms: string[];
};

export type WorkflowSummary = {
  id: string;
  state: CreatorStudioState;
  revision: number;
};

export type WorkItemRequirements = {
  caption: boolean;
  externalUrl: boolean;
  checklist: string[];
};

export type WorkItemValidation = {
  caption: boolean;
  externalUrl: boolean;
  checklist: boolean;
  assets: boolean;
  publicationProof: boolean;
};

export type PublicationProofRequirement = {
  kind: "publication_url";
  allowedPlatforms: string[];
  evidence: "optional";
};

export type PublicationProofMetadata = {
  title: string | null;
  author: string | null;
  publishedAt: string | null;
};

export type PublicationProofEvidence = {
  id: string;
  attemptId: string;
  storagePath: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
  byteSize: number;
  checksumSha256: string | null;
  status: "pending" | "finalized";
};

export type PublicationProofAttempt = {
  id: string;
  workItemId: string;
  parentAttemptId: string | null;
  sequence: number;
  publishedUrl: string;
  platform: string | null;
  state: "draft" | "submitted" | "verified" | "changes_requested";
  metadataState: "pending" | "available" | "unavailable" | "failed";
  metadata: PublicationProofMetadata | null;
  operatorMessage: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  evidence: PublicationProofEvidence[];
};

export type PublicationProofSnapshot = {
  required: boolean;
  currentAttempt: PublicationProofAttempt | null;
  history: PublicationProofAttempt[];
};

export type WorkingDraft = {
  caption: string | null;
  externalUrl: string | null;
  checklist: Record<string, boolean>;
  version: number;
  updatedAt: string;
};

export type DraftAsset = {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string | null;
  state: "pending" | "finalized";
  storagePath: string;
};

export type ReviewFeedback = {
  id: string;
  state: "changes_requested" | "approved";
  message: string;
};

export type WorkItem = {
  id: string;
  position: number;
  title: string;
  instructions: string;
  requirements: WorkItemRequirements;
  requiresAsset: boolean;
  proofRequirement: PublicationProofRequirement | null;
  state: CreatorStudioState;
  validation: WorkItemValidation;
  draft: WorkingDraft | null;
  assets: DraftAsset[];
  publicationProof: PublicationProofSnapshot;
  reviewFeedback: OptionalSection<ReviewFeedback[]>;
};

export type NextAction = {
  workItemId: string;
  state: CreatorStudioState;
  label: string;
};

export type SubmissionWorkspace = {
  submission: SubmissionSummary;
  brief: MissionBrief;
  workflow: WorkflowSummary;
  workItems: WorkItem[];
  nextAction: NextAction | null;
};

export type UploadGrant = {
  bucket: string;
  path: string;
  token: string;
  assetId: string;
  expiresAt: string;
};

export type FinalizedAsset = {
  asset: DraftAsset;
  workItem: WorkItem;
  workflow: WorkflowSummary;
};

export type DraftCommandResponse = {
  replayed: boolean;
  draft: WorkingDraft;
  workItem: WorkItem;
  workflow: WorkflowSummary;
};

export type UploadGrantCommandResponse = UploadGrant & { replayed: boolean };
export type FinalizedAssetCommandResponse = FinalizedAsset & { replayed: boolean };
export type SubmittedWorkItem = { replayed: boolean; workItem: WorkItem; workflow: WorkflowSummary };

export type SaveDraftCommandInput = {
  commandId: string;
  expectedVersion: number;
  patch: { caption?: string; externalUrl?: string | null; checklist?: Record<string, boolean> };
};

export type CreateUploadGrantCommandInput = {
  commandId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
};

export type FinalizeAssetCommandInput = {
  commandId: string;
  byteSize: number;
  mimeType: string;
  checksumSha256: string | null;
};

export type SubmitWorkItemCommandInput = { commandId: string; expectedVersion: number };

export type CreatePublicationProofAttemptCommandInput = {
  commandId: string;
  publishedUrl: string;
  platform: string;
};

export type CreateProofEvidenceGrantCommandInput = {
  commandId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
};

export type FinalizeProofEvidenceCommandInput = {
  commandId: string;
  byteSize: number;
  mimeType: string;
  checksumSha256: string | null;
};

export type ProofCommandInput = { commandId: string };
export type PublicationProofAttemptCommandResponse = PublicationProofAttempt & { replayed: boolean };
export type PublicationProofEvidenceCommandResponse = PublicationProofEvidence & { replayed: boolean };
export type CancelledProofEvidenceCommandResponse = { evidenceId: string; replayed: boolean };
export type ProofUploadGrantCommandResponse = UploadGrantCommandResponse;

export const creatorStudioKeys = {
  workspace: (submissionId: string) => ["creator-studio", "workspace", submissionId] as const,
};

const invalidateWorkspace = (queryClient: ReturnType<typeof useQueryClient>, submissionId: string) =>
  queryClient.invalidateQueries({ queryKey: creatorStudioKeys.workspace(submissionId) });

export function useSubmissionWorkspace(submissionId: string) {
  return useQuery({
    queryKey: creatorStudioKeys.workspace(submissionId),
    queryFn: () => apiFetch<SubmissionWorkspace>(`/my-missions/${submissionId}/workspace`),
    enabled: Boolean(submissionId),
  });
}

export function useSaveCreatorDraft(submissionId: string, workItemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveDraftCommandInput) => apiFetch<DraftCommandResponse>(
      `/my-missions/${submissionId}/work-items/${workItemId}/draft`,
      {
        method: "PATCH",
        body: JSON.stringify({
          command_id: input.commandId,
          expected_version: input.expectedVersion,
          patch: {
            ...(input.patch.caption === undefined ? {} : { caption: input.patch.caption }),
            ...(input.patch.externalUrl === undefined ? {} : { external_url: input.patch.externalUrl }),
            ...(input.patch.checklist === undefined ? {} : { checklist: input.patch.checklist }),
          },
        }),
      },
    ),
    onSuccess: () => invalidateWorkspace(queryClient, submissionId),
  });
}

export function useCreateDraftAssetGrant(submissionId: string, workItemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUploadGrantCommandInput) => apiFetch<UploadGrantCommandResponse>(
      `/my-missions/${submissionId}/work-items/${workItemId}/assets/upload-grant`,
      { method: "POST", body: JSON.stringify({ command_id: input.commandId, file_name: input.fileName, mime_type: input.mimeType, byte_size: input.byteSize }) },
    ),
    onSuccess: () => invalidateWorkspace(queryClient, submissionId),
  });
}

export function useFinalizeDraftAsset(submissionId: string, workItemId: string, assetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: FinalizeAssetCommandInput) => apiFetch<FinalizedAssetCommandResponse>(
      `/my-missions/${submissionId}/work-items/${workItemId}/assets/${assetId}/finalize`,
      { method: "POST", body: JSON.stringify({ command_id: input.commandId, byte_size: input.byteSize, mime_type: input.mimeType, checksum_sha256: input.checksumSha256 }) },
    ),
    onSuccess: () => invalidateWorkspace(queryClient, submissionId),
  });
}

export function useSubmitWorkItem(submissionId: string, workItemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitWorkItemCommandInput) => apiFetch<SubmittedWorkItem>(
      `/my-missions/${submissionId}/work-items/${workItemId}/submit`,
      { method: "POST", body: JSON.stringify({ command_id: input.commandId, expected_version: input.expectedVersion }) },
    ),
    onSuccess: () => invalidateWorkspace(queryClient, submissionId),
  });
}

export function useCreatePublicationProofAttempt(submissionId: string, workItemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePublicationProofAttemptCommandInput) => apiFetch<PublicationProofAttemptCommandResponse>(
      `/my-missions/${submissionId}/work-items/${workItemId}/publication-proof/attempts`,
      { method: "POST", body: JSON.stringify({ command_id: input.commandId, published_url: input.publishedUrl, platform: input.platform }) },
    ),
    onSuccess: () => invalidateWorkspace(queryClient, submissionId),
  });
}

export function useCreateProofEvidenceGrant(submissionId: string, workItemId: string, attemptId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProofEvidenceGrantCommandInput) => apiFetch<ProofUploadGrantCommandResponse>(
      `/my-missions/${submissionId}/work-items/${workItemId}/publication-proof/attempts/${attemptId}/evidence/upload-grant`,
      { method: "POST", body: JSON.stringify({ command_id: input.commandId, file_name: input.fileName, mime_type: input.mimeType, byte_size: input.byteSize }) },
    ),
    onSuccess: () => invalidateWorkspace(queryClient, submissionId),
  });
}

export function useFinalizeProofEvidence(submissionId: string, workItemId: string, attemptId: string, evidenceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: FinalizeProofEvidenceCommandInput) => apiFetch<PublicationProofEvidenceCommandResponse>(
      `/my-missions/${submissionId}/work-items/${workItemId}/publication-proof/attempts/${attemptId}/evidence/${evidenceId}/finalize`,
      { method: "POST", body: JSON.stringify({ command_id: input.commandId, byte_size: input.byteSize, mime_type: input.mimeType, checksum_sha256: input.checksumSha256 }) },
    ),
    onSuccess: () => invalidateWorkspace(queryClient, submissionId),
  });
}

export function useCancelProofEvidence(submissionId: string, workItemId: string, attemptId: string, evidenceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProofCommandInput) => apiFetch<CancelledProofEvidenceCommandResponse>(
      `/my-missions/${submissionId}/work-items/${workItemId}/publication-proof/attempts/${attemptId}/evidence/${evidenceId}/cancel`,
      { method: "POST", body: JSON.stringify({ command_id: input.commandId }) },
    ),
    onSuccess: () => invalidateWorkspace(queryClient, submissionId),
  });
}

export function useSubmitPublicationProof(submissionId: string, workItemId: string, attemptId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProofCommandInput) => apiFetch<PublicationProofAttemptCommandResponse>(
      `/my-missions/${submissionId}/work-items/${workItemId}/publication-proof/attempts/${attemptId}/submit`,
      { method: "POST", body: JSON.stringify({ command_id: input.commandId }) },
    ),
    onSuccess: () => invalidateWorkspace(queryClient, submissionId),
  });
}

export function useRefreshProofMetadata(submissionId: string, workItemId: string, attemptId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProofCommandInput) => apiFetch<PublicationProofAttemptCommandResponse>(
      `/my-missions/${submissionId}/work-items/${workItemId}/publication-proof/attempts/${attemptId}/metadata/refresh`,
      { method: "POST", body: JSON.stringify({ command_id: input.commandId }) },
    ),
    onSuccess: () => invalidateWorkspace(queryClient, submissionId),
  });
}

export async function uploadDraftAsset(grant: UploadGrant, file: File) {
  const { error } = await supabase.storage.from(grant.bucket).uploadToSignedUrl(grant.path, grant.token, file);
  if (error) throw error;
}

export const uploadPublicationProofEvidence = uploadDraftAsset;
