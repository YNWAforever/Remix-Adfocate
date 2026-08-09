import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { CreatorStudioError } from "./errors.js";
import type { CreatorStudioRepository } from "./repository.js";
import type {
  CommandResult,
  CancelProofEvidenceInput,
  CancelledProofEvidence,
  CreatePublicationProofAttemptInput,
  CreateProofEvidenceGrantInput,
  CreateUploadGrantInput,
  CreatorStudioContext,
  DraftCommandResult,
  DraftAsset,
  FinalizeAssetInput,
  FinalizedAsset,
  FinalizeProofEvidenceInput,
  MissionBrief,
  MissionSubmissionStatus,
  NextAction,
  OptionalSection,
  ReviewFeedback,
  RefreshProofMetadataInput,
  SaveDraftInput,
  SubmissionSummary,
  SubmissionWorkspace,
  SubmittedWorkItem,
  SubmitPublicationProofInput,
  SubmitWorkItemInput,
  UploadGrant,
  WorkItem,
  WorkItemRequirements,
  WorkItemState,
  WorkingDraft,
} from "./types.js";
import { isStrictHttpUrl } from "./types.js";
import { hashCommand } from "./command.js";
import { recordCreatorStudioEvent, type CreatorStudioMetricsSink } from "./metrics.js";
import { PROOF_ATTEMPT_STATES, PROOF_METADATA_STATES, validatePublicationProofUrl } from "./publicationProof.js";
import type {
  PublicationProofAttempt,
  PublicationProofEvidence,
  PublicationProofMetadata,
  PublicationProofRequirement,
  PublicationProofSnapshot,
} from "./publicationProof.js";

type Row = Record<string, unknown>;

const studioStates = new Set<WorkItemState>([
  "not_started", "drafting", "ready_to_submit", "submitted", "changes_requested", "resubmitted", "approved",
]);
const submissionStates = new Set<MissionSubmissionStatus>([
  "applied", "joined", "submitted", "under_review", "approved", "rejected", "expired", "declined",
]);
const proofAttemptStates = new Set<string>(PROOF_ATTEMPT_STATES);
const proofMetadataStates = new Set<string>(PROOF_METADATA_STATES);
const proofEvidenceMimes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const proofEvidenceStates = new Set(["pending", "finalized"]);
const proofEvidenceExtensions = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["application/pdf", "pdf"],
]);
const escapeRegExp = (value: string): string => value.replace(/[.*+?^$()|[\]\\]/g, "\\$&");

const asRow = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const text = (row: Row, key: string, fallback = ""): string => typeof row[key] === "string" ? row[key] : fallback;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const bool = (value: unknown): boolean => value === true;
const requirementKey = (value: string): string => value.trim().toLowerCase().replace(/[\s_-]+/g, "");

function mapRequirements(value: unknown): WorkItemRequirements {
  const snapshot = asRow(value);
  if (Array.isArray(snapshot.requirements)) {
    const requirements = strings(snapshot.requirements);
    return {
      caption: requirements.some((requirement) => requirementKey(requirement) === "caption"),
      externalUrl: requirements.some((requirement) => requirementKey(requirement) === "externalurl"),
      checklist: requirements.filter((requirement) => {
        const key = requirementKey(requirement);
        return key !== "caption" && key !== "externalurl";
      }),
    };
  }

  const requirements = asRow(snapshot.requirements);
  const domainRequirements = Object.keys(requirements).length > 0 ? requirements : snapshot;
  return {
    caption: bool(domainRequirements.caption),
    externalUrl: bool(domainRequirements.externalUrl) || bool(domainRequirements.external_url),
    checklist: strings(domainRequirements.checklist),
  };
}

function mapState(value: unknown): WorkItemState {
  return typeof value === "string" && studioStates.has(value as WorkItemState) ? value as WorkItemState : "not_started";
}

function mapSubmissionStatus(value: unknown): MissionSubmissionStatus {
  return typeof value === "string" && submissionStates.has(value as MissionSubmissionStatus)
    ? value as MissionSubmissionStatus
    : "joined";
}

function mapDraft(row: Row | undefined): WorkingDraft | null {
  if (!row) return null;
  return {
    caption: typeof row.caption === "string" ? row.caption : null,
    externalUrl: typeof row.external_url === "string" ? row.external_url : null,
    checklist: asRow(row.checklist) as Record<string, boolean>,
    version: typeof row.version === "number" ? row.version : 0,
    updatedAt: text(row, "updated_at"),
  };
}

function mapAsset(row: Row): DraftAsset {
  return {
    id: text(row, "id"),
    fileName: text(row, "original_filename"),
    mimeType: text(row, "mime_type"),
    byteSize: typeof row.byte_size === "number" ? row.byte_size : Number(row.byte_size ?? 0),
    checksumSha256: typeof row.checksum_sha256 === "string" ? row.checksum_sha256 : null,
    state: row.upload_state === "finalized" ? "finalized" : "pending",
    storagePath: text(row, "storage_object_path"),
  };
}

