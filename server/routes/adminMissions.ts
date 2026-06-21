// server/routes/adminMissions.ts
import { Hono } from "hono";
import { serviceClient } from "../lib/supabase.js";
import { type MissionInput, type MissionRecord, validateMission, validateEdit } from "../lib/missionAuthoring.js";

/** Secret-gated mission authoring (Slice B1). Mounted under the /admin shared-secret gate;
 *  uses serviceClient (bypasses RLS). Real per-workspace role auth lands with the Brand
 *  Dashboard (B3). All relative imports carry the .js ESM extension. */
export const adminMissionRoutes = new Hono();

const ENGAGED_STATUSES = ["applied", "joined", "submitted", "under_review", "approved"];

const MISSION_COLS =
  "id, workspace_id, slug, title, description, category, mission_type, access_type, required_level, " +
  "points_reward, cash_reward, cpm_rate, cpm_budget_pool, deadline, quota, filled, status, " +
  "deliverables, requirements, platforms, effort, created_at, updated_at, published_at, closed_at";

const EDITABLE_COLS: (keyof MissionInput)[] = [
  "slug", "title", "description", "category", "mission_type", "access_type", "required_level",
  "points_reward", "cash_reward", "cpm_rate", "cpm_budget_pool", "deadline", "quota",
  "deliverables", "requirements", "platforms", "effort",
];

// Asia/Hong_Kong YYYY-MM-DD. The route (not the pure module) is where the clock lives.
// en-CA formats as YYYY-MM-DD; HK = UTC+8, no DST.
function hkToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

async function countEngaged(svc: ReturnType<typeof serviceClient>, missionId: string) {
  return svc
    .from("mission_submissions")
    .select("id", { count: "exact", head: true })
    .eq("mission_id", missionId)
    .in("status", ENGAGED_STATUSES);
}

adminMissionRoutes.get("/workspaces", async (c) => {
  const { data, error } = await serviceClient().from("workspaces").select("id, slug, name").order("name");
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ workspaces: data ?? [] });
});

adminMissionRoutes.get("/missions", async (c) => {
  const workspace = c.req.query("workspace");
  const status = c.req.query("status");
  const svc = serviceClient();
  let q = svc.from("missions").select(MISSION_COLS).order("updated_at", { ascending: false });
  if (workspace) q = q.eq("workspace_id", workspace);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);

  const rows = (data ?? []) as unknown as Array<Record<string, unknown> & { id: string; filled: number | null }>;
  const ids = rows.map((r) => r.id);
  let engagedSet = new Set<string>();
  if (ids.length) {
    const { data: subs, error: sErr } = await svc
      .from("mission_submissions").select("mission_id").in("mission_id", ids).in("status", ENGAGED_STATUSES);
    if (sErr) return c.json({ error: sErr.message, code: "db_error" }, 500);
    engagedSet = new Set((subs ?? []).map((s) => s.mission_id as string));
  }
  const missions = rows.map((r) => ({ ...r, engaged: engagedSet.has(r.id) || (r.filled ?? 0) > 0 }));
  return c.json({ missions });
});

adminMissionRoutes.get("/missions/:id", async (c) => {
  const { data, error } = await serviceClient().from("missions").select(MISSION_COLS).eq("id", c.req.param("id")).maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!data) return c.json({ error: "not_found", code: "not_found" }, 404);
  return c.json({ mission: data });
});

adminMissionRoutes.post("/missions", async (c) => {
  const body = await c.req.json<MissionInput>().catch(() => ({}) as MissionInput);
  const { ok, errors } = validateMission(body, "draft");
  if (!ok) return c.json({ error: "請修正欄位後再儲存", code: "validation", fields: errors }, 422);

  const insert: Record<string, unknown> = {
    workspace_id: body.workspace_id, slug: body.slug, title: body.title, mission_type: body.mission_type,
    description: body.description ?? null, category: body.category ?? null,
    access_type: body.access_type ?? "open", required_level: body.required_level ?? "L0",
    points_reward: body.points_reward ?? 0, cash_reward: body.cash_reward ?? null,
    cpm_rate: body.cpm_rate ?? null, cpm_budget_pool: body.cpm_budget_pool ?? null,
    deadline: body.deadline ?? null, quota: body.quota ?? 10,
    deliverables: body.deliverables ?? [], requirements: body.requirements ?? [], platforms: body.platforms ?? [],
    effort: body.effort ?? null, status: "draft",
  };
  const { data, error } = await serviceClient().from("missions").insert(insert).select(MISSION_COLS).single();
  if (error) {
    if (error.code === "23505") {
      return c.json({ error: "Slug 已被使用", code: "validation", fields: { slug: "此 workspace 已有相同 slug 的任務" } }, 422);
    }
    return c.json({ error: error.message, code: "db_error" }, 500);
  }
  return c.json({ mission: data }, 201);
});

