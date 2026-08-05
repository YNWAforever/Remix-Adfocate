import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono, type Context } from "hono";
import { serviceClient } from "../lib/supabase.js";
import type { AdminEnv, StaffIdentity } from "../lib/staffAuth.js";
import { PUBLICATION_PROOF_ASSET_BUCKET, refreshPublicationProofMetadata } from "../lib/activeMission/publicationProof.js";
import { inspectProofUrl } from "../lib/activeMission/proofUrl.js";
import { validateProofChecklist } from "../lib/activeMission/state.js";
import type { ProofChecklist, ProofReviewItemInput } from "../lib/activeMission/types.js";
import { getOperatorRewardHandoffProjection } from "../lib/activeMission/rewardHandoff.js";

const ASSET_BUCKET = "mission-draft-assets";
const SIGNED_URL_TTL_SECONDS = 10 * 60;
const QUEUE_STATES = ["submitted", "under_review"];
const PROOF_QUEUE_STATES = ["proof_submitted", "proof_under_review", "proof_correction_requested"];
const ALL_QUEUE_STATES = [...QUEUE_STATES, ...PROOF_QUEUE_STATES];
const EXPECTED_REVIEW_STATES = new Set(QUEUE_STATES);
const MAX_PUBLICATION_WINDOW_HOURS = 8760;

// Supabase joins and RPC JSON have endpoint-specific dynamic fields; boundary validators narrow values before use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type OperatorErrorCode =
  | "WORKFLOW_NOT_FOUND"
  | "NOT_AUTHORIZED"
  | "VALIDATION_FAILED"
  | "WORKFLOW_STALE"
  | "WRONG_STATE"
  | "REVISION_LIMIT_REACHED"
  | "PUBLICATION_SETUP_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "UNKNOWN";

class OperatorActiveMissionError extends Error {
  constructor(public code: OperatorErrorCode, message: string, public details?: unknown) {
    super(message);
  }
}

export type ActiveMissionQueueItem = {
  workflowId: string;
  workItemId: string;
  missionId: string;
  creatorDisplayName: string;
  missionTitle: string;
  deliverableTitle: string;
  state: string;
  creatorDeadline: string | null;
  submittedAt: string | null;
  reviewDueAt: string | null;
  reviewerId: string | null;
  riskBucket: "overdue" | "due_soon" | "on_track" | "no_sla";
  proofAttemptId?: string | null;
  proofAttemptNumber?: number | null;
  submittedLate?: boolean;
  metadataStatus?: string | null;
  platform?: string | null;
  publicationDueAt?: string | null;
  creatorResponseDeadline?: string | null;
  proofReviewerId?: string | null;
};

type QueueSortFields = {
  workItemId: string;
  reviewDueAt: string | null;
  creatorDeadline: string | null;
  submittedAt: string | null;
  publicationDueAt?: string | null;
  creatorResponseDeadline?: string | null;
  submittedLate?: boolean;
  proofAttemptNumber?: number | null;
};

