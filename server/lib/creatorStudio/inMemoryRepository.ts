import { hashCommand } from "./command.js";
import { CreatorStudioError } from "./errors.js";
import type { CreatorStudioRepository } from "./repository.js";
import {
  validatePublicationProofPlatform,
  validatePublicationProofUrl,
} from "./publicationProof.js";
import type {
  PublicationProofAttempt,
  PublicationProofEvidence,
  PublicationProofMetadata,
} from "./publicationProof.js";
import {
  CREATOR_STUDIO_MAX_COMMAND_ID_LENGTH,
  CREATOR_STUDIO_MAX_UPLOAD_BYTES,
  CREATOR_STUDIO_UPLOAD_MIME_TYPES,
  isStrictHttpUrl,
} from "./types.js";
import type {
  CommandResult,
  CreatePublicationProofAttemptInput,
  CreateProofEvidenceGrantInput,
  CreateUploadGrantInput,
  CreatorStudioContext,
  CreatorStudioEvent,
  DraftAsset,
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
  metadataResolver?: PublicationProofMetadataResolver;
};

export type PublicationProofMetadataResolver = (input: {
  publishedUrl: string;
  platform: string;
}) => Promise<PublicationProofMetadata | null>;

const ALLOWED_UPLOAD_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["video/mp4", "mp4"],
  ["application/pdf", "pdf"],
]);

