import { Hono } from "hono";
import type { Env } from "../app.js";
import { getPublicPassportByToken } from "../lib/publicPassport.js";
import { serviceClient } from "../lib/supabase.js";
import { publicMission } from "../../src/lib/studio/policy.js";

export const publicRoutes = new Hono<Env>();

// Separate allowlist, explicit publisher opt-in; protected /missions stays unchanged.
publicRoutes.get("/missions", async c => {
  if (process.env.PUBLIC_MISSION_PREVIEW !== "true") return c.json({ code: "preview_disabled" }, 404);
  const slug = c.req.query("workspace") ?? "demo";
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return c.json({ code: "not_found" }, 404);
  const client = serviceClient();
  const workspace = await client.from("workspaces").select("id").eq("slug", slug).maybeSingle();
  if (workspace.error) return c.json({ code: "preview_unavailable" }, 503);
  if (!workspace.data) return c.json({ missions: [] });
  const result = await client.from("missions").select("slug,title,status,points_reward,required_level,deadline")
    .eq("workspace_id", workspace.data.id).eq("status", "active").eq("public_preview_enabled", true).order("created_at", { ascending: false }).limit(12);
  if (result.error) return c.json({ code: "preview_unavailable" }, 503);
  return c.json({ missions: result.data.map(row => publicMission(row)).filter(Boolean) });
});

publicRoutes.get("/passports/:token", async (c) => {
  const passport = await getPublicPassportByToken(c.req.param("token"));
  if (!passport) return c.json({ error: "Not found", code: "not_found" }, 404);
  return c.json(passport);
});
