import { Hono } from "hono";
import { serviceClient } from "../lib/supabase.js";

/** Operator-only review endpoints. Interim shared-secret auth (replaced by real
 *  admin-auth / the Brand Dashboard in Slice 8). Uses the service client. */
export const adminRoutes = new Hono();

adminRoutes.use("*", async (c, next) => {
  const secret = process.env.ADMIN_SECRET;
  const provided = c.req.header("x-admin-secret");
  if (!secret || provided !== secret) {
    return c.json({ error: "forbidden", code: "no_admin" }, 401);
  }
  await next();
});

adminRoutes.get("/submissions", async (c) => {
  const status = c.req.query("status") ?? "submitted";
  const svc = serviceClient();
  const { data, error } = await svc
    .from("mission_submissions")
    .select("id, status, content_urls, submitted_at, creator_id, creators!inner(display_name), missions!inner(slug, title, points_reward)")
    .eq("status", status)
    .order("submitted_at", { ascending: true });
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ submissions: data ?? [] });
});

adminRoutes.post("/submissions/:id/approve", async (c) => {
  const notes = (await c.req.json<{ notes?: string }>().catch(() => ({}))).notes ?? null;
  const svc = serviceClient();
  const { data, error } = await svc.rpc("approve_submission", { p_submission: c.req.param("id"), p_notes: notes });
  if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);
  return c.json(data);
});

adminRoutes.post("/submissions/:id/reject", async (c) => {
  const notes = (await c.req.json<{ notes?: string }>().catch(() => ({}))).notes ?? null;
  const svc = serviceClient();
  const { data, error } = await svc.rpc("reject_submission", { p_submission: c.req.param("id"), p_notes: notes });
  if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);
  return c.json(data);
});
