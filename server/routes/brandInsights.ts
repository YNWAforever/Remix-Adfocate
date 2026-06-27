// server/routes/brandInsights.ts
import { Hono } from "hono";
import { serviceClient } from "../lib/supabase.js";
import { shapeBrandInsights, type BrandInsightsWindowDays } from "../lib/brandInsights.js";
import type { BrandEnv } from "../lib/brandAuth.js";

/** Brand-facing READ-ONLY analytics. Mounted under requireBrand; reads via serviceClient
 *  hard-filtered to c.var.brand.workspaceId (mission_submissions has no brand RLS policy, so we
 *  use the Slice 2 trust-boundary pattern — workspace comes from the verified identity, never a
 *  param). All relative imports carry .js. */
export const brandInsightsRoutes = new Hono<BrandEnv>();

const VALID_WINDOWS: BrandInsightsWindowDays[] = [7, 30, 90];
const DAY_MS = 86_400_000;

brandInsightsRoutes.get("/insights", async (c) => {
  const raw = c.req.query("window");
  const days = (raw ? Number(raw) : 30) as BrandInsightsWindowDays;
  if (!VALID_WINDOWS.includes(days)) {
    return c.json({ error: "window must be 7, 30 or 90", code: "validation" }, 422);
  }
  const ws = c.var.brand.workspaceId;
  const to = new Date().toISOString();
  const priorFromIso = new Date(Date.parse(to) - 2 * days * DAY_MS).toISOString();
  const svc = serviceClient();

  const subs = await svc
    .from("mission_submissions")
    .select("creator_id, status, points_awarded, quality_rating, created_at, submitted_at, reviewed_at")
    .eq("workspace_id", ws)
    .or(`created_at.gte.${priorFromIso},submitted_at.gte.${priorFromIso},reviewed_at.gte.${priorFromIso}`);
  if (subs.error) return c.json({ error: subs.error.message, code: "db_error" }, 500);

  const earn = await svc
    .from("earnings_transactions")
    .select("amount, created_at")
    .eq("workspace_id", ws)
    .eq("type", "earn")
    .gte("created_at", priorFromIso);
  if (earn.error) return c.json({ error: earn.error.message, code: "db_error" }, 500);

  const missions = await svc.from("missions").select("status, quota, filled").eq("workspace_id", ws);
  if (missions.error) return c.json({ error: missions.error.message, code: "db_error" }, 500);

  const creators = await svc.from("creators").select("id, display_name").eq("workspace_id", ws);
  if (creators.error) return c.json({ error: creators.error.message, code: "db_error" }, 500);

  const insights = shapeBrandInsights({
    to,
    days,
    submissions: subs.data ?? [],
    earnings: earn.data ?? [],
    missions: missions.data ?? [],
    creators: creators.data ?? [],
  });
  return c.json({ insights });
});
