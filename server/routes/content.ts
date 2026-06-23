// server/routes/content.ts — creator-facing reads. Mounted on the guarded group;
// makeUserClient(jwt) so RLS enforces published-global visibility. Relative imports carry .js.
import { Hono } from "hono";
import type { Env } from "../app.js";
import { makeUserClient } from "../lib/supabase.js";

export const contentRoutes = new Hono<Env>();

type Row = {
  id: string; slug: string; kind: string; title_zh: string; title_en: string | null;
  excerpt_zh: string | null; excerpt_en: string | null; body_zh: string; body_en: string | null;
  cover_image_url: string | null; published_at: string | null; pinned: boolean; pinned_rank: number | null;
  views: number; content_categories: { slug: string; label_zh: string; label_en: string | null } | null;
  content_item_tags: { content_tags: { slug: string; label_zh: string; label_en: string | null } }[];
};

const SEL =
  "id, slug, kind, title_zh, title_en, excerpt_zh, excerpt_en, body_zh, body_en, cover_image_url, " +
  "published_at, pinned, pinned_rank, views, content_categories(slug,label_zh,label_en), " +
  "content_item_tags(content_tags(slug,label_zh,label_en))";

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
    category: r.content_categories ? { slug: r.content_categories.slug, label: pick(r.content_categories.label_en, r.content_categories.label_zh, lang) } : null,
    tags: (r.content_item_tags ?? []).map((t) => t.content_tags.slug),
    publishedAt: r.published_at, pinned: r.pinned, views: r.views,
  };
}

// ---- list ----
contentRoutes.get("/", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const lang = c.req.query("lang") === "en" ? "en" : "zh-HK";
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const pageSize = 20;
  let q = supabase.from("content_items").select(SEL, { count: "exact" });
  const kind = c.req.query("kind"); if (kind) q = q.eq("kind", kind);
  const category = c.req.query("category"); if (category) q = q.eq("content_categories.slug", category);
  q = q.order("pinned_rank", { ascending: true, nullsFirst: false })
       .order("published_at", { ascending: false })
       .order("id", { ascending: false })
       .range((page - 1) * pageSize, page * pageSize - 1);
  const { data, error, count } = await q;
  if (error) return c.json({ items: [], page, pageSize, total: 0 }); // degrade, never 500
  return c.json({ items: (data as unknown as Row[]).map((r) => shape(r, lang, false)), page, pageSize, total: count ?? 0 });
});

// ---- detail (+ view increment + related) ----
contentRoutes.get("/:slug", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const lang = c.req.query("lang") === "en" ? "en" : "zh-HK";
  const slug = c.req.param("slug");
  const { data, error } = await supabase.from("content_items").select(SEL).eq("slug", slug).maybeSingle();
  if (error || !data) return c.json({ error: "not found", code: "not_found" }, 404);
  await supabase.rpc("content_increment_views", { p_slug: slug });

  const row = data as unknown as Row;
  const tagSlugs = row.content_item_tags?.map((t) => t.content_tags.slug) ?? [];
  let related: ReturnType<typeof shape>[] = [];
  if (tagSlugs.length) {
    const { data: rel } = await supabase.from("content_items").select(SEL)
      .neq("slug", slug).contains("content_item_tags.content_tags.slug", tagSlugs).limit(4);
    related = ((rel as unknown as Row[]) ?? []).map((r) => shape(r, lang, false));
  }
  if (!related.length && row.content_categories) {
    const { data: rel2 } = await supabase.from("content_items").select(SEL)
      .neq("slug", slug).eq("content_categories.slug", row.content_categories.slug)
      .order("published_at", { ascending: false }).limit(4);
    related = ((rel2 as unknown as Row[]) ?? []).map((r) => shape(r, lang, false));
  }
  return c.json({ item: shape(row, lang, true), related });
});
