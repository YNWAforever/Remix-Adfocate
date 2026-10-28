import { Hono } from "hono";
import { createHash } from "node:crypto";
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
import { adminRewardHandoffRoutes } from "./adminRewardHandoffs.js";
import { requireStaffWorkspace, assertStaffResource, StaffWorkspaceError } from "../lib/staffWorkspace.js";
import { validateSubmissionEvidence } from "../../src/lib/submissionEvidence.js";
import { requireCapability, requirePlatformCapability, staffRouteRequirement, StaffCapabilityError } from "../lib/staffCapabilities.js";
import { adminStaffAccessRoutes } from "./adminStaffAccess.js";
import { staffMissionAssistRoutes } from "./assistant.js";

/** Operator/brand admin endpoints. B3a: real per-staff Google login (staff_users),
 *  with the legacy shared secret kept as a one-release break-glass fallback (removed in B3b). */
export const adminRoutes = new Hono<AdminEnv>();

adminRoutes.use("*", async (c, next) => {
  // Break-glass (B3b removes this block): the shared secret still grants full access and
  // keeps the existing secret-based test suite + emergency curl working.
  const secret = process.env.ADMIN_SECRET;
  if (secret && c.req.header("x-admin-secret") === secret) {
    return c.json({ error: "A staff user session is required", code: "staff_session_required" }, 401);
  }
  // Primary: Supabase JWT → staff_users (or allowlist auto-promote).
  const auth = c.req.header("Authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return c.json({ error: "forbidden", code: "no_admin" }, 401);
  let authResult: Awaited<ReturnType<ReturnType<typeof makeUserClient>["auth"]["getUser"]>>;
  try { authResult = await makeUserClient(jwt).auth.getUser(); }
  catch { return c.json({ error: "Staff authentication service unavailable; retry", code: "staff_unavailable" }, 503); }
  const { data, error } = authResult;
  if (error && (!error.status || error.status >= 500)) return c.json({ error: "Staff authentication service unavailable; retry", code: "staff_unavailable" }, 503);
  if (error || !data.user) return c.json({ error: "invalid token", code: "bad_token" }, 401);
  let staff: StaffUser | null;
  try {
    // Pass email-verified so domain-wide (@fimmick.com) promotion only trusts a proven address.
    staff = await resolveStaff(
      serviceClient(),
      data.user.id,
      data.user.email ?? null,
      false, // Interactive access only reads existing grants; domain matches do not enrol staff.
    );
  } catch (err) {
    void err;
    return c.json({ error: "Staff service unavailable; retry", code: "staff_unavailable" }, 503);
  }
  if (!staff) return c.json({ error: "not staff", code: "not_staff" }, 403);
  c.set("staff", { userId: staff.user_id, email: staff.email, active: true });
  await next();
});

// Scope legacy resources before service-role reads/writes, including opaque resource IDs.
// Capabilities add to the live staff/membership gates; brand owner/member is not a staff role.
adminRoutes.use("*", async (c, next) => {
  const parts = c.req.path.split("/").filter(Boolean);
  const relative = parts.slice(parts.indexOf("admin") + 1);
  try {
    const client = serviceClient();
    const requirement = staffRouteRequirement(c.req.method, relative.join("/"));
    if (requirement.kind === "identity") return next();
    if (requirement.kind === "deny") throw new StaffCapabilityError("STAFF_ROUTE_NOT_ALLOWED", 403);
    if (requirement.kind === "platform") {
      await requirePlatformCapability(client, c.get("staff"), "content.manage");
      return next();
    }
    const requested = c.req.query("workspace") || c.req.query("ws") || c.req.header("X-Workspace-Slug") || "";
    const scope = await requireStaffWorkspace(client, c.get("staff"), requested);
    // Reject conflicting aliases rather than silently choosing the first one.
    for (const value of [c.req.query("workspace"), c.req.query("ws"), c.req.header("X-Workspace-Slug")]) {
      if (value && value !== scope.workspaceId && value !== scope.workspaceSlug) throw new StaffWorkspaceError("NOT_FOUND", 404);
    }
    c.set("authorizedWorkspace", scope);
    if (requirement.kind === "workspace") await requireCapability(client, scope, requirement.anyOf);
    const tables: Record<string, string> = {
      creators: "creators", missions: "missions", submissions: "mission_submissions",
      applications: "mission_submissions", campaigns: "campaigns", gifts: "redemption_gifts", social: "creator_social_accounts",
    };
    const [kind, id] = relative;
    if (tables[kind] && id && id !== "review") await assertStaffResource(client, scope, tables[kind], id);
    if (!["GET", "HEAD"].includes(c.req.method)) {
      const body = await c.req.raw.clone().json().catch(() => null) as Record<string, unknown> | null;
      if (body?.workspace_id && body.workspace_id !== scope.workspaceId) throw new StaffWorkspaceError("NOT_FOUND", 404);
      for (const [field, table] of [["creator_id", "creators"], ["mission_id", "missions"]]) {
        if (typeof body?.[field] === "string") await assertStaffResource(client, scope, table, body[field] as string);
      }
      if (relative[2] === "missions" && relative[3]) await assertStaffResource(client, scope, "missions", relative[3]);
      if (relative[2] === "shortlist" && relative[3]) await assertStaffResource(client, scope, "creators", relative[3]);
    }
    // Existing list handlers consume these canonical filters. Resource checks above
    // remain mandatory for mutation/detail handlers that do not use a list filter.
    const url = new URL(c.req.url);
    url.searchParams.set("workspace", scope.workspaceId);
    url.searchParams.set("ws", scope.workspaceId);
    const headers = new Headers(c.req.raw.headers);
    headers.set("X-Workspace-Slug", scope.workspaceSlug);
    c.req.raw = new Request(url, { method: c.req.method, headers,
      ...(!["GET", "HEAD"].includes(c.req.method) ? { body: await c.req.raw.clone().arrayBuffer() } : {}),
    });
    await next();
  } catch (error) {
    if (error instanceof StaffCapabilityError) return c.json({
      error: error.status === 403 ? "This action requires an assigned staff capability. Ask the workspace or platform owner to review access."
        : error.code === "STAFF_CAPABILITY_SCHEMA_REQUIRED" ? "Staff access schema is not ready. Ask the release owner to review migrations; retry after repair."
        : "Staff access could not be checked. Please retry; your input is retained.", code: error.code,
    }, error.status);
    if (error instanceof StaffWorkspaceError) return c.json({ error: error.code === "WORKSPACE_MEMBERSHIP_REQUIRED"
      ? "Signed in as staff; ask the workspace owner to assign an active membership."
      : error.code === "NOT_FOUND" ? "Not found" : "Workspace service unavailable; retry", code: error.code }, error.status);
    throw error;
  }
});

adminRoutes.get("/me", (c) => {
  const s = c.get("staff");
  return c.json({ staff: { userId: s.userId, email: s.email } });
});

adminRoutes.route("/", adminOperatorCrmRoutes);
adminRoutes.route("/", adminStaffAccessRoutes);
adminRoutes.route("/", staffMissionAssistRoutes());
adminRoutes.route("/", adminMissionRoutes);
adminRoutes.route("/", adminContentRoutes);
adminRoutes.route("/", adminInsightsRoutes);
adminRoutes.route("/", adminRadarRoutes);
adminRoutes.route("/", adminBrandInviteRoutes);
adminRoutes.route("/", adminCampaignRoutes);
adminRoutes.route("/", adminAcademyRoutes);
adminRoutes.route("/active-missions", adminActiveMissionRoutes);
adminRoutes.route("/", adminRewardHandoffRoutes);

// NOTE: interim — this lists submissions across ALL workspaces (filtered only by
// status). Fine while there is a single operator + one live workspace; the Brand
// Dashboard (Slice 8) replaces this with per-workspace, role-scoped review.
adminRoutes.get("/submissions", async (c) => {
  const status = c.req.query("status") ?? "submitted";
  const submissionId = c.req.query("submission_id");
  if (submissionId && !/^[0-9a-f-]{36}$/i.test(submissionId)) return c.json({ error: "Invalid submission", code: "bad_request" }, 400);
  const ws = c.req.query("workspace");
  const svc = serviceClient();
  let q = svc
    .from("mission_submissions")
    .select(
      "id, mission_id, status, content_urls, evidence_revision, submitted_at, created_at, creator_id, creators!inner(display_name), missions!inner(slug, title, points_reward)",
    );
  q = submissionId ? q.eq("id", submissionId) : q.eq("status", status);
  if (ws) q = q.eq("missions.workspace_id", ws);
  const { data, error } = await q.order("submitted_at", { ascending: true });
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (submissionId && !data?.length) return c.json({ error: "Not found", code: "not_found" }, 404);
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
  const evidence = await svc.from("mission_submissions").select("content_urls").eq("id", c.req.param("id")).maybeSingle();
  if (evidence.error) return c.json({ error: "Evidence lookup unavailable", code: "evidence_unavailable" }, 503);
  if (!evidence.data) return c.json({ error: "Not found", code: "not_found" }, 404);
  if (!validateSubmissionEvidence(evidence.data.content_urls).ok) return c.json({
    error: "Stored work URLs are invalid. Request correction before approval.", code: "invalid_evidence",
  }, 400);
  const { data, error } = await svc.rpc("approve_submission", {
    p_submission: c.req.param("id"),
    p_notes: notes,
    p_quality_rating: rating,
  });
  if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);
  await persistScores((data as { creator_id: string }).creator_id);
  return c.json(data);
});

