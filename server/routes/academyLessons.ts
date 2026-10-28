import { Hono } from "hono";
import type { Env } from "../app.js";
import type { AdminEnv } from "../lib/staffAuth.js";
import { makeUserClient, serviceClient } from "../lib/supabase.js";

export const academyLessonsRoutes = new Hono<Env>();
export const adminAcademyLessonsRoutes = new Hono<AdminEnv>();
function failure(error: { code?: string; message?: string }) {
  const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : ["PT409", "40001", "23505"].includes(error.code ?? "") ? 409
    : ["22023", "22P02", "23514", "23502"].includes(error.code ?? "") ? 422 : ["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code ?? "") ? 503 : 500;
  return { status: status as 403 | 404 | 409 | 422 | 503 | 500,
    body: { code: status === 503 ? "learning_unavailable" : status === 409 ? "version_changed" : status === 403 ? "academy_locked" : status === 404 ? "not_found" : status === 422 ? "validation_error" : "learning_error",
      error: status === 409 ? "The lesson or revision changed. Reload before retrying." : status === 503 ? "Learning storage is unavailable." : status === 403 ? "This course is locked." : status === 422 ? "Check the lesson content, revision and approval reference." : "Unable to load or save learning content." } };
}
async function trackFor(slug: string, jwt: string) {
  return makeUserClient(jwt).from("academy_content").select("id").eq("kind", "track").eq("status", "published").eq("slug", slug).maybeSingle();
}
academyLessonsRoutes.get("/track/:slug/lessons", async c => {
  if (c.req.query("creatorId") && c.req.query("creatorId") !== c.get("userId")) return c.json({ code: "forbidden", error: "Progress belongs to the signed-in Creator." }, 403);
  const found = await trackFor(c.req.param("slug"), c.get("jwt"));
  if (found.error) { const e = failure(found.error); return c.json(e.body, e.status); }
  if (!found.data) return c.json({ code: "not_found", error: "Course not found." }, 404);
  const { data, error } = await makeUserClient(c.get("jwt")).rpc("get_academy_learning", { p_track: found.data.id, p_lang: c.req.query("lang") === "en" ? "en" : "zh-HK" });
  if (error) { const e = failure(error); return c.json(e.body, e.status); }
  return c.json(data);
});
academyLessonsRoutes.post("/track/:slug/lessons/:lessonId/complete", async c => {
  const input = await c.req.json().catch(() => null);
  if (!input || !Number.isInteger(input.contentVersion) || input.contentVersion < 1) return c.json({ code: "validation_error", error: "A positive contentVersion is required." }, 422);
  if (Object.keys(input).some(k => k !== "contentVersion")) return c.json({ code: "forbidden", error: "Only the signed-in Creator can complete their lesson." }, 403);
  const found = await trackFor(c.req.param("slug"), c.get("jwt"));
  if (found.error) { const e = failure(found.error); return c.json(e.body, e.status); }
  if (!found.data) return c.json({ code: "not_found", error: "Course not found." }, 404);
  const { data, error } = await makeUserClient(c.get("jwt")).rpc("complete_academy_lesson", { p_track: found.data.id, p_lesson: c.req.param("lessonId"), p_version: input.contentVersion });
  if (error) { const e = failure(error); return c.json(e.body, e.status); }
  return c.json(data);
});

adminAcademyLessonsRoutes.get("/academy/:id/lessons", async c => {
  const { data, error } = await serviceClient().from("academy_lessons").select("*").eq("track_id", c.req.param("id")).order("position").order("content_version", { ascending: false });
  if (error) { const e = failure(error); return c.json(e.body, e.status); }
  return c.json({ items: data ?? [] });
});
const fields = ["title_zh", "title_en", "body_zh", "body_en", "position"];
for (const action of ["save", "publish", "archive"] as const) {
  const handler: import("hono").Handler<AdminEnv> = async c => {
    const staff = c.get("staff");
    if (!staff.userId || staff.viaSecret || staff.active === false) return c.json({ code: "staff_required", error: "Sign in as an active staff member." }, 403);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ code: "validation_error", error: "A lesson object is required." }, 422);
    const id = c.req.param("lessonId") ?? null;
    if (id && (!Number.isInteger(body.contentVersion) || body.contentVersion < 1 || !Number.isInteger(body.revision) || body.revision < 1)) return c.json({ code: "validation_error", error: "Current version and revision are required." }, 422);
    const allowed = [...fields, "contentVersion", "revision", "approvalRef"];
    if (Object.keys(body).some(k => !allowed.includes(k)) || fields.some(k => body[k] !== undefined && (k === "position" ? !Number.isInteger(body[k]) || body[k] < 0 || body[k] > 10000 : typeof body[k] !== "string" || body[k].length > (k.startsWith("body") ? 50000 : 200)))) return c.json({ code: "validation_error", error: "Check lesson fields and position." }, 422);
    if (action === "publish" && (typeof body.approvalRef !== "string" || !body.approvalRef.trim() || body.approvalRef.length > 500)) return c.json({ code: "validation_error", error: "An approved content reference is required." }, 422);
    const { data, error } = await serviceClient().rpc("author_academy_lesson", {
      p_staff: staff.userId, p_track: c.req.param("id"), p_lesson: id, p_version: body.contentVersion ?? null,
      p_revision: body.revision ?? null, p_input: Object.fromEntries(fields.filter(k => body[k] !== undefined).map(k => [k, body[k]])), p_action: action, p_approval_ref: action === "publish" ? body.approvalRef.trim() : null,
    });
    if (error) { const e = failure(error); return c.json(e.body, e.status); }
    return c.json({ item: data }, id ? 200 : 201);
  };
  if (action === "save") { adminAcademyLessonsRoutes.post("/academy/:id/lessons", handler); adminAcademyLessonsRoutes.patch("/academy/:id/lessons/:lessonId", handler); }
  else adminAcademyLessonsRoutes.post(`/academy/:id/lessons/:lessonId/${action}`, handler);
}