function mapProofRequirement(value: unknown): PublicationProofRequirement | null {
  if (value === undefined) {
    throw new Error("Creator Studio publication proof returned a missing requirement");
  }
  if (value === null) return null;
  if (!isRow(value) || value.kind !== "publication_url") {
    throw new Error("Creator Studio publication proof returned an invalid requirement");
  }
  const row = value;
  const rawAllowedPlatforms = row.allowedPlatforms ?? row.allowed_platforms;
  if (!Array.isArray(rawAllowedPlatforms)
    || rawAllowedPlatforms.length === 0
    || !rawAllowedPlatforms.every((platform) => typeof platform === "string" && platform.trim().length > 0)
    || row.evidence !== "optional") {
    throw new Error("Creator Studio publication proof returned an invalid requirement");
  }
  const allowedPlatforms = rawAllowedPlatforms as string[];
  return { kind: "publication_url", allowedPlatforms, evidence: "optional" };
}

function mapProofMetadata(value: unknown): PublicationProofMetadata | null {
  if (value === null || value === undefined) return null;
  if (!isRow(value)) throw new Error("Creator Studio publication proof returned invalid metadata");
  const title = value.title;
  const author = value.author;
  const publishedAt = value.publishedAt ?? value.published_at;
  if ((title !== null && title !== undefined && typeof title !== "string")
    || (author !== null && author !== undefined && typeof author !== "string")
    || (publishedAt !== null && publishedAt !== undefined && typeof publishedAt !== "string")) {
    throw new Error("Creator Studio publication proof returned invalid metadata");
  }
  return {
    title: typeof title === "string" ? title : null,
    author: typeof author === "string" ? author : null,
    publishedAt: typeof publishedAt === "string" ? publishedAt : null,
  };
}

function mapProofEvidence(row: Row): PublicationProofEvidence {
  const mimeType = text(row, "mime_type");
  if (!proofEvidenceMimes.has(mimeType)) throw new Error("Creator Studio proof evidence returned an invalid MIME type");
  if (!proofEvidenceStates.has(text(row, "upload_state"))) {
    throw new Error("Creator Studio proof evidence returned an invalid upload state");
  }
  const byteSize = typeof row.byte_size === "number" ? row.byte_size : Number(row.byte_size ?? Number.NaN);
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > 52_428_800) {
    throw new Error("Creator Studio proof evidence returned an invalid byte size");
  }
  const id = text(row, "id");
  const attemptId = text(row, "mission_publication_proof_attempt_id", text(row, "attempt_id"));
  const storagePath = text(row, "storage_object_path");
  if (!id || !attemptId || !storagePath) {
    throw new Error("Creator Studio proof evidence returned incomplete lineage");
  }
  if (row.content_checksum !== null && row.content_checksum !== undefined && typeof row.content_checksum !== "string") {
    throw new Error("Creator Studio proof evidence returned an invalid checksum");
  }
  return {
    id,
    attemptId,
    storagePath,
    mimeType: mimeType as PublicationProofEvidence["mimeType"],
    byteSize,
    checksumSha256: typeof row.content_checksum === "string" ? row.content_checksum : null,
    status: row.upload_state === "finalized" ? "finalized" : "pending",
  };
}

function mapProofAttempt(row: Row, evidenceRows: Row[] = []): PublicationProofAttempt {
  if (typeof row.state !== "string" || !proofAttemptStates.has(row.state)) {
    throw new Error("Creator Studio publication proof returned an invalid attempt state");
  }
  if (typeof row.metadata_state !== "string" || !proofMetadataStates.has(row.metadata_state)) {
    throw new Error("Creator Studio publication proof returned an invalid metadata state");
  }
  const state = row.state as PublicationProofAttempt["state"];
  const metadataState = row.metadata_state as PublicationProofAttempt["metadataState"];
  const id = text(row, "id");
  const workItemId = text(row, "mission_work_item_id", text(row, "work_item_id"));
  const publishedUrl = text(row, "published_url");
  const sequence = Number(row.sequence ?? Number.NaN);
  if (!id || !workItemId || !publishedUrl || !validatePublicationProofUrl(publishedUrl)
    || !Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("Creator Studio publication proof returned incomplete attempt data");
  }
  if (row.platform !== null && row.platform !== undefined && typeof row.platform !== "string") {
    throw new Error("Creator Studio publication proof returned an invalid platform");
  }
  if (row.operator_message !== null && row.operator_message !== undefined && typeof row.operator_message !== "string") {
    throw new Error("Creator Studio publication proof returned an invalid operator message");
  }
  if (row.submitted_at !== null && row.submitted_at !== undefined && typeof row.submitted_at !== "string") {
    throw new Error("Creator Studio publication proof returned an invalid submitted timestamp");
  }
  if (row.decided_at !== null && row.decided_at !== undefined && typeof row.decided_at !== "string") {
    throw new Error("Creator Studio publication proof returned an invalid decision timestamp");
  }
  if (row.parent_attempt_id !== null && row.parent_attempt_id !== undefined && typeof row.parent_attempt_id !== "string") {
    throw new Error("Creator Studio publication proof returned an invalid parent attempt");
  }
  let nestedEvidence = evidenceRows;
  if (Object.prototype.hasOwnProperty.call(row, "evidence")) {
    if (!Array.isArray(row.evidence)) {
      throw new Error("Creator Studio publication proof returned invalid evidence");
    }
    nestedEvidence = row.evidence.map(asRow);
  }
  return {
    id,
    workItemId: text(row, "mission_work_item_id", workItemId),
    parentAttemptId: typeof row.parent_attempt_id === "string" ? row.parent_attempt_id : null,
    sequence,
    publishedUrl,
    platform: typeof row.platform === "string" ? row.platform : null,
    state,
    metadataState,
    metadata: mapProofMetadata(row.metadata),
    operatorMessage: typeof row.operator_message === "string" ? row.operator_message : null,
    submittedAt: typeof row.submitted_at === "string" ? row.submitted_at : null,
    decidedAt: typeof row.decided_at === "string" ? row.decided_at : null,
    evidence: nestedEvidence.map(mapProofEvidence),
  };
}

