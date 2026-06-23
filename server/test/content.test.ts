import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { createClient } from "@supabase/supabase-js";
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
      { kind: "article", slug: "c1-pub", status: "published", title_zh: "已發布", body_zh: "內容", published_at: new Date().toISOString() },
      { kind: "article", slug: "c1-draft", status: "draft", title_zh: "草稿", body_zh: "x" },
    ]);
  });
  afterAll(cleanup);

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
});
