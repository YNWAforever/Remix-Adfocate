// server/routes/adminAcademy.ts — staff Academy authoring (C1.5). Sub-mounted inside adminRoutes
// (inherits staff-auth). Writes via serviceClient(). All relative imports carry .js.
import { Hono } from "hono";
import type { AdminEnv } from "../lib/staffAuth.js";
import { serviceClient } from "../lib/supabase.js";
import { adminAcademyLessonsRoutes } from "./academyLessons.js";
import {
  type AcademyInput, type AcademyEditInput, type AcademyStatus,
  validateAcademyInput, validateAcademyEdit,
} from "../lib/academyAuthoring.js";

export const adminAcademyRoutes = new Hono<AdminEnv>();
adminAcademyRoutes.route("/", adminAcademyLessonsRoutes);

const COLS =
  "id, kind, slug, status, title_zh, title_en, excerpt_zh, excerpt_en, body_zh, body_en, " +
  "category, required_level, emoji, color, sort, metadata, published_at, archived_at, created_at, updated_at";

const EDITABLE: (keyof AcademyInput)[] = [
  "kind", "title_zh", "title_en", "excerpt_zh", "excerpt_en", "body_zh", "body_en",
  "category", "required_level", "emoji", "color", "sort", "metadata",
];

// ---- list (all statuses) ----
adminAcademyRoutes.get("/academy", async (c) => {
  const svc = serviceClient();
  let q = svc.from("academy_content").select(COLS);
  const kind = c.req.query("kind"); if (kind) q = q.eq("kind", kind);
  const status = c.req.query("status"); if (status) q = q.eq("status", status);
  q = q.order("kind").order("sort");
  const { data, error } = await q;
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ items: data ?? [] });
});

// ---- get one (incl. drafts) ----
adminAcademyRoutes.get("/academy/:id", async (c) => {
  const { data, error } = await serviceClient().from("academy_content").select(COLS).eq("id", c.req.param("id")).maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (!data) return c.json({ error: "not found", code: "not_found" }, 404);
  return c.json({ item: data });
});

// ---- create (draft) ----
adminAcademyRoutes.post("/academy", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as AcademyInput & { slug?: string };
  const { errors } = validateAcademyInput(body);
  if (Object.keys(errors).length) return c.json({ error: "invalid", code: "validation_error", fields: errors }, 422);
  const svc = serviceClient();
  const row: Record<string, unknown> = { status: "draft", slug: (body.slug ?? "").trim() };
  if (!row.slug) return c.json({ error: "slug required", code: "validation_error", fields: { slug: "請輸入 slug" } }, 422);
  for (const k of EDITABLE) if (k in body) row[k] = body[k];
  const { data, error } = await svc.from("academy_content").insert(row).select(COLS).single();
  if (error) return c.json({ error: error.message, code: error.code === "23505" ? "conflict" : "db_error" }, error.code === "23505" ? 409 : 500);
  return c.json({ item: data }, 201);
});

// ---- edit (optimistic concurrency; slug only while draft) ----
adminAcademyRoutes.patch("/academy/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as AcademyEditInput & { updated_at?: string; slug?: string };
  const { errors } = validateAcademyEdit(body);
  if (Object.keys(errors).length) return c.json({ error: "invalid", code: "validation_error", fields: errors }, 422);
  const svc = serviceClient();
  const { data: cur, error: e0 } = await svc.from("academy_content").select("status, updated_at").eq("id", id).maybeSingle();
  if (e0) return c.json({ error: e0.message, code: "db_error" }, 500);
  if (!cur) return c.json({ error: "not found", code: "not_found" }, 404);
  if (body.updated_at && body.updated_at !== cur.updated_at) return c.json({ error: "stale", code: "conflict" }, 409);
  const patch: Record<string, unknown> = {};
  for (const k of EDITABLE) if (k in body) patch[k] = body[k];
  if (body.slug !== undefined) {
    if (cur.status !== "draft") return c.json({ error: "slug locked", code: "conflict" }, 409);
    patch.slug = body.slug.trim();
  }
  const { data, error } = await svc.from("academy_content").update(patch).eq("id", id).select(COLS).single();
  if (error) return c.json({ error: error.message, code: error.code === "23505" ? "conflict" : "db_error" }, error.code === "23505" ? 409 : 500);
  return c.json({ item: data });
});

// ---- lifecycle ----
const STATUS_NEXT: Record<AcademyStatus, AcademyStatus[]> = {
  draft: ["published", "archived"],
  published: ["draft", "archived"],
  archived: ["draft"],
};

async function transition(c: import("hono").Context<AdminEnv>, to: AcademyStatus, extra: Record<string, unknown> = {}) {
  const id = c.req.param("id");
  const svc = serviceClient();
  const { data: cur, error: e0 } = await svc.from("academy_content").select("status, title_zh").eq("id", id).maybeSingle();
  if (e0) return c.json({ error: e0.message, code: "db_error" }, 500);
  if (!cur) return c.json({ error: "not found", code: "not_found" }, 404);
  if (!STATUS_NEXT[cur.status as AcademyStatus]?.includes(to)) return c.json({ error: "bad transition", code: "conflict" }, 409);
  if (to === "published" && !(cur.title_zh && String(cur.title_zh).trim())) return c.json({ error: "needs title", code: "validation_error" }, 422);
  const { data, error } = await svc.from("academy_content").update({ status: to, ...extra }).eq("id", id).select(COLS).single();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ item: data });
}

adminAcademyRoutes.post("/academy/:id/publish", (c) => transition(c, "published", { published_at: new Date().toISOString() }));
adminAcademyRoutes.post("/academy/:id/unpublish", (c) => transition(c, "draft"));
adminAcademyRoutes.post("/academy/:id/archive", (c) => transition(c, "archived", { archived_at: new Date().toISOString() }));

// ---- delete (draft only) ----
adminAcademyRoutes.delete("/academy/:id", async (c) => {
  const id = c.req.param("id");
  const svc = serviceClient();
  const { data: cur } = await svc.from("academy_content").select("status, published_at").eq("id", id).maybeSingle();
  if (!cur) return c.json({ error: "not found", code: "not_found" }, 404);
  if (cur.status !== "draft" || cur.published_at) return c.json({ error: "archive instead", code: "conflict" }, 409);
  const { error } = await svc.from("academy_content").delete().eq("id", id);
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ ok: true });
});
