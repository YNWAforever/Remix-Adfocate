// server/routes/adminContent.ts — staff content authoring (CMS C1). Sub-mounted inside
// adminRoutes (inherits staff-auth). Writes via serviceClient(). All relative imports carry .js.
import { Hono } from "hono";
import type { AdminEnv } from "../lib/staffAuth.js";
import { serviceClient } from "../lib/supabase.js";
import {
  type ContentInput, type ContentEditInput, type ContentStatus,
  validateContentInput, validateContentEdit, canTransition, isPublishable,
  slugify, uniqueSlug, isAllowedImageUrl,
} from "../lib/contentAuthoring.js";

export const adminContentRoutes = new Hono<AdminEnv>();

const COLS =
  "id, kind, slug, status, title_zh, title_en, excerpt_zh, excerpt_en, body_zh, body_en, " +
  "cover_image_url, category_id, author_id, workspace_id, audience, pinned, pinned_rank, views, " +
  "scheduled_for, published_at, archived_at, created_at, updated_at";

const EDITABLE: (keyof ContentInput)[] = [
  "kind", "audience", "title_zh", "title_en", "excerpt_zh", "excerpt_en", "body_zh", "body_en",
  "cover_image_url", "category_id", "pinned", "pinned_rank",
];

function bucketHosts(): string[] {
  try { return [new URL(process.env.SUPABASE_URL!).hostname]; } catch { return []; }
}

// ---- list ----
adminContentRoutes.get("/content", async (c) => {
  const svc = serviceClient();
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const pageSize = 20;
  let q = svc.from("content_items").select(COLS, { count: "exact" });
  const kind = c.req.query("kind"); if (kind) q = q.eq("kind", kind);
  const status = c.req.query("status"); if (status) q = q.eq("status", status);
  const category = c.req.query("category"); if (category) q = q.eq("category_id", category);
  const search = c.req.query("q"); if (search) q = q.ilike("title_zh", `%${search}%`);
  q = q.order("updated_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
  const { data, error, count } = await q;
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ items: data ?? [], page, pageSize, total: count ?? 0 });
});

// ---- get one (incl. drafts) ----
adminContentRoutes.get("/content/:id", async (c) => {
  const { data, error } = await serviceClient().from("content_items").select(COLS).eq("id", c.req.param("id")).maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!data) return c.json({ error: "not found", code: "not_found" }, 404);
  return c.json({ item: data });
});

// ---- create (draft) ----
adminContentRoutes.post("/content", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as ContentInput;
  const { errors } = validateContentInput(body);
  if (Object.keys(errors).length) return c.json({ error: "invalid", code: "validation_error", fields: errors }, 422);
  if (body.cover_image_url && !isAllowedImageUrl(body.cover_image_url, bucketHosts()))
    return c.json({ error: "bad cover url", code: "validation_error", fields: { cover_image_url: "封面圖片網址無效" } }, 422);

  const svc = serviceClient();
  const base = slugify(body.slug || body.title_zh);
  const { data: existing } = await svc.from("content_items").select("slug").like("slug", `${base}%`);
  const slug = uniqueSlug(base, (existing ?? []).map((r) => r.slug as string));
  const row: Record<string, unknown> = { slug, status: "draft", author_id: c.get("staff").userId };
  for (const k of EDITABLE) if (k in body) row[k] = body[k];
  const { data, error } = await svc.from("content_items").insert(row).select(COLS).single();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ item: data }, 201);
});

