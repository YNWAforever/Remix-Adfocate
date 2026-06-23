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

cronRoutes.get("/publish-scheduled", async (c) => {
  const expected = process.env.CRON_SECRET;
  if (!expected || c.req.header("Authorization") !== `Bearer ${expected}`)
    return c.json({ error: "Unauthorized", code: "unauthorized" }, 401);
  const { data, error } = await serviceClient().rpc("content_publish_scheduled");
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ published: data ?? 0 });
});
