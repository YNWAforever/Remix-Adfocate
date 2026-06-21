// server/routes/adminMissions.ts
import { Hono } from "hono";
import { serviceClient } from "../lib/supabase.js";
import { type MissionInput } from "../lib/missionAuthoring.js";

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

// Re-export helpers for Tasks 8–9 to import from this file.
export { hkToday, countEngaged, EDITABLE_COLS, MISSION_COLS };
