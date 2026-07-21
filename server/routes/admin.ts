import { Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminOperatorCrmRoutes } from "./adminOperatorCrm.js";
import { adminMissionRoutes } from "./adminMissions.js";
import { makeUserClient, serviceClient } from "../lib/supabase.js";
import { enrichAdminMissionRows } from "../lib/operatorCrm/repo.js";
import { persistScores } from "../lib/persistScores.js";
import { shapeEngagedRoster, type EngagedSubmissionRow } from "../lib/engagedRoster.js";
import { markVerified } from "../lib/social/repo.js";
import { resolveStaff, type AdminEnv, type StaffUser } from "../lib/staffAuth.js";
import { adminContentRoutes } from "./adminContent.js";
import { adminInsightsRoutes } from "./adminInsights.js";
import { adminRadarRoutes } from "./adminRadar.js";
import { adminBrandInviteRoutes } from "./adminBrandInvites.js";
import { adminCampaignRoutes } from "./adminCampaigns.js";
import { adminAcademyRoutes } from "./adminAcademy.js";
import { adminActiveMissionRoutes } from "./adminActiveMissions.js";

/** Operator/brand admin endpoints. B3a: real per-staff Google login (staff_users),
 *  with the legacy shared secret kept as a one-release break-glass fallback (removed in B3b). */
export const adminRoutes = new Hono<AdminEnv>();

adminRoutes.use("*", async (c, next) => {
  // Break-glass (B3b removes this block): the shared secret still grants full access and
  // keeps the existing secret-based test suite + emergency curl working.
  const secret = process.env.ADMIN_SECRET;
  if (secret && c.req.header("x-admin-secret") === secret) {
    c.set("staff", { userId: null, email: "shared-secret", viaSecret: true });
    return next();
  }
  // Primary: Supabase JWT → staff_users (or allowlist auto-promote).
  const auth = c.req.header("Authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return c.json({ error: "forbidden", code: "no_admin" }, 401);
  const { data, error } = await makeUserClient(jwt).auth.getUser();
  if (error || !data.user) return c.json({ error: "invalid token", code: "bad_token" }, 401);
  let staff: StaffUser | null;
  try {
    // Pass email-verified so domain-wide (@fimmick.com) promotion only trusts a proven address.
    staff = await resolveStaff(
      serviceClient(),
      data.user.id,
      data.user.email ?? null,
      Boolean(data.user.email_confirmed_at),
    );
  } catch (err) {
    console.error("[requireStaff] resolveStaff threw:", err);
    return c.json({ error: "staff lookup failed", code: "db_error" }, 500);
  }
  if (!staff) return c.json({ error: "not staff", code: "not_staff" }, 403);
  c.set("staff", { userId: staff.user_id, email: staff.email });
  await next();
});

adminRoutes.get("/me", (c) => {
  const s = c.get("staff");
  return c.json({ staff: { userId: s.userId, email: s.email } });
});

adminRoutes.route("/", adminOperatorCrmRoutes);
adminRoutes.route("/", adminMissionRoutes);
adminRoutes.route("/", adminContentRoutes);
adminRoutes.route("/", adminInsightsRoutes);
adminRoutes.route("/", adminRadarRoutes);
adminRoutes.route("/", adminBrandInviteRoutes);
adminRoutes.route("/", adminCampaignRoutes);
adminRoutes.route("/", adminAcademyRoutes);
adminRoutes.route("/active-missions", adminActiveMissionRoutes);

// NOTE: interim — this lists submissions across ALL workspaces (filtered only by
// status). Fine while there is a single operator + one live workspace; the Brand
// Dashboard (Slice 8) replaces this with per-workspace, role-scoped review.
adminRoutes.get("/submissions", async (c) => {
  const status = c.req.query("status") ?? "submitted";
  const ws = c.req.query("workspace");
  const svc = serviceClient();
  let q = svc
    .from("mission_submissions")
    .select(
      "id, mission_id, status, content_urls, submitted_at, created_at, creator_id, creators!inner(display_name), missions!inner(slug, title, points_reward)",
    )
    .eq("status", status);
  if (ws) q = q.eq("missions.workspace_id", ws);
  const { data, error } = await q.order("submitted_at", { ascending: true });
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
  const ws = c.req.query("workspace");
  const svc = serviceClient();
  let q = svc
    .from("mission_submissions")
    .select("id, mission_id, created_at, creator_id, creators!inner(display_name), missions!inner(slug, title, points_reward)")
    .eq("status", "applied");
  if (ws) q = q.eq("missions.workspace_id", ws);
  const { data, error } = await q.order("created_at", { ascending: true });
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
  const ws = c.req.query("workspace");
  const svc = serviceClient();
  let q = svc
    .from("mission_submissions")
    .select(
      "id, mission_id, creator_id, status, points_awarded, created_at, submitted_at, reviewed_at, review_deadline, creators!inner(id, display_name, avatar_url, level, xp), missions!inner(slug, title)",
    )
    .in("status", ["joined", "submitted", "under_review", "approved"]);
  if (ws) q = q.eq("missions.workspace_id", ws);
  const { data, error } = await q.order("created_at", { ascending: true });
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ creators: shapeEngagedRoster((data ?? []) as unknown as EngagedSubmissionRow[]) });
});

export async function acceptApplicationWithWorkflow(svc: SupabaseClient, submissionId: string) {
  const accepted = await svc.rpc("accept_application", { p_submission: submissionId });
  if (accepted.error) return { data: null, error: accepted.error, stage: "accept" as const };

  const submission = accepted.data;
  const missionResult = await svc
    .from("missions")
    .select("creator_workflow_mode")
    .eq("id", submission.mission_id)
    .maybeSingle();
  if (missionResult.error) return { data: null, error: missionResult.error, stage: "mission" as const };
  if (!missionResult.data) return { data: null, error: null, stage: "not_found" as const };

  if (missionResult.data.creator_workflow_mode === "active_workspace") {
    const workflow = await svc.rpc("create_mission_workflow", {
      p_submission: submission.id,
    });
    if (workflow.error) return { data: null, error: workflow.error, stage: "workflow" as const };
    return {
      data: { submission, workflow: workflow.data },
      error: null,
      stage: null,
    };
  }

  return { data: submission, error: null, stage: null };
}

adminRoutes.post("/applications/:id/accept", async (c) => {
  const result = await acceptApplicationWithWorkflow(serviceClient(), c.req.param("id"));
  if (result.stage === "accept" || result.stage === "workflow") {
    return c.json({ error: result.error!.message, code: "rpc_error" }, 400);
  }
  if (result.stage === "mission") {
    return c.json({ error: result.error!.message, code: "db_error" }, 500);
  }
  if (result.stage === "not_found") {
    return c.json({ error: "not_found", code: "not_found" }, 404);
  }
  return c.json(result.data);
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
