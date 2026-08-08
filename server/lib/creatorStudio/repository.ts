import type {
  CommandResult,
  CreateUploadGrantInput,
  CreatorStudioContext,
  DraftCommandResult,
  FinalizeAssetInput,
  FinalizedAsset,
  SaveDraftInput,
  SubmissionWorkspace,
  SubmittedWorkItem,
  SubmitWorkItemInput,
  UploadGrant,
} from "./types.js";

export interface CreatorStudioRepository {
  getWorkspace(context: CreatorStudioContext): Promise<SubmissionWorkspace | null>;
  saveDraft(context: CreatorStudioContext, workItemId: string, input: SaveDraftInput): Promise<CommandResult<DraftCommandResult>>;
  createUploadGrant(context: CreatorStudioContext, workItemId: string, input: CreateUploadGrantInput): Promise<CommandResult<UploadGrant>>;
  finalizeAsset(context: CreatorStudioContext, workItemId: string, assetId: string, input: FinalizeAssetInput): Promise<CommandResult<FinalizedAsset>>;
  submitWorkItem(context: CreatorStudioContext, workItemId: string, input: SubmitWorkItemInput): Promise<CommandResult<SubmittedWorkItem>>;
}
