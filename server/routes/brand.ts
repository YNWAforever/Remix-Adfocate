// server/routes/brand.ts
import { Hono } from "hono";
import { serviceClient, makeUserClient } from "../lib/supabase.js";
import { requireBrand, acceptBrandInvite, type BrandEnv } from "../lib/brandAuth.js";
import { type MissionInput, type MissionRecord, validateMission, validateEdit } from "../lib/missionAuthoring.js";
import { MISSION_COLS, EDITABLE_COLS, hkToday, countEngaged, normalizeBriefForWrite } from "./adminMissions.js";
import { brandReviewRoutes } from "./brandReview.js";
import { brandBudgetRoutes } from "./brandBudget.js";
import { brandInsightsRoutes } from "./brandInsights.js";

/** Brand self-serve portal API. Brands authenticate as real Supabase users; mission reads/writes
 *  run through makeUserClient(jwt) so Postgres RLS (migration 0023) enforces workspace isolation —
 *  a cross-workspace mission is simply invisible (→ 404). workspace_id always comes from the
 *  authenticated identity, never the request body. serviceClient is used only for: accept (writes
 *  RLS-closed brand_users/brand_invites), the workspace-name lookup, and the engagement count
 *  (mission_submissions has no brand RLS policy; the mission is already confirmed via an RLS read).
 *  Mirrors server/routes/adminMissions.ts CRUD. All relative imports carry the .js ESM extension. */

function bearer(c: { req: { header: (k: string) => string | undefined } }): string {
  const a = c.req.header("Authorization") ?? "";
  return a.startsWith("Bearer ") ? a.slice(7) : "";
}

// Lightweight columns for the brand mission list (the client BrandMission shape lands in Task 7).
const LIST_COLS = "id, slug, title, status, mission_type, points_reward, cash_reward, filled, quota, deadline";

export const brandRoutes = new Hono();

// --- Unguarded: accept (creates/links membership from a magic-link session) ------------------
brandRoutes.post("/accept", async (c) => {
  const jwt = bearer(c);
  if (!jwt) return c.json({ error: "unauthorized", code: "no_token" }, 401);
  const svc = serviceClient();
  const { data, error } = await svc.auth.getUser(jwt);
  if (error || !data.user?.email) return c.json({ error: "unauthorized", code: "bad_token" }, 401);
  const now = new Date().toISOString();
  let identity;
  try {
    identity = await acceptBrandInvite(svc, { userId: data.user.id, email: data.user.email, now });
  } catch (err) {
    console.error("[brand/accept] acceptBrandInvite threw:", err);
    return c.json({ error: "brand accept failed", code: "db_error" }, 500);
  }
  if (!identity) return c.json({ error: "no brand access", code: "not_brand" }, 403);
  const { data: ws } = await svc.from("workspaces").select("name").eq("id", identity.workspaceId).maybeSingle();
  return c.json({ brand: { email: identity.email, workspaceId: identity.workspaceId, workspaceName: ws?.name ?? "", role: identity.role } });
});

// --- Guarded brand API -----------------------------------------------------------------------
const guarded = new Hono<BrandEnv>();
guarded.use("*", requireBrand());

guarded.get("/me", async (c) => {
  const b = c.var.brand;
  const { data } = await serviceClient().from("workspaces").select("name").eq("id", b.workspaceId).maybeSingle();
  return c.json({ brand: { email: b.email, workspaceId: b.workspaceId, workspaceName: data?.name ?? "", role: b.role } });
});

guarded.get("/missions", async (c) => {
  const b = c.var.brand;
  const status = c.req.query("status") || "";
  let q = makeUserClient(bearer(c)).from("missions")
    .select(LIST_COLS).eq("workspace_id", b.workspaceId).order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ missions: data ?? [] });
});

guarded.get("/missions/:id", async (c) => {
  const { data, error } = await makeUserClient(bearer(c)).from("missions")
    .select(MISSION_COLS).eq("id", c.req.param("id")).maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!data) return c.json({ error: "not_found", code: "not_found" }, 404);
  return c.json({ mission: data });
});

guarded.post("/missions", async (c) => {
  const b = c.var.brand;
  const body = await c.req.json<MissionInput>().catch(() => ({}) as MissionInput);
  // workspace_id is forced from the identity; never trust the body.
  const input: MissionInput = { ...body, workspace_id: b.workspaceId };
  const { ok, errors } = validateMission(input, "draft");
  if (!ok) return c.json({ error: "請修正欄位後再儲存", code: "validation", fields: errors }, 422);

  const insert: Record<string, unknown> = {
    workspace_id: b.workspaceId, slug: input.slug, title: input.title, mission_type: input.mission_type,
    description: input.description ?? null, category: input.category ?? null,
    access_type: input.access_type ?? "open", required_level: input.required_level ?? "L0",
    points_reward: input.points_reward ?? 0, cash_reward: input.cash_reward ?? null,
    cpm_rate: input.cpm_rate ?? null, cpm_budget_pool: input.cpm_budget_pool ?? null,
    deadline: input.deadline ?? null, quota: input.quota ?? 10,
    deliverables: input.deliverables ?? [], requirements: input.requirements ?? [], platforms: input.platforms ?? [],
    effort: input.effort ?? null, status: "draft",
    ...normalizeBriefForWrite(input),
  };
  const { data, error } = await makeUserClient(bearer(c)).from("missions").insert(insert).select(MISSION_COLS).single();
  if (error) {
    if (error.code === "23505") return c.json({ error: "Slug 已被使用", code: "validation", fields: { slug: "此 workspace 已有相同 slug 的任務" } }, 422);
    return c.json({ error: error.message, code: "db_error" }, 500);
  }
  return c.json({ mission: data }, 201);
});

