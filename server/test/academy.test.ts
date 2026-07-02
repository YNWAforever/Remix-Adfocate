import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function koreq(path: string, jwt: string) {
  return app.request(`/api${path}`, { headers: { Authorization: `Bearer ${jwt}`, "X-Workspace-Slug": "demo" } });
}

suite("GET /api/academy (creator reads)", () => {
  let jwt: string;
  beforeAll(async () => {
    await cleanup();
    ({ jwt } = await makeCreator("academy-reader@test.local"));
  });
  afterAll(async () => {
    await cleanup();
  });

  it("returns the four published groups", async () => {
    const res = await koreq("/academy?lang=zh-HK", jwt);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.docs.length).toBe(8);
    expect(body.tracks.length).toBe(9);
    expect(body.playbooks.length).toBe(6);
    expect(body.resources.length).toBe(8);
    // list bundle omits body
    expect(body.docs[0].body).toBeUndefined();
    // track metadata is localized to a scalar
    expect(typeof body.tracks[0].meta.duration).toBe("string");
    expect(body.tracks[0].meta.levelLabel).toBeTruthy();
  });

  it("returns a guide_doc body via /doc/:slug", async () => {
    const res = await koreq("/academy/doc/leveling?lang=zh-HK", jwt);
    expect(res.status).toBe(200);
    const { item } = await res.json();
    expect(item.title).toBe("等級制度");
    expect(item.body).toContain("經驗值");
    expect(item.body.startsWith("---")).toBe(false); // frontmatter stripped
  });

  it("returns a track via /track/:slug with excerpt", async () => {
    const res = await koreq("/academy/track/a1?lang=en", jwt);
    expect(res.status).toBe(200);
    const { item } = await res.json();
    expect(item.title).toBe("KOC Starter Bootcamp");
    expect(item.excerpt).toBeTruthy();
    expect(item.requiredLevel).toBe("L0");
  });

  it("404s an unknown slug", async () => {
    const res = await koreq("/academy/doc/nope", jwt);
    expect(res.status).toBe(404);
  });
});