function mapProofSnapshot(
  requirement: PublicationProofRequirement | null,
  attempts: PublicationProofAttempt[],
): PublicationProofSnapshot {
  if (!requirement && attempts.length > 0) {
    throw new Error("Creator Studio publication proof returned attempts without a requirement");
  }
  const ordered = [...attempts].sort((left, right) => right.sequence - left.sequence || right.id.localeCompare(left.id));
  return {
    required: requirement?.kind === "publication_url",
    currentAttempt: ordered[0] ?? null,
    history: ordered.slice(1),
  };
}

function mapCommandWorkItem(row: Row): WorkItem {
  const draft = mapDraft(isRow(row.draft) ? row.draft : undefined);
  const assets = Array.isArray(row.assets) ? row.assets.map(asRow).map(mapAsset) : [];
  const proofRequirement = mapProofRequirement(row.proof_requirement);
  const publicationProofRow = isRow(row.publication_proof) ? row.publication_proof : null;
  const proofSnapshot = publicationProofRow
    ? mapProofSnapshot(proofRequirement, [
      ...(isRow(publicationProofRow.currentAttempt) ? [mapProofAttempt(publicationProofRow.currentAttempt)] : []),
      ...(Array.isArray(publicationProofRow.history) ? publicationProofRow.history.map(asRow).map((attempt) => mapProofAttempt(attempt)) : []),
    ])
    : mapProofSnapshot(proofRequirement, []);
  const item: WorkItem = {
    id: text(row, "id"),
    position: Number(row.position ?? 0),
    title: text(row, "title"),
    instructions: text(row, "instructions"),
    requirements: mapRequirements(row.requirements),
    requiresAsset: bool(row.requires_asset),
    state: mapState(row.state),
    proofRequirement,
    validation: { caption: false, externalUrl: false, checklist: false, assets: false, publicationProof: false },
    draft,
    assets,
    publicationProof: proofSnapshot,
    reviewFeedback: { status: "unavailable", reason: "temporarily_unavailable" },
  };
  item.validation = validationFor(item);
  return item;
}

function mapCommandWorkflow(row: Row) {
  return {
    id: text(row, "id"),
    state: mapState(row.state),
    revision: typeof row.revision === "number" ? row.revision : Number(row.revision ?? 0),
  };
}

