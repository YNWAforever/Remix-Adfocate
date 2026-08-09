import type {
  CommandResult,
  CreateUploadGrantInput,
  CreatePublicationProofAttemptInput,
  CreateProofEvidenceGrantInput,
  CreatorStudioContext,
  DraftCommandResult,
  FinalizeAssetInput,
  FinalizedAsset,
  FinalizeProofEvidenceInput,
  RefreshProofMetadataInput,
  SaveDraftInput,
  SubmissionWorkspace,
  SubmittedWorkItem,
  SubmitPublicationProofInput,
  SubmitWorkItemInput,
  UploadGrant,
} from "./types.js";
import type { PublicationProofAttempt, PublicationProofEvidence } from "./publicationProof.js";

export interface CreatorStudioRepository {
  getWorkspace(context: CreatorStudioContext): Promise<SubmissionWorkspace | null>;
  saveDraft(context: CreatorStudioContext, workItemId: string, input: SaveDraftInput): Promise<CommandResult<DraftCommandResult>>;
  createUploadGrant(context: CreatorStudioContext, workItemId: string, input: CreateUploadGrantInput): Promise<CommandResult<UploadGrant>>;
  finalizeAsset(context: CreatorStudioContext, workItemId: string, assetId: string, input: FinalizeAssetInput): Promise<CommandResult<FinalizedAsset>>;
  submitWorkItem(context: CreatorStudioContext, workItemId: string, input: SubmitWorkItemInput): Promise<CommandResult<SubmittedWorkItem>>;
  createPublicationProofAttempt(
    context: CreatorStudioContext,
    workItemId: string,
    input: CreatePublicationProofAttemptInput,
  ): Promise<CommandResult<PublicationProofAttempt>>;
  createProofEvidenceGrant(
    context: CreatorStudioContext,
    workItemId: string,
    attemptId: string,
    input: CreateProofEvidenceGrantInput,
  ): Promise<CommandResult<UploadGrant>>;
  finalizeProofEvidence(
    context: CreatorStudioContext,
    workItemId: string,
    attemptId: string,
    evidenceId: string,
    input: FinalizeProofEvidenceInput,
  ): Promise<CommandResult<PublicationProofEvidence>>;
  submitPublicationProof(
    context: CreatorStudioContext,
    workItemId: string,
    attemptId: string,
    input: SubmitPublicationProofInput,
  ): Promise<CommandResult<PublicationProofAttempt>>;
  refreshProofMetadata(
    context: CreatorStudioContext,
    workItemId: string,
    attemptId: string,
    input: RefreshProofMetadataInput,
  ): Promise<CommandResult<PublicationProofAttempt>>;
}
