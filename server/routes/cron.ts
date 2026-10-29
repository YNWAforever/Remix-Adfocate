import { Hono } from "hono";
import type { Env } from "../app.js";
import { refreshDueSocialAccounts } from "../lib/social/service.js";
import { serviceClient } from "../lib/supabase.js";

export const cronRoutes = new Hono<Env>();

function hasLiveScanConfig() {
  return Boolean(
    process.env.RAPIDAPI_KEY &&
      process.env.RAPIDAPI_INSTAGRAM_PROFILE_URL &&
      process.env.RAPIDAPI_THREADS_PROFILE_URL,
  );
}

cronRoutes.get("/social-refresh", async (c) => {
  const expected = process.env.CRON_SECRET;
  const auth = c.req.header("Authorization");

  if (!expected || auth !== `Bearer ${expected}`) {
    return c.json({ error: "Unauthorized", code: "unauthorized" }, 401);
  }

  if (!hasLiveScanConfig()) {
    return c.json({ scanned: 0, failed: 0, skipped: true, code: "provider_not_configured" });
  }

  const result = await refreshDueSocialAccounts(25);
  return c.json(result);
});

cronRoutes.get("/daily", async (c) => {
  const expected = process.env.CRON_SECRET;
  if (!expected || c.req.header("Authorization") !== `Bearer ${expected}`)
    return c.json({ error: "Unauthorized", code: "unauthorized" }, 401);
  const svc = serviceClient();
  const out: { published: number | null; snapshotted: number | null; campaignsClosed: number | null; deadlineReminders: number | null; errors: string[] } =
    { published: null, snapshotted: null, campaignsClosed: null, deadlineReminders: null, errors: [] };

  try { const { data, error } = await svc.rpc("content_publish_scheduled"); if (error) throw error; out.published = data ?? 0; }
  catch (e: unknown) { out.errors.push("publish:" + (e instanceof Error ? e.message : String(e))); }

  try { const { data, error } = await svc.rpc("snapshot_campaign_leaderboards"); if (error) throw error; out.snapshotted = data ?? 0; }
  catch (e: unknown) { out.errors.push("snapshot:" + (e instanceof Error ? e.message : String(e))); }

  try { const { data, error } = await svc.rpc("close_due_campaigns"); if (error) throw error; out.campaignsClosed = data ?? 0; }
  catch (e: unknown) { out.errors.push("close:" + (e instanceof Error ? e.message : String(e))); }

  // Active-mission work items due within 24h (approaching) or past due (overdue); the
  // emitter dedupes per item, so a daily run notifies each creator at most once per state.
  try { const { data, error } = await svc.rpc("emit_active_mission_deadline_notifications"); if (error) throw error; out.deadlineReminders = data ?? 0; }
  catch (e: unknown) { out.errors.push("deadlines:" + (e instanceof Error ? e.message : String(e))); }

  if (out.errors.length) console.error(JSON.stringify({ level: "error", code: "cron_daily_failed", errors: out.errors }));

  return c.json(out);
});
