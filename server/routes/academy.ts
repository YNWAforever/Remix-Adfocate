// server/routes/academy.ts — creator-facing Academy reads (C1.5). Mounted on the guarded group;
// makeUserClient(jwt) so RLS enforces published-only. Degrade to empty, never 500. All relative
// imports carry the .js ESM extension.
import { Hono } from "hono";
import type { Env } from "../app.js";
import { makeUserClient } from "../lib/supabase.js";

export const academyRoutes = new Hono<Env>();

type Row = {
  id: string; kind: string; slug: string; title_zh: string; title_en: string | null;
  excerpt_zh: string | null; excerpt_en: string | null; body_zh: string; body_en: string | null;
  category: string | null; required_level: string | null; emoji: string | null; color: string | null;
  sort: number; metadata: Record<string, unknown>;
};

const LIST_COLS =
  "id, kind, slug, title_zh, title_en, excerpt_zh, excerpt_en, category, required_level, emoji, color, sort, metadata";
const FULL_COLS = LIST_COLS + ", body_zh, body_en";

function pick(en: string | null | undefined, zh: string | null | undefined, lang: string): string {
  return (lang === "en" && en ? en : zh) ?? "";
}

// Collapse {en,zh} objects (and arrays of them, e.g. playbook levels[]) to the active language.
// Plain strings and plain-string arrays (e.g. playbook ideas[], zh-only) pass through unchanged.
function localizeMeta(meta: Record<string, unknown>, lang: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta ?? {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && "en" in v && "zh" in v) {
      out[k] = pick((v as { en: string }).en, (v as { zh: string }).zh, lang);
    } else if (Array.isArray(v)) {
      out[k] = v.map((el) =>
        el && typeof el === "object" && "en" in el && "zh" in el
          ? pick((el as { en: string }).en, (el as { zh: string }).zh, lang)
          : el,
      );
    } else {
      out[k] = v;
    }
  }
  return out;
}

function shape(r: Row, lang: string, withBody: boolean) {
  return {
    id: r.id, kind: r.kind, slug: r.slug,
    title: pick(r.title_en, r.title_zh, lang),
    excerpt: pick(r.excerpt_en, r.excerpt_zh, lang) || null,
    ...(withBody ? { body: pick(r.body_en, r.body_zh, lang) } : {}),
    ...(r.kind === "track" ? { contentStatus: pick(r.body_en, r.body_zh, lang).trim() ? "available" : "preparing", ...(withBody ? { learningEnabled: true } : {}) } : {}),
    category: r.category, requiredLevel: r.required_level,
    emoji: r.emoji, color: r.color, sort: r.sort,
    meta: localizeMeta(r.metadata, lang),
  };
}

// ---- index bundle (docs list-only; tracks/playbooks/resources full) ----
academyRoutes.get("/", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const lang = c.req.query("lang") === "en" ? "en" : "zh-HK";
  // Read the body to determine availability, but keep full text out of the list DTO.
  const { data, error } = await supabase.from("academy_content").select(FULL_COLS)
    .eq("status", "published").order("kind").order("sort");
  if (error) return c.json({ docs: [], tracks: [], playbooks: [], resources: [] });
  const rows = (data as unknown as Row[]).map((r) => shape(r, lang, false));
  return c.json({
    docs: rows.filter((r) => r.kind === "guide_doc"),
    tracks: rows.filter((r) => r.kind === "track"),
    playbooks: rows.filter((r) => r.kind === "playbook"),
    resources: rows.filter((r) => r.kind === "resource"),
  });
});

// ---- guide_doc detail (with body) ----
academyRoutes.get("/doc/:slug", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const lang = c.req.query("lang") === "en" ? "en" : "zh-HK";
  const { data, error } = await supabase.from("academy_content").select(FULL_COLS)
    .eq("status", "published").eq("kind", "guide_doc").eq("slug", c.req.param("slug")).maybeSingle();
  if (error || !data) return c.json({ error: "not found", code: "not_found" }, 404);
  return c.json({ item: shape(data as unknown as Row, lang, true) });
});

// ---- track detail (body may be empty; card renders excerpt) ----
academyRoutes.get("/track/:slug", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const lang = c.req.query("lang") === "en" ? "en" : "zh-HK";
  const { data, error } = await supabase.from("academy_content").select(FULL_COLS)
    .eq("status", "published").eq("kind", "track").eq("slug", c.req.param("slug")).maybeSingle();
  if (error || !data) return c.json({ error: "not found", code: "not_found" }, 404);
  const { data: allowed, error: gateError } = await supabase.rpc("can_read_academy_track", { p_track: (data as unknown as Row).id });
  if (gateError) return c.json({ code: "learning_unavailable", error: "Learning permissions are temporarily unavailable." }, 503);
  return c.json({ item: { ...shape(data as unknown as Row, lang, true), ...(!allowed ? { body: "" } : {}) } });
});
