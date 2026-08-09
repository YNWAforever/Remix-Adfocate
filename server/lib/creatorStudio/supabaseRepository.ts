import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { CreatorStudioError } from "./errors.js";
import type { CreatorStudioRepository } from "./repository.js";
import type {
  CommandResult,
  CreateUploadGrantInput,
  CreatorStudioContext,
  DraftCommandResult,
  DraftAsset,
  FinalizeAssetInput,
  FinalizedAsset,
  MissionBrief,
  MissionSubmissionStatus,
  NextAction,
  OptionalSection,
  ReviewFeedback,
  SaveDraftInput,
  SubmissionSummary,
  SubmissionWorkspace,
  SubmittedWorkItem,
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

type Row = Record<string, unknown>;

const studioStates = new Set<WorkItemState>([
  "not_started", "drafting", "ready_to_submit", "submitted", "changes_requested", "resubmitted", "approved",
]);
const submissionStates = new Set<MissionSubmissionStatus>([
  "applied", "joined", "submitted", "under_review", "approved", "rejected", "expired", "declined",
]);

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

function mapCommandWorkItem(row: Row): WorkItem {
  const draft = mapDraft(isRow(row.draft) ? row.draft : undefined);
  const assets = Array.isArray(row.assets) ? row.assets.map(asRow).map(mapAsset) : [];
  const item: WorkItem = {
    id: text(row, "id"),
    position: Number(row.position ?? 0),
    title: text(row, "title"),
    instructions: text(row, "instructions"),
    requirements: mapRequirements(row.requirements),
    requiresAsset: bool(row.requires_asset),
    state: mapState(row.state),
    validation: { caption: false, externalUrl: false, checklist: false, assets: false },
    draft,
    assets,
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

function validationFor(item: Pick<WorkItem, "requirements" | "requiresAsset" | "draft" | "assets">) {
  return {
    caption: !item.requirements.caption || Boolean(item.draft?.caption?.trim()),
    externalUrl: !item.requirements.externalUrl || isStrictHttpUrl(item.draft?.externalUrl ?? ""),
    checklist: item.requirements.checklist.every((key) => item.draft?.checklist[key] === true),
    assets: !item.requiresAsset || item.assets.some((asset) => asset.state === "finalized"),
  };
}

function nextActionFor(workItems: WorkItem[]): NextAction | null {
  const workItem = workItems.find((item) => item.state !== "approved");
  if (!workItem) return null;
  const state = workItem.state === "ready_to_submit" && !Object.values(workItem.validation).every(Boolean)
    ? "drafting"
    : workItem.state;
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
        .select("id, creator_id, workspace_id, mission_id, status, missions!inner(id, title, deliverables, requirements, platforms)")
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
        .select("id, position, title, instructions, requirements, requires_asset, state")
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

      const [draftRows, assetRows, reviewFeedback] = await Promise.all([
        this.readDrafts(context, workItemIds),
        this.readAssets(context, workItemIds),
        this.readReviewFeedback(context, workItemIds),
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

      const workItems = workItemRows.map((row): WorkItem => {
        const id = text(row, "id");
        const draft = mapDraft(draftsByItemId.get(id));
        const assets = (assetsByItemId.get(id) ?? [])
          .sort((left, right) => (
            text(left, "created_at").localeCompare(text(right, "created_at"))
            || text(left, "id").localeCompare(text(right, "id"))
          ))
          .map(mapAsset);
        const item: WorkItem = {
          id,
          position: Number(row.position ?? 0),
          title: text(row, "title"),
          instructions: text(row, "instructions"),
          requirements: mapRequirements(row.requirements),
          requiresAsset: bool(row.requires_asset),
          state: mapState(row.state),
          validation: { caption: false, externalUrl: false, checklist: false, assets: false },
          draft,
          assets,
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
      };
      const brief: MissionBrief = {
        missionId: text(missionRow, "id"),
        title: text(missionRow, "title"),
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
      const result = {
        replayed: response.replayed === true,
        value: {
          draft,
          workItem: mapCommandWorkItem(requiredRow(response.work_item, "work item")),
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
      const result = {
        replayed: response.replayed === true,
        value: {
          asset: mapAsset(requiredRow(response.asset, "asset")),
          workItem: mapCommandWorkItem(requiredRow(response.work_item, "work item")),
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
      const result = {
        replayed: response.replayed === true,
        value: {
          workItem: mapCommandWorkItem(requiredRow(response.work_item, "work item")),
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
      "asset_not_uploaded", "asset_finalized",
    ].find((candidate) => message.includes(candidate));
    if (safeCode) {
      return new CreatorStudioError(safeCode as ConstructorParameters<typeof CreatorStudioError>[0], "Creator Studio command was rejected");
    }
    console.error("Creator Studio repository operation failed", { correlationId, error });
    return new CreatorStudioError("db_error", "repository read failed", correlationId);
  }
}
