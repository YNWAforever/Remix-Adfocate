import type { SupabaseClient } from "@supabase/supabase-js";
import { ActiveMissionError } from "./errors.js";
import { validateDraftPatch } from "./state.js";
import type { DraftPatch, FulfillmentState, WorkflowState, WorkItemState } from "./types.js";

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

function requirementIds(row: JsonRow): string[] {
  if (!Array.isArray(row.requirements_snapshot)) return [];
  return row.requirements_snapshot
    .map((requirement: unknown) =>
      requirement && typeof requirement === "object" && typeof (requirement as JsonRow).id === "string"
        ? (requirement as JsonRow).id as string
        : null)
    .filter((id: string | null): id is string => id !== null);
}

function assertRevision(value: unknown): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new ActiveMissionError("VALIDATION_FAILED", "revision must be a non-negative integer");
  }
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

      const [draftsResult, eventsResult] = await Promise.all([
        draftsQuery, eventsQuery,
      ]);
      for (const result of [draftsResult, eventsResult]) {
        if (result.error) dbFailure(result.error);
      }

      const itemIdSet = new Set(itemIds);
      const draftByItem = new Map(
        ((draftsResult.data ?? []) as JsonRow[])
          .filter((row) => itemIdSet.has(row.mission_work_item_id))
          .map((row) => [row.mission_work_item_id as string, row]),
      );
      const workItems: MissionWorkItemView[] = itemRows.map((row) => ({
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
      }));
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
      const { workflow } = await ownedAnchor(client, owner);
      const itemResult = await client
        .from("mission_work_items")
        .select(ITEM_SELECT)
        .eq("id", owner.workItemId)
        .eq("mission_workflow_id", workflow.id)
        .eq("workspace_id", owner.workspaceId)
        .maybeSingle();
      if (itemResult.error) dbFailure(itemResult.error);
      if (!itemResult.data) notFound();

      const patch: DraftPatch = {};
      if (Object.prototype.hasOwnProperty.call(input, "caption")) patch.caption = input.caption;
      if (Object.prototype.hasOwnProperty.call(input, "externalUrl")) patch.externalUrl = input.externalUrl;
      if (Object.prototype.hasOwnProperty.call(input, "checklist")) patch.checklist = input.checklist;
      validateDraftPatch(patch, requirementIds(itemResult.data as JsonRow));

      const update: Record<string, unknown> = {
        revision: input.revision + 1,
        last_saved_at: new Date().toISOString(),
      };
      if (Object.prototype.hasOwnProperty.call(patch, "caption")) update.caption_text = patch.caption;
      if (Object.prototype.hasOwnProperty.call(patch, "externalUrl")) update.external_draft_url = patch.externalUrl;
      if (Object.prototype.hasOwnProperty.call(patch, "checklist")) update.checklist_answers = patch.checklist;

      const saved = await client
        .from("mission_working_drafts")
        .update(update)
        .eq("mission_work_item_id", owner.workItemId)
        .eq("workspace_id", owner.workspaceId)
        .eq("revision", input.revision)
        .is("archived_at", null)
        .select(DRAFT_SELECT)
        .maybeSingle();
      if (saved.error) dbFailure(saved.error);
      if (saved.data) return toDraft(saved.data as JsonRow);

      const current = await client
        .from("mission_working_drafts")
        .select(DRAFT_SELECT)
        .eq("mission_work_item_id", owner.workItemId)
        .eq("workspace_id", owner.workspaceId)
        .is("archived_at", null)
        .maybeSingle();
      if (current.error) dbFailure(current.error);
      if (!current.data) notFound();
      throw new ActiveMissionError("WORKFLOW_STALE", "Draft revision is stale", {
        currentDraft: toDraft(current.data as JsonRow),
      });
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
