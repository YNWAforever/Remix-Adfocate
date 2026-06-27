// server/routes/brandReview.ts
import { Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "../lib/supabase.js";
import { enrichAdminMissionRows } from "../lib/operatorCrm/repo.js";
import { shapeEngagedRoster, type EngagedSubmissionRow } from "../lib/engagedRoster.js";
import { persistScores } from "../lib/persistScores.js";
import type { BrandEnv } from "../lib/brandAuth.js";

/** Brand-scoped review + payout. Mounted under requireBrand (server/routes/brand.ts), so c.var.brand
 *  is the verified identity and the workspace ALWAYS comes from it, never a request param. Reads use
 *  serviceClient (privileged) hard-filtered to brand.workspaceId because the lists join `creators`,
 *  which a brand user cannot read via RLS. Every write first verifies the target submission belongs to
 *  brand.workspaceId (→ 404 otherwise) before invoking the existing SECURITY DEFINER decision/payout
 *  RPCs. Mirrors server/routes/admin.ts review endpoints. All relative imports carry the .js extension. */

export const brandReviewRoutes = new Hono<BrandEnv>();

// True iff submission `id` belongs to a mission in `workspaceId`. Gates every brand action so a
// cross-workspace submission/application id resolves to 404 before any privileged RPC runs.
async function brandOwnsSubmission(svc: SupabaseClient, id: string, workspaceId: string): Promise<boolean> {
  const { data } = await svc
    .from("mission_submissions")
    .select("id, missions!inner(workspace_id)")
    .eq("id", id)
    .eq("missions.workspace_id", workspaceId)
    .maybeSingle();
  return Boolean(data);
}

brandReviewRoutes.get("/submissions", async (c) => {
  const ws = c.var.brand.workspaceId;
  const status = c.req.query("status") ?? "submitted";
  if (status !== "submitted" && status !== "under_review") {
    return c.json({ error: "unsupported status", code: "bad_status" }, 400);
  }
  const svc = serviceClient();
  const { data, error } = await svc
    .from("mission_submissions")
    .select(
      "id, mission_id, status, content_urls, submitted_at, created_at, creator_id, creators!inner(display_name), missions!inner(slug, title, points_reward)",
    )
    .eq("status", status)
    .eq("missions.workspace_id", ws)
    .order("submitted_at", { ascending: true });
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  try {
    return c.json({ submissions: await enrichAdminMissionRows(svc, data ?? []) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to enrich submissions";
    return c.json({ error: message, code: "db_error" }, 500);
  }
});

brandReviewRoutes.get("/applications", async (c) => {
  const ws = c.var.brand.workspaceId;
  const svc = serviceClient();
  const { data, error } = await svc
    .from("mission_submissions")
    .select(
      "id, mission_id, created_at, creator_id, creators!inner(display_name), missions!inner(slug, title, points_reward)",
    )
    .eq("status", "applied")
    .eq("missions.workspace_id", ws)
    .order("created_at", { ascending: true });
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  try {
    return c.json({ applications: await enrichAdminMissionRows(svc, data ?? []) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to enrich applications";
    return c.json({ error: message, code: "db_error" }, 500);
  }
});

brandReviewRoutes.get("/engaged", async (c) => {
  const ws = c.var.brand.workspaceId;
  const svc = serviceClient();
  const { data, error } = await svc
    .from("mission_submissions")
    .select(
      "id, mission_id, creator_id, status, points_awarded, created_at, submitted_at, reviewed_at, review_deadline, creators!inner(id, display_name, avatar_url, level, xp), missions!inner(slug, title)",
    )
    .in("status", ["joined", "submitted", "under_review", "approved"])
    .eq("missions.workspace_id", ws)
    .order("created_at", { ascending: true });
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ creators: shapeEngagedRoster((data ?? []) as unknown as EngagedSubmissionRow[]) });
});

brandReviewRoutes.post("/submissions/:id/approve", async (c) => {
  const id = c.req.param("id");
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
  if (!(await brandOwnsSubmission(svc, id, c.var.brand.workspaceId))) {
    return c.json({ error: "not_found", code: "not_found" }, 404);
  }
  const { data, error } = await svc.rpc("approve_submission", { p_submission: id, p_notes: notes, p_quality_rating: rating });
  if (error) {
    if (error.message === "insufficient_budget") return c.json({ error: "budget exhausted", code: "insufficient_budget" }, 402);
    return c.json({ error: error.message, code: "rpc_error" }, 400);
  }
  await persistScores((data as { creator_id: string }).creator_id);
  return c.json(data);
});

brandReviewRoutes.post("/submissions/:id/reject", async (c) => {
  const id = c.req.param("id");
  const notes = (await c.req.json<{ notes?: string }>().catch(() => ({}) as { notes?: string })).notes ?? null;
  const svc = serviceClient();
  if (!(await brandOwnsSubmission(svc, id, c.var.brand.workspaceId))) {
    return c.json({ error: "not_found", code: "not_found" }, 404);
  }
  const { data, error } = await svc.rpc("reject_submission", { p_submission: id, p_notes: notes });
  if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);
  await persistScores((data as { creator_id: string }).creator_id);
  return c.json(data);
});

brandReviewRoutes.post("/applications/:id/accept", async (c) => {
  const id = c.req.param("id");
  const svc = serviceClient();
  if (!(await brandOwnsSubmission(svc, id, c.var.brand.workspaceId))) {
    return c.json({ error: "not_found", code: "not_found" }, 404);
  }
  const { data, error } = await svc.rpc("accept_application", { p_submission: id });
  if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);
  return c.json(data);
});

brandReviewRoutes.post("/applications/:id/decline", async (c) => {
  const id = c.req.param("id");
  const notes = (await c.req.json<{ notes?: string }>().catch(() => ({}) as { notes?: string })).notes ?? null;
  const svc = serviceClient();
  if (!(await brandOwnsSubmission(svc, id, c.var.brand.workspaceId))) {
    return c.json({ error: "not_found", code: "not_found" }, 404);
  }
  const { data, error } = await svc.rpc("decline_application", { p_submission: id, p_notes: notes });
  if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);
  return c.json(data);
});
