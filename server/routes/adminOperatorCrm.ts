import { Hono } from "hono";
import type { Context } from "hono";
import {
  listCreatorShortlistMemberships,
  listMissionShortlist,
  OperatorCrmError,
  updateMissionShortlistStatus,
  upsertMissionShortlist,
} from "../lib/operatorCrm/repo.js";
import {
  nonEmptyText,
  parseNoteCategory,
  parseReviewStatus,
  parseRiskLevel,
  parseShortlistSource,
  parseShortlistStatus,
} from "../lib/operatorCrm/serializers.js";
import { serviceClient } from "../lib/supabase.js";
import type { AdminEnv } from "../lib/staffAuth.js";
import { CreatorCaseError } from "../lib/creatorCase/errors.js";
import type { CreatorCaseRepository } from "../lib/creatorCase/repository.js";
import { SupabaseCreatorCaseRepository } from "../lib/creatorCase/supabaseRepository.js";
import type { CreatorCaseCommandContext, CreatorCaseReadContext } from "../lib/creatorCase/types.js";

export type CreateAdminOperatorCrmRoutesOptions = {
  creatorCaseRepository?: CreatorCaseRepository;
  creatorCaseRepositoryFactory?: () => CreatorCaseRepository;
  creatorShortlistProjection?: (creatorId: string, workspaceId: string) => Promise<unknown[]>;
};

function operatorContext(c: Context<AdminEnv>) {
  const staff = c.get("staff");
  // Break-glass (shared secret) keeps honoring the legacy client headers so the existing
  // secret-based tests + emergency curl preserve their attribution. Real JWT staff always
  // get their unspoofable identity (B3b removes the break-glass branch entirely).
  if (staff.viaSecret) {
    return {
      operatorId: c.req.header("x-operator-id")?.trim() || "shared-secret",
      actorLabel: c.req.header("x-operator-label")?.trim() || "Admin operator",
    };
  }
  return { operatorId: staff.userId!, actorLabel: staff.email };
}

function creatorCaseReadContext(c: Context<AdminEnv>): CreatorCaseReadContext {
  const workspaceId = nonEmptyText(c.req.query("workspace"));
  if (!workspaceId) throw new CreatorCaseError("workspace_required", "Workspace is required");
  const operator = operatorContext(c);
  return { workspaceId, actorId: operator.operatorId, actorLabel: operator.actorLabel };
}

function creatorCaseCommandContext(c: Context<AdminEnv>, commandId: unknown): CreatorCaseCommandContext {
  const context = creatorCaseReadContext(c);
  const normalizedCommandId = nonEmptyText(commandId);
  if (!normalizedCommandId) throw new CreatorCaseError("command_conflict", "command_id is required");
  return { ...context, commandId: normalizedCommandId };
}

function crmError(c: { json: (body: unknown, status?: number) => Response }, error: unknown) {
  if (!(error instanceof OperatorCrmError)) {
    return c.json({ error: "Database error", code: "db_error" }, 500);
  }

  const status =
    error.code === "creator_not_found" || error.code === "mission_not_found" || error.code === "shortlist_not_found"
      ? 404
      : error.code === "flagged_invite_blocked"
        ? 409
        : error.code === "db_error"
          ? 500
          : 400;

  return c.json({ error: error.message, code: error.code }, status);
}

function creatorCaseError(c: { json: (body: unknown, status?: number) => Response }, error: unknown) {
  if (!(error instanceof CreatorCaseError)) {
    return c.json({ error: "Creator case request failed", code: "db_error", correlationId: crypto.randomUUID() }, 500);
  }

  if (error.code === "creator_not_found" || error.code === "workspace_mismatch") {
    return c.json({ error: "Creator not found", code: "creator_not_found" }, 404);
  }
  if (error.code === "command_conflict") {
    return c.json({ error: error.publicMessage, code: error.code }, 409);
  }
  if (
    error.code === "workspace_required" ||
    error.code === "bad_review_status" ||
    error.code === "bad_risk_level" ||
    error.code === "bad_note_category" ||
    error.code === "bad_note_body" ||
    error.code === "flagged_review_note_required"
  ) {
    return c.json({ error: error.publicMessage, code: error.code }, 422);
  }
  if (error.code === "mission_not_found") {
    return c.json({ error: "Mission not found", code: error.code }, 404);
  }
  return c.json(
    { error: "Creator case request failed", code: "db_error", correlationId: error.correlationId ?? crypto.randomUUID() },
    500,
  );
}

function defaultCreatorCaseRepositoryFactory(): CreatorCaseRepository {
  return new SupabaseCreatorCaseRepository(serviceClient());
}

