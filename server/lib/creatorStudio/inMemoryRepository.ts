import { hashCommand } from "./command.js";
import { CreatorStudioError } from "./errors.js";
import type { CreatorStudioRepository } from "./repository.js";
import type {
  CommandResult,
  CreateUploadGrantInput,
  CreatorStudioContext,
  CreatorStudioEvent,
  DraftAsset,
  DraftCommandResult,
  FinalizeAssetInput,
  FinalizedAsset,
  SaveDraftInput,
  SubmissionWorkspace,
  SubmittedWorkItem,
  SubmitWorkItemInput,
  UploadGrant,
  WorkItem,
  WorkItemState,
  WorkingDraft,
} from "./types.js";

type CompletedCommand = {
  hash: string;
  result: unknown;
};

export type InMemoryCreatorStudioRepositoryOptions = {
  workspace: SubmissionWorkspace;
};

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const ALLOWED_UPLOAD_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["video/mp4", "mp4"],
  ["application/pdf", "pdf"],
]);
const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryCreatorStudioRepository implements CreatorStudioRepository {
  private readonly commands = new Map<string, CompletedCommand>();
  private readonly eventLog: CreatorStudioEvent[] = [];
  private readonly drafts = new Map<string, WorkingDraft>();
  private readonly assets = new Map<string, DraftAsset>();
  private readonly draftVersions = new Map<string, WorkingDraft[]>();
  private readonly workspace: SubmissionWorkspace;
  private sequence = 0;

  constructor(options: InMemoryCreatorStudioRepositoryOptions) {
    this.workspace = clone(options.workspace);
    for (const workItem of this.workspace.workItems) {
      if (workItem.draft) {
        this.drafts.set(workItem.id, clone(workItem.draft));
        this.draftVersions.set(workItem.id, [clone(workItem.draft)]);
      }
      for (const asset of workItem.assets) this.assets.set(asset.id, clone(asset));
    }
  }

  async getWorkspace(context: CreatorStudioContext): Promise<SubmissionWorkspace | null> {
    if (!this.owns(context)) return null;
    return clone(this.workspace);
  }

  async saveDraft(
    context: CreatorStudioContext,
    workItemId: string,
    input: SaveDraftInput,
  ): Promise<CommandResult<DraftCommandResult>> {
    this.requireCommand(input.commandId);
    const workItem = this.requireWorkItem(context, workItemId);
    const payload = { type: "save_draft", context, workItemId, input };
    const requestHash = hashCommand(payload);
    const replay = this.replay<DraftCommandResult>(context, input.commandId, requestHash);
    if (replay) return replay;

    const current = this.drafts.get(workItem.id);
    const currentVersion = current?.version ?? 0;
    if (input.expectedVersion !== currentVersion) {
      throw new CreatorStudioError("version_conflict", "The draft was updated elsewhere");
    }
    if (workItem.state !== "not_started" && workItem.state !== "drafting" && workItem.state !== "ready_to_submit" && workItem.state !== "changes_requested") {
      throw new CreatorStudioError("invalid_transition", "This work item cannot be edited");
    }

    const draft: WorkingDraft = {
      caption: input.patch.caption ?? current?.caption ?? null,
      externalUrl: input.patch.externalUrl === undefined ? (current?.externalUrl ?? null) : input.patch.externalUrl,
      checklist: { ...(current?.checklist ?? {}), ...(input.patch.checklist ?? {}) },
      version: currentVersion + 1,
      updatedAt: new Date().toISOString(),
    };
    this.drafts.set(workItem.id, clone(draft));
    this.draftVersions.set(workItem.id, [...(this.draftVersions.get(workItem.id) ?? []), clone(draft)]);
    workItem.draft = clone(draft);
    this.refreshWorkItemValidation(workItem);
    this.refreshEditableWorkItemState(workItem);
    this.refreshWorkflow();

    const result = { draft: clone(draft), workItem: clone(workItem), workflow: clone(this.workspace.workflow) };
    this.recordEvent("draft.saved", workItem.id, { version: draft.version });
    return this.commit(context, input.commandId, requestHash, result);
  }

  async createUploadGrant(
    context: CreatorStudioContext,
    workItemId: string,
    input: CreateUploadGrantInput,
  ): Promise<CommandResult<UploadGrant>> {
    this.requireCommand(input.commandId);
    const workItem = this.requireWorkItem(context, workItemId);
    const payload = { type: "create_upload_grant", context, workItemId, input };
    const requestHash = hashCommand(payload);
    const replay = this.replay<UploadGrant>(context, input.commandId, requestHash);
    if (replay) return replay;
    this.requireEditableAssetWorkItem(workItem);
    this.validateFile(input.mimeType, input.byteSize);

    const id = `asset-${++this.sequence}`;
    const extension = this.extensionForMime(input.mimeType);
    const asset: DraftAsset = {
      id,
      fileName: input.fileName.trim(),
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      checksumSha256: null,
      state: "pending",
      storagePath: `${context.actorId}/${this.workspace.workflow.id}/${workItem.id}/${id}.${extension}`,
    };
    this.assets.set(id, clone(asset));
    workItem.assets.push(clone(asset));
    this.refreshWorkItemValidation(workItem);
    this.refreshNextAction();
    const result: UploadGrant = {
      bucket: "creator-studio-assets",
      path: asset.storagePath,
      token: `memory-upload-token-${asset.id}`,
      assetId: asset.id,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
    this.recordEvent("asset.reserved", workItem.id, { assetId: asset.id, byteSize: asset.byteSize });
    return this.commit(context, input.commandId, requestHash, result);
  }

  async finalizeAsset(
    context: CreatorStudioContext,
    workItemId: string,
    assetId: string,
    input: FinalizeAssetInput,
  ): Promise<CommandResult<FinalizedAsset>> {
    this.requireCommand(input.commandId);
    const workItem = this.requireWorkItem(context, workItemId);
    const payload = { type: "finalize_asset", context, workItemId, assetId, input };
    const requestHash = hashCommand(payload);
    const replay = this.replay<FinalizedAsset>(context, input.commandId, requestHash);
    if (replay) return replay;
    this.requireEditableAssetWorkItem(workItem);

    const asset = this.assets.get(assetId);
    if (!asset || !workItem.assets.some((candidate) => candidate.id === assetId)) {
      throw new CreatorStudioError("asset_not_found", "Asset was not found");
    }
    if (asset.state === "finalized") throw new CreatorStudioError("asset_finalized", "Asset is already finalized");
    if (asset.byteSize !== input.byteSize || asset.mimeType !== input.mimeType) {
      throw new CreatorStudioError("asset_not_uploaded", "Uploaded asset metadata did not match the reservation");
    }

    asset.state = "finalized";
    asset.checksumSha256 = input.checksumSha256;
    this.assets.set(asset.id, clone(asset));
    workItem.assets = workItem.assets.map((candidate) => candidate.id === asset.id ? clone(asset) : candidate);
    this.refreshWorkItemValidation(workItem);
    this.refreshEditableWorkItemState(workItem);
    this.refreshWorkflow();
    const result = { asset: clone(asset), workItem: clone(workItem), workflow: clone(this.workspace.workflow) };
    this.recordEvent("asset.finalized", workItem.id, { assetId: asset.id });
    return this.commit(context, input.commandId, requestHash, result);
  }

  async submitWorkItem(
    context: CreatorStudioContext,
    workItemId: string,
    input: SubmitWorkItemInput,
  ): Promise<CommandResult<SubmittedWorkItem>> {
    this.requireCommand(input.commandId);
    const workItem = this.requireWorkItem(context, workItemId);
    const payload = { type: "submit_work_item", context, workItemId, input };
    const requestHash = hashCommand(payload);
    const replay = this.replay<SubmittedWorkItem>(context, input.commandId, requestHash);
    if (replay) return replay;

    const version = this.drafts.get(workItem.id)?.version ?? 0;
    if (input.expectedVersion !== version) throw new CreatorStudioError("version_conflict", "The draft was updated elsewhere");
    const validation = this.workItemValidation(workItem);
    if (!Object.values(validation).every(Boolean)) {
      throw new CreatorStudioError("draft_invalid", "Complete the required draft fields and assets");
    }
    if (workItem.state === "ready_to_submit") workItem.state = "submitted";
    else if (workItem.state === "changes_requested") workItem.state = "resubmitted";
    else throw new CreatorStudioError("invalid_transition", "This work item is not ready to submit");
    this.refreshWorkItemValidation(workItem);
    this.refreshWorkflow();

    const result = { workItem: clone(workItem), workflow: clone(this.workspace.workflow) };
    this.recordEvent("work_item.submitted", workItem.id, { state: workItem.state });
    return this.commit(context, input.commandId, requestHash, result);
  }

  events(): CreatorStudioEvent[] {
    return clone(this.eventLog);
  }

  getDraft(workItemId: string): WorkingDraft | undefined {
    const draft = this.drafts.get(workItemId);
    return draft ? clone(draft) : undefined;
  }

  private owns(context: CreatorStudioContext): boolean {
    const submission = this.workspace.submission;
    return submission.id === context.submissionId
      && submission.workspaceId === context.workspaceId
      && submission.creatorId === context.actorId;
  }

  private requireWorkItem(context: CreatorStudioContext, workItemId: string): WorkItem {
    if (!this.owns(context)) throw new CreatorStudioError("submission_not_found", "Submission was not found");
    const workItem = this.workspace.workItems.find((candidate) => candidate.id === workItemId);
    if (!workItem) throw new CreatorStudioError("work_item_not_found", "Work item was not found");
    return workItem;
  }

  private requireCommand(commandId: string): void {
    if (!commandId.trim()) throw new CreatorStudioError("command_required", "commandId is required");
  }

  private commandKey(context: CreatorStudioContext, commandId: string): string {
    return `${context.submissionId}:${context.actorId}:${commandId}`;
  }

  private replay<T>(context: CreatorStudioContext, commandId: string, requestHash: string): CommandResult<T> | null {
    const completed = this.commands.get(this.commandKey(context, commandId));
    if (!completed) return null;
    if (completed.hash !== requestHash) {
      throw new CreatorStudioError("command_conflict", "Command id was already used with a different request");
    }
    return { value: clone(completed.result as T), replayed: true };
  }

  private commit<T>(context: CreatorStudioContext, commandId: string, requestHash: string, result: T): CommandResult<T> {
    this.commands.set(this.commandKey(context, commandId), { hash: requestHash, result: clone(result) });
    return { value: clone(result), replayed: false };
  }

  private validateFile(mimeType: string, byteSize: number): void {
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(mimeType)) throw new CreatorStudioError("file_not_allowed", "File type is not allowed");
    if (!Number.isInteger(byteSize) || byteSize < 1 || byteSize > MAX_UPLOAD_BYTES) {
      throw new CreatorStudioError("file_too_large", "File is too large");
    }
  }

  private refreshWorkItemValidation(workItem: WorkItem): void {
    const draft = this.drafts.get(workItem.id) ?? null;
    workItem.draft = draft ? clone(draft) : null;
    workItem.validation = this.workItemValidation(workItem);
  }

  private workItemValidation(workItem: WorkItem) {
    const draft = this.drafts.get(workItem.id) ?? null;
    return {
      caption: !workItem.requirements.caption || Boolean(draft?.caption?.trim()),
      externalUrl: !workItem.requirements.externalUrl || Boolean(draft?.externalUrl),
      checklist: workItem.requirements.checklist.every((key) => draft?.checklist[key] === true),
      assets: !workItem.requiresAsset || workItem.assets.some((asset) => asset.state === "finalized"),
    };
  }

  private isReady(workItem: WorkItem): boolean {
    return Object.values(workItem.validation).every(Boolean);
  }

  private extensionForMime(mimeType: string): string {
    const extension = ALLOWED_UPLOAD_EXTENSIONS.get(mimeType);
    if (!extension) throw new CreatorStudioError("file_not_allowed", "File type is not allowed");
    return extension;
  }

  private requireEditableAssetWorkItem(workItem: WorkItem): void {
    if (workItem.state === "not_started" || workItem.state === "drafting"
      || workItem.state === "ready_to_submit" || workItem.state === "changes_requested") return;
    throw new CreatorStudioError("invalid_transition", "This work item cannot accept asset changes");
  }

  private refreshEditableWorkItemState(workItem: WorkItem): void {
    if (workItem.state === "changes_requested") return;
    workItem.state = this.isReady(workItem) ? "ready_to_submit" : "drafting";
  }

  private refreshWorkflow(): void {
    const states = this.workspace.workItems.map((item) => item.state);
    const state: WorkItemState = states.includes("changes_requested") ? "changes_requested"
      : states.length > 0 && states.every((candidate) => candidate === "approved") ? "approved"
      : states.includes("resubmitted") ? "resubmitted"
      : states.includes("submitted") ? "submitted"
      : states.includes("ready_to_submit") ? "ready_to_submit"
      : states.includes("drafting") ? "drafting"
      : "not_started";
    this.workspace.workflow = { ...this.workspace.workflow, state, revision: this.workspace.workflow.revision + 1 };
    this.refreshNextAction();
  }

  private refreshNextAction(): void {
    const workItem = [...this.workspace.workItems]
      .sort((left, right) => left.position - right.position)
      .find((candidate) => candidate.state !== "approved");
    if (!workItem) {
      this.workspace.nextAction = null;
      return;
    }

    const label = {
      not_started: `Start ${workItem.title}`,
      drafting: `Continue ${workItem.title}`,
      ready_to_submit: `Submit ${workItem.title}`,
      submitted: `Await review for ${workItem.title}`,
      changes_requested: `Revise ${workItem.title}`,
      resubmitted: `Await review for ${workItem.title}`,
      approved: `Review ${workItem.title}`,
    } satisfies Record<WorkItemState, string>;
    this.workspace.nextAction = { workItemId: workItem.id, state: workItem.state, label: label[workItem.state] };
  }

  private recordEvent(
    type: CreatorStudioEvent["type"],
    workItemId: string,
    metadata: CreatorStudioEvent["metadata"],
  ): void {
    this.eventLog.push({ id: `event-${++this.sequence}`, type, workItemId, workflowId: this.workspace.workflow.id, metadata });
  }
}