guarded.put("/missions/:id", async (c) => {
  const id = c.req.param("id");
  const patch = await c.req.json<MissionInput>().catch(() => ({}) as MissionInput);
  const uc = makeUserClient(bearer(c));

  // RLS-scoped read: a cross-workspace id is invisible → 404 (the isolation guarantee).
  const { data: existing, error: exErr } = await uc.from("missions").select(MISSION_COLS).eq("id", id).maybeSingle();
  if (exErr) return c.json({ error: exErr.message, code: "db_error" }, 500);
  if (!existing) return c.json({ error: "not_found", code: "not_found" }, 404);
  if ((existing as unknown as { status: string }).status === "closed") {
    return c.json({ error: "已關閉的任務不可編輯", code: "invalid_transition" }, 409);
  }

  // Engagement count via serviceClient (mission_submissions has no brand RLS policy); the mission
  // is already confirmed to belong to this brand by the RLS read above.
  const { count, error: cErr } = await countEngaged(serviceClient(), id);
  if (cErr) return c.json({ error: cErr.message, code: "db_error" }, 500);
  const engaged = ((existing as unknown as { filled: number | null }).filled ?? 0) > 0 || (count ?? 0) > 0;

  const { ok, errors } = validateEdit(existing as unknown as MissionRecord, patch, engaged);
  if (!ok) return c.json({ error: "請修正欄位後再儲存", code: "validation", fields: errors }, 422);

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of EDITABLE_COLS) if (Object.prototype.hasOwnProperty.call(patch, k)) updates[k] = patch[k];
  const briefDefaults = normalizeBriefForWrite(patch);
  for (const k of ["target_audience", "dos", "donts", "key_messages", "reference_links"] as const) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) updates[k] = briefDefaults[k];
  }

  const { data, error } = await uc.from("missions").update(updates).eq("id", id).select(MISSION_COLS).single();
  if (error) {
    if (error.code === "23505") return c.json({ error: "Slug 已被使用", code: "validation", fields: { slug: "此 workspace 已有相同 slug 的任務" } }, 422);
    return c.json({ error: error.message, code: "db_error" }, 500);
  }
  return c.json({ mission: data });
});

guarded.post("/missions/:id/publish", async (c) => {
  const id = c.req.param("id");
  const uc = makeUserClient(bearer(c));
  const { data: m, error } = await uc.from("missions").select(MISSION_COLS).eq("id", id).maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!m) return c.json({ error: "not_found", code: "not_found" }, 404);
  if ((m as unknown as { status: string }).status !== "draft") return c.json({ error: "只有草稿可以發佈", code: "invalid_transition" }, 409);

  const { ok, errors } = validateMission(m as unknown as MissionInput, "publish", hkToday());
  if (!ok) return c.json({ error: "發佈前請完成必填欄位", code: "validation", fields: errors }, 422);

  const now = new Date().toISOString();
  const { data, error: uErr } = await uc.from("missions")
    .update({ status: "active", published_at: now, updated_at: now }).eq("id", id).select(MISSION_COLS).single();
  if (uErr) return c.json({ error: uErr.message, code: "db_error" }, 500);
  return c.json({ mission: data });
});

guarded.post("/missions/:id/close", async (c) => {
  const id = c.req.param("id");
  const uc = makeUserClient(bearer(c));
  const { data: m, error } = await uc.from("missions").select("id, status").eq("id", id).maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!m) return c.json({ error: "not_found", code: "not_found" }, 404);
  if ((m as { status: string }).status !== "active") return c.json({ error: "只有進行中的任務可以關閉", code: "invalid_transition" }, 409);

  const now = new Date().toISOString();
  const { data, error: uErr } = await uc.from("missions")
    .update({ status: "closed", closed_at: now, updated_at: now }).eq("id", id).select(MISSION_COLS).single();
  if (uErr) return c.json({ error: uErr.message, code: "db_error" }, 500);
  return c.json({ mission: data });
});

guarded.delete("/missions/:id", async (c) => {
  const id = c.req.param("id");
  const uc = makeUserClient(bearer(c));
  const { data: m, error } = await uc.from("missions").select("id, status").eq("id", id).maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!m) return c.json({ error: "not_found", code: "not_found" }, 404);
  if ((m as { status: string }).status !== "draft") return c.json({ error: "只有草稿可以刪除", code: "invalid_transition" }, 409);

  const { count, error: cErr } = await serviceClient().from("mission_submissions").select("id", { count: "exact", head: true }).eq("mission_id", id);
  if (cErr) return c.json({ error: cErr.message, code: "db_error" }, 500);
  if ((count ?? 0) > 0) return c.json({ error: "已有報名紀錄的草稿不可刪除", code: "invalid_transition" }, 409);

  // RLS delete policy additionally requires role='owner'; a member's delete affects 0 rows → 403.
  const { data: del, error: dErr } = await uc.from("missions").delete().eq("id", id).select("id");
  if (dErr) return c.json({ error: dErr.message, code: "db_error" }, 500);
  if (!del || del.length === 0) return c.json({ error: "只有擁有者可以刪除任務", code: "forbidden" }, 403);
  return c.json({ ok: true });
});

guarded.route("/review", brandReviewRoutes);
guarded.route("/", brandBudgetRoutes);
guarded.route("/", brandInsightsRoutes);

brandRoutes.route("/", guarded);