function timestamp(value: string | null | undefined, fallback = Number.POSITIVE_INFINITY) {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function sortActiveMissionQueue<T extends QueueSortFields>(items: T[], now = new Date()): T[] {
  const current = now.getTime();
  const due = (item: T) => Math.min(
    timestamp(item.reviewDueAt),
    timestamp(item.creatorResponseDeadline),
    timestamp(item.publicationDueAt),
    timestamp(item.creatorDeadline),
  );
  return [...items].sort((a, b) => {
    const aDue = due(a);
    const bDue = due(b);
    const overdue = Number(Boolean(b.submittedLate) || bDue < current) - Number(Boolean(a.submittedLate) || aDue < current);
    if (overdue !== 0) return overdue;
    return aDue - bDue
      || timestamp(a.submittedAt) - timestamp(b.submittedAt)
      || a.workItemId.localeCompare(b.workItemId);
  });
}

function riskBucket(reviewDueAt: string | null, now = Date.now()): ActiveMissionQueueItem["riskBucket"] {
  if (!reviewDueAt) return "no_sla";
  const due = timestamp(reviewDueAt);
  if (due < now) return "overdue";
  return due <= now + 24 * 60 * 60 * 1000 ? "due_soon" : "on_track";
}

export type AdminActiveMissionRepository = {
  listQueue(input: {
    operatorId: string;
    workspaceSlug: string;
    state?: string;
    reviewerId?: string;
    missionId?: string;
    risk?: string;
    proofState?: string;
    late?: boolean;
    metadataStatus?: string;
    platform?: string;
    publicationDeadline?: string;
  }): Promise<{ items: ActiveMissionQueueItem[] }>;
  getDetail(input: { workflowId: string; workspaceSlug: string; operatorId: string; signedUrlTtlSeconds: number }): Promise<unknown>;
  startReview(input: TransitionBase & { expectedState: string }): Promise<unknown>;
  requestRevision(input: TransitionBase & {
    expectedState: string;
    versionId: string;
    deadline: string | null;
    items: ReviewItemInput[];
  }): Promise<unknown>;
  grantRevision(input: TransitionBase & { reason: string; grantedCount: number }): Promise<unknown>;
  setPublicationInstructions(input: TransitionBase & PublicationInstructionMutation): Promise<unknown>;
  setupExistingPublicationInstructions(input: TransitionBase & PublicationInstructionSetupMutation): Promise<unknown>;
  approveVersion(input: TransitionBase & { expectedState: string; versionId: string }): Promise<unknown>;
  markFulfillmentShipped(input: Omit<TransitionBase, "workItemId"> & { note: string | null }): Promise<unknown>;
  startProofReview(input: ProofTransitionInput): Promise<unknown>;
  requestProofCorrection(input: ProofTransitionInput & {
    checklist: ProofChecklist;
    corrections: ProofReviewItemInput[];
    summary: string | null;
  }): Promise<unknown>;
  verifyProof(input: ProofTransitionInput & {
    checklist: ProofChecklist;
    summary: string | null;
  }): Promise<unknown>;
  refreshProofMetadata(input: ProofTransitionInput): Promise<unknown>;
};

type TransitionBase = {
  workflowId: string;
  workItemId: string;
  workspaceSlug: string;
  operatorId: string;
};

type ProofTransitionInput = TransitionBase & {
  attemptId: string;
  expectedState: string;
  expectedRevision: number;
  idempotencyKey: string;
};

type ReviewItemInput = {
  requirementId?: string | null;
  category: "format" | "key_message" | "compliance" | "quality" | "other";
  text: string;
  required?: boolean;
};

type PublicationInstructionInput = {
  publicationInstructions: string;
  publicationWindowHours: number;
  requiredDisclosures: string[];
  expectedAccount: string | null;
  proofEvidencePolicy: Record<string, unknown>;
};

type PublicationInstructionMutation = {
  expectedState: string;
  expectedRevision: number;
  idempotencyKey: string;
  overrideReason: string;
  instructions: PublicationInstructionInput;
};

type PublicationInstructionSetupMutation = Omit<
  PublicationInstructionMutation,
  "overrideReason"
>;

function dbError(error: { message?: string | null } | null): never {
  const message = error?.message ?? "Operator active mission database error";
  const mapped: Record<string, OperatorErrorCode> = {
    not_found: "WORKFLOW_NOT_FOUND",
    idempotency_conflict: "IDEMPOTENCY_CONFLICT",
    not_authorized: "NOT_AUTHORIZED",
    validation_failed: "VALIDATION_FAILED",
    stale: "WORKFLOW_STALE",
    workflow_stale: "WORKFLOW_STALE",
    wrong_state: "WRONG_STATE",
    revision_limit_reached: "REVISION_LIMIT_REACHED",
    publication_setup_required: "PUBLICATION_SETUP_REQUIRED",
  };
  throw new OperatorActiveMissionError(mapped[message.toLowerCase()] ?? "UNKNOWN", message);
}

const rewardProcessingWindowByWorkspace = new Map<string, number | null>();

async function workspaceId(client: SupabaseClient, slug: string, operatorId?: string) {
  if (operatorId) {
    const membership = await client.from("brand_users")
      .select("workspace_id, workspaces!brand_users_workspace_id_fkey!inner(id, slug, reward_processing_window_days)")
      .eq("user_id", operatorId)
      .eq("active", true)
      .eq("workspaces.slug", slug)
      .maybeSingle();
    if (membership.error || !membership.data) {
      throw new OperatorActiveMissionError("NOT_AUTHORIZED", "not_authorized");
    }
    const membershipRow = membership.data as Row;
    const workspaceValue = membershipRow.workspaces;
    const workspace = Array.isArray(workspaceValue)
      ? workspaceValue[0] as Row | undefined
      : workspaceValue as Row | undefined;
    const resolvedWorkspaceId = membershipRow.workspace_id;
    if (typeof resolvedWorkspaceId !== "string"
      || workspace?.id !== resolvedWorkspaceId
      || workspace.slug !== slug) {
      throw new OperatorActiveMissionError("NOT_AUTHORIZED", "not_authorized");
    }
    rewardProcessingWindowByWorkspace.set(resolvedWorkspaceId,
      workspace.reward_processing_window_days == null ? null : Number(workspace.reward_processing_window_days));
    return resolvedWorkspaceId;
  }
  const result = await client.from("workspaces").select("id").eq("slug", slug).maybeSingle();
  if (result.error) dbError(result.error);
  if (!result.data) throw new OperatorActiveMissionError("NOT_AUTHORIZED", "not_authorized");
  return result.data.id as string;
}

function requireData<T>(result: { data: T | null; error: { message?: string | null } | null }): T {
  if (result.error) dbError(result.error);
  if (!result.data) throw new OperatorActiveMissionError("WORKFLOW_NOT_FOUND", "not_found");
  return result.data;
}

function rpcData(result: { data: unknown; error: { message?: string | null } | null }) {
  if (result.error) dbError(result.error);
  if (!result.data) throw new OperatorActiveMissionError("WORKFLOW_NOT_FOUND", "not_found");
  return { workItem: result.data };
}

function publicationRpcData(result: { data: unknown; error: { message?: string | null } | null }) {
  if (result.error) dbError(result.error);
  const payload = result.data as Row | null;
  if (!payload) throw new OperatorActiveMissionError("WORKFLOW_NOT_FOUND", "not_found");
  if (payload.code) throw new OperatorActiveMissionError(payload.code as OperatorErrorCode, payload.code, payload.current_publication);
  return payload;
}

export function createAdminActiveMissionRepository(client: SupabaseClient): AdminActiveMissionRepository {
  return {
    async listQueue(input) {
      const workspace = await workspaceId(client, input.workspaceSlug, input.operatorId);
      const query = client.from("mission_work_items")
        .select("id, mission_workflow_id, title, platform, state, deadline, review_due_at, current_reviewer_id, current_submitted_version_id, current_proof_attempt_id")
        .eq("workspace_id", workspace)
        .in("state", input.proofState ? [input.proofState] : input.state ? [input.state] : ALL_QUEUE_STATES);
      const itemsResult = await query;
      if (itemsResult.error) dbError(itemsResult.error);
      const itemRows = (itemsResult.data ?? []) as Row[];
      if (itemRows.length === 0) return { items: [] };

      const proofItemIds = itemRows.filter((row) => PROOF_QUEUE_STATES.includes(row.state)).map((row) => row.id as string);
      const [attemptsResult, instructionsResult, proofReviewsResult] = proofItemIds.length ? await Promise.all([
        client.from("mission_publication_proof_attempts")
          .select("id, mission_work_item_id, attempt_number, submitted_at, submitted_late, metadata_status")
          .eq("workspace_id", workspace).in("mission_work_item_id", proofItemIds),
        client.from("mission_publication_instructions")
          .select("mission_work_item_id, publication_due_at")
          .eq("workspace_id", workspace).in("mission_work_item_id", proofItemIds),
        client.from("mission_publication_proof_reviews")
          .select("mission_publication_proof_attempt_id, reviewer_id, creator_response_deadline")
          .eq("workspace_id", workspace),
      ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
      for (const result of [attemptsResult, instructionsResult, proofReviewsResult]) if (result.error) dbError(result.error);
      const attemptById = new Map(((attemptsResult.data ?? []) as Row[]).map((row) => [row.id, row]));
      const instructionByItem = new Map(((instructionsResult.data ?? []) as Row[]).map((row) => [row.mission_work_item_id, row]));
      const proofReviewByAttempt = new Map(((proofReviewsResult.data ?? []) as Row[]).map((row) => [row.mission_publication_proof_attempt_id, row]));

      const workflowIds = [...new Set(itemRows.map((row) => row.mission_workflow_id as string))];
      const versionIds = itemRows.map((row) => row.current_submitted_version_id as string).filter(Boolean);
      const [workflowsResult, versionsResult] = await Promise.all([
        client.from("mission_workflows").select("id, mission_submission_id").eq("workspace_id", workspace).in("id", workflowIds),
        versionIds.length
          ? client.from("mission_draft_versions").select("id, submitted_at").eq("workspace_id", workspace).in("id", versionIds)
          : Promise.resolve({ data: [] as Row[], error: null }),
      ]);
      if (workflowsResult.error) dbError(workflowsResult.error);
      if (versionsResult.error) dbError(versionsResult.error);
      const workflowRows = (workflowsResult.data ?? []) as Row[];
      const submissionIds = workflowRows.map((row) => row.mission_submission_id as string);
      const submissionsResult = await client.from("mission_submissions")
        .select("id, mission_id, creator_id, creators!mission_submissions_creator_id_fkey(display_name), missions!mission_submissions_mission_workspace_fk(title)")
        .eq("workspace_id", workspace)
        .in("id", submissionIds);
      if (submissionsResult.error) dbError(submissionsResult.error);

      const workflowById = new Map(workflowRows.map((row) => [row.id, row]));
      const submissionById = new Map(((submissionsResult.data ?? []) as Row[]).map((row) => [row.id, row]));
      const versionById = new Map(((versionsResult.data ?? []) as Row[]).map((row) => [row.id, row]));
      const now = Date.now();
      let items = itemRows.flatMap((row): ActiveMissionQueueItem[] => {
        const workflow = workflowById.get(row.mission_workflow_id);
        const submission = workflow ? submissionById.get(workflow.mission_submission_id) : null;
        if (!workflow || !submission) return [];
        const creator = Array.isArray(submission.creators) ? submission.creators[0] : submission.creators;
        const mission = Array.isArray(submission.missions) ? submission.missions[0] : submission.missions;
        if (input.missionId && submission.mission_id !== input.missionId) return [];
        const version = versionById.get(row.current_submitted_version_id);
        const attempt = attemptById.get(row.current_proof_attempt_id);
        const instruction = instructionByItem.get(row.id);
        const proofReview = attempt ? proofReviewByAttempt.get(attempt.id) : null;
        return [{
          workflowId: workflow.id,
          workItemId: row.id,
          missionId: submission.mission_id,
          creatorDisplayName: creator?.display_name ?? "Creator",
          missionTitle: mission?.title ?? "Mission",
          deliverableTitle: row.title,
          state: row.state,
          creatorDeadline: row.deadline ?? null,
          submittedAt: attempt?.submitted_at ?? version?.submitted_at ?? null,
          reviewDueAt: row.review_due_at ?? null,
          reviewerId: row.current_reviewer_id ?? null,
          riskBucket: riskBucket(row.review_due_at ?? null, now),
          proofAttemptId: attempt?.id ?? null,
          proofAttemptNumber: attempt?.attempt_number ?? null,
          submittedLate: attempt?.submitted_late ?? false,
          metadataStatus: attempt?.metadata_status ?? null,
          platform: row.platform ?? null,
          publicationDueAt: instruction?.publication_due_at ?? null,
          creatorResponseDeadline: proofReview?.creator_response_deadline ?? null,
          proofReviewerId: proofReview?.reviewer_id ?? null,
        }];
      });
      if (input.risk) items = items.filter((item) => item.riskBucket === input.risk);
      if (input.late !== undefined) items = items.filter((item) => item.submittedLate === input.late);
      if (input.metadataStatus) items = items.filter((item) => item.metadataStatus === input.metadataStatus);
      if (input.platform) items = items.filter((item) => item.platform === input.platform);
      if (input.reviewerId) items = items.filter((item) =>
        (item.proofAttemptId ? item.proofReviewerId : item.reviewerId) === input.reviewerId);
      if (input.publicationDeadline) {
        const current = Date.now();
        items = items.filter((item) => input.publicationDeadline === "overdue"
          ? timestamp(item.publicationDueAt) < current
          : input.publicationDeadline === "upcoming"
            ? timestamp(item.publicationDueAt) >= current
            : true);
      }
      return { items: sortActiveMissionQueue(items, new Date(now)) };
    },

    async getDetail(input) {
      const workspace = await workspaceId(client, input.workspaceSlug, input.operatorId);
      const workflow = requireData<Row>(await client.from("mission_workflows")
        .select("*").eq("id", input.workflowId).eq("workspace_id", workspace).maybeSingle());
      const submission = requireData<Row>(await client.from("mission_submissions")
        .select("*, creators!mission_submissions_creator_id_fkey(id, display_name), missions!mission_submissions_mission_workspace_fk(*)")
        .eq("id", workflow.mission_submission_id).eq("workspace_id", workspace).maybeSingle());
      const [itemsResult, fulfillmentResult, eventsResult, assetsResult] = await Promise.all([
        client.from("mission_work_items").select("*").eq("mission_workflow_id", input.workflowId).eq("workspace_id", workspace).order("position"),
        client.from("mission_fulfillments").select("*").eq("mission_workflow_id", input.workflowId).eq("workspace_id", workspace).maybeSingle(),
        client.from("mission_workflow_events").select("*").eq("mission_workflow_id", input.workflowId).eq("workspace_id", workspace).order("created_at"),
        client.from("mission_draft_assets").select("*").eq("mission_workflow_id", input.workflowId).eq("workspace_id", workspace).is("deleted_at", null),
      ]);
      for (const result of [itemsResult, fulfillmentResult, eventsResult, assetsResult]) if (result.error) dbError(result.error);
      const itemIds = ((itemsResult.data ?? []) as Row[]).map((row) => row.id as string);
      const [versionsResult, reviewsResult, grantsResult] = itemIds.length ? await Promise.all([
        client.from("mission_draft_versions").select("*").eq("workspace_id", workspace).in("mission_work_item_id", itemIds).order("version_number"),
        client.from("mission_review_rounds").select("*, mission_review_items!mission_review_items_round_workspace_fk(*)").eq("workspace_id", workspace).in("mission_work_item_id", itemIds).order("round_number"),
        client.from("mission_revision_grants").select("*").eq("workspace_id", workspace).in("mission_work_item_id", itemIds).order("granted_at"),
      ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
      for (const result of [versionsResult, reviewsResult, grantsResult]) if (result.error) dbError(result.error);

      const [publicationInstructionsResult, proofAttemptsResult, proofReviewsResult, proofAssetsResult] = itemIds.length ? await Promise.all([
        client.from("mission_publication_instructions").select("*").eq("workspace_id", workspace).in("mission_work_item_id", itemIds),
        client.from("mission_publication_proof_attempts").select("*").eq("workspace_id", workspace).in("mission_work_item_id", itemIds).order("attempt_number"),
        client.from("mission_publication_proof_reviews").select("*, mission_publication_proof_review_items(*)").eq("workspace_id", workspace),
        client.from("mission_publication_proof_assets").select("*").eq("workspace_id", workspace).in("mission_work_item_id", itemIds),
      ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
      for (const result of [publicationInstructionsResult, proofAttemptsResult, proofReviewsResult, proofAssetsResult]) if (result.error) dbError(result.error);
      const proofAttemptIds = new Set(((proofAttemptsResult.data ?? []) as Row[]).map((attempt) => attempt.id));
      const proofReviews = ((proofReviewsResult.data ?? []) as Row[]).filter((proofReview) => proofAttemptIds.has(proofReview.mission_publication_proof_attempt_id));
      const authorizedProofAssets = ((proofAssetsResult.data ?? []) as Row[]).filter((proofAsset) =>
        proofAsset.upload_state === "finalized" && proofAttemptIds.has(proofAsset.mission_publication_proof_attempt_id));
      const instructionItemIds = new Set(
        ((publicationInstructionsResult.data ?? []) as Row[]).map((instruction) => instruction.mission_work_item_id),
      );
      const proofAttemptItemIds = new Set(((proofAttemptsResult.data ?? []) as Row[]).map((attempt) => attempt.mission_work_item_id));
      const setupHistoryItemIds = new Set(
        ((eventsResult.data ?? []) as Row[])
          .filter((event) => event.event_type === "mission_publication_existing_instructions_setup")
          .map((event) => event.mission_work_item_id),
      );
      const proofAssets = await Promise.all(authorizedProofAssets.map(async (proofAsset) => {
        const signed = await client.storage.from(PUBLICATION_PROOF_ASSET_BUCKET)
          .createSignedUrl(proofAsset.storage_object_path, input.signedUrlTtlSeconds);
        if (signed.error || !signed.data) dbError(signed.error);
        return {
          id: proofAsset.id,
          attemptId: proofAsset.mission_publication_proof_attempt_id,
          originalFilename: proofAsset.original_filename,
          contentType: proofAsset.mime_type,
          sizeBytes: Number(proofAsset.byte_size),
          createdAt: proofAsset.created_at,
          signedUrl: signed.data.signedUrl,
        };
      }));

      const assets = await Promise.all(((assetsResult.data ?? []) as Row[]).map(async (asset) => {
        const signed = await client.storage.from(ASSET_BUCKET)
          .createSignedUrl(asset.storage_object_path, input.signedUrlTtlSeconds);
        if (signed.error || !signed.data) dbError(signed.error);
        return { ...asset, signedUrl: signed.data.signedUrl };
      }));
      const rewardHandoff = await getOperatorRewardHandoffProjection(
        client,
        workspace,
        input.workflowId,
        { workflow, submission, requiredItems: (itemsResult.data ?? []) as Row[], proofAttempts: (proofAttemptsResult.data ?? []) as Row[], proofReviews },
        rewardProcessingWindowByWorkspace.get(workspace) ?? null,
      );
      return {
        workflow,
        submission,
        ...rewardHandoff,
        workItems: ((itemsResult.data ?? []) as Row[]).map((item) => ({
          ...item,
          publicationSetupRequired: item.state === "approved_to_publish"
            && !instructionItemIds.has(item.id)
            && !proofAttemptItemIds.has(item.id)
            && !setupHistoryItemIds.has(item.id),
        })),
        fulfillment: fulfillmentResult.data ?? null,
        versions: versionsResult.data ?? [],
        reviews: reviewsResult.data ?? [],
        grants: grantsResult.data ?? [],
        events: eventsResult.data ?? [],
        assets,
        publicationInstructions: ((publicationInstructionsResult.data ?? []) as Row[]).map((instruction) => ({
          id: instruction.id, workItemId: instruction.mission_work_item_id,
          publicationInstructions: instruction.publication_instructions,
          publicationWindowHours: instruction.publication_window_hours,
          requiredDisclosures: instruction.required_disclosures,
          expectedAccount: instruction.expected_account,
          proofEvidencePolicy: instruction.proof_evidence_policy,
          publicationDueAt: instruction.publication_due_at,
          frozenAt: instruction.frozen_at ?? null,
          revision: instruction.revision ?? 0,
        })),
        proofAttempts: ((proofAttemptsResult.data ?? []) as Row[]).map((attempt) => ({
          id: attempt.id, workItemId: attempt.mission_work_item_id,
          attemptNumber: attempt.attempt_number,
          primaryUrl: attempt.primary_url, additionalUrls: attempt.additional_urls,
          submittedAt: attempt.submitted_at, submittedLate: attempt.submitted_late,
          metadataStatus: attempt.metadata_status,
          metadataSnapshot: attempt.metadata_snapshot,
          metadataErrorCategory: attempt.metadata_error_category,
        })),
        proofReviews: proofReviews.map((proofReview) => ({
          id: proofReview.id,
          attemptId: proofReview.mission_publication_proof_attempt_id,
          reviewNumber: proofReview.review_number,
          state: proofReview.state, decision: proofReview.decision,
          reviewerId: proofReview.reviewer_id,
          reviewedAt: proofReview.reviewed_at,
          decisionAt: proofReview.decision_at ?? proofReview.reviewed_at,
          creatorResponseDeadline: proofReview.creator_response_deadline ?? null,
          checklist: proofReview.checklist ?? null,
          summary: proofReview.summary,
          items: (proofReview.mission_publication_proof_review_items ?? []).map((reviewItem: Row) => ({
            id: reviewItem.id, category: reviewItem.category,
            text: reviewItem.finding_text ?? reviewItem.text,
            passed: reviewItem.passed, position: reviewItem.position,
          })),
        })),
        proofAssets,
      };
    },

    async startReview(input) {
      const workspace = await workspaceId(client, input.workspaceSlug);
      return rpcData(await client.rpc("start_mission_review", {
        p_workflow: input.workflowId, p_work_item: input.workItemId, p_operator: input.operatorId,
        p_workspace: workspace, p_expected_state: input.expectedState,
      }));
    },
    async requestRevision(input) {
      const workspace = await workspaceId(client, input.workspaceSlug);
      return rpcData(await client.rpc("request_mission_revision", {
        p_workflow: input.workflowId, p_work_item: input.workItemId, p_version: input.versionId,
        p_operator: input.operatorId, p_workspace: workspace, p_expected_state: input.expectedState,
        p_deadline: input.deadline, p_items: input.items,
      }));
    },
    async grantRevision(input) {
      const workspace = await workspaceId(client, input.workspaceSlug);
      return rpcData(await client.rpc("grant_mission_revision", {
        p_workflow: input.workflowId, p_work_item: input.workItemId, p_operator: input.operatorId,
        p_workspace: workspace, p_reason: input.reason, p_granted_count: input.grantedCount,
      }));
    },
    async setPublicationInstructions(input) {
      const workspace = await workspaceId(client, input.workspaceSlug);
      const result = await client.rpc("set_publication_instructions", {
        p_workflow: input.workflowId,
        p_work_item: input.workItemId,
        p_operator: input.operatorId,
        p_workspace: workspace,
        p_expected_state: input.expectedState,
        p_expected_revision: input.expectedRevision,
        p_idempotency_key: input.idempotencyKey,
        p_instructions: {
          publication_instructions: input.instructions.publicationInstructions,
          publication_window_hours: input.instructions.publicationWindowHours,
          required_disclosures: input.instructions.requiredDisclosures,
          expected_account: input.instructions.expectedAccount,
          proof_evidence_policy: input.instructions.proofEvidencePolicy,
          override_reason: input.overrideReason,
        },
      });
      if (result.error) dbError(result.error);
      const payload = result.data as Row | null;
      if (!payload) throw new OperatorActiveMissionError("WORKFLOW_NOT_FOUND", "not_found");
      if (payload.code) throw new OperatorActiveMissionError(payload.code as OperatorErrorCode, payload.code, payload.current_instruction);
      return payload;
    },

    async setupExistingPublicationInstructions(input) {
      const workspace = await workspaceId(client, input.workspaceSlug);
      const result = await client.rpc("setup_existing_publication_instructions", {
        p_workspace: workspace,
        p_workflow: input.workflowId,
        p_work_item: input.workItemId,
        p_operator: input.operatorId,
        p_expected_state: input.expectedState,
        p_expected_revision: input.expectedRevision,
        p_idempotency_key: input.idempotencyKey,
        p_instructions: {
          publication_instructions: input.instructions.publicationInstructions,
          publication_window_hours: input.instructions.publicationWindowHours,
          required_disclosures: input.instructions.requiredDisclosures,
          expected_account: input.instructions.expectedAccount,
          proof_evidence_policy: input.instructions.proofEvidencePolicy,
        },
      });
      if (result.error) dbError(result.error);
      const payload = result.data as Row | null;
      if (!payload) throw new OperatorActiveMissionError("WORKFLOW_NOT_FOUND", "not_found");
      if (payload.code) {
        throw new OperatorActiveMissionError(
          payload.code as OperatorErrorCode,
          payload.code,
          payload.current_instruction,
        );
      }
      return payload;
    },
    async approveVersion(input) {
      const workspace = await workspaceId(client, input.workspaceSlug);
      return rpcData(await client.rpc("approve_mission_version", {
        p_workflow: input.workflowId, p_work_item: input.workItemId, p_version: input.versionId,
        p_operator: input.operatorId, p_workspace: workspace, p_expected_state: input.expectedState,
      }));
    },
    async markFulfillmentShipped(input) {
      const workspace = await workspaceId(client, input.workspaceSlug);
      const result = await client.rpc("mark_mission_fulfillment_shipped", {
        p_workflow: input.workflowId, p_operator: input.operatorId, p_workspace: workspace, p_note: input.note,
      });
      if (result.error) dbError(result.error);
      if (!result.data) throw new OperatorActiveMissionError("WORKFLOW_NOT_FOUND", "not_found");
      return { fulfillment: result.data };
    },
    async startProofReview(input) {
      const workspace = await workspaceId(client, input.workspaceSlug);
      return publicationRpcData(await client.rpc("start_publication_proof_review", {
        p_workspace: workspace, p_workflow: input.workflowId, p_work_item: input.workItemId,
        p_attempt: input.attemptId, p_expected_state: input.expectedState,
        p_expected_revision: input.expectedRevision, p_operator: input.operatorId,
        p_idempotency_key: input.idempotencyKey,
      }));
    },
    async requestProofCorrection(input) {
      const workspace = await workspaceId(client, input.workspaceSlug);
      return publicationRpcData(await client.rpc("request_publication_proof_correction", {
        p_workspace: workspace, p_workflow: input.workflowId, p_work_item: input.workItemId,
        p_attempt: input.attemptId, p_expected_state: input.expectedState,
        p_expected_revision: input.expectedRevision, p_operator: input.operatorId,
        p_idempotency_key: input.idempotencyKey, p_checklist: input.checklist,
        p_items: input.corrections, p_summary: input.summary,
      }));
    },
    async verifyProof(input) {
      const workspace = await workspaceId(client, input.workspaceSlug);
      return publicationRpcData(await client.rpc("verify_publication_proof", {
        p_workspace: workspace, p_workflow: input.workflowId, p_work_item: input.workItemId,
        p_attempt: input.attemptId, p_expected_state: input.expectedState,
        p_expected_revision: input.expectedRevision, p_operator: input.operatorId,
        p_idempotency_key: input.idempotencyKey, p_checklist: input.checklist,
        p_summary: input.summary,
      }));
    },
    async refreshProofMetadata(input) {
      const workspace = await workspaceId(client, input.workspaceSlug);
      return refreshPublicationProofMetadata({
        workspaceId: workspace, workflowId: input.workflowId, workItemId: input.workItemId,
        attemptId: input.attemptId, operatorId: input.operatorId,
        expectedState: input.expectedState, expectedRevision: input.expectedRevision,
        idempotencyKey: input.idempotencyKey,
      }, {
        prepare: async (context) => {
          const payload = publicationRpcData(await client.rpc("request_publication_proof_metadata_refresh", {
            p_workspace: context.workspaceId, p_workflow: context.workflowId,
            p_work_item: context.workItemId, p_attempt: context.attemptId,
            p_expected_state: context.expectedState, p_expected_revision: context.expectedRevision,
            p_operator: context.operatorId, p_idempotency_key: context.idempotencyKey,
          })) as Row;
          if (payload.idempotent) return { primaryUrl: "", platform: null, idempotent: true, result: payload };
          if (typeof payload.primary_url !== "string") {
            throw new OperatorActiveMissionError("VALIDATION_FAILED", "Invalid publication proof refresh target");
          }
          return {
            primaryUrl: payload.primary_url,
            platform: typeof payload.platform === "string" ? payload.platform : null,
          };
        },
        inspect: (target) => inspectProofUrl(target),
        complete: async (metadata) => publicationRpcData(await client.rpc("complete_publication_proof_metadata_refresh", {
          p_workspace: workspace, p_workflow: input.workflowId, p_work_item: input.workItemId,
          p_attempt: input.attemptId, p_expected_state: input.expectedState,
          p_expected_revision: input.expectedRevision, p_operator: input.operatorId,
          p_idempotency_key: input.idempotencyKey,
          p_metadata_status: metadata.metadataStatus,
          p_metadata_snapshot: metadata.metadataSnapshot,
          p_metadata_error_category: metadata.metadataErrorCategory,
        })),
      });
    },
  };
}

function statusFor(code: OperatorErrorCode) {
  if (code === "WORKFLOW_NOT_FOUND" || code === "NOT_AUTHORIZED") return 404;
  if (code === "VALIDATION_FAILED") return 400;
  if (code === "WORKFLOW_STALE" || code === "WRONG_STATE"
    || code === "REVISION_LIMIT_REACHED" || code === "PUBLICATION_SETUP_REQUIRED"
    || code === "IDEMPOTENCY_CONFLICT") return 409;
  return 500;
}

function routeError(c: Context<AdminEnv>, error: unknown) {
  if (error instanceof OperatorActiveMissionError) {
    return c.json({ error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) }, statusFor(error.code));
  }
  return c.json({ error: "Operator active mission request failed", code: "UNKNOWN" }, 500);
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function uuid(value: unknown) {
  const candidate = text(value);
  return candidate && UUID_PATTERN.test(candidate) ? candidate : null;
}

function pathUuid(c: Context<AdminEnv>, name: "workflowId" | "workItemId" | "attemptId") {
  const value = uuid(c.req.param(name));
  if (!value) throw new OperatorActiveMissionError("VALIDATION_FAILED", `${name} must be a UUID`);
  return value;
}

function reviewItems(value: unknown): ReviewItemInput[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const categories = new Set(["format", "key_message", "compliance", "quality", "other"]);
  const items = value.map((row) => {
    if (!row || typeof row !== "object" || !categories.has((row as Row).category)) return null;
    const body = text((row as Row).text);
    const rawRequirementId = (row as Row).requirementId;
    const requirementId = rawRequirementId === null || rawRequirementId === undefined || rawRequirementId === ""
      ? null : uuid(rawRequirementId);
    if (!body || (rawRequirementId !== null && rawRequirementId !== undefined && rawRequirementId !== "" && !requirementId)) return null;
    return { requirementId, category: (row as Row).category, text: body, required: (row as Row).required !== false } as ReviewItemInput;
  });
  return items.every(Boolean) ? items as ReviewItemInput[] : null;
}

function publicationInstructionInput(value: unknown): PublicationInstructionInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Row;
  const publicationInstructions = text(row.publicationInstructions);
  const publicationWindowHours = row.publicationWindowHours;
  const disclosures = row.requiredDisclosures;
  const expectedAccount = row.expectedAccount === null || row.expectedAccount === undefined ? null : text(row.expectedAccount);
  const proofEvidencePolicy = row.proofEvidencePolicy;
  if (!publicationInstructions
    || !Number.isInteger(publicationWindowHours) || publicationWindowHours <= 0
    || publicationWindowHours > MAX_PUBLICATION_WINDOW_HOURS
    || !Array.isArray(disclosures) || !disclosures.every((entry) => typeof entry === "string" && entry.trim())
    || (row.expectedAccount !== null && row.expectedAccount !== undefined && !expectedAccount)
    || !proofEvidencePolicy || typeof proofEvidencePolicy !== "object" || Array.isArray(proofEvidencePolicy)) return null;
  return {
    publicationInstructions,
    publicationWindowHours,
    requiredDisclosures: disclosures.map((entry) => entry.trim()),
    expectedAccount,
    proofEvidencePolicy: proofEvidencePolicy as Record<string, unknown>,
  };
}

function proofReviewItems(value: unknown): ProofReviewItemInput[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const categories = new Set(["access", "platform", "account", "content", "timing", "disclosure", "evidence", "other"]);
  const items = value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const row = entry as Row;
    const body = text(row.text);
    const position = row.position ?? index;
    if (!categories.has(row.category) || !body || !Number.isInteger(position) || position < 0) return null;
    return { category: row.category, text: body, position } as ProofReviewItemInput;
  });
  return items.every(Boolean) ? items as ProofReviewItemInput[] : null;
}

function proofMutation(c: Context<AdminEnv>, body: Row, expectedState: string) {
  const attemptId = uuid(body.attemptId);
  const state = text(body.expectedState);
  const expectedRevision = body.expectedRevision;
  const idempotencyKey = uuid(c.req.header("Idempotency-Key") ?? body.idempotencyKey);
  if (!attemptId || state !== expectedState || !Number.isInteger(expectedRevision) || expectedRevision < 0 || !idempotencyKey) {
    throw new OperatorActiveMissionError("VALIDATION_FAILED", "Exact attempt, expected state/revision, and Idempotency-Key are required");
  }
  return { attemptId, expectedState: state, expectedRevision, idempotencyKey };
}

function proofChecklist(value: unknown): ProofChecklist {
  try {
    validateProofChecklist(value);
    return value;
  } catch {
    throw new OperatorActiveMissionError("VALIDATION_FAILED", "A complete six-item proof checklist is required");
  }
}

function optionalSummary(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const summary = text(value);
  if (!summary || summary.length > 2000) throw new OperatorActiveMissionError("VALIDATION_FAILED", "summary must be at most 2000 characters");
  return summary;
}

type IdentityProvider = (c: Context<AdminEnv>) => StaffIdentity;

export function createAdminActiveMissionRoutes(
  injectedRepository?: AdminActiveMissionRepository,
  identity: IdentityProvider = (c) => c.get("staff"),
) {
  const routes = new Hono<AdminEnv>();
  const repository = () => injectedRepository ?? createAdminActiveMissionRepository(serviceClient());
  const context = (c: Context<AdminEnv>) => {
    const workspaceSlug = text(c.req.header("X-Workspace-Slug"));
    const operatorId = identity(c).userId;
    if (!workspaceSlug) throw new OperatorActiveMissionError("VALIDATION_FAILED", "X-Workspace-Slug is required");
    if (!operatorId) throw new OperatorActiveMissionError("NOT_AUTHORIZED", "A staff user session is required");
    return { workspaceSlug, operatorId };
  };

  routes.get("/queue", async (c) => {
    try {
      const { workspaceSlug, operatorId } = context(c);
      return c.json(await repository().listQueue({
        workspaceSlug,
        state: text(c.req.query("state")) ?? undefined,
        reviewerId: text(c.req.query("reviewer")) ?? undefined,
        operatorId,
        missionId: text(c.req.query("mission")) ?? undefined,
        risk: text(c.req.query("risk")) ?? undefined,
        proofState: text(c.req.query("proofState")) ?? undefined,
        late: c.req.query("late") === undefined ? undefined : c.req.query("late") === "true",
        metadataStatus: text(c.req.query("metadataStatus")) ?? undefined,
        platform: text(c.req.query("platform")) ?? undefined,
        publicationDeadline: text(c.req.query("publicationDeadline")) ?? undefined,
      }));
    } catch (error) { return routeError(c, error); }
  });

  routes.get("/:workflowId", async (c) => {
    try {
      const { workspaceSlug, operatorId } = context(c);
      const workflowId = pathUuid(c, "workflowId");
      return c.json(await repository().getDetail({ workflowId, workspaceSlug, operatorId, signedUrlTtlSeconds: SIGNED_URL_TTL_SECONDS }));
    } catch (error) { return routeError(c, error); }
  });

  routes.post("/:workflowId/work-items/:workItemId/start-review", async (c) => {
    try {
      const ctx = context(c);
      const workflowId = pathUuid(c, "workflowId");
      const workItemId = pathUuid(c, "workItemId");
      const body: Row = await c.req.json<Row>().catch(() => ({} as Row));
      const expectedState = text(body.expectedState);
      if (!expectedState || !EXPECTED_REVIEW_STATES.has(expectedState)) throw new OperatorActiveMissionError("VALIDATION_FAILED", "expectedState is required");
      return c.json(await repository().startReview({ workflowId, workItemId, ...ctx, expectedState }));
    } catch (error) { return routeError(c, error); }
  });

  routes.post("/:workflowId/work-items/:workItemId/request-revision", async (c) => {
    try {
      const ctx = context(c);
      const workflowId = pathUuid(c, "workflowId");
      const workItemId = pathUuid(c, "workItemId");
      const body: Row = await c.req.json<Row>().catch(() => ({} as Row));
      const expectedState = text(body.expectedState);
      const versionId = uuid(body.versionId);
      const deadline = text(body.deadline) ?? null;
      const items = reviewItems(body.items);
      if (!expectedState || !EXPECTED_REVIEW_STATES.has(expectedState) || !versionId || !items || (deadline !== null && timestamp(deadline, 0) <= Date.now())) {
        throw new OperatorActiveMissionError("VALIDATION_FAILED", "A current version, state, optional future deadline, and feedback items are required");
      }
      return c.json(await repository().requestRevision({ workflowId, workItemId, ...ctx, expectedState, versionId, deadline, items }));
    } catch (error) { return routeError(c, error); }
  });

  routes.post("/:workflowId/work-items/:workItemId/grant-revision", async (c) => {
    try {
      const ctx = context(c);
      const workflowId = pathUuid(c, "workflowId");
      const workItemId = pathUuid(c, "workItemId");
      const body: Row = await c.req.json<Row>().catch(() => ({} as Row));
      const reason = text(body.reason);
      const grantedCount = body.grantedCount ?? 1;
      if (!reason || !Number.isInteger(grantedCount) || grantedCount < 1) throw new OperatorActiveMissionError("VALIDATION_FAILED", "A reason and positive grant count are required");
      return c.json(await repository().grantRevision({ workflowId, workItemId, ...ctx, reason, grantedCount }));
    } catch (error) { return routeError(c, error); }
  });

  routes.put("/:workflowId/work-items/:workItemId/publication-instructions", async (c) => {
    try {
      const ctx = context(c);
      const workflowId = pathUuid(c, "workflowId");
      const workItemId = pathUuid(c, "workItemId");
      const body: Row = await c.req.json<Row>().catch(() => ({} as Row));
      const expectedState = text(body.expectedState);
      const expectedRevision = body.expectedRevision;
      const idempotencyKey = uuid(body.idempotencyKey);
      const overrideReason = text(body.overrideReason);
      const instructions = publicationInstructionInput(body.instructions);
      if (!expectedState || !Number.isInteger(expectedRevision) || expectedRevision < 0
        || !idempotencyKey || !overrideReason || !instructions) {
        throw new OperatorActiveMissionError("VALIDATION_FAILED", "Complete instructions, expected state/revision, idempotency key, and override reason are required");
      }
      return c.json(await repository().setPublicationInstructions({
        workflowId, workItemId, ...ctx, expectedState, expectedRevision, idempotencyKey, overrideReason, instructions,
      }));
    } catch (error) { return routeError(c, error); }
  });

  routes.post("/:workflowId/work-items/:workItemId/publication-setup", async (c) => {
    try {
      const ctx = context(c);
      const workflowId = pathUuid(c, "workflowId");
      const workItemId = pathUuid(c, "workItemId");
      const body: Row = await c.req.json<Row>().catch(() => ({} as Row));
      const expectedState = text(body.expectedState);
      const expectedRevision = body.expectedRevision;
      const idempotencyKey = uuid(body.idempotencyKey);
      const instructions = publicationInstructionInput(body.instructions);
      if (expectedState !== "approved_to_publish"
        || !Number.isInteger(expectedRevision) || expectedRevision < 0
        || !idempotencyKey || !instructions) {
        throw new OperatorActiveMissionError(
          "VALIDATION_FAILED",
          "Complete instructions, approved state/revision, and idempotency key are required",
        );
      }
      return c.json(await repository().setupExistingPublicationInstructions({
        workflowId, workItemId, ...ctx, expectedState, expectedRevision, idempotencyKey, instructions,
      }));
    } catch (error) { return routeError(c, error); }
  });

  routes.post("/:workflowId/work-items/:workItemId/approve-to-publish", async (c) => {
    try {
      const ctx = context(c);
      const workflowId = pathUuid(c, "workflowId");
      const workItemId = pathUuid(c, "workItemId");
      const body: Row = await c.req.json<Row>().catch(() => ({} as Row));
      const expectedState = text(body.expectedState);
      const versionId = uuid(body.versionId);
      if (!expectedState || !EXPECTED_REVIEW_STATES.has(expectedState) || !versionId) throw new OperatorActiveMissionError("VALIDATION_FAILED", "A current version and state are required");
      return c.json(await repository().approveVersion({ workflowId, workItemId, ...ctx, expectedState, versionId }));
    } catch (error) { return routeError(c, error); }
  });

  routes.post("/:workflowId/fulfillment/shipped", async (c) => {
    try {
      const ctx = context(c);
      const workflowId = pathUuid(c, "workflowId");
      const body: Row = await c.req.json<Row>().catch(() => ({} as Row));
      return c.json(await repository().markFulfillmentShipped({ workflowId, ...ctx, note: text(body.note) }));
    } catch (error) { return routeError(c, error); }
  });

  routes.post("/:workflowId/work-items/:workItemId/proof-review/start", async (c) => {
    try {
      const ctx = context(c);
      const workflowId = pathUuid(c, "workflowId");
      const workItemId = pathUuid(c, "workItemId");
      const body: Row = await c.req.json<Row>().catch(() => ({} as Row));
      const mutation = proofMutation(c, body, "proof_submitted");
      return c.json(await repository().startProofReview({ workflowId, workItemId, ...ctx, ...mutation }));
    } catch (error) { return routeError(c, error); }
  });

  routes.post("/:workflowId/work-items/:workItemId/proof-review/corrections", async (c) => {
    try {
      const ctx = context(c);
      const workflowId = pathUuid(c, "workflowId");
      const workItemId = pathUuid(c, "workItemId");
      const body: Row = await c.req.json<Row>().catch(() => ({} as Row));
      const mutation = proofMutation(c, body, "proof_under_review");
      const checklist = proofChecklist(body.checklist);
      const corrections = proofReviewItems(body.corrections);
      if (!corrections) throw new OperatorActiveMissionError("VALIDATION_FAILED", "At least one categorized correction is required");
      return c.json(await repository().requestProofCorrection({
        workflowId, workItemId, ...ctx, ...mutation, checklist, corrections, summary: optionalSummary(body.summary),
      }));
    } catch (error) { return routeError(c, error); }
  });

  routes.post("/:workflowId/work-items/:workItemId/proof-review/verify", async (c) => {
    try {
      const ctx = context(c);
      const workflowId = pathUuid(c, "workflowId");
      const workItemId = pathUuid(c, "workItemId");
      const body: Row = await c.req.json<Row>().catch(() => ({} as Row));
      const mutation = proofMutation(c, body, "proof_under_review");
      const checklist = proofChecklist(body.checklist);
      if (Object.values(checklist).some((answer) => !answer)) throw new OperatorActiveMissionError("VALIDATION_FAILED", "Every proof checklist item must pass before verification");
      return c.json(await repository().verifyProof({
        workflowId, workItemId, ...ctx, ...mutation, checklist, summary: optionalSummary(body.summary),
      }));
    } catch (error) { return routeError(c, error); }
  });

  routes.post("/:workflowId/work-items/:workItemId/proofs/:attemptId/metadata-refresh", async (c) => {
    try {
      const ctx = context(c);
      const workflowId = pathUuid(c, "workflowId");
      const workItemId = pathUuid(c, "workItemId");
      const attemptId = pathUuid(c, "attemptId");
      const body: Row = await c.req.json<Row>().catch(() => ({} as Row));
      const expectedState = text(body.expectedState);
      if (!expectedState || (!PROOF_QUEUE_STATES.includes(expectedState) && expectedState !== "proof_verified")) {
        throw new OperatorActiveMissionError("VALIDATION_FAILED", "Proof metadata cannot be refreshed in this state");
      }
      const mutation = proofMutation(c, { ...body, attemptId }, expectedState);
      return c.json(await repository().refreshProofMetadata({ workflowId, workItemId, ...ctx, ...mutation }));
    } catch (error) { return routeError(c, error); }
  });

  return routes;
}

export const adminActiveMissionRoutes = createAdminActiveMissionRoutes();