function isRow(value: unknown): value is Row {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredRow(value: unknown, label: string): Row {
  if (!isRow(value)) throw new Error(`Creator Studio command RPC returned no ${label}`);
  return value;
}

function validationFor(item: Pick<WorkItem, "requirements" | "requiresAsset" | "draft" | "assets" | "proofRequirement" | "publicationProof">) {
  return {
    caption: !item.requirements.caption || Boolean(item.draft?.caption?.trim()),
    externalUrl: !item.requirements.externalUrl || isStrictHttpUrl(item.draft?.externalUrl ?? ""),
    checklist: item.requirements.checklist.every((key) => item.draft?.checklist[key] === true),
    assets: !item.requiresAsset || item.assets.some((asset) => asset.state === "finalized"),
    publicationProof: item.proofRequirement?.kind !== "publication_url"
      || item.publicationProof.currentAttempt?.state === "submitted"
      || item.publicationProof.currentAttempt?.state === "verified",
  };
}

function nextActionFor(workItems: WorkItem[]): NextAction | null {
  const workItem = workItems.find((item) => item.state !== "approved");
  if (!workItem) return null;
  const state = workItem.state === "ready_to_submit" && !Object.values(workItem.validation).every(Boolean)
    ? "drafting"
    : workItem.state;
  const proofAttempt = workItem.publicationProof.currentAttempt;
  if (workItem.publicationProof.required) {
    if (!proofAttempt || proofAttempt.state === "draft") {
      return { workItemId: workItem.id, state, label: `Submit proof for ${workItem.title}` };
    }
    if (proofAttempt.state === "submitted") {
      return { workItemId: workItem.id, state, label: `Awaiting operator verification for ${workItem.title}` };
    }
    if (proofAttempt.state === "changes_requested") {
      return { workItemId: workItem.id, state, label: `Create corrected proof attempt for ${workItem.title}` };
    }
  }
  const label = {
    not_started: `Start ${workItem.title}`,
    drafting: `Continue ${workItem.title}`,
    ready_to_submit: `Submit ${workItem.title}`,
    submitted: `Await review for ${workItem.title}`,
    changes_requested: `Revise ${workItem.title}`,
    resubmitted: `Await review for ${workItem.title}`,
    approved: `Approved ${workItem.title}`,
  } satisfies Record<WorkItemState, string>;
  return { workItemId: workItem.id, state, label: label[state] };
}

export class SupabaseCreatorStudioRepository implements CreatorStudioRepository {
  constructor(private readonly client: SupabaseClient, private readonly metricsSink?: CreatorStudioMetricsSink) {}

  async getWorkspace(context: CreatorStudioContext): Promise<SubmissionWorkspace | null> {
    this.validateContext(context);
    try {
      const { data: submissionData, error: submissionError } = await this.client
        .from("mission_submissions")
        .select("id, creator_id, workspace_id, mission_id, status, missions!inner(id, title, description, deadline, deliverables, requirements, platforms, deliverable_specs)")
        .eq("id", context.submissionId)
        .eq("creator_id", context.actorId)
        .eq("workspace_id", context.workspaceId)
        .maybeSingle();
      if (submissionError) throw submissionError;
      if (!submissionData) return null;

      const submissionRow = asRow(submissionData);
      const missionValue = submissionRow.missions;
      const missionRow = asRow(Array.isArray(missionValue) ? missionValue[0] : missionValue);
      if (!text(missionRow, "id")) return null;

      const { data: workflowData, error: workflowError } = await this.client
        .from("mission_workflows")
        .select("id, state, revision")
        .eq("mission_submission_id", context.submissionId)
        .eq("creator_id", context.actorId)
        .eq("workspace_id", context.workspaceId)
        .maybeSingle();
      if (workflowError) throw workflowError;
      if (!workflowData) return null;

      const workflowRow = asRow(workflowData);
      const workflowId = text(workflowRow, "id");
      if (!workflowId) return null;

      const { data: workItemData, error: workItemError } = await this.client
        .from("mission_work_items")
        .select("id, position, title, instructions, requirements, requires_asset, proof_requirement, state")
        .eq("mission_workflow_id", workflowId)
        .eq("mission_submission_id", context.submissionId)
        .eq("creator_id", context.actorId)
        .eq("workspace_id", context.workspaceId)
        .order("position", { ascending: true })
        .order("id", { ascending: true });
      if (workItemError) throw workItemError;
      const workItemRows = (workItemData ?? []).map(asRow).sort((left, right) => (
        Number(left.position) - Number(right.position)
        || text(left, "id").localeCompare(text(right, "id"))
      ));
      const workItemIds = workItemRows.map((row) => text(row, "id")).filter(Boolean);

      const [draftRows, assetRows, reviewFeedback, proofAttemptRows, proofEvidenceRows] = await Promise.all([
        this.readDrafts(context, workItemIds),
        this.readAssets(context, workItemIds),
        this.readReviewFeedback(context, workItemIds),
        this.readPublicationProofAttempts(context, workItemIds),
        this.readPublicationProofEvidence(context, workItemIds),
      ]);
      const draftsByItemId = new Map(draftRows.map((row) => [text(row, "mission_work_item_id"), row]));
      const assetsByItemId = new Map<string, Row[]>();
      for (const assetRow of assetRows) {
        const itemId = text(assetRow, "mission_work_item_id");
        assetsByItemId.set(itemId, [...(assetsByItemId.get(itemId) ?? []), assetRow]);
      }
      const reviewsByItemId = new Map<string, ReviewFeedback[]>();
      if (reviewFeedback.status === "available") {
        for (const review of reviewFeedback.value) {
          reviewsByItemId.set(review.workItemId, [...(reviewsByItemId.get(review.workItemId) ?? []), review.value]);
        }
      }

      const evidenceByAttemptId = new Map<string, Row[]>();
      for (const evidenceRow of proofEvidenceRows) {
        const attemptId = text(evidenceRow, "mission_publication_proof_attempt_id");
        evidenceByAttemptId.set(attemptId, [...(evidenceByAttemptId.get(attemptId) ?? []), evidenceRow]);
      }
      const attemptsByItemId = new Map<string, PublicationProofAttempt[]>();
      for (const attemptRow of proofAttemptRows) {
        const attempt = mapProofAttempt(attemptRow, evidenceByAttemptId.get(text(attemptRow, "id")) ?? []);
        attemptsByItemId.set(attempt.workItemId, [...(attemptsByItemId.get(attempt.workItemId) ?? []), attempt]);
      }

      const workItems = workItemRows.map((row): WorkItem => {
        const id = text(row, "id");
        const draft = mapDraft(draftsByItemId.get(id));
        const assets = (assetsByItemId.get(id) ?? [])
          .sort((left, right) => (
            text(left, "created_at").localeCompare(text(right, "created_at"))
            || text(left, "id").localeCompare(text(right, "id"))
        ))
        .map(mapAsset);
        const proofRequirement = mapProofRequirement(row.proof_requirement);
        const publicationProof = mapProofSnapshot(proofRequirement, attemptsByItemId.get(id) ?? []);
        const item: WorkItem = {
          id,
          position: Number(row.position ?? 0),
          title: text(row, "title"),
          instructions: text(row, "instructions"),
          requirements: mapRequirements(row.requirements),
          requiresAsset: bool(row.requires_asset),
          state: mapState(row.state),
          proofRequirement,
          validation: { caption: false, externalUrl: false, checklist: false, assets: false, publicationProof: false },
          draft,
          assets,
          publicationProof,
          reviewFeedback: reviewFeedback.status === "available"
            ? { status: "available", value: reviewsByItemId.get(id) ?? [] }
            : reviewFeedback,
        };
        item.validation = validationFor(item);
        return item;
      });

      const submission: SubmissionSummary = {
        id: text(submissionRow, "id"),
        creatorId: text(submissionRow, "creator_id"),
        workspaceId: text(submissionRow, "workspace_id"),
        missionId: text(submissionRow, "mission_id"),
        status: mapSubmissionStatus(submissionRow.status),
        deadline: typeof missionRow.deadline === "string" ? missionRow.deadline : null,
      };
      const brief: MissionBrief = {
        missionId: text(missionRow, "id"),
        title: text(missionRow, "title"),
        description: typeof missionRow.description === "string" ? missionRow.description : null,
        deliverables: strings(missionRow.deliverables),
        requirements: strings(missionRow.requirements),
        platforms: strings(missionRow.platforms),
      };
      const workspace: SubmissionWorkspace = {
        submission,
        brief,
        workflow: {
          id: workflowId,
          state: mapState(workflowRow.state),
          revision: typeof workflowRow.revision === "number" ? workflowRow.revision : 0,
        },
        workItems,
        nextAction: nextActionFor(workItems),
      };
      return workspace;
    } catch (error) {
      if (error instanceof CreatorStudioError) throw error;
      throw this.repositoryError(error);
    }
  }

  async saveDraft(
    context: CreatorStudioContext,
    workItemId: string,
    input: SaveDraftInput,
  ): Promise<CommandResult<DraftCommandResult>> {
    this.validateContext(context);
    const payload = { type: "save_draft", context, workItemId, input };
    const response = await this.commandRpc("creator_studio_save_draft", {
      p_submission_id: context.submissionId,
      p_workspace_id: context.workspaceId,
      p_work_item_id: workItemId,
      p_command_id: input.commandId,
      p_request_hash: hashCommand(payload),
      p_expected_version: input.expectedVersion,
      p_patch: {
        ...(input.patch.caption === undefined ? {} : { caption: input.patch.caption }),
        ...(input.patch.externalUrl === undefined ? {} : { external_url: input.patch.externalUrl }),
        ...(input.patch.checklist === undefined ? {} : { checklist: input.patch.checklist }),
      },
    });
    try {
      const draft = mapDraft(requiredRow(response.draft, "draft"));
      if (!draft) throw new Error("Creator Studio command RPC returned no draft");
      const workItem = await this.hydratePublicationProof(
        context,
        workItemId,
        mapCommandWorkItem(requiredRow(response.work_item, "work item")),
      );
      const result = {
        replayed: response.replayed === true,
        value: {
          draft,
          workItem,
          workflow: mapCommandWorkflow(requiredRow(response.workflow, "workflow")),
        },
      };
      if (!result.replayed) this.record("draft_saved", context, workItemId, input.commandId);
      return result;
    } catch (error) {
      throw this.repositoryError(error);
    }
  }

  async createUploadGrant(
    context: CreatorStudioContext,
    workItemId: string,
    input: CreateUploadGrantInput,
  ): Promise<CommandResult<UploadGrant>> {
    this.validateContext(context);
    const payload = { type: "create_upload_grant", context, workItemId, input };
    const response = await this.commandRpc("creator_studio_create_upload_grant", {
      p_submission_id: context.submissionId,
      p_workspace_id: context.workspaceId,
      p_work_item_id: workItemId,
      p_command_id: input.commandId,
      p_request_hash: hashCommand(payload),
      p_file_name: input.fileName,
      p_mime_type: input.mimeType,
      p_byte_size: input.byteSize,
    });
    try {
      const grant = requiredRow(response.grant, "upload grant");
      const bucket = text(grant, "bucket");
      const path = text(grant, "path");
      const assetId = text(grant, "asset_id");
      const expiresAt = text(grant, "expires_at");
      if (!bucket || !path || !assetId || !expiresAt) throw new Error("Creator Studio grant RPC returned an invalid grant");
      const { data, error } = await this.client.storage.from(bucket).createSignedUploadUrl(path);
      if (error || !data?.token) {
        const correlationId = randomUUID();
        console.error("Creator Studio storage signing failed", { correlationId, error });
        throw new CreatorStudioError("storage_error", "Storage upload could not be prepared", correlationId);
      }
      return {
        replayed: response.replayed === true,
        value: { bucket, path, token: data.token, assetId, expiresAt },
      };
    } catch (error) {
      if (error instanceof CreatorStudioError) throw error;
      throw this.repositoryError(error);
    }
  }

  async finalizeAsset(
    context: CreatorStudioContext,
    workItemId: string,
    assetId: string,
    input: FinalizeAssetInput,
  ): Promise<CommandResult<FinalizedAsset>> {
    this.validateContext(context);
    const payload = { type: "finalize_asset", context, workItemId, assetId, input };
    const response = await this.commandRpc("creator_studio_finalize_asset", {
      p_submission_id: context.submissionId,
      p_workspace_id: context.workspaceId,
      p_work_item_id: workItemId,
      p_asset_id: assetId,
      p_command_id: input.commandId,
      p_request_hash: hashCommand(payload),
      p_byte_size: input.byteSize,
      p_mime_type: input.mimeType,
      p_checksum_sha256: input.checksumSha256,
    });
    try {
      const workItem = await this.hydratePublicationProof(
        context,
        workItemId,
        mapCommandWorkItem(requiredRow(response.work_item, "work item")),
      );
      const result = {
        replayed: response.replayed === true,
        value: {
          asset: mapAsset(requiredRow(response.asset, "asset")),
          workItem,
          workflow: mapCommandWorkflow(requiredRow(response.workflow, "workflow")),
        },
      };
      if (!result.replayed) this.record("asset_finalized", context, workItemId, input.commandId);
      return result;
    } catch (error) {
      throw this.repositoryError(error);
    }
  }

  async submitWorkItem(
    context: CreatorStudioContext,
    workItemId: string,
    input: SubmitWorkItemInput,
  ): Promise<CommandResult<SubmittedWorkItem>> {
    this.validateContext(context);
    const payload = { type: "submit_work_item", context, workItemId, input };
    const response = await this.commandRpc("creator_studio_submit_work_item", {
      p_submission_id: context.submissionId,
      p_workspace_id: context.workspaceId,
      p_work_item_id: workItemId,
      p_command_id: input.commandId,
      p_request_hash: hashCommand(payload),
      p_expected_version: input.expectedVersion,
    });
    try {
      const workItem = await this.hydratePublicationProof(
        context,
        workItemId,
        mapCommandWorkItem(requiredRow(response.work_item, "work item")),
      );
      const result = {
        replayed: response.replayed === true,
        value: {
          workItem,
          workflow: mapCommandWorkflow(requiredRow(response.workflow, "workflow")),
        },
      };
      if (!result.replayed) this.record(
        result.value.workItem.state === "resubmitted" ? "work_item_resubmitted" : "work_item_submitted",
        context,
        workItemId,
        input.commandId,
      );
      return result;
    } catch (error) {
      throw this.repositoryError(error);
    }
  }

  async createPublicationProofAttempt(
    context: CreatorStudioContext,
    workItemId: string,
    input: CreatePublicationProofAttemptInput,
  ): Promise<CommandResult<PublicationProofAttempt>> {
    this.validateContext(context);
    const payload = { type: "create_publication_proof_attempt", context, workItemId, input };
    const response = await this.commandRpc("creator_studio_create_publication_proof_attempt", {
      p_submission_id: context.submissionId,
      p_workspace_id: context.workspaceId,
      p_work_item_id: workItemId,
      p_command_id: input.commandId,
      p_request_hash: hashCommand(payload),
      p_published_url: input.publishedUrl,
      p_platform: input.platform,
    });
    try {
      return {
        replayed: response.replayed === true,
        value: mapProofAttempt(requiredRow(response.attempt, "publication proof attempt")),
      };
    } catch (error) {
      throw this.repositoryError(error);
    }
  }

  async createProofEvidenceGrant(
    context: CreatorStudioContext,
    workItemId: string,
    attemptId: string,
    input: CreateProofEvidenceGrantInput,
  ): Promise<CommandResult<UploadGrant>> {
    this.validateContext(context);
    const extension = proofEvidenceExtensions.get(input.mimeType);
    if (!extension
      || !input.fileName.trim()
      || input.fileName.length > 255
      || !Number.isSafeInteger(input.byteSize)
      || input.byteSize < 1
      || input.byteSize > 52_428_800) {
      throw new CreatorStudioError("proof_evidence_invalid", "Evidence file metadata is invalid");
    }
    const payload = { type: "create_proof_evidence_grant", context, workItemId, attemptId, input };
    const response = await this.commandRpc("creator_studio_create_proof_evidence_grant", {
      p_submission_id: context.submissionId,
      p_workspace_id: context.workspaceId,
      p_work_item_id: workItemId,
      p_attempt_id: attemptId,
      p_command_id: input.commandId,
      p_request_hash: hashCommand(payload),
      p_file_name: input.fileName,
      p_mime_type: input.mimeType,
      p_byte_size: input.byteSize,
    });
    try {
      const grant = requiredRow(response.grant, "proof evidence grant");
      const bucket = text(grant, "bucket");
      const path = text(grant, "path");
      const assetId = text(grant, "asset_id");
      const expiresAt = text(grant, "expires_at");
      const proofPath = new RegExp(
        "^" + escapeRegExp(context.actorId) + "/[^/]+/" + escapeRegExp(workItemId)
          + "/proof-evidence/[^/]+\\." + extension + "$",
        "i",
      );
      if (bucket !== "mission-publication-proof-assets"
        || !path
        || path.includes("..")
        || path.includes("\\")
        || !proofPath.test(path)
        || !assetId
        || !expiresAt
        || Number.isNaN(Date.parse(expiresAt))) {
        throw new CreatorStudioError("proof_evidence_invalid", "Evidence grant RPC returned an invalid grant");
      }
      const { data, error } = await this.client.storage.from(bucket).createSignedUploadUrl(path);
      if (error || !data?.token) {
        const correlationId = randomUUID();
        console.error("Creator Studio proof storage signing failed", { correlationId, error });
        throw new CreatorStudioError("storage_error", "Storage upload could not be prepared", correlationId);
      }
      return {
        replayed: response.replayed === true,
        value: { bucket, path, token: data.token, assetId, expiresAt },
      };
    } catch (error) {
      if (error instanceof CreatorStudioError) throw error;
      throw this.repositoryError(error);
    }
  }

  async finalizeProofEvidence(
    context: CreatorStudioContext,
    workItemId: string,
    attemptId: string,
    evidenceId: string,
    input: FinalizeProofEvidenceInput,
  ): Promise<CommandResult<PublicationProofEvidence>> {
    this.validateContext(context);
    const payload = { type: "finalize_proof_evidence", context, workItemId, attemptId, evidenceId, input };
    const response = await this.commandRpc("creator_studio_finalize_proof_evidence", {
      p_submission_id: context.submissionId,
      p_workspace_id: context.workspaceId,
      p_work_item_id: workItemId,
      p_attempt_id: attemptId,
      p_evidence_id: evidenceId,
      p_command_id: input.commandId,
      p_request_hash: hashCommand(payload),
      p_byte_size: input.byteSize,
      p_mime_type: input.mimeType,
      p_checksum_sha256: input.checksumSha256,
    });
    try {
      return {
        replayed: response.replayed === true,
        value: mapProofEvidence(requiredRow(response.evidence, "publication proof evidence")),
      };
    } catch (error) {
      throw this.repositoryError(error);
    }
  }

  async cancelProofEvidence(
    context: CreatorStudioContext,
    workItemId: string,
    attemptId: string,
    evidenceId: string,
    input: CancelProofEvidenceInput,
  ): Promise<CommandResult<CancelledProofEvidence>> {
    this.validateContext(context);
    const payload = { type: "cancel_proof_evidence", context, workItemId, attemptId, evidenceId, input };
    const response = await this.commandRpc("creator_studio_cancel_proof_evidence", {
      p_submission_id: context.submissionId,
      p_workspace_id: context.workspaceId,
      p_work_item_id: workItemId,
      p_attempt_id: attemptId,
      p_evidence_id: evidenceId,
      p_command_id: input.commandId,
      p_request_hash: hashCommand(payload),
    });
    try {
      const cancelledEvidenceId = text(response, "evidence_id");
      if (!cancelledEvidenceId || cancelledEvidenceId !== evidenceId) {
        throw new CreatorStudioError("proof_evidence_invalid", "Proof evidence cancellation returned an invalid id");
      }
      return {
        replayed: response.replayed === true,
        value: { evidenceId: cancelledEvidenceId },
      };
    } catch (error) {
      throw this.repositoryError(error);
    }
  }

  async submitPublicationProof(
    context: CreatorStudioContext,
    workItemId: string,
    attemptId: string,
    input: SubmitPublicationProofInput,
  ): Promise<CommandResult<PublicationProofAttempt>> {
    this.validateContext(context);
    const payload = { type: "submit_publication_proof", context, workItemId, attemptId, input };
    const response = await this.commandRpc("creator_studio_submit_publication_proof", {
      p_submission_id: context.submissionId,
      p_workspace_id: context.workspaceId,
      p_work_item_id: workItemId,
      p_attempt_id: attemptId,
      p_command_id: input.commandId,
      p_request_hash: hashCommand(payload),
    });
    try {
      return {
        replayed: response.replayed === true,
        value: mapProofAttempt(requiredRow(response.attempt, "publication proof attempt")),
      };
    } catch (error) {
      throw this.repositoryError(error);
    }
  }

  async refreshProofMetadata(
    context: CreatorStudioContext,
    workItemId: string,
    attemptId: string,
    input: RefreshProofMetadataInput,
  ): Promise<CommandResult<PublicationProofAttempt>> {
    this.validateContext(context);
    const payload = { type: "refresh_proof_metadata", context, workItemId, attemptId, input };
    const response = await this.commandRpc("creator_studio_refresh_proof_metadata", {
      p_submission_id: context.submissionId,
      p_workspace_id: context.workspaceId,
      p_work_item_id: workItemId,
      p_attempt_id: attemptId,
      p_command_id: input.commandId,
      p_request_hash: hashCommand(payload),
    });
    try {
      return {
        replayed: response.replayed === true,
        value: mapProofAttempt(requiredRow(response.attempt, "publication proof attempt")),
      };
    } catch (error) {
      throw this.repositoryError(error);
    }
  }

  private async readDrafts(context: CreatorStudioContext, workItemIds: string[]): Promise<Row[]> {
    if (workItemIds.length === 0) return [];
    const { data, error } = await this.client
      .from("mission_working_drafts")
      .select("mission_work_item_id, caption, external_url, checklist, version, updated_at")
      .eq("creator_id", context.actorId)
      .eq("workspace_id", context.workspaceId)
      .eq("mission_submission_id", context.submissionId)
      .in("mission_work_item_id", workItemIds);
    if (error) throw error;
    return (data ?? []).map(asRow);
  }

  private async readAssets(context: CreatorStudioContext, workItemIds: string[]): Promise<Row[]> {
    if (workItemIds.length === 0) return [];
    const { data, error } = await this.client
      .from("mission_draft_assets")
      .select("id, mission_work_item_id, original_filename, mime_type, byte_size, checksum_sha256, upload_state, storage_object_path, created_at")
      .eq("creator_id", context.actorId)
      .eq("workspace_id", context.workspaceId)
      .eq("mission_submission_id", context.submissionId)
      .in("mission_work_item_id", workItemIds)
      .in("upload_state", ["pending", "finalized"])
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(asRow);
  }

  private async readPublicationProofAttempts(context: CreatorStudioContext, workItemIds: string[]): Promise<Row[]> {
    if (workItemIds.length === 0) return [];
    const { data, error } = await this.client
      .from("mission_publication_proof_attempts")
      .select("id, mission_work_item_id, parent_attempt_id, sequence, published_url, platform, state, metadata_state, metadata, operator_message, submitted_at, decided_at")
      .eq("creator_id", context.actorId)
      .eq("workspace_id", context.workspaceId)
      .eq("mission_submission_id", context.submissionId)
      .in("mission_work_item_id", workItemIds)
      .order("sequence", { ascending: false })
      .order("id", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(asRow);
  }

  private async readPublicationProofEvidence(context: CreatorStudioContext, workItemIds: string[]): Promise<Row[]> {
    if (workItemIds.length === 0) return [];
    const { data, error } = await this.client
      .from("mission_publication_proof_assets")
      .select("id, mission_publication_proof_attempt_id, mission_work_item_id, storage_object_path, mime_type, byte_size, content_checksum, upload_state, created_at")
      .eq("creator_id", context.actorId)
      .eq("workspace_id", context.workspaceId)
      .eq("mission_submission_id", context.submissionId)
      .in("mission_work_item_id", workItemIds)
      .in("upload_state", ["pending", "finalized"])
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(asRow);
  }

  private async hydratePublicationProof(
    context: CreatorStudioContext,
    workItemId: string,
    item: WorkItem,
  ): Promise<WorkItem> {
    if (!item.proofRequirement) return item;
    const [attemptRows, evidenceRows] = await Promise.all([
      this.readPublicationProofAttempts(context, [workItemId]),
      this.readPublicationProofEvidence(context, [workItemId]),
    ]);
    const evidenceByAttemptId = new Map<string, Row[]>();
    for (const evidenceRow of evidenceRows) {
      const attemptId = text(evidenceRow, "mission_publication_proof_attempt_id");
      evidenceByAttemptId.set(attemptId, [...(evidenceByAttemptId.get(attemptId) ?? []), evidenceRow]);
    }
    const attempts = attemptRows.map((attemptRow) => mapProofAttempt(
      attemptRow,
      evidenceByAttemptId.get(text(attemptRow, "id")) ?? [],
    ));
    const hydrated = {
      ...item,
      publicationProof: mapProofSnapshot(item.proofRequirement, attempts),
    };
    hydrated.validation = validationFor(hydrated);
    return hydrated;
  }

  private async readReviewFeedback(
    context: CreatorStudioContext,
    workItemIds: string[],
  ): Promise<OptionalSection<Array<{ workItemId: string; value: ReviewFeedback }>>> {
    if (workItemIds.length === 0) return { status: "available", value: [] };
    const { data, error } = await this.client
      .from("mission_review_items")
      .select("id, mission_work_item_id, outcome, message, created_at")
      .eq("creator_id", context.actorId)
      .eq("workspace_id", context.workspaceId)
      .eq("mission_submission_id", context.submissionId)
      .in("mission_work_item_id", workItemIds)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) return { status: "unavailable", reason: "temporarily_unavailable" };
    return {
      status: "available",
      value: (data ?? []).map(asRow)
        .sort((left, right) => (
          text(left, "created_at").localeCompare(text(right, "created_at"))
          || text(left, "id").localeCompare(text(right, "id"))
        ))
        .map((row) => ({
          workItemId: text(row, "mission_work_item_id"),
          value: {
            id: text(row, "id"),
            state: row.outcome === "approved" ? "approved" : "changes_requested",
            message: text(row, "message"),
          },
        })),
    };
  }

  private validateContext(context: CreatorStudioContext): void {
    if (!context.actorId.trim() || !context.workspaceId.trim() || !context.submissionId.trim()) {
      throw new CreatorStudioError("submission_not_found", "Submission was not found");
    }
  }

  private record(
    name: "draft_saved" | "asset_finalized" | "work_item_submitted" | "work_item_resubmitted",
    context: CreatorStudioContext,
    workItemId: string,
    commandId: string,
  ): void {
    recordCreatorStudioEvent({
      name,
      workspaceId: context.workspaceId,
      submissionId: context.submissionId,
      workItemId,
      commandId,
      createdAt: new Date().toISOString(),
    }, this.metricsSink);
  }

  private async commandRpc(name: string, args: Record<string, unknown>): Promise<Row> {
    try {
      const { data, error } = await this.client.rpc(name, args);
      if (error) throw error;
      if (!isRow(data)) throw new Error("Creator Studio command RPC returned an invalid response");
      return data;
    } catch (error) {
      if (error instanceof CreatorStudioError) throw error;
      throw this.repositoryError(error);
    }
  }

  private repositoryError(error: unknown): CreatorStudioError {
    const correlationId = randomUUID();
    const message = error instanceof Error ? error.message : "";
    const safeCode = [
      "command_required", "command_conflict", "version_conflict", "submission_not_found", "work_item_not_found",
      "invalid_transition", "draft_invalid", "file_not_allowed", "file_too_large", "asset_not_found",
      "asset_not_uploaded", "asset_finalized", "proof_url_invalid", "proof_platform_invalid",
      "proof_attempt_immutable", "proof_attempt_transition_invalid", "proof_evidence_invalid",
      "proof_metadata_refresh_failed",
    ].find((candidate) => message.includes(candidate));
    if (safeCode) {
      return new CreatorStudioError(safeCode as ConstructorParameters<typeof CreatorStudioError>[0], "Creator Studio command was rejected");
    }
    console.error("Creator Studio repository operation failed", { correlationId, error });
    return new CreatorStudioError("db_error", "repository read failed", correlationId);
  }
}
