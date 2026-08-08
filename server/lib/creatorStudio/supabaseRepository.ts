import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { CreatorStudioError } from "./errors.js";
import type { CreatorStudioRepository } from "./repository.js";
import type {
  CreatorStudioContext,
  DraftAsset,
  MissionBrief,
  MissionSubmissionStatus,
  NextAction,
  OptionalSection,
  ReviewFeedback,
  SubmissionSummary,
  SubmissionWorkspace,
  WorkItem,
  WorkItemRequirements,
  WorkItemState,
  WorkingDraft,
} from "./types.js";

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

function mapRequirements(value: unknown): WorkItemRequirements {
  const requirements = asRow(asRow(value).requirements);
  return {
    caption: bool(requirements.caption),
    externalUrl: bool(requirements.externalUrl) || bool(requirements.external_url),
    checklist: strings(requirements.checklist),
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

function validationFor(item: Pick<WorkItem, "requirements" | "requiresAsset" | "draft" | "assets">) {
  return {
    caption: !item.requirements.caption || Boolean(item.draft?.caption?.trim()),
    externalUrl: !item.requirements.externalUrl || Boolean(item.draft?.externalUrl),
    checklist: item.requirements.checklist.every((key) => item.draft?.checklist[key] === true),
    assets: !item.requiresAsset || item.assets.some((asset) => asset.state === "finalized"),
  };
}

function nextActionFor(workItems: WorkItem[]): NextAction | null {
  const workItem = workItems.find((item) => item.state !== "approved");
  if (!workItem) return null;
  const label = {
    not_started: `Start ${workItem.title}`,
    drafting: `Continue ${workItem.title}`,
    ready_to_submit: `Submit ${workItem.title}`,
    submitted: `Await review for ${workItem.title}`,
    changes_requested: `Revise ${workItem.title}`,
    resubmitted: `Await review for ${workItem.title}`,
    approved: `Approved ${workItem.title}`,
  } satisfies Record<WorkItemState, string>;
  return { workItemId: workItem.id, state: workItem.state, label: label[workItem.state] };
}

export class SupabaseCreatorStudioRepository implements CreatorStudioRepository {
  constructor(private readonly client: SupabaseClient) {}

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

  async saveDraft(): Promise<never> { throw new Error("Creator Studio commands are not implemented in this task"); }
  async createUploadGrant(): Promise<never> { throw new Error("Creator Studio commands are not implemented in this task"); }
  async finalizeAsset(): Promise<never> { throw new Error("Creator Studio commands are not implemented in this task"); }
  async submitWorkItem(): Promise<never> { throw new Error("Creator Studio commands are not implemented in this task"); }

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

  private repositoryError(error: unknown): CreatorStudioError {
    const correlationId = randomUUID();
    console.error("Creator Studio repository read failed", { correlationId, error });
    return new CreatorStudioError("db_error", "repository read failed", correlationId);
  }
}
