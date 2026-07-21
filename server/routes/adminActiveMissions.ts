import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono, type Context } from "hono";
import { serviceClient } from "../lib/supabase.js";
import type { AdminEnv, StaffIdentity } from "../lib/staffAuth.js";

const ASSET_BUCKET = "mission-draft-assets";
const SIGNED_URL_TTL_SECONDS = 10 * 60;
const QUEUE_STATES = ["submitted", "under_review"];
const EXPECTED_REVIEW_STATES = new Set(QUEUE_STATES);

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
};

type QueueSortFields = {
  workItemId: string;
  reviewDueAt: string | null;
  creatorDeadline: string | null;
  submittedAt: string | null;
};

function timestamp(value: string | null | undefined, fallback = Number.POSITIVE_INFINITY) {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function sortActiveMissionQueue<T extends QueueSortFields>(items: T[], now = new Date()): T[] {
  const current = now.getTime();
  return [...items].sort((a, b) => {
    const aDue = timestamp(a.reviewDueAt);
    const bDue = timestamp(b.reviewDueAt);
    const overdue = Number(bDue < current) - Number(aDue < current);
    if (overdue !== 0) return overdue;
    return aDue - bDue
      || timestamp(a.creatorDeadline) - timestamp(b.creatorDeadline)
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
    workspaceSlug: string;
    state?: string;
    reviewerId?: string;
    missionId?: string;
    risk?: string;
  }): Promise<{ items: ActiveMissionQueueItem[] }>;
  getDetail(input: { workflowId: string; workspaceSlug: string; signedUrlTtlSeconds: number }): Promise<unknown>;
  startReview(input: TransitionBase & { expectedState: string }): Promise<unknown>;
  requestRevision(input: TransitionBase & {
    expectedState: string;
    versionId: string;
    deadline: string | null;
    items: ReviewItemInput[];
  }): Promise<unknown>;
  grantRevision(input: TransitionBase & { reason: string; grantedCount: number }): Promise<unknown>;
  approveVersion(input: TransitionBase & { expectedState: string; versionId: string }): Promise<unknown>;
  markFulfillmentShipped(input: Omit<TransitionBase, "workItemId"> & { note: string | null }): Promise<unknown>;
};

type TransitionBase = {
  workflowId: string;
  workItemId: string;
  workspaceSlug: string;
  operatorId: string;
};

type ReviewItemInput = {
  requirementId?: string | null;
  category: "format" | "key_message" | "compliance" | "quality" | "other";
  text: string;
  required?: boolean;
};

function dbError(error: { message?: string | null } | null): never {
  const message = error?.message ?? "Operator active mission database error";
  const mapped: Record<string, OperatorErrorCode> = {
    not_found: "WORKFLOW_NOT_FOUND",
    not_authorized: "NOT_AUTHORIZED",
    validation_failed: "VALIDATION_FAILED",
    stale: "WORKFLOW_STALE",
    wrong_state: "WRONG_STATE",
    revision_limit_reached: "REVISION_LIMIT_REACHED",
  };
  throw new OperatorActiveMissionError(mapped[message] ?? "UNKNOWN", message);
}

async function workspaceId(client: SupabaseClient, slug: string) {
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

export function createAdminActiveMissionRepository(client: SupabaseClient): AdminActiveMissionRepository {
  return {
    async listQueue(input) {
      const workspace = await workspaceId(client, input.workspaceSlug);
      let query = client.from("mission_work_items")
        .select("id, mission_workflow_id, title, state, deadline, review_due_at, current_reviewer_id, current_submitted_version_id")
        .eq("workspace_id", workspace)
        .in("state", input.state ? [input.state] : QUEUE_STATES);
      if (input.reviewerId) query = query.eq("current_reviewer_id", input.reviewerId);
      const itemsResult = await query;
      if (itemsResult.error) dbError(itemsResult.error);
      const itemRows = (itemsResult.data ?? []) as Row[];
      if (itemRows.length === 0) return { items: [] };

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
        .select("id, mission_id, creator_id, creators!mission_submissions_creator_workspace_fk(display_name), missions!mission_submissions_mission_workspace_fk(title)")
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
        return [{
          workflowId: workflow.id,
          workItemId: row.id,
          missionId: submission.mission_id,
          creatorDisplayName: creator?.display_name ?? "Creator",
          missionTitle: mission?.title ?? "Mission",
          deliverableTitle: row.title,
          state: row.state,
          creatorDeadline: row.deadline ?? null,
          submittedAt: version?.submitted_at ?? null,
          reviewDueAt: row.review_due_at ?? null,
          reviewerId: row.current_reviewer_id ?? null,
          riskBucket: riskBucket(row.review_due_at ?? null, now),
        }];
      });
      if (input.risk) items = items.filter((item) => item.riskBucket === input.risk);
      return { items: sortActiveMissionQueue(items, new Date(now)) };
    },

    async getDetail(input) {
      const workspace = await workspaceId(client, input.workspaceSlug);
      const workflow = requireData<Row>(await client.from("mission_workflows")
        .select("*").eq("id", input.workflowId).eq("workspace_id", workspace).maybeSingle());
      const submission = requireData<Row>(await client.from("mission_submissions")
        .select("*, creators!mission_submissions_creator_workspace_fk(id, display_name), missions!mission_submissions_mission_workspace_fk(*)")
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
        client.from("mission_review_rounds").select("*, mission_review_items(*)").eq("workspace_id", workspace).in("mission_work_item_id", itemIds).order("round_number"),
        client.from("mission_revision_grants").select("*").eq("workspace_id", workspace).in("mission_work_item_id", itemIds).order("granted_at"),
      ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
      for (const result of [versionsResult, reviewsResult, grantsResult]) if (result.error) dbError(result.error);

      const assets = await Promise.all(((assetsResult.data ?? []) as Row[]).map(async (asset) => {
        const signed = await client.storage.from(ASSET_BUCKET)
          .createSignedUrl(asset.storage_object_path, input.signedUrlTtlSeconds);
        if (signed.error || !signed.data) dbError(signed.error);
        return { ...asset, signedUrl: signed.data.signedUrl };
      }));
      return {
        workflow,
        submission,
        workItems: itemsResult.data ?? [],
        fulfillment: fulfillmentResult.data ?? null,
        versions: versionsResult.data ?? [],
        reviews: reviewsResult.data ?? [],
        grants: grantsResult.data ?? [],
        events: eventsResult.data ?? [],
        assets,
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
  };
}

function statusFor(code: OperatorErrorCode) {
  if (code === "WORKFLOW_NOT_FOUND" || code === "NOT_AUTHORIZED") return 404;
  if (code === "VALIDATION_FAILED") return 400;
  if (code === "WORKFLOW_STALE" || code === "WRONG_STATE" || code === "REVISION_LIMIT_REACHED") return 409;
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

function pathUuid(c: Context<AdminEnv>, name: "workflowId" | "workItemId") {
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
      const { workspaceSlug } = context(c);
      return c.json(await repository().listQueue({
        workspaceSlug,
        state: text(c.req.query("state")) ?? undefined,
        reviewerId: text(c.req.query("reviewer")) ?? undefined,
        missionId: text(c.req.query("mission")) ?? undefined,
        risk: text(c.req.query("risk")) ?? undefined,
      }));
    } catch (error) { return routeError(c, error); }
  });

  routes.get("/:workflowId", async (c) => {
    try {
      const { workspaceSlug } = context(c);
      const workflowId = pathUuid(c, "workflowId");
      return c.json(await repository().getDetail({ workflowId, workspaceSlug, signedUrlTtlSeconds: SIGNED_URL_TTL_SECONDS }));
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

  return routes;
}

export const adminActiveMissionRoutes = createAdminActiveMissionRoutes();
