// server/routes/brandResources.ts — brand-facing guide/help hub (C2). Read-only; mirrors
// server/routes/content.ts but hard-filters audience='brand' and has no "related" section
// (no tags/categories on brand content in v1). Mounted inside server/routes/brand.ts under
// the existing requireBrand() guard — content is global (workspace_id is null), same
// convention 0021_content_hub.sql already established. All relative imports carry .js.
import { Hono } from "hono";
import type { BrandEnv } from "../lib/brandAuth.js";
import { makeUserClient } from "../lib/supabase.js";

export const brandResourcesRoutes = new Hono<BrandEnv>();

type Row = {
  id: string; slug: string; kind: string; title_zh: string; title_en: string | null;
  excerpt_zh: string | null; excerpt_en: string | null; body_zh: string; body_en: string | null;
  cover_image_url: string | null; published_at: string | null; pinned: boolean; pinned_rank: number | null;
  views: number;
};

const SEL =
  "id, slug, kind, title_zh, title_en, excerpt_zh, excerpt_en, body_zh, body_en, cover_image_url, " +
  "published_at, pinned, pinned_rank, views";

function pick(en: string | null | undefined, zh: string, lang: string) {
  return lang === "en" && en ? en : zh;
}

function shape(r: Row, lang: string, withBody: boolean) {
  return {
    id: r.id, slug: r.slug, kind: r.kind,
    title: pick(r.title_en, r.title_zh, lang),
    excerpt: pick(r.excerpt_en, r.excerpt_zh ?? "", lang) || null,
    ...(withBody ? { body: pick(r.body_en, r.body_zh, lang) } : {}),
    coverImageUrl: r.cover_image_url,
    publishedAt: r.published_at, pinned: r.pinned, views: r.views,
  };
}

function bearer(c: { req: { header: (k: string) => string | undefined } }): string {
  const a = c.req.header("Authorization") ?? "";
  return a.startsWith("Bearer ") ? a.slice(7) : "";
}

// ---- list ----
brandResourcesRoutes.get("/resources", async (c) => {
  const supabase = makeUserClient(bearer(c));
  const lang = c.req.query("lang") === "en" ? "en" : "zh-HK";
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const pageSize = 20;
  const { data, error, count } = await supabase.from("content_items").select(SEL, { count: "exact" })
    .eq("audience", "brand")
    .order("pinned_rank", { ascending: true, nullsFirst: false })
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) return c.json({ items: [], page, pageSize, total: 0 }); // degrade, never 500
  return c.json({ items: (data as unknown as Row[]).map((r) => shape(r, lang, false)), page, pageSize, total: count ?? 0 });
});

// ---- detail (+ view increment; no related section in v1) ----
brandResourcesRoutes.get("/resources/:slug", async (c) => {
  const supabase = makeUserClient(bearer(c));
  const lang = c.req.query("lang") === "en" ? "en" : "zh-HK";
  const slug = c.req.param("slug");
  const { data, error } = await supabase.from("content_items").select(SEL)
    .eq("audience", "brand").eq("slug", slug).maybeSingle();
  if (error || !data) return c.json({ error: "not found", code: "not_found" }, 404);
  await supabase.rpc("content_increment_views", { p_slug: slug });
  return c.json({ item: shape(data as unknown as Row, lang, true) });
});