export function createAdminOperatorCrmRoutes(
  options: CreateAdminOperatorCrmRoutesOptions = {},
): Hono<AdminEnv> {
  const repositoryFactory = options.creatorCaseRepositoryFactory ?? defaultCreatorCaseRepositoryFactory;
  const creatorCaseRepository = () => options.creatorCaseRepository ?? repositoryFactory();
  const creatorShortlistProjection = options.creatorShortlistProjection ?? ((creatorId: string, workspaceId: string) =>
    listCreatorShortlistMemberships(serviceClient(), creatorId, workspaceId));
  const routes = new Hono<AdminEnv>();

  routes.get("/creators/review", async (c) => {
  const page = Math.max(Number(c.req.query("page") ?? 1), 1);
  const pageSize = Math.min(Math.max(Number(c.req.query("page_size") ?? 25), 1), 100);
  const statusQuery = c.req.query("status");
  const riskQuery = c.req.query("risk_level");
  const status = statusQuery ? (parseReviewStatus(statusQuery) ?? undefined) : undefined;
  const riskLevel = riskQuery ? (parseRiskLevel(riskQuery) ?? undefined) : undefined;

  if (statusQuery && !status) return creatorCaseError(c, new CreatorCaseError("bad_review_status", "Invalid review status"));
  if (riskQuery && !riskLevel) return creatorCaseError(c, new CreatorCaseError("bad_risk_level", "Invalid risk level"));

  try {
    return c.json(await creatorCaseRepository().listReviewQueue(creatorCaseReadContext(c), {
        status,
        riskLevel,
        missionId: nonEmptyText(c.req.query("mission_id")) ?? undefined,
        q: nonEmptyText(c.req.query("q")) ?? undefined,
        page,
        pageSize,
        sort: (c.req.query("sort") as "last_activity" | "trust_score" | "level" | "social_freshness") || "last_activity",
      }));
  } catch (error) {
    return creatorCaseError(c, error);
  }
  });

  routes.get("/creators/:id", async (c) => {
  try {
    const context = creatorCaseReadContext(c);
    const creatorCase = await creatorCaseRepository().getCase(context, c.req.param("id"));
    const shortlists = await creatorShortlistProjection(c.req.param("id"), context.workspaceId);
    return c.json({ ...creatorCase, shortlists });
  } catch (error) {
    return creatorCaseError(c, error);
  }
  });

  routes.post("/creators/:id/review", async (c) => {
  const body = await c.req
    .json<{ command_id?: unknown; status?: unknown; risk_level?: unknown; summary?: unknown; note?: unknown }>()
    .catch(() => ({}) as { command_id?: unknown; status?: unknown; risk_level?: unknown; summary?: unknown; note?: unknown });
  const status = parseReviewStatus(body.status);
  const riskLevel = parseRiskLevel(body.risk_level);
  const note = nonEmptyText(body.note);

  if (!status) return creatorCaseError(c, new CreatorCaseError("bad_review_status", "Invalid review status"));
  if (!riskLevel) return creatorCaseError(c, new CreatorCaseError("bad_risk_level", "Invalid risk level"));
  if (status === "flagged" && !note) {
    return creatorCaseError(c, new CreatorCaseError("flagged_review_note_required", "Flagged reviews require a note"));
  }

  try {
    const creatorCase = await creatorCaseRepository().applyReview(creatorCaseCommandContext(c, body.command_id), {
      creatorId: c.req.param("id"),
      status,
      riskLevel,
      summary: nonEmptyText(body.summary),
      note: note ? { category: "other", body: note } : null,
    });
    return c.json({ review: creatorCase.review });
  } catch (error) {
    return creatorCaseError(c, error);
  }
  });

  routes.post("/creators/:id/notes", async (c) => {
  const body = await c.req
    .json<{ command_id?: unknown; category?: unknown; body?: unknown }>()
    .catch(() => ({}) as { command_id?: unknown; category?: unknown; body?: unknown });
  const category = parseNoteCategory(body.category);
  const noteBody = nonEmptyText(body.body);

  if (!category) return creatorCaseError(c, new CreatorCaseError("bad_note_category", "Invalid note category"));
  if (!noteBody) return creatorCaseError(c, new CreatorCaseError("bad_note_body", "Note body is required"));

  try {
    const creatorCase = await creatorCaseRepository().appendNote(creatorCaseCommandContext(c, body.command_id), {
        creatorId: c.req.param("id"),
        category,
        body: noteBody,
      });
    return c.json({ note: creatorCase.insertedNote ?? null });
  } catch (error) {
    return creatorCaseError(c, error);
  }
  });

  routes.get("/missions/:missionId/shortlist", async (c) => {
  try {
    return c.json(await listMissionShortlist(serviceClient(), c.req.param("missionId")));
  } catch (error) {
    return crmError(c, error);
  }
  });

  routes.post("/missions/:missionId/shortlist", async (c) => {
  const body = await c.req
    .json<{ creator_id?: unknown; source?: unknown; notes?: unknown }>()
    .catch(() => ({}) as { creator_id?: unknown; source?: unknown; notes?: unknown });
  const creatorId = nonEmptyText(body.creator_id);
  const source = parseShortlistSource(body.source ?? "manual");

  if (!creatorId) return c.json({ error: "Missing creator_id", code: "bad_creator" }, 400);
  if (!source) return c.json({ error: "Invalid shortlist source", code: "bad_shortlist_source" }, 400);

  try {
    return c.json({
      shortlist: await upsertMissionShortlist(serviceClient(), {
        missionId: c.req.param("missionId"),
        creatorId,
        source,
        notes: nonEmptyText(body.notes),
        context: operatorContext(c),
      }),
    });
  } catch (error) {
    return crmError(c, error);
  }
  });

  routes.patch("/missions/:missionId/shortlist/:creatorId", async (c) => {
  const body = await c.req
    .json<{ status?: unknown; notes?: unknown }>()
    .catch(() => ({}) as { status?: unknown; notes?: unknown });
  const status = parseShortlistStatus(body.status);
  const hasNotes = Object.prototype.hasOwnProperty.call(body, "notes");

  if (!status) return c.json({ error: "Invalid shortlist status", code: "bad_shortlist_status" }, 400);

  try {
    return c.json({
      shortlist: await updateMissionShortlistStatus(serviceClient(), {
        missionId: c.req.param("missionId"),
        creatorId: c.req.param("creatorId"),
        status,
        ...(hasNotes ? { notes: nonEmptyText(body.notes) } : {}),
        context: operatorContext(c),
      }),
    });
  } catch (error) {
    return crmError(c, error);
  }
  });

  return routes;
}

export const adminOperatorCrmRoutes = createAdminOperatorCrmRoutes();
export default adminOperatorCrmRoutes;