const ALLOWED_PROOF_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
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
  private readonly metadataResolver?: PublicationProofMetadataResolver;
  private sequence = 0;
  private proofAttemptSequence = 0;
  private proofEvidenceSequence = 0;

  constructor(options: InMemoryCreatorStudioRepositoryOptions) {
    this.workspace = clone(options.workspace);
    this.metadataResolver = options.metadataResolver;
    for (const workItem of this.workspace.workItems) {
      if (workItem.draft) {
        this.drafts.set(workItem.id, clone(workItem.draft));
        this.draftVersions.set(workItem.id, [clone(workItem.draft)]);
      }
      for (const asset of workItem.assets) this.assets.set(asset.id, clone(asset));
      for (const attempt of [
        ...(workItem.publicationProof.currentAttempt ? [workItem.publicationProof.currentAttempt] : []),
        ...workItem.publicationProof.history,
      ]) {
        const attemptNumber = Number(attempt.id.match(/^proof-attempt-(\d+)$/)?.[1] ?? 0);
        if (attemptNumber > this.proofAttemptSequence) this.proofAttemptSequence = attemptNumber;
        for (const evidence of attempt.evidence) {
          const evidenceNumber = Number(evidence.id.match(/^proof-evidence-(\d+)$/)?.[1] ?? 0);
          if (evidenceNumber > this.proofEvidenceSequence) this.proofEvidenceSequence = evidenceNumber;
        }
      }
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
    this.validateDraftInput(input);

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
    this.validateUploadGrantInput(input);
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
    this.recordEvent("asset.reserved", workItem.id, { assetId: asset.id });
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
    this.validateFinalizeInput(input);

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
    this.validateExpectedVersion(input.expectedVersion);

    const draft = this.drafts.get(workItem.id);
    if (!draft) throw new CreatorStudioError("invalid_transition", "Complete the required draft fields and assets");
    if (input.expectedVersion !== draft.version) throw new CreatorStudioError("version_conflict", "The draft was updated elsewhere");
    const validation = this.workItemValidation(workItem);
    if (!Object.values(validation).every(Boolean)) {
      throw new CreatorStudioError("invalid_transition", "Complete the required draft fields and assets");
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

  async createPublicationProofAttempt(
    context: CreatorStudioContext,
    workItemId: string,
    input: CreatePublicationProofAttemptInput,
  ): Promise<CommandResult<PublicationProofAttempt>> {
    this.requireCommand(input.commandId);
    const workItem = this.requireWorkItem(context, workItemId);
    const payload = { type: "create_publication_proof_attempt", context, workItemId, input };
    const requestHash = hashCommand(payload);
    const replay = this.replay<PublicationProofAttempt>(context, input.commandId, requestHash);
    if (replay) return replay;

    const requirement = this.requireProofRequirement(workItem);
    const publishedUrl = this.validateProofUrl(input.publishedUrl);
    const platform = this.normalizeProofPlatform(input.platform, requirement.allowedPlatforms);
    const current = workItem.publicationProof.currentAttempt;

    if (current?.state === "draft") {
      current.publishedUrl = publishedUrl;
      current.platform = platform;
      current.metadataState = "pending";
      current.metadata = null;
      this.refreshProofDerivedState(workItem);
      const result = clone(current);
      this.recordEvent("proof.attempt_created", workItem.id, { attemptId: current.id, sequence: current.sequence });
      return this.commit(context, input.commandId, requestHash, result);
    }

    const parent = current ?? workItem.publicationProof.history.at(-1) ?? null;
    const attempt: PublicationProofAttempt = {
      id: `proof-attempt-${++this.proofAttemptSequence}`,
      workItemId: workItem.id,
      parentAttemptId: parent?.id ?? null,
      sequence: (parent?.sequence ?? 0) + 1,
      publishedUrl,
      platform,
      state: "draft",
      metadataState: "pending",
      metadata: null,
      operatorMessage: null,
      submittedAt: null,
      decidedAt: null,
      evidence: [],
    };
    workItem.publicationProof = {
      required: true,
      currentAttempt: attempt,
      history: current
        ? [...workItem.publicationProof.history, clone(current)]
        : [...workItem.publicationProof.history],
    };
    this.refreshProofDerivedState(workItem);
    this.recordEvent("proof.attempt_created", workItem.id, { attemptId: attempt.id, sequence: attempt.sequence });
    return this.commit(context, input.commandId, requestHash, clone(attempt));
  }

  async createProofEvidenceGrant(
    context: CreatorStudioContext,
    workItemId: string,
    attemptId: string,
    input: CreateProofEvidenceGrantInput,
  ): Promise<CommandResult<UploadGrant>> {
    this.requireCommand(input.commandId);
    const workItem = this.requireWorkItem(context, workItemId);
    const payload = { type: "create_proof_evidence_grant", context, workItemId, attemptId, input };
    const requestHash = hashCommand(payload);
    const replay = this.replay<UploadGrant>(context, input.commandId, requestHash);
    if (replay) return replay;

    const attempt = this.requireEditableProofAttempt(workItem, attemptId);
    this.validateProofFile(input.fileName, input.mimeType, input.byteSize);
    const evidenceId = `proof-evidence-${++this.proofEvidenceSequence}`;
    const extension = this.proofExtensionForMime(input.mimeType);
    const evidence: PublicationProofEvidence = {
      id: evidenceId,
      attemptId: attempt.id,
      storagePath: `${context.actorId}/${this.workspace.workflow.id}/${workItem.id}/proof-evidence/${evidenceId}.${extension}`,
      mimeType: input.mimeType as PublicationProofEvidence["mimeType"],
      byteSize: input.byteSize,
      checksumSha256: null,
      status: "pending",
    };
    attempt.evidence.push(evidence);
    this.refreshProofDerivedState(workItem);
    const result: UploadGrant = {
      bucket: "mission-publication-proof-assets",
      path: evidence.storagePath,
      token: `memory-proof-upload-token-${evidence.id}`,
      assetId: evidence.id,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
    this.recordEvent("proof.evidence_reserved", workItem.id, { attemptId: attempt.id, evidenceId: evidence.id });
    return this.commit(context, input.commandId, requestHash, result);
  }

  async finalizeProofEvidence(
    context: CreatorStudioContext,
    workItemId: string,
    attemptId: string,
    evidenceId: string,
    input: FinalizeProofEvidenceInput,
  ): Promise<CommandResult<PublicationProofEvidence>> {
    this.requireCommand(input.commandId);
    const workItem = this.requireWorkItem(context, workItemId);
    const payload = { type: "finalize_proof_evidence", context, workItemId, attemptId, evidenceId, input };
    const requestHash = hashCommand(payload);
    const replay = this.replay<PublicationProofEvidence>(context, input.commandId, requestHash);
    if (replay) return replay;

    const attempt = this.requireEditableProofAttempt(workItem, attemptId);
    const evidence = attempt.evidence.find((candidate) => candidate.id === evidenceId);
    if (!evidence) throw new CreatorStudioError("proof_evidence_invalid", "Evidence was not found");
    if (evidence.status !== "pending") throw new CreatorStudioError("proof_evidence_invalid", "Evidence is already finalized");
    this.validateProofFile(evidence.id, input.mimeType, input.byteSize);
    if (evidence.byteSize !== input.byteSize || evidence.mimeType !== input.mimeType) {
      throw new CreatorStudioError("proof_evidence_invalid", "Uploaded evidence metadata did not match the reservation");
    }
    if (input.checksumSha256 !== null && (typeof input.checksumSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(input.checksumSha256))) {
      throw new CreatorStudioError("proof_evidence_invalid", "Evidence checksum is invalid");
    }

    evidence.status = "finalized";
    evidence.checksumSha256 = input.checksumSha256;
    this.refreshProofDerivedState(workItem);
    this.recordEvent("proof.evidence_finalized", workItem.id, { attemptId: attempt.id, evidenceId: evidence.id });
    return this.commit(context, input.commandId, requestHash, clone(evidence));
  }

  async submitPublicationProof(
    context: CreatorStudioContext,
    workItemId: string,
    attemptId: string,
    input: SubmitPublicationProofInput,
  ): Promise<CommandResult<PublicationProofAttempt>> {
    this.requireCommand(input.commandId);
    const workItem = this.requireWorkItem(context, workItemId);
    const payload = { type: "submit_publication_proof", context, workItemId, attemptId, input };
    const requestHash = hashCommand(payload);
    const replay = this.replay<PublicationProofAttempt>(context, input.commandId, requestHash);
    if (replay) return replay;

    const attempt = this.requireEditableProofAttempt(workItem, attemptId);
    if (attempt.evidence.some((evidence) => evidence.status !== "finalized")) {
      throw new CreatorStudioError("proof_evidence_invalid", "Finalize or remove pending evidence before submitting");
    }
    attempt.state = "submitted";
    attempt.submittedAt = new Date().toISOString();
    this.refreshProofDerivedState(workItem);
    this.recordEvent("proof.submitted", workItem.id, { attemptId: attempt.id, state: attempt.state });
    return this.commit(context, input.commandId, requestHash, clone(attempt));
  }

  async refreshProofMetadata(
    context: CreatorStudioContext,
    workItemId: string,
    attemptId: string,
    input: RefreshProofMetadataInput,
  ): Promise<CommandResult<PublicationProofAttempt>> {
    this.requireCommand(input.commandId);
    const workItem = this.requireWorkItem(context, workItemId);
    const payload = { type: "refresh_proof_metadata", context, workItemId, attemptId, input };
    const requestHash = hashCommand(payload);
    const replay = this.replay<PublicationProofAttempt>(context, input.commandId, requestHash);
    if (replay) return replay;

    const attempt = this.findProofAttempt(workItem, attemptId);
    if (!attempt || workItem.publicationProof.currentAttempt?.id !== attempt.id) {
      throw new CreatorStudioError("proof_attempt_immutable", "Only the current proof attempt can be refreshed");
    }
    if (attempt.state !== "draft") {
      throw new CreatorStudioError("proof_attempt_immutable", "Only the current draft proof attempt can be refreshed");
    }

    let metadataState: PublicationProofAttempt["metadataState"];
    let metadata: PublicationProofMetadata | null = null;
    if (!this.metadataResolver) {
      metadataState = "unavailable";
    } else {
      try {
        const resolved = await this.metadataResolver({
          publishedUrl: attempt.publishedUrl,
          platform: attempt.platform ?? "",
        });
        metadataState = resolved ? "available" : "unavailable";
        metadata = resolved;
      } catch {
        metadataState = "failed";
      }
    }
    attempt.metadataState = metadataState;
    attempt.metadata = metadata;
    this.refreshProofDerivedState(workItem);
    this.recordEvent("proof.metadata_refreshed", workItem.id, { attemptId: attempt.id, metadataState });
    return this.commit(context, input.commandId, requestHash, clone(attempt));
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
    if (typeof commandId !== "string" || !commandId.trim() || commandId.length > CREATOR_STUDIO_MAX_COMMAND_ID_LENGTH) {
      throw new CreatorStudioError("command_required", "commandId is required");
    }
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
    if (!(CREATOR_STUDIO_UPLOAD_MIME_TYPES as readonly string[]).includes(mimeType)) {
      throw new CreatorStudioError("file_not_allowed", "File type is not allowed");
    }
    if (!Number.isInteger(byteSize) || byteSize < 1 || byteSize > CREATOR_STUDIO_MAX_UPLOAD_BYTES) {
      throw new CreatorStudioError("file_too_large", "File is too large");
    }
  }

  private validateDraftInput(input: SaveDraftInput): void {
    this.validateExpectedVersion(input.expectedVersion);
    const patch = input.patch;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new CreatorStudioError("draft_invalid", "Draft patch is invalid");
    }
    if (patch.caption !== undefined && typeof patch.caption !== "string") {
      throw new CreatorStudioError("draft_invalid", "Draft caption is invalid");
    }
    if (patch.externalUrl !== undefined && patch.externalUrl !== null) {
      if (typeof patch.externalUrl !== "string" || !isStrictHttpUrl(patch.externalUrl)) {
        throw new CreatorStudioError("draft_invalid", "Draft URL is invalid");
      }
    }
    if (patch.checklist !== undefined) {
      if (!patch.checklist || typeof patch.checklist !== "object" || Array.isArray(patch.checklist)
        || !Object.values(patch.checklist).every((value) => typeof value === "boolean")) {
        throw new CreatorStudioError("draft_invalid", "Draft checklist is invalid");
      }
    }
  }

  private validateUploadGrantInput(input: CreateUploadGrantInput): void {
    if (typeof input.fileName !== "string" || !input.fileName.trim() || input.fileName.length > 255) {
      throw new CreatorStudioError("file_not_allowed", "File name is invalid");
    }
  }

  private validateFinalizeInput(input: FinalizeAssetInput): void {
    if (input.checksumSha256 !== null && (typeof input.checksumSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(input.checksumSha256))) {
      throw new CreatorStudioError("asset_not_uploaded", "Asset checksum is invalid");
    }
    this.validateFile(input.mimeType, input.byteSize);
  }

  private validateExpectedVersion(expectedVersion: number): void {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      throw new CreatorStudioError("draft_invalid", "Draft version is invalid");
    }
  }

  private requireProofRequirement(workItem: WorkItem): NonNullable<WorkItem["proofRequirement"]> {
    if (!workItem.proofRequirement || workItem.proofRequirement.kind !== "publication_url") {
      throw new CreatorStudioError("proof_attempt_transition_invalid", "Publication proof is not required for this work item");
    }
    return workItem.proofRequirement;
  }

  private validateProofUrl(publishedUrl: string): string {
    if (typeof publishedUrl !== "string" || !validatePublicationProofUrl(publishedUrl)) {
      throw new CreatorStudioError("proof_url_invalid", "Publication URL must be a valid HTTPS URL");
    }
    return publishedUrl.trim();
  }

  private normalizeProofPlatform(platform: string, allowedPlatforms: string[]): string {
    if (typeof platform !== "string" || !validatePublicationProofPlatform(platform, allowedPlatforms)) {
      throw new CreatorStudioError("proof_platform_invalid", "Publication platform is not allowed");
    }
    const normalizedPlatform = platform.trim().toLowerCase();
    return allowedPlatforms.find((allowed) => allowed.trim().toLowerCase() === normalizedPlatform)?.trim() ?? normalizedPlatform;
  }

  private findProofAttempt(workItem: WorkItem, attemptId: string): PublicationProofAttempt | null {
    if (workItem.publicationProof.currentAttempt?.id === attemptId) return workItem.publicationProof.currentAttempt;
    return workItem.publicationProof.history.find((attempt) => attempt.id === attemptId) ?? null;
  }

  private requireEditableProofAttempt(workItem: WorkItem, attemptId: string): PublicationProofAttempt {
    const attempt = this.findProofAttempt(workItem, attemptId);
    if (!attempt || workItem.publicationProof.currentAttempt?.id !== attempt.id || attempt.state !== "draft") {
      throw new CreatorStudioError("proof_attempt_immutable", "Only the current draft proof attempt can be edited");
    }
    return attempt;
  }

  private validateProofFile(fileName: string, mimeType: string, byteSize: number): void {
    if (typeof fileName !== "string" || !fileName.trim() || fileName.length > 255) {
      throw new CreatorStudioError("proof_evidence_invalid", "Evidence file name is invalid");
    }
    if (!ALLOWED_PROOF_EXTENSIONS.has(mimeType)) {
      throw new CreatorStudioError("proof_evidence_invalid", "Evidence file type is not allowed");
    }
    if (!Number.isInteger(byteSize) || byteSize < 1 || byteSize > CREATOR_STUDIO_MAX_UPLOAD_BYTES) {
      throw new CreatorStudioError("proof_evidence_invalid", "Evidence file size is invalid");
    }
  }

  private proofExtensionForMime(mimeType: string): string {
    const extension = ALLOWED_PROOF_EXTENSIONS.get(mimeType);
    if (!extension) throw new CreatorStudioError("proof_evidence_invalid", "Evidence file type is not allowed");
    return extension;
  }

  private refreshProofDerivedState(workItem: WorkItem): void {
    this.refreshWorkItemValidation(workItem);
    this.refreshEditableWorkItemState(workItem);
    this.refreshWorkflow();
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
      externalUrl: !workItem.requirements.externalUrl || isStrictHttpUrl(draft?.externalUrl ?? ""),
      checklist: workItem.requirements.checklist.every((key) => draft?.checklist[key] === true),
      assets: !workItem.requiresAsset || workItem.assets.some((asset) => asset.state === "finalized"),
      publicationProof: workItem.proofRequirement?.kind !== "publication_url"
        || workItem.publicationProof.currentAttempt?.state === "submitted"
        || workItem.publicationProof.currentAttempt?.state === "verified",
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
    if (workItem.state !== "not_started" && workItem.state !== "drafting"
      && workItem.state !== "ready_to_submit" && workItem.state !== "changes_requested") return;
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

    const proofAttempt = workItem.publicationProof.currentAttempt;
    if (workItem.publicationProof.required) {
      if (!proofAttempt || proofAttempt.state === "draft") {
        this.workspace.nextAction = { workItemId: workItem.id, state: workItem.state, label: `Submit proof for ${workItem.title}` };
        return;
      }
      if (proofAttempt.state === "submitted") {
        this.workspace.nextAction = { workItemId: workItem.id, state: workItem.state, label: `Awaiting operator verification for ${workItem.title}` };
        return;
      }
      if (proofAttempt.state === "changes_requested") {
        this.workspace.nextAction = { workItemId: workItem.id, state: workItem.state, label: `Create corrected proof attempt for ${workItem.title}` };
        return;
      }
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
