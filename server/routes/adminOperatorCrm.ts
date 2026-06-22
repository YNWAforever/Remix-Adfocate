import { Hono } from "hono";
import type { Context } from "hono";
import {
  addCreatorReviewNote,
  getCreatorOperatorDetail,
  listCreatorReviewQueue,
  listMissionShortlist,
  OperatorCrmError,
  updateCreatorReview,
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

export const adminOperatorCrmRoutes = new Hono<AdminEnv>();

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

adminOperatorCrmRoutes.get("/creators/review", async (c) => {
  const page = Math.max(Number(c.req.query("page") ?? 1), 1);
  const pageSize = Math.min(Math.max(Number(c.req.query("page_size") ?? 25), 1), 100);
  const statusQuery = c.req.query("status");
  const riskQuery = c.req.query("risk_level");
  const status = statusQuery ? (parseReviewStatus(statusQuery) ?? undefined) : undefined;
  const riskLevel = riskQuery ? (parseRiskLevel(riskQuery) ?? undefined) : undefined;

  if (statusQuery && !status) return c.json({ error: "Invalid review status", code: "bad_review_status" }, 400);
  if (riskQuery && !riskLevel) return c.json({ error: "Invalid risk level", code: "bad_risk_level" }, 400);

  try {
    return c.json(
      await listCreatorReviewQueue(serviceClient(), {
        status,
        riskLevel,
        missionId: nonEmptyText(c.req.query("mission_id")) ?? undefined,
        q: nonEmptyText(c.req.query("q")) ?? undefined,
        workspace: c.req.query("workspace") || undefined,
        page,
        pageSize,
        sort: (c.req.query("sort") as "last_activity" | "trust_score" | "level" | "social_freshness") || "last_activity",
      }),
    );
  } catch (error) {
    return crmError(c, error);
  }
});

adminOperatorCrmRoutes.get("/creators/:id", async (c) => {
  try {
    return c.json(await getCreatorOperatorDetail(serviceClient(), c.req.param("id")));
  } catch (error) {
    return crmError(c, error);
  }
});

adminOperatorCrmRoutes.post("/creators/:id/review", async (c) => {
  const body = await c.req
    .json<{ status?: unknown; risk_level?: unknown; summary?: unknown; note?: unknown }>()
    .catch(() => ({}) as { status?: unknown; risk_level?: unknown; summary?: unknown; note?: unknown });
  const status = parseReviewStatus(body.status);
  const riskLevel = parseRiskLevel(body.risk_level);
  const note = nonEmptyText(body.note);

  if (!status) return c.json({ error: "Invalid review status", code: "bad_review_status" }, 400);
  if (!riskLevel) return c.json({ error: "Invalid risk level", code: "bad_risk_level" }, 400);
  if (status === "flagged" && !note) {
    return c.json({ error: "Flagged reviews require a note", code: "flagged_review_note_required" }, 400);
  }

  try {
    const review = await updateCreatorReview(serviceClient(), {
      creatorId: c.req.param("id"),
      status,
      riskLevel,
      summary: nonEmptyText(body.summary),
      note,
      context: operatorContext(c),
    });
    return c.json({ review });
  } catch (error) {
    return crmError(c, error);
  }
});

adminOperatorCrmRoutes.post("/creators/:id/notes", async (c) => {
  const body = await c.req
    .json<{ category?: unknown; body?: unknown }>()
    .catch(() => ({}) as { category?: unknown; body?: unknown });
  const category = parseNoteCategory(body.category);
  const noteBody = nonEmptyText(body.body);

  if (!category) return c.json({ error: "Invalid note category", code: "bad_note_category" }, 400);
  if (!noteBody) return c.json({ error: "Missing note body", code: "bad_note_body" }, 400);

  try {
    return c.json({
      note: await addCreatorReviewNote(serviceClient(), {
        creatorId: c.req.param("id"),
        category,
        body: noteBody,
        context: operatorContext(c),
      }),
    });
  } catch (error) {
    return crmError(c, error);
  }
});

adminOperatorCrmRoutes.get("/missions/:missionId/shortlist", async (c) => {
  try {
    return c.json(await listMissionShortlist(serviceClient(), c.req.param("missionId")));
  } catch (error) {
    return crmError(c, error);
  }
});

adminOperatorCrmRoutes.post("/missions/:missionId/shortlist", async (c) => {
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

adminOperatorCrmRoutes.patch("/missions/:missionId/shortlist/:creatorId", async (c) => {
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
