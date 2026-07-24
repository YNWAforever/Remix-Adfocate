import type { SupabaseClient } from "@supabase/supabase-js";
import { ActiveMissionError } from "./errors.js";
import { validateDraftPatch } from "./state.js";
import type { DraftPatch, FulfillmentState, WorkflowState, WorkItemState } from "./types.js";
import { createProofEvidenceUploadGrant, finalizeProofEvidence, type ProofEvidenceFinalizeInput, type ProofEvidenceUploadInput, type PublicationProofOwner } from "./publicationProof.js";
import {
  createUploadGrant as createCreatorUploadGrant,
  finalizeAsset as finalizeCreatorAsset,
  submitDraft as submitCreatorDraft,
  type FinalizeAssetInput,
  type SubmitDraftInput,
  type UploadGrantInput,
} from "./creatorActions.js";



export type ActiveMissionOwner = {
  submissionId: string;
  creatorId: string;
  workspaceId: string;
};

export type DraftSaveInput = DraftPatch & { revision: number };

export type MissionBriefSnapshot = {
  description: string | null;
  deliverables: string[];
  requirements: string[];
  platforms: string[];
  effort: string | null;
  targetAudience: string | null;
  dos: string[];
  donts: string[];
  keyMessages: string[];
  referenceLinks: string[];
};

export type MissionWorkflow = {
  id: string;
  submissionId: string;
  state: WorkflowState;
  acceptedAt: string;
  deadline: string | null;
  fulfillmentRequired: boolean;
  revisionLimit: number;
  reviewSlaHours: number;
  revisionResponseHours: number;
  createdAt: string;
  updatedAt: string;
};

export type MissionDraft = {
  id: string;
  caption: string;
  externalUrl: string | null;
  checklist: Record<string, boolean>;
  revision: number;
  lastSavedAt: string;
};

export type MissionDraftAssetView = {
  id: string;
  versionId: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string | null;
  uploadState: string;
  signedUrl: string | null;
};

export type MissionRequiredChangeView = {
  id: string;
  requirementId: string | null;
  category: string;
  text: string;
  required: boolean;
  position: number;
  createdAt: string;
};

export type MissionReviewRoundView = {
  id: string;
  versionId: string;
  roundNumber: number;
  state: string;
  reviewerId: string | null;
  reviewStartedAt: string | null;
  decisionAt: string | null;
  creatorResponseDeadline: string | null;
  requiredChanges: MissionRequiredChangeView[];
};

export type MissionDraftVersionView = {
  id: string;
  versionNumber: number;
  caption: string;
  externalUrl: string | null;
  checklist: Record<string, boolean>;
  contentChecksum: string;
  submittedAt: string;
  state: "submitted" | "under_review" | "revision_requested" | "approved_to_publish";
  decisionAt: string | null;
  assets: MissionDraftAssetView[];
};

export type MissionWorkItemView = {
  id: string;
  title: string;
  platform: string;
  requirements: Array<Record<string, unknown>>;
  required: boolean;
  position: number;
  deadline: string | null;
  state: WorkItemState;
  draft: MissionDraft | null;
  currentSubmittedVersionId: string | null;
  approvedVersionId: string | null;
  reviewStartedAt: string | null;
  reviewDueAt: string | null;
  draftAssets: MissionDraftAssetView[];
  versions: MissionDraftVersionView[];
  reviewRounds: MissionReviewRoundView[];
  requiredChanges: MissionRequiredChangeView[];
  revisionDeadline: string | null;
};

export type MissionFulfillment = {
  id: string;
  status: FulfillmentState;
  shippedAt: string | null;
  receivedAt: string | null;
  operationalNote: string | null;
};

