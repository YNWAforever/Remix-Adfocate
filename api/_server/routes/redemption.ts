import { Hono } from "hono";
import type { Env } from "../app";
import { makeUserClient } from "../lib/supabase";

export const redemptionRoutes = new Hono<Env>();

redemptionRoutes.get("/gifts", async (c) => {
  const category = c.req.query("category");
  const supabase = makeUserClient(c.get("jwt"));
  let q = supabase
    .from("redemption_gifts")
    .select("id, name, description, category, points_cost, stock_remaining, gift_type, image_url, status")
    .eq("workspace_id", c.get("workspaceId"))
    .order("points_cost", { ascending: true });
  if (category && category !== "全部") q = q.eq("category", category);
  const { data, error } = await q;
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ gifts: data });
});
