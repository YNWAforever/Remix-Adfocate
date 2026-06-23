import { Hono } from "hono";
import type { Env } from "../app.js";
import { makeUserClient } from "../lib/supabase.js";

export const notificationRoutes = new Hono<Env>();

// Every query is RLS-scoped via makeUserClient, but we ALSO filter user_id explicitly
// (= auth.uid() = creators.id) as defence-in-depth — matching the pattern in match.ts —
// so a dropped/disabled policy can never widen a read or a mark-read.

/** GET /api/notifications?limit=20&before=<ISO> — caller's notifications, newest first,
 *  plus the current unread count. RLS scopes every read to auth.uid(). */
notificationRoutes.get("/", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const userId = c.get("userId");
  const limit = Math.max(1, Math.min(Number(c.req.query("limit") ?? 20) || 20, 50));
  const before = c.req.query("before");

  let q = supabase
    .from("notifications")
    .select("id, type, data, entity_type, entity_id, read_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (before) q = q.lt("created_at", before);

  const [{ data: items, error }, { count, error: cErr }] = await Promise.all([
    q,
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).is("read_at", null),
  ]);
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (cErr) return c.json({ error: cErr.message, code: "db_error" }, 500);
  return c.json({ items: items ?? [], unread_count: count ?? 0 });
});

/** GET /api/notifications/unread-count — cheap endpoint for the nav badge poll. */
notificationRoutes.get("/unread-count", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const userId = c.get("userId");
  const { count, error } = await supabase
    .from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).is("read_at", null);
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ count: count ?? 0 });
});

/** POST /api/notifications/read { ids: string[] } — mark specific rows read (idempotent). */
notificationRoutes.post("/read", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? (body.ids as string[]) : [];
  if (ids.length === 0) return c.json({ updated: 0 });
  const { data, error } = await supabase
    .from("notifications").update({ read_at: new Date().toISOString() })
    .eq("user_id", userId).in("id", ids).is("read_at", null).select("id");
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ updated: data?.length ?? 0 });  // actual rows flipped, not the input count
});

/** POST /api/notifications/read-all — mark all of the caller's unread rows read. */
notificationRoutes.post("/read-all", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const userId = c.get("userId");
  const { error } = await supabase
    .from("notifications").update({ read_at: new Date().toISOString() })
    .eq("user_id", userId).is("read_at", null);
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ ok: true });
});
