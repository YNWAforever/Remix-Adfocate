import { Hono } from "hono";
import type { Env } from "../app.js";
import { makeUserClient } from "../lib/supabase.js";

export const missionRoutes = new Hono<Env>();

missionRoutes.get("/", async (c) => {
  const category = c.req.query("category");
  const supabase = makeUserClient(c.get("jwt"));
  let q = supabase
    .from("missions")
    .select("id, slug, title, description, category, mission_type, points_reward, deadline, quota, filled, status")
    .eq("workspace_id", c.get("workspaceId"))
    .order("created_at", { ascending: false });
  if (category && category !== "全部") q = q.eq("category", category);
  const { data, error } = await q;
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ missions: data });
});

missionRoutes.get("/:slug", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data, error } = await supabase
    .from("missions")
    .select("*")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("slug", c.req.param("slug"))
    .maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!data) return c.json({ error: "Not found", code: "not_found" }, 404);
  return c.json(data);
});
