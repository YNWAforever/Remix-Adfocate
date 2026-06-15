import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, makeMission, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function req(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, "X-Workspace-Slug": "demo", "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

suite("copilot hook generator", () => {
  let koc: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("hooks@test.local", 0);
    await makeMission({ slug: "test-hooks-mission", title: "夏日保濕面膜", category: "美容" });
  });
  afterAll(cleanup);

  it("returns 5 template hooks (no AI key) for a real mission", async () => {
    const res = await req("/copilot/hook-generator", koc.jwt, {
      method: "POST", body: JSON.stringify({ mission_slug: "test-hooks-mission", platform: "instagram" }),
    });
    expect(res.status).toBe(200);
    const { hooks, source } = await res.json();
    expect(source).toBe("template");
    expect(hooks).toHaveLength(5);
    expect(hooks.map((h: { angle: string }) => h.angle)).toEqual(["問題式", "好奇式", "優惠式", "體驗式", "對比式"]);
    expect(hooks.every((h: { text: string }) => h.text.includes("夏日保濕面膜"))).toBe(true);
  });

  it("404s for an unknown mission slug", async () => {
    const res = await req("/copilot/hook-generator", koc.jwt, {
      method: "POST", body: JSON.stringify({ mission_slug: "test-nope", platform: "instagram" }),
    });
    expect(res.status).toBe(404);
  });

  it("400s when mission_slug is missing", async () => {
    const res = await req("/copilot/hook-generator", koc.jwt, { method: "POST", body: JSON.stringify({ platform: "instagram" }) });
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await app.request("/api/copilot/hook-generator", {
      method: "POST", headers: { "X-Workspace-Slug": "demo", "Content-Type": "application/json" },
      body: JSON.stringify({ mission_slug: "test-hooks-mission", platform: "instagram" }),
    });
    expect(res.status).toBe(401);
  });
});
