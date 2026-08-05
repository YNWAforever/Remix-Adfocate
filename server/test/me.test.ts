import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { parseBootstrapSlugs } from "../routes/me";
import { makeCreator, makeUser, serviceForTests, cleanup, hasSupabaseEnv, DEMO_WS } from "./helpers";

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

/** The workspace bootstrap must refuse — a real row, deliberately off the allowlist. The
 *  "test-brand-ws-" prefix is what cleanup() deletes. */
const OFF_ALLOWLIST_SLUG = "test-brand-ws-bootstrap-allowlist";

function bootstrap(slug: string, jwt: string) {
  return app.request("/api/me/bootstrap", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ slug }),
  });
}

describe("parseBootstrapSlugs", () => {
  it("falls back to the deploy's single configured workspace when unset", () => {
    expect([...parseBootstrapSlugs(undefined, undefined)]).toEqual(["demo"]);
    expect([...parseBootstrapSlugs("   ", "acme")]).toEqual(["acme"]);
  });

  it("parses a comma list, trimming, lowercasing and dropping empties", () => {
    expect([...parseBootstrapSlugs(" Demo , acme ,, ", "ignored")]).toEqual(["demo", "acme"]);
  });
});

suite("me/bootstrap workspace allowlist", () => {
  let user: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    const { error } = await serviceForTests()
      .from("workspaces")
      .insert({ slug: OFF_ALLOWLIST_SLUG, name: "Bootstrap allowlist test WS" });
    if (error) throw error;
    user = await makeUser({ email: "bootallowlist@test.local" });
  });
  afterAll(cleanup);

  it("joins the allow-listed workspace", async () => {
    // Also gives cleanup() a creator row (display_name "%@test.local") to remove afterwards.
    const res = await bootstrap("demo", user.jwt);
    expect(res.status).toBe(200);
    expect((await res.json()).created).toBe(true);
  });

  it("refuses a real off-allowlist workspace, indistinguishably from an unknown slug", async () => {
    const real = await bootstrap(OFF_ALLOWLIST_SLUG, user.jwt);
    const unknown = await bootstrap("no-such-workspace-4f2a", user.jwt);
    expect(real.status).toBe(404);
    expect(real.status).toBe(unknown.status);
    expect(real.headers.get("content-type")).toBe(unknown.headers.get("content-type"));
    expect(await real.text()).toBe(await unknown.text());

    // The refusal never re-homed the creator away from the workspace they bootstrapped into.
    const { data } = await serviceForTests()
      .from("creators")
      .select("workspace_id")
      .eq("id", user.userId)
      .single();
    expect(data!.workspace_id).toBe(DEMO_WS);
  });
});

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
