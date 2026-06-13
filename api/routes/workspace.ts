import { Hono } from "hono";
import type { Env } from "../app";
import { makeUserClient } from "../lib/supabase";

export const workspaceRoutes = new Hono<Env>();

workspaceRoutes.get("/", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data, error } = await supabase
    .from("workspaces")
    .select("slug, name, theme")
    .eq("id", c.get("workspaceId"))
    .single();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json(data);
});
