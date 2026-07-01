import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, serviceForTests, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function koreq(path: string, jwt: string) {
  return app.request(`/api${path}`, { headers: { Authorization: `Bearer ${jwt}`, "X-Workspace-Slug": "demo" } });
}

suite("creator content reads (RLS)", () => {
  let koc: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("content-read@test.local", 0);
    const svc = serviceForTests();
    await svc.from("content_items").insert([
      { kind: "article", slug: "c1-pub", status: "published", title_zh: "已發布", body_zh: "內容", audience: "creator", published_at: new Date().toISOString() },
      { kind: "article", slug: "c1-draft", status: "draft", title_zh: "草稿", body_zh: "x", audience: "creator" },
      { kind: "article", slug: "c1-brand-leak", status: "published", title_zh: "品牌專屬", body_zh: "y", audience: "brand", published_at: new Date().toISOString() },
    ]);
  });
  afterAll(async () => {
    await serviceForTests().from("content_items").delete().in("slug", ["c1-pub", "c1-draft", "c1-brand-leak"]);
    await cleanup();
  });

  it("list returns published, hides draft", async () => {
    const { items } = await (await koreq("/content", koc.jwt)).json();
    const slugs = items.map((i: { slug: string }) => i.slug);
    expect(slugs).toContain("c1-pub");
    expect(slugs).not.toContain("c1-draft");
  });

  it("detail 404s a draft slug, 200s a published one and increments views", async () => {
    expect((await koreq("/content/c1-draft", koc.jwt)).status).toBe(404);
    const res = await koreq("/content/c1-pub", koc.jwt);
    expect(res.status).toBe(200);
    expect((await res.json()).item.slug).toBe("c1-pub");
    const { data } = await serviceForTests().from("content_items").select("views").eq("slug", "c1-pub").single();
    expect(data!.views).toBeGreaterThanOrEqual(1);
  });

  it("never returns a brand-audience row in the list, even with a kind filter", async () => {
    const { items } = await (await koreq("/content", koc.jwt)).json();
    expect(items.map((i: { slug: string }) => i.slug)).not.toContain("c1-brand-leak");
    const { items: filtered } = await (await koreq("/content?kind=article", koc.jwt)).json();
    expect(filtered.map((i: { slug: string }) => i.slug)).not.toContain("c1-brand-leak");
  });

  it("404s a direct slug fetch of a brand-audience row", async () => {
    expect((await koreq("/content/c1-brand-leak", koc.jwt)).status).toBe(404);
  });
});