// ---- edit (optimistic concurrency; slug only while draft) ----
adminContentRoutes.patch("/content/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as ContentEditInput & { updated_at?: string; slug?: string };
  const { errors } = validateContentEdit(body);
  if (Object.keys(errors).length) return c.json({ error: "invalid", code: "validation_error", fields: errors }, 422);
  if (body.cover_image_url && !isAllowedImageUrl(body.cover_image_url, bucketHosts()))
    return c.json({ error: "bad cover url", code: "validation_error", fields: { cover_image_url: "封面圖片網址無效" } }, 422);

  const svc = serviceClient();
  const { data: cur, error: e0 } = await svc.from("content_items").select("status, updated_at").eq("id", id).maybeSingle();
  if (e0) return c.json({ error: e0.message, code: "db_error" }, 500);
  if (!cur) return c.json({ error: "not found", code: "not_found" }, 404);
  if (body.updated_at && body.updated_at !== cur.updated_at)
    return c.json({ error: "stale", code: "conflict" }, 409);

  const patch: Record<string, unknown> = {};
  for (const k of EDITABLE) if (k in body) patch[k] = body[k];
  if (body.slug !== undefined) {
    if (cur.status !== "draft") return c.json({ error: "slug locked", code: "conflict" }, 409);
    patch.slug = slugify(body.slug);
  }
  const { data, error } = await svc.from("content_items").update(patch).eq("id", id).select(COLS).single();
  if (error) return c.json({ error: error.message, code: error.code === "23505" ? "conflict" : "db_error" }, error.code === "23505" ? 409 : 500);
  return c.json({ item: data });
});

// ---- lifecycle helper ----
async function transition(c: import("hono").Context<AdminEnv>, to: ContentStatus, extra: Record<string, unknown> = {}) {
  const id = c.req.param("id");
  const svc = serviceClient();
  const { data: cur, error: e0 } = await svc.from("content_items").select("status, title_zh, body_zh").eq("id", id).maybeSingle();
  if (e0) return c.json({ error: e0.message, code: "db_error" }, 500);
  if (!cur) return c.json({ error: "not found", code: "not_found" }, 404);
  if (!canTransition(cur.status as ContentStatus, to)) return c.json({ error: "bad transition", code: "conflict" }, 409);
  if (to === "published" && !isPublishable(cur as { title_zh: string; body_zh: string }))
    return c.json({ error: "needs title + body", code: "validation_error" }, 422);
  const { data, error } = await svc.from("content_items").update({ status: to, ...extra }).eq("id", id).select(COLS).single();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ item: data });
}

adminContentRoutes.post("/content/:id/publish", (c) => transition(c, "published", { published_at: new Date().toISOString() }));
adminContentRoutes.post("/content/:id/unpublish", (c) => transition(c, "draft"));
adminContentRoutes.post("/content/:id/archive", (c) => transition(c, "archived", { archived_at: new Date().toISOString() }));
adminContentRoutes.post("/content/:id/schedule", async (c) => {
  const { scheduled_for } = (await c.req.json().catch(() => ({}))) as { scheduled_for?: string };
  const when = scheduled_for ? new Date(scheduled_for) : null;
  if (!when || isNaN(when.getTime()) || when.getTime() <= Date.now())
    return c.json({ error: "future time required", code: "validation_error", fields: { scheduled_for: "請選擇未來時間" } }, 422);
  return transition(c, "scheduled", { scheduled_for: when.toISOString() });
});

// ---- delete (draft + never-published only) ----
adminContentRoutes.delete("/content/:id", async (c) => {
  const id = c.req.param("id");
  const svc = serviceClient();
  const { data: cur } = await svc.from("content_items").select("status, published_at").eq("id", id).maybeSingle();
  if (!cur) return c.json({ error: "not found", code: "not_found" }, 404);
  if (cur.status !== "draft" || cur.published_at) return c.json({ error: "archive instead", code: "conflict" }, 409);
  const { error } = await svc.from("content_items").delete().eq("id", id);
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ ok: true });
});

// ---- taxonomy ----
adminContentRoutes.get("/content-categories", async (c) => {
  const { data, error } = await serviceClient().from("content_categories").select("id, slug, label_zh, label_en, sort").order("sort");
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ categories: data ?? [] });
});
adminContentRoutes.get("/content-tags", async (c) => {
  const { data, error } = await serviceClient().from("content_tags").select("id, slug, label_zh, label_en").order("label_zh");
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ tags: data ?? [] });
});

// ---- media upload (server-side via serviceClient; bucket is public-read) ----
adminContentRoutes.post("/content/media", async (c) => {
  const form = await c.req.parseBody();
  const file = form["file"];
  if (!(file instanceof File)) return c.json({ error: "no file", code: "validation_error" }, 422);
  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
  const path = `images/${crypto.randomUUID()}.${ext}`;
  const svc = serviceClient();
  const { error } = await svc.storage.from("content-media").upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  const { data } = svc.storage.from("content-media").getPublicUrl(path);
  return c.json({ url: data.publicUrl });
});