export type MissionWorkflowEvent = {
  id: string;
  workItemId: string | null;
  actorType: "creator" | "operator" | "system";
  actorId: string | null;
  eventType: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ActiveMissionWorkspace = {
  workflow: MissionWorkflow;
  mission: { id: string; slug: string; title: string; missionType: string; brief: MissionBriefSnapshot };
  fulfillment: MissionFulfillment | null;
  workItems: MissionWorkItemView[];
  events: MissionWorkflowEvent[];
  nextAction: { kind: string; workItemId: string | null; deadline: string | null; blockedReason: string | null };
};

export interface ActiveMissionRepository {
  getWorkspace(owner: ActiveMissionOwner): Promise<ActiveMissionWorkspace>;
  saveDraft(owner: ActiveMissionOwner & { workItemId: string }, input: DraftSaveInput): Promise<MissionDraft>;
  createUploadGrant(owner: ActiveMissionOwner & { workItemId: string }, input: UploadGrantInput): ReturnType<typeof createCreatorUploadGrant>;
  finalizeAsset(owner: ActiveMissionOwner & { workItemId: string; assetId: string }, input: FinalizeAssetInput): ReturnType<typeof finalizeCreatorAsset>;
  createProofEvidenceUploadGrant(owner: PublicationProofOwner, input: ProofEvidenceUploadInput): ReturnType<typeof createProofEvidenceUploadGrant>;
  finalizeProofEvidence(owner: PublicationProofOwner & { assetId: string }, input: ProofEvidenceFinalizeInput): ReturnType<typeof finalizeProofEvidence>;
  submitDraft(owner: ActiveMissionOwner & { workItemId: string }, input: SubmitDraftInput): ReturnType<typeof submitCreatorDraft>;
  receiveFulfillment(owner: ActiveMissionOwner): Promise<MissionWorkflow>;
}

const SUBMISSION_SELECT =
  "id, mission_id, creator_id, workspace_id, missions!mission_submissions_mission_workspace_fk(id, slug, title, mission_type, description, deliverables, requirements, platforms, effort, target_audience, dos, donts, key_messages, reference_links)";
const WORKFLOW_SELECT =
  "id, workspace_id, mission_submission_id, state, accepted_at, deadline, fulfillment_required, revision_limit, review_sla_hours, revision_response_hours, created_at, updated_at";
const ITEM_SELECT =
  "id, workspace_id, mission_workflow_id, title, platform, requirements_snapshot, required, position, deadline, state, current_submitted_version_id, approved_version_id, review_started_at, review_due_at, created_at, updated_at";
const DRAFT_SELECT =
  "id, workspace_id, mission_work_item_id, caption_text, external_draft_url, checklist_answers, revision, last_saved_at, archived_at";
const FULFILLMENT_SELECT =
  "id, workspace_id, mission_workflow_id, status, shipped_at, received_at, operational_note";
const EVENT_SELECT =
  "id, workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id, event_type, entity_type, entity_id, metadata, created_at";
const VERSION_SELECT =
  "id, workspace_id, mission_work_item_id, version_number, caption_snapshot, external_draft_url_snapshot, checklist_snapshot, submitted_at, content_checksum";
const REVIEW_SELECT =
  "id, workspace_id, mission_work_item_id, mission_draft_version_id, round_number, state, reviewer_id, review_started_at, decision_at, creator_response_deadline, mission_review_items!mission_review_items_round_workspace_fk(id, requirement_id, category, required_change_text, required, position, created_at)";
const ASSET_SELECT =
  "id, workspace_id, mission_workflow_id, mission_work_item_id, creator_id, mission_draft_version_id, storage_object_path, original_filename, mime_type, byte_size, checksum, upload_state, created_at, deleted_at";
const ASSET_BUCKET = "mission-draft-assets";
const CREATOR_ASSET_SIGNED_URL_TTL_SECONDS = 600;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase dynamic select rows are normalized at module boundaries.
type JsonRow = Record<string, any>;

function notFound(): never {
  throw new ActiveMissionError("WORKFLOW_NOT_FOUND", "Active mission not found");
}

function dbFailure(error: { message?: string | null } | null): never {
  throw new ActiveMissionError("UNKNOWN", error?.message ?? "Active mission database error", error);
}

async function ownedAnchor(client: SupabaseClient, owner: ActiveMissionOwner) {
  const submissionResult = await client
    .from("mission_submissions")
    .select(SUBMISSION_SELECT)
    .eq("id", owner.submissionId)
    .eq("creator_id", owner.creatorId)
    .eq("workspace_id", owner.workspaceId)
    .maybeSingle();
  if (submissionResult.error) dbFailure(submissionResult.error);
  if (!submissionResult.data) notFound();

  const workflowResult = await client
    .from("mission_workflows")
    .select(WORKFLOW_SELECT)
    .eq("mission_submission_id", owner.submissionId)
    .eq("workspace_id", owner.workspaceId)
    .maybeSingle();
  if (workflowResult.error) dbFailure(workflowResult.error);
  if (!workflowResult.data) notFound();

  return {
    submission: submissionResult.data as JsonRow,
    workflow: workflowResult.data as JsonRow,
  };
}

function toWorkflow(row: JsonRow): MissionWorkflow {
  return {
    id: row.id,
    submissionId: row.mission_submission_id,
    state: row.state,
    acceptedAt: row.accepted_at,
    deadline: row.deadline ?? null,
    fulfillmentRequired: row.fulfillment_required,
    revisionLimit: row.revision_limit,
    reviewSlaHours: row.review_sla_hours,
    revisionResponseHours: row.revision_response_hours,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDraft(row: JsonRow): MissionDraft {
  return {
    id: row.id,
    caption: row.caption_text ?? "",
    externalUrl: row.external_draft_url ?? null,
    checklist: row.checklist_answers ?? {},
    revision: row.revision,
    lastSavedAt: row.last_saved_at,
  };
}

function toRequiredChange(row: JsonRow): MissionRequiredChangeView {
  return {
    id: row.id,
    requirementId: row.requirement_id ?? null,
    category: row.category,
    text: row.required_change_text,
    required: row.required,
    position: row.position,
    createdAt: row.created_at,
  };
}

function requiredChanges(row: JsonRow): MissionRequiredChangeView[] {
  if (!Array.isArray(row.mission_review_items)) return [];
  return (row.mission_review_items as JsonRow[])
    .map(toRequiredChange)
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

function toReviewRound(row: JsonRow): MissionReviewRoundView {
  return {
    id: row.id,
    versionId: row.mission_draft_version_id,
    roundNumber: row.round_number,
    state: row.state,
    reviewerId: row.reviewer_id ?? null,
    reviewStartedAt: row.review_started_at ?? null,
    decisionAt: row.decision_at ?? null,
    creatorResponseDeadline: row.creator_response_deadline ?? null,
    requiredChanges: requiredChanges(row),
  };
}

function toAsset(row: JsonRow, signedUrl: string | null): MissionDraftAssetView {
  return {
    id: row.id,
    versionId: row.mission_draft_version_id ?? null,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.byte_size),
    checksum: row.checksum ?? null,
    uploadState: row.upload_state,
    signedUrl,
  };
}

function versionState(round: JsonRow | undefined): MissionDraftVersionView["state"] {
  if (!round || round.state === "open") {
    return round?.review_started_at ? "under_review" : "submitted";
  }
  if (round.state === "revision_requested" || round.state === "approved_to_publish") {
    return round.state;
  }
  return "submitted";
}

function toVersion(
  row: JsonRow,
  rounds: JsonRow[],
  assets: MissionDraftAssetView[],
): MissionDraftVersionView {
  const round = rounds.find((candidate) => candidate.mission_draft_version_id === row.id);
  return {
    id: row.id,
    versionNumber: row.version_number,
    caption: row.caption_snapshot ?? "",
    externalUrl: row.external_draft_url_snapshot ?? null,
    checklist: row.checklist_snapshot ?? {},
    contentChecksum: row.content_checksum,
    submittedAt: row.submitted_at,
    state: versionState(round),
    decisionAt: round?.decision_at ?? null,
    assets: assets.filter((asset) => asset.versionId === row.id),
  };
}

function missionRow(value: unknown): JsonRow {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") notFound();
  return row as JsonRow;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function nextAction(items: MissionWorkItemView[]) {
  const item = items.find((candidate) => !["approved_to_publish", "cancelled", "expired"].includes(candidate.state));
  if (!item) return { kind: "complete", workItemId: null, deadline: null, blockedReason: null };
  if (item.state === "blocked_by_fulfillment") {
    return {
      kind: "await_fulfillment",
      workItemId: item.id,
      deadline: item.deadline,
      blockedReason: "fulfillment_not_received",
    };
  }
  const kind: Record<string, string> = {
    drafting: "continue_draft",
    revision_requested: "revise_draft",
    submitted: "await_review",
    under_review: "await_review",
  };
  return { kind: kind[item.state] ?? "continue", workItemId: item.id, deadline: item.deadline, blockedReason: null };
}

function assertRevision(value: unknown): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new ActiveMissionError("VALIDATION_FAILED", "revision must be a non-negative integer");
  }
}

function mapDraftRpcError(error: { message?: string | null }): never {
  const message = error.message ?? "active_mission_draft_save_failed";
  if (message.includes("not_found")) notFound();
  if (message.includes("validation_failed")) {
    throw new ActiveMissionError("VALIDATION_FAILED", "Draft changes are invalid");
  }
  if (message.includes("not_authorized")) {
    throw new ActiveMissionError("NOT_AUTHORIZED", "Draft changes are not authorized");
  }
  if (message.includes("stale_revision")) {
    throw new ActiveMissionError("WORKFLOW_STALE", "Draft revision is stale");
  }
  if (message.includes("wrong_state")) {
    throw new ActiveMissionError("WRONG_STATE", "Draft is no longer editable");
  }
  if (message.includes("deadline_passed")) {
    throw new ActiveMissionError("DEADLINE_PASSED", "The mission deadline has passed");
  }
  dbFailure(error);
}

function mapRpcError(error: { message?: string | null }): never {
  if (error.message === "not_found") notFound();
  if (error.message === "wrong_state") {
    throw new ActiveMissionError("WRONG_STATE", "Fulfillment must be shipped before receipt");
  }
  dbFailure(error);
}

export function createActiveMissionRepository(client: SupabaseClient): ActiveMissionRepository {
  return {
    async getWorkspace(owner) {
      const { submission, workflow } = await ownedAnchor(client, owner);
      const fulfillmentQuery = client
        .from("mission_fulfillments")
        .select(FULFILLMENT_SELECT)
        .eq("mission_workflow_id", workflow.id)
        .eq("workspace_id", owner.workspaceId)
        .maybeSingle();
      const itemsQuery = client
        .from("mission_work_items")
        .select(ITEM_SELECT)
        .eq("mission_workflow_id", workflow.id)
        .eq("workspace_id", owner.workspaceId)
        .order("position", { ascending: true });

      const [fulfillmentResult, itemsResult] = await Promise.all([
        fulfillmentQuery, itemsQuery,
      ]);
      for (const result of [fulfillmentResult, itemsResult]) {
        if (result.error) dbFailure(result.error);
      }
      const itemRows = (itemsResult.data ?? []) as JsonRow[];
      const itemIds = itemRows.map((row) => row.id as string);
      const draftsQuery = itemIds.length === 0
        ? Promise.resolve({ data: [] as JsonRow[], error: null })
        : client
          .from("mission_working_drafts")
          .select(DRAFT_SELECT)
          .eq("workspace_id", owner.workspaceId)
          .in("mission_work_item_id", itemIds)
          .is("archived_at", null);
      const eventsQuery = client
        .from("mission_workflow_events")
        .select(EVENT_SELECT)
        .eq("mission_workflow_id", workflow.id)
        .eq("workspace_id", owner.workspaceId)
        .order("created_at", { ascending: true });
      const versionsQuery = itemIds.length === 0
        ? Promise.resolve({ data: [] as JsonRow[], error: null })
        : client.from("mission_draft_versions")
          .select(VERSION_SELECT)
          .eq("workspace_id", owner.workspaceId)
          .in("mission_work_item_id", itemIds)
          .order("version_number", { ascending: true });
      const reviewsQuery = itemIds.length === 0
        ? Promise.resolve({ data: [] as JsonRow[], error: null })
        : client.from("mission_review_rounds")
          .select(REVIEW_SELECT)
          .eq("workspace_id", owner.workspaceId)
          .in("mission_work_item_id", itemIds)
          .order("round_number", { ascending: true });
      const assetsQuery = itemIds.length === 0
        ? Promise.resolve({ data: [] as JsonRow[], error: null })
        : client.from("mission_draft_assets")
          .select(ASSET_SELECT)
          .eq("mission_workflow_id", workflow.id)
          .eq("workspace_id", owner.workspaceId)
          .eq("creator_id", owner.creatorId)
          .in("mission_work_item_id", itemIds)
          .is("deleted_at", null)
          .order("created_at", { ascending: true });

      const [draftsResult, eventsResult, versionsResult, reviewsResult, assetsResult] = await Promise.all([
        draftsQuery, eventsQuery, versionsQuery, reviewsQuery, assetsQuery,
      ]);
      for (const result of [draftsResult, eventsResult, versionsResult, reviewsResult, assetsResult]) {
        if (result.error) dbFailure(result.error);
      }

      const itemIdSet = new Set(itemIds);
      const draftByItem = new Map(
        ((draftsResult.data ?? []) as JsonRow[])
          .filter((row) => itemIdSet.has(row.mission_work_item_id))
          .map((row) => [row.mission_work_item_id as string, row]),
      );
      const childRows = (value: unknown) => ((value ?? []) as JsonRow[])
        .filter((row) => itemIdSet.has(row.mission_work_item_id));
      const groupByItem = (rows: JsonRow[]) => {
        const grouped = new Map<string, JsonRow[]>();
        for (const row of rows) {
          const workItemId = row.mission_work_item_id as string;
          const siblings = grouped.get(workItemId);
          if (siblings) siblings.push(row);
          else grouped.set(workItemId, [row]);
        }
        return grouped;
      };
      const versionRowsByItem = groupByItem(childRows(versionsResult.data));
      const reviewRowsByItem = groupByItem(childRows(reviewsResult.data));
      const assetRows = childRows(assetsResult.data)
        .filter((row) => row.creator_id === owner.creatorId && row.mission_workflow_id === workflow.id);
      const signedAssetRows = await Promise.all(assetRows.map(async (row) => {
        let signedUrl: string | null = null;
        if (row.upload_state === "ready") {
          const signed = await client.storage.from(ASSET_BUCKET)
            .createSignedUrl(row.storage_object_path, CREATOR_ASSET_SIGNED_URL_TTL_SECONDS);
          if (signed.error || !signed.data?.signedUrl) dbFailure(signed.error);
          signedUrl = signed.data.signedUrl;
        }
        return {
          workItemId: row.mission_work_item_id as string,
          asset: toAsset(row, signedUrl),
        };
      }));
      const assetsByItem = new Map<string, MissionDraftAssetView[]>();
      for (const entry of signedAssetRows) {
        const siblings = assetsByItem.get(entry.workItemId);
        if (siblings) siblings.push(entry.asset);
        else assetsByItem.set(entry.workItemId, [entry.asset]);
      }
      const workItems: MissionWorkItemView[] = itemRows.map((row) => {
        const itemReviews = reviewRowsByItem.get(row.id) ?? [];
        const itemAssets = assetsByItem.get(row.id) ?? [];
        const latestRound = itemReviews.at(-1);
        return {
          id: row.id,
          title: row.title,
          platform: row.platform,
          requirements: Array.isArray(row.requirements_snapshot) ? row.requirements_snapshot : [],
          required: row.required,
          position: row.position,
          deadline: row.deadline ?? null,
          state: row.state,
          draft: draftByItem.has(row.id) ? toDraft(draftByItem.get(row.id)!) : null,
          currentSubmittedVersionId: row.current_submitted_version_id ?? null,
          approvedVersionId: row.approved_version_id ?? null,
          reviewStartedAt: row.review_started_at ?? null,
          reviewDueAt: row.review_due_at ?? null,
          draftAssets: itemAssets.filter((asset) => asset.versionId === null),
          versions: (versionRowsByItem.get(row.id) ?? [])
            .map((version) => toVersion(version, itemReviews, itemAssets)),
          reviewRounds: itemReviews.map(toReviewRound),
          requiredChanges: latestRound?.state === "revision_requested"
            ? requiredChanges(latestRound)
            : [],
          revisionDeadline: latestRound?.state === "revision_requested"
            ? latestRound.creator_response_deadline ?? null
            : null,
        };
      });
      const rawMission = missionRow(submission.missions);
      const fulfillment = fulfillmentResult.data as JsonRow | null;

      return {
        workflow: toWorkflow(workflow),
        mission: {
          id: rawMission.id,
          slug: rawMission.slug,
          title: rawMission.title,
          missionType: rawMission.mission_type,
          brief: {
            description: rawMission.description ?? null,
            deliverables: strings(rawMission.deliverables),
            requirements: strings(rawMission.requirements),
            platforms: strings(rawMission.platforms),
            effort: rawMission.effort ?? null,
            targetAudience: rawMission.target_audience ?? null,
            dos: strings(rawMission.dos),
            donts: strings(rawMission.donts),
            keyMessages: strings(rawMission.key_messages),
            referenceLinks: strings(rawMission.reference_links),
          },
        },
        fulfillment: fulfillment ? {
          id: fulfillment.id,
          status: fulfillment.status,
          shippedAt: fulfillment.shipped_at ?? null,
          receivedAt: fulfillment.received_at ?? null,
          operationalNote: fulfillment.operational_note ?? null,
        } : null,
        workItems,
        events: ((eventsResult.data ?? []) as JsonRow[]).map((row) => ({
          id: row.id,
          workItemId: row.mission_work_item_id ?? null,
          actorType: row.actor_type,
          actorId: row.actor_id ?? null,
          eventType: row.event_type,
          entityType: row.entity_type ?? null,
          entityId: row.entity_id ?? null,
          metadata: row.metadata ?? {},
          createdAt: row.created_at,
        })),
        nextAction: nextAction(workItems),
      };
    },

    async saveDraft(owner, input) {
      assertRevision(input.revision);
      const patch: DraftPatch = {};
      if (Object.prototype.hasOwnProperty.call(input, "caption")) patch.caption = input.caption;
      if (Object.prototype.hasOwnProperty.call(input, "externalUrl")) patch.externalUrl = input.externalUrl;
      if (Object.prototype.hasOwnProperty.call(input, "checklist")) patch.checklist = input.checklist;
      const checklistKeys = patch.checklist && typeof patch.checklist === "object" && !Array.isArray(patch.checklist)
        ? Object.keys(patch.checklist)
        : [];
      validateDraftPatch(patch, checklistKeys);

      const result = await client.rpc("save_active_mission_draft", {
        p_submission: owner.submissionId,
        p_creator: owner.creatorId,
        p_workspace: owner.workspaceId,
        p_work_item: owner.workItemId,
        p_expected_revision: input.revision,
        p_patch: patch,
      });
      if (result.error) mapDraftRpcError(result.error);
      const payload = result.data;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        dbFailure({ message: "Invalid save_active_mission_draft response" });
      }
      const row = payload as JsonRow;
      if (row.code === "WORKFLOW_STALE" || row.code === "WRONG_STATE") {
        if (!row.current_draft || typeof row.current_draft !== "object" || Array.isArray(row.current_draft)) {
          dbFailure({ message: "Invalid save_active_mission_draft conflict response" });
        }
        throw new ActiveMissionError(
          row.code,
          row.code === "WORKFLOW_STALE" ? "Draft revision is stale" : "Draft is no longer editable",
          { currentDraft: toDraft(row.current_draft as JsonRow) },
        );
      }
      if (!row.draft || typeof row.draft !== "object" || Array.isArray(row.draft)) {
        dbFailure({ message: "Invalid save_active_mission_draft success response" });
      }
      return toDraft(row.draft as JsonRow);
    },

    async createUploadGrant(owner, input) {
      return createCreatorUploadGrant(client, owner, input);
    },

    async finalizeAsset(owner, input) {
      return finalizeCreatorAsset(client, owner, input);
    },

    async createProofEvidenceUploadGrant(owner, input) {
      return createProofEvidenceUploadGrant(client, owner, input);
    },

    async finalizeProofEvidence(owner, input) {
      return finalizeProofEvidence(client, owner, input);
    },

    async submitDraft(owner, input) {
      return submitCreatorDraft(client, owner, input);
    },

    async receiveFulfillment(owner) {
      const result = await client.rpc("receive_mission_fulfillment", {
        p_submission: owner.submissionId,
        p_creator: owner.creatorId,
        p_workspace: owner.workspaceId,
      });
      if (result.error) mapRpcError(result.error);
      if (!result.data) notFound();
      return toWorkflow(result.data as JsonRow);
    },
  };
}
