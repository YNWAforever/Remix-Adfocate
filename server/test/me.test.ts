import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function req(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "X-Workspace-Slug": "demo",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

suite("me/profile endpoint", () => {
  let c1: { userId: string; jwt: string };
  let c2: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    c1 = await makeCreator("meprofile1@test.local", 0);
    c2 = await makeCreator("meprofile2@test.local", 0);
  });
  afterAll(cleanup);

  it("updates display_name, categories and social_handles; GET /me reflects it", async () => {
    // Keep the '@test.local' suffix so the shared cleanup() still matches this row after the rename.
    const res = await req("/me/profile", c1.jwt, {
      method: "PUT",
      body: JSON.stringify({
        display_name: "updated.meprofile1@test.local",
        categories: ["美容", "科技"],
        social_handles: [{ platform: "Instagram", handle: "@me", followers: 1000, verified: false }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.display_name).toBe("updated.meprofile1@test.local");
    expect(body.categories).toEqual(["美容", "科技"]);
    expect(body.social_handles).toHaveLength(1);
    expect(body.social_handles[0]).toMatchObject({ platform: "Instagram", handle: "@me" });

    const me = await (await req("/me", c1.jwt)).json();
    expect(me.display_name).toBe("updated.meprofile1@test.local");
    expect(me.social_handles).toHaveLength(1);
  });

  it("replaces social_handles wholesale (not append)", async () => {
    await req("/me/profile", c1.jwt, {
      method: "PUT",
      body: JSON.stringify({ social_handles: [{ platform: "TikTok", handle: "@tt" }] }),
    });
    const me = await (await req("/me", c1.jwt)).json();
    expect(me.social_handles).toHaveLength(1);
    expect(me.social_handles[0].platform).toBe("TikTok");
    expect(me.social_handles[0].handle).toBe("@tt");
  });

  it("a creator's edit never touches another creator's row (self-scope)", async () => {
    // c1's display_name is still "updated.meprofile1@test.local" from the first test; test 2 only touched c1's social_handles.
    const before = await (await req("/me", c1.jwt)).json();
    // Keep the '@test.local' suffix so cleanup() still matches c2 after the rename.
    await req("/me/profile", c2.jwt, {
      method: "PUT",
      body: JSON.stringify({ display_name: "selfonly.meprofile2@test.local" }),
    });
    const after = await (await req("/me", c1.jwt)).json();
    expect(after.display_name).toBe(before.display_name);
    const me2 = await (await req("/me", c2.jwt)).json();
    expect(me2.display_name).toBe("selfonly.meprofile2@test.local");
  });
});
