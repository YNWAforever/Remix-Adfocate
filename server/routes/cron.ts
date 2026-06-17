import { Hono } from "hono";
import type { Env } from "../app.js";
import { refreshDueSocialAccounts } from "../lib/social/service.js";

export const cronRoutes = new Hono<Env>();

cronRoutes.get("/social-refresh", async (c) => {
  const expected = process.env.CRON_SECRET;
  const auth = c.req.header("Authorization");

  if (!expected || auth !== `Bearer ${expected}`) {
    return c.json({ error: "Unauthorized", code: "unauthorized" }, 401);
  }

  const result = await refreshDueSocialAccounts(25);
  return c.json(result);
});