adminRoutes.post("/submissions/:id/request-correction", async (c) => {
  const body = await c.req.json<{ note?: string; request_id?: string; expected_revision?: number }>().catch(() => ({} as { note?: string; request_id?: string; expected_revision?: number }));
  if (!body.note?.trim() || !body.request_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.request_id)
    || !Number.isSafeInteger(body.expected_revision) || body.expected_revision! < 0) return c.json({ error: "A reason, request UUID and revision are required", code: "bad_request" }, 400);
  const scope = c.get("authorizedWorkspace");
  const svc = serviceClient();
  try {
    // Existing receipts must reach the locked command for exact replay/payload
    // comparison even after replacement URLs and a newer revision were saved.
    const receipt = await svc.from("legacy_evidence_corrections").select("request_id")
      .eq("workspace_id", scope.workspaceId).eq("operator_id", scope.userId).eq("request_id", body.request_id).maybeSingle();
    if (receipt.error) return c.json({ error: "Correction request unavailable; retry the same request", code: "correction_unavailable" }, 503);
    if (!receipt.data) {
      const evidence = await svc.rpc("get_legacy_correction_evidence", { p_workspace: scope.workspaceId, p_submission: c.req.param("id") });
      if (evidence.error) return c.json({ error: "Evidence lookup unavailable; retry the same request", code: "correction_unavailable" }, 503);
      if (!evidence.data) return c.json({ error: "Not found", code: "not_found" }, 404);
      if (typeof evidence.data.sql_valid !== "boolean" || !Number.isSafeInteger(evidence.data.evidence_revision)) return c.json({ error: "Evidence validation unavailable; retry the same request", code: "correction_unavailable" }, 503);
      // A changed revision can mean the original request just committed after
      // the receipt read. The locked command checks its receipt before staleness.
      if (evidence.data.evidence_revision === body.expected_revision && evidence.data.sql_valid && validateSubmissionEvidence(evidence.data.content_urls).ok) return c.json({ error: "Stored work URLs are valid; this correction is unavailable", code: "wrong_state" }, 409);
    }
  } catch {
    return c.json({ error: "Correction request unavailable; retry the same request", code: "correction_unavailable" }, 503);
  }
  const result = await svc.rpc("request_legacy_evidence_correction", { p_workspace: scope.workspaceId, p_operator: scope.userId,
    p_submission: c.req.param("id"), p_request: body.request_id, p_expected_revision: body.expected_revision, p_note: body.note.trim() });
  if (result.error) {
    const code = result.error.message;
    if (["EVIDENCE_STALE", "IDEMPOTENCY_CONFLICT", "wrong_state"].includes(code)) return c.json({ error: "Record changed; reload and compare your retained input", code }, 409);
    if (code === "not_found" || code === "FORBIDDEN") return c.json({ error: "Not found", code: "not_found" }, 404);
    return c.json({ error: "Correction request unavailable; retry the same request", code: "correction_unavailable" }, 503);
  }
  return c.json(result.data);
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

for (const action of ["accept", "decline"] as const) {
  adminRoutes.post(`/applications/:id/${action}`, async (c) => {
    let body: { notes?: unknown; request_id?: unknown; expected_revision?: unknown } | null = null;
    try { const text = await c.req.text(); body = text.trim() ? JSON.parse(text) : {}; } catch { /* Reject malformed non-empty JSON below. */ }
    if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "Invalid application command", code: "invalid_command" }, 400);
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;
    if (action === "decline" && !notes) return c.json({ error: "請填寫拒絕原因 / A decline reason is required", code: "application_reason_required" }, 400);
    if (typeof body.notes === "string" && [...body.notes].length > 500) return c.json({ error: "原因上限為 500 字 / Limit: 500 characters", code: "application_reason_too_long" }, 400);
    const revision = body.expected_revision ?? 0;
    if (!Number.isSafeInteger(revision) || Number(revision) < 0) return c.json({ error: "Invalid application revision", code: "invalid_command" }, 400);
    const scope = c.get("authorizedWorkspace"), operator = c.get("staff").userId!;
    // Older callers send {}. Their logical decision still has one stable receipt;
    // an explicitly supplied request key is never replaced on a transport retry.
    const hex = createHash("sha256").update(JSON.stringify(["application/v1", scope.workspaceId, operator, c.req.param("id"), action])).digest("hex");
    const fallback = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const request = body.request_id ?? fallback;
    if (typeof request !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request)) return c.json({ error: "Invalid application request", code: "invalid_command" }, 400);
    const { data, error } = await Promise.resolve(serviceClient().rpc("decide_mission_application", {
      p_workspace: scope.workspaceId, p_operator: operator, p_submission: c.req.param("id"),
      p_request: request, p_expected_revision: Number(revision), p_decision: action, p_notes: action === "decline" ? notes : null,
    })).catch(() => ({ data: null, error: { message: "unavailable" } }));
    if (error) {
      if (error.message === "FORBIDDEN") return c.json({ error: "Application review access is required", code: "FORBIDDEN" }, 403);
      if (error.message === "application_not_found") return c.json({ error: "Application not found", code: "not_found" }, 404);
      if (["APPLICATION_STALE", "IDEMPOTENCY_CONFLICT"].includes(error.message)) return c.json({ error: "申請已更新；保留輸入並重新讀取 / Refresh the application; input is retained", code: error.message }, 409);
      if (["mission_full", "application_reason_required", "application_reason_too_long", "invalid_command"].includes(error.message)) return c.json({ error: error.message, code: error.message }, 400);
      return c.json({ error: "申請服務未能完成；保留輸入並重試同一要求 / Application unavailable; retry the same request", code: "application_unavailable" }, 503);
    }
    if (!data?.decision && !data?.conflict) return c.json({ error: "尚未確認保存；請重試同一要求 / Saving is not confirmed; retry the same request", code: "application_unavailable" }, 503);
    if (data?.conflict) {
      const winner = data.decision;
      const time = winner?.decidedAt && Number.isFinite(Date.parse(winner.decidedAt))
        ? new Intl.DateTimeFormat("zh-HK", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Hong_Kong" }).format(new Date(winner.decidedAt)) : "未提供 / Unknown";
      return c.json({ error: `申請已處理：${winner?.actorLabel || "處理者未提供 / Unknown operator"} · ${time}。請重新讀取；輸入已保留。 / Already processed; refresh to continue.`, code: "APPLICATION_DECIDED", current_decision: winner }, 409);
    }
    return c.json(data);
  });
}

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
