import { Hono } from "hono";
import { adminOperatorCrmRoutes } from "./adminOperatorCrm.js";
import { adminMissionRoutes } from "./adminMissions.js";
import { serviceClient } from "../lib/supabase.js";
import { enrichAdminMissionRows } from "../lib/operatorCrm/repo.js";
import { persistScores } from "../lib/persistScores.js";
import { shapeEngagedRoster, type EngagedSubmissionRow } from "../lib/engagedRoster.js";
import { markVerified } from "../lib/social/repo.js";

/** Operator-only review endpoints. Interim shared-secret auth (replaced by real
 *  admin-auth / the Brand Dashboard in Slice 8). Uses the service client. */
export const adminRoutes = new Hono();

adminRoutes.use("*", async (c, next) => {
  const secret = process.env.ADMIN_SECRET;
  const provided = c.req.header("x-admin-secret");
  if (!secret || provided !== secret) {
    return c.json({ error: "forbidden", code: "no_admin" }, 401);
  }
  await next();
});

adminRoutes.route("/", adminOperatorCrmRoutes);
adminRoutes.route("/", adminMissionRoutes);

// NOTE: interim — this lists submissions across ALL workspaces (filtered only by
// status). Fine while there is a single operator + one live workspace; the Brand
// Dashboard (Slice 8) replaces this with per-workspace, role-scoped review.
adminRoutes.get("/submissions", async (c) => {
  const status = c.req.query("status") ?? "submitted";
  const svc = serviceClient();
  const { data, error } = await svc
    .from("mission_submissions")
    .select(
      "id, mission_id, status, content_urls, submitted_at, created_at, creator_id, creators!inner(display_name), missions!inner(slug, title, points_reward)",
    )
    .eq("status", status)
    .order("submitted_at", { ascending: true });
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  try {
    return c.json({ submissions: await enrichAdminMissionRows(svc, data ?? []) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to enrich submissions";
    return c.json({ error: message, code: "db_error" }, 500);
  }
});

adminRoutes.post("/submissions/:id/approve", async (c) => {
  const body = await c.req
    .json<{ notes?: string; quality_rating?: number }>()
    .catch(() => ({}) as { notes?: string; quality_rating?: number });
  const notes = body.notes ?? null;
  const raw = body.quality_rating;
  if (raw !== undefined && raw !== null && (!Number.isInteger(raw) || raw < 1 || raw > 5)) {
    return c.json({ error: "quality_rating must be an integer 1-5", code: "bad_rating" }, 400);
  }
  const rating = raw ?? null;
  const svc = serviceClient();
  const { data, error } = await svc.rpc("approve_submission", {
    p_submission: c.req.param("id"),
    p_notes: notes,
    p_quality_rating: rating,
  });
  if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);
  await persistScores((data as { creator_id: string }).creator_id);
  return c.json(data);
});

adminRoutes.post("/submissions/:id/reject", async (c) => {
  const notes = (await c.req.json<{ notes?: string }>().catch(() => ({}) as { notes?: string })).notes ?? null;
  const svc = serviceClient();
  const { data, error } = await svc.rpc("reject_submission", { p_submission: c.req.param("id"), p_notes: notes });
  if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);
  await persistScores((data as { creator_id: string }).creator_id);
  return c.json(data);
});

// Pending applications (status='applied') across workspaces — interim single-operator
// scope, same caveat as /submissions above (Brand Dashboard replaces with role-scoped review).
adminRoutes.get("/applications", async (c) => {
  const svc = serviceClient();
  const { data, error } = await svc
    .from("mission_submissions")
    .select("id, mission_id, created_at, creator_id, creators!inner(display_name), missions!inner(slug, title, points_reward)")
    .eq("status", "applied")
    .order("created_at", { ascending: true });
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  try {
    return c.json({ applications: await enrichAdminMissionRows(svc, data ?? []) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to enrich applications";
    return c.json({ error: message, code: "db_error" }, 500);
  }
});

// Engaged users: creators with >=1 active participation (joined/submitted/under_review),
// each expandable to their active missions. Approved rows are pulled only for the
// completed/points rollups. Interim single-operator/single-workspace scope (same
// caveat as /submissions and /applications above; the Brand Dashboard replaces this).
adminRoutes.get("/engaged", async (c) => {
  const svc = serviceClient();
  const { data, error } = await svc
    .from("mission_submissions")
    .select(
      "id, mission_id, creator_id, status, points_awarded, created_at, submitted_at, reviewed_at, review_deadline, creators!inner(id, display_name, avatar_url, level, xp), missions!inner(slug, title)",
    )
    .in("status", ["joined", "submitted", "under_review", "approved"])
    .order("created_at", { ascending: true });
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ creators: shapeEngagedRoster((data ?? []) as unknown as EngagedSubmissionRow[]) });
});

adminRoutes.post("/applications/:id/accept", async (c) => {
  const svc = serviceClient();
  const { data, error } = await svc.rpc("accept_application", { p_submission: c.req.param("id") });
  if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);
  return c.json(data);
});

adminRoutes.post("/applications/:id/decline", async (c) => {
  const notes = (await c.req.json<{ notes?: string }>().catch(() => ({}) as { notes?: string })).notes ?? null;
  const svc = serviceClient();
  const { data, error } = await svc.rpc("decline_application", { p_submission: c.req.param("id"), p_notes: notes });
  if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);
  return c.json(data);
});

adminRoutes.post("/social/:accountId/verify", async (c) => {
  try {
    const account = await markVerified(serviceClient(), c.req.param("accountId"));
    return c.json({ account });
  } catch (error) {
    const ecode = typeof error === "object" && error && "code" in error ? (error.code as string) : null;
    if (ecode === "handle_taken") return c.json({ error: "Handle already verified by another creator", code: ecode }, 409);
    return c.json({ error: "Manual verify failed", code: "db_error" }, 500);
  }
});

adminRoutes.post("/gifts/:id/codes", async (c) => {
  const body = await c.req.json<{ codes?: string[] }>().catch(() => ({} as { codes?: string[] }));
  const codes = (body.codes ?? []).map((s) => s.trim()).filter(Boolean);
  if (codes.length === 0) return c.json({ error: "no codes", code: "empty_codes" }, 400);
  const giftId = c.req.param("id");
  const svc = serviceClient();

  const { data: g, error: gErr } = await svc
    .from("redemption_gifts")
    .select("id, workspace_id, stock_remaining")
    .eq("id", giftId)
    .maybeSingle();
  if (gErr) return c.json({ error: gErr.message, code: "db_error" }, 500);
  if (!g) return c.json({ error: "not_found", code: "not_found" }, 404);

  const rows = codes.map((code) => ({ gift_id: giftId, workspace_id: g.workspace_id, code }));
  const { error: insErr } = await svc.from("redemption_codes").insert(rows);
  if (insErr) {
    // 23505 = unique_violation: a code already exists in this gift's pool.
    if (insErr.code === "23505") return c.json({ error: "duplicate codes", code: "duplicate_codes" }, 409);
    return c.json({ error: insErr.message, code: "db_error" }, 500);
  }

  // Bump stock by the batch size (single operator → no contention on this read-modify-write).
  const { error: updErr } = await svc
    .from("redemption_gifts")
    .update({ stock_remaining: (g.stock_remaining ?? 0) + codes.length })
    .eq("id", giftId);
  if (updErr) return c.json({ error: updErr.message, code: "db_error" }, 500);
  return c.json({ added: codes.length });
});
