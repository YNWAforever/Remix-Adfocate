import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, seedSubmission, setReferredBy, setXp, cleanup, hasSupabaseEnv } from "./helpers";

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

suite("creator passport", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("a fresh creator gets all-null scores and no badges", async () => {
    const c = await makeCreator("passport-empty@test.local");
    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.scores).toEqual({ influence: null, reliability: null, content: null, brandSafety: null });
    expect(p.badges).toEqual([]);
    expect(p.level).toBe("L0");
  });

  it("computes reliability from concluded submissions (in-flight ignored)", async () => {
    const c = await makeCreator("passport-rel@test.local");
    await seedSubmission(c.userId, "approved", "test-pp-rel-1");
    await seedSubmission(c.userId, "approved", "test-pp-rel-2");
    await seedSubmission(c.userId, "rejected", "test-pp-rel-3");
    await seedSubmission(c.userId, "expired", "test-pp-rel-4");
    await seedSubmission(c.userId, "joined", "test-pp-rel-5"); // in-flight → excluded
    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.scores.reliability).toBe(50); // round(100 * 2/4)
    expect(p.badges).toContain("first_approval");
  });

  it("reliability is null when only in-flight submissions exist", async () => {
    const c = await makeCreator("passport-relnull@test.local");
    await seedSubmission(c.userId, "joined", "test-pp-relnull-1");
    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.scores.reliability).toBeNull();
  });

  it("computes influence from social-handle followers and earns social_linked", async () => {
    const c = await makeCreator("passport-inf@test.local");
    await req("/me/profile", c.jwt, {
      method: "PUT",
      body: JSON.stringify({ social_handles: [{ platform: "Instagram", handle: "@x", followers: 12000 }] }),
    });
    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.scores.influence).toBe(50); // 12k ≥ 10k tier
    expect(p.badges).toContain("social_linked");
  });

  it("content and brand safety are always locked (null)", async () => {
    const c = await makeCreator("passport-locked@test.local");
    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.scores.content).toBeNull();
    expect(p.scores.brandSafety).toBeNull();
  });

  it("earns level_l1 once xp crosses L1 and referrer with a referred creator", async () => {
    const c = await makeCreator("passport-badges@test.local");
    const child = await makeCreator("passport-child@test.local");
    await setXp(c.userId, 500); // → L1
    await setReferredBy(child.userId, c.userId);
    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.level).toBe("L1");
    expect(p.badges).toContain("level_l1");
    expect(p.badges).toContain("referrer");
  });
});
