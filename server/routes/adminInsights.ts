// server/routes/adminInsights.ts
import { Hono } from "hono";
import { serviceClient } from "../lib/supabase.js";
import { shapeInsights, type InsightsWindowDays } from "../lib/insights.js";
import type { AdminEnv } from "../lib/staffAuth.js";

const VALID_WINDOWS: InsightsWindowDays[] = [7, 30, 90];
const DAY_MS = 86_400_000;

export const adminInsightsRoutes = new Hono<AdminEnv>();

// GET /admin/insights?workspace=<uuid?>&window=<7|30|90>
// Inherits the staff-auth middleware from adminRoutes — no extra guard.
adminInsightsRoutes.get("/insights", async (c) => {
  const raw = c.req.query("window");
  const days = (raw ? Number(raw) : 30) as InsightsWindowDays;
  if (!VALID_WINDOWS.includes(days)) {
    return c.json({ error: "window must be 7, 30 or 90", code: "validation" }, 422);
  }
  const ws = c.req.query("workspace") || "";

  const to = new Date().toISOString();
  const priorFromIso = new Date(Date.parse(to) - 2 * days * DAY_MS).toISOString();
  const svc = serviceClient();

  // 1) submissions touching the current OR prior window (any of the three timestamps)
  let subsQ = svc
    .from("mission_submissions")
    .select("creator_id, status, points_awarded, created_at, submitted_at, reviewed_at")
    .or(`created_at.gte.${priorFromIso},submitted_at.gte.${priorFromIso},reviewed_at.gte.${priorFromIso}`);
  if (ws) subsQ = subsQ.eq("workspace_id", ws);
  const subs = await subsQ;
  if (subs.error) return c.json({ error: subs.error.message, code: "db_error" }, 500);

  // 2) cash credits in the current + prior window
  let earnQ = svc
    .from("earnings_transactions")
    .select("amount, created_at")
    .eq("type", "earn")
    .gte("created_at", priorFromIso);
  if (ws) earnQ = earnQ.eq("workspace_id", ws);
  const earn = await earnQ;
  if (earn.error) return c.json({ error: earn.error.message, code: "db_error" }, 500);

  // 3) level histogram — current creators snapshot
  let creatorsQ = svc.from("creators").select("level");
  if (ws) creatorsQ = creatorsQ.eq("workspace_id", ws);
  const creators = await creatorsQ;
  if (creators.error) return c.json({ error: creators.error.message, code: "db_error" }, 500);

  // 4) fill rate — active missions snapshot
  let missionsQ = svc.from("missions").select("status, quota, filled").eq("status", "active");
  if (ws) missionsQ = missionsQ.eq("workspace_id", ws);
  const missions = await missionsQ;
  if (missions.error) return c.json({ error: missions.error.message, code: "db_error" }, 500);

  const insights = shapeInsights({
    to,
    days,
    submissions: subs.data ?? [],
    earnings: earn.data ?? [],
    creators: creators.data ?? [],
    missions: missions.data ?? [],
  });
  return c.json({ insights });
});
