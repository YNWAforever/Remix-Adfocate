import { fixtureName } from "./helpers";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeBrand, makeCreator, serviceForTests, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function breq(path: string, jwt: string) {
  return app.request(`/api${path}`, { headers: { Authorization: `Bearer ${jwt}` } });
}

suite("brand resources (audience isolation)", () => {
  let brand: Awaited<ReturnType<typeof makeBrand>>;

  beforeAll(async () => {
    await cleanup();
    brand = await makeBrand(fixtureName("resources-brand@test.local"));
    const svc = serviceForTests();
    await svc.from("content_items").insert([
      { kind: "article", slug: "res-brand-pub", status: "published", title_zh: "品牌指南", body_zh: "內容", audience: "brand", published_at: new Date().toISOString() },
      { kind: "article", slug: "res-brand-draft", status: "draft", title_zh: "草稿指南", body_zh: "x", audience: "brand" },
      { kind: "article", slug: "res-creator-leak", status: "published", title_zh: "創作者專屬", body_zh: "y", audience: "creator", published_at: new Date().toISOString() },
    ]);
  });
  afterAll(async () => {
    await serviceForTests().from("content_items").delete().in("slug", ["res-brand-pub", "res-brand-draft", "res-creator-leak"]);
    await cleanup();
  });

  it("401s without a token", async () => {
    expect((await app.request("/api/brand/resources")).status).toBe(401);
  });

  it("lists published brand-audience items, hides drafts and creator-audience rows", async () => {
    const res = await breq("/brand/resources", brand.jwt);
    expect(res.status).toBe(200);
    const { items } = await res.json();
    const slugs = items.map((i: { slug: string }) => i.slug);
    expect(slugs).toContain("res-brand-pub");
    expect(slugs).not.toContain("res-brand-draft");
    expect(slugs).not.toContain("res-creator-leak");
  });

  it("never returns a creator-audience row on direct slug fetch", async () => {
    expect((await breq("/brand/resources/res-creator-leak", brand.jwt)).status).toBe(404);
  });

  it("detail 200s a published brand row and increments views", async () => {
    const res = await breq("/brand/resources/res-brand-pub", brand.jwt);
    expect(res.status).toBe(200);
    expect((await res.json()).item.slug).toBe("res-brand-pub");
    const { data } = await serviceForTests().from("content_items").select("views").eq("slug", "res-brand-pub").single();
    expect(data!.views).toBeGreaterThanOrEqual(1);
  });

  it("a non-brand caller (creator) gets 403", async () => {
    const koc = await makeCreator(fixtureName("resources-koc@test.local"), 0);
    expect((await breq("/brand/resources", koc.jwt)).status).toBe(403);
  });
});