adminMissionRoutes.patch("/missions/:id", async (c) => {
  const id = c.req.param("id");
  const patch = await c.req.json<MissionInput>().catch(() => ({}) as MissionInput);
  const svc = serviceClient();

  const { data: existing, error: exErr } = await svc.from("missions").select(MISSION_COLS).eq("id", id).maybeSingle();
  if (exErr) return c.json({ error: exErr.message, code: "db_error" }, 500);
  if (!existing) return c.json({ error: "not_found", code: "not_found" }, 404);
  if ((existing as unknown as { status: string }).status === "closed") {
    return c.json({ error: "已關閉的任務不可編輯", code: "invalid_transition" }, 409);
  }

  const { count, error: cErr } = await countEngaged(svc, id);
  if (cErr) return c.json({ error: cErr.message, code: "db_error" }, 500);
  const engaged = ((existing as unknown as { filled: number | null }).filled ?? 0) > 0 || (count ?? 0) > 0;

  const { ok, errors } = validateEdit(existing as unknown as MissionRecord, patch, engaged);
  if (!ok) return c.json({ error: "請修正欄位後再儲存", code: "validation", fields: errors }, 422);

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of EDITABLE_COLS) if (Object.prototype.hasOwnProperty.call(patch, k)) updates[k] = patch[k];

  const { data, error } = await svc.from("missions").update(updates).eq("id", id).select(MISSION_COLS).single();
  if (error) {
    if (error.code === "23505") {
      return c.json({ error: "Slug 已被使用", code: "validation", fields: { slug: "此 workspace 已有相同 slug 的任務" } }, 422);
    }
    return c.json({ error: error.message, code: "db_error" }, 500);
  }
  return c.json({ mission: data });
});

adminMissionRoutes.post("/missions/:id/publish", async (c) => {
  const id = c.req.param("id");
  const svc = serviceClient();
  const { data: m, error } = await svc.from("missions").select(MISSION_COLS).eq("id", id).maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!m) return c.json({ error: "not_found", code: "not_found" }, 404);
  if ((m as unknown as { status: string }).status !== "draft") return c.json({ error: "只有草稿可以發佈", code: "invalid_transition" }, 409);

  const { ok, errors } = validateMission(m as unknown as MissionInput, "publish", hkToday());
  if (!ok) return c.json({ error: "發佈前請完成必填欄位", code: "validation", fields: errors }, 422);

  const now = new Date().toISOString();
  const { data, error: uErr } = await svc.from("missions")
    .update({ status: "active", published_at: now, updated_at: now }).eq("id", id).select(MISSION_COLS).single();
  if (uErr) return c.json({ error: uErr.message, code: "db_error" }, 500);
  return c.json({ mission: data });
});

adminMissionRoutes.post("/missions/:id/close", async (c) => {
  const id = c.req.param("id");
  const svc = serviceClient();
  const { data: m, error } = await svc.from("missions").select("id, status").eq("id", id).maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!m) return c.json({ error: "not_found", code: "not_found" }, 404);
  if ((m as { status: string }).status !== "active") return c.json({ error: "只有進行中的任務可以關閉", code: "invalid_transition" }, 409);

  const now = new Date().toISOString();
  const { data, error: uErr } = await svc.from("missions")
    .update({ status: "closed", closed_at: now, updated_at: now }).eq("id", id).select(MISSION_COLS).single();
  if (uErr) return c.json({ error: uErr.message, code: "db_error" }, 500);
  return c.json({ mission: data });
});

adminMissionRoutes.delete("/missions/:id", async (c) => {
  const id = c.req.param("id");
  const svc = serviceClient();
  const { data: m, error } = await svc.from("missions").select("id, status").eq("id", id).maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!m) return c.json({ error: "not_found", code: "not_found" }, 404);
  if ((m as { status: string }).status !== "draft") return c.json({ error: "只有草稿可以刪除", code: "invalid_transition" }, 409);

  const { count, error: cErr } = await svc.from("mission_submissions").select("id", { count: "exact", head: true }).eq("mission_id", id);
  if (cErr) return c.json({ error: cErr.message, code: "db_error" }, 500);
  if ((count ?? 0) > 0) return c.json({ error: "已有報名紀錄的草稿不可刪除", code: "invalid_transition" }, 409);

  const { error: dErr } = await svc.from("missions").delete().eq("id", id);
  if (dErr) return c.json({ error: dErr.message, code: "db_error" }, 500);
  return c.json({ ok: true });
});

// Re-export helpers for Tasks 8–9 to import from this file.
export { hkToday, countEngaged, EDITABLE_COLS, MISSION_COLS };
