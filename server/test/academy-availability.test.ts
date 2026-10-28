import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Env } from "../app";
const h = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("../lib/supabase.js", () => ({
  makeUserClient: () => ({ from: () => {
    const q = { select: () => q, eq: () => q, order: () => q,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: h.rows, error: null }).then(resolve) };
    return q;
  } }),
}));
import { academyRoutes } from "../routes/academy";
const app = new Hono<Env>();
app.use("*", async (c, next) => { c.set("jwt", "offline-fixture"); await next(); });
app.route("/academy", academyRoutes);
const row = (id: string, body_zh: string, body_en: string | null) => ({
  id, slug: id, kind: "track", title_zh: "課程", title_en: "Track", excerpt_zh: "簡介", excerpt_en: "Introduction",
  body_zh, body_en, required_level: "L0", emoji: "🌱", color: "pink", sort: 0, metadata: { duration: { en: "4 lessons", zh: "4堂課" } },
});
describe("D14 Academy availability DTO", () => {
  beforeEach(() => { h.rows = []; });
  it("derives availability from the localized body, never from duration metadata or the excerpt", async () => {
    h.rows = [row("empty", "   ", null), row("ready", "## 真實正文", "## Real body")];
    const res = await app.request("/academy?lang=en");
    expect(res.status).toBe(200);
    const bundle = await res.json();
    expect(bundle.tracks.map((t: Record<string, unknown>) => [t.slug, t.contentStatus])).toEqual([["empty", "preparing"], ["ready", "available"]]);
    expect(bundle.tracks.every((t: Record<string, unknown>) => !("body" in t))).toBe(true);
  });
  it("uses the same language fallback for availability and the displayed body", async () => {
    h.rows = [row("zh-only", "## 中文正文", "")];
    const { tracks } = await (await app.request("/academy?lang=en")).json();
    expect(tracks[0].contentStatus).toBe("available");
  });
});
