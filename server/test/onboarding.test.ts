import { FIXTURE_WORKSPACE_SLUG } from "./helpers";
import { fixtureName } from "./helpers";
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
      "X-Workspace-Slug": FIXTURE_WORKSPACE_SLUG,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

suite("onboarding endpoints", () => {
  let creator: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    creator = await makeCreator(fixtureName("onb@test.local"), 0);
  });
  afterAll(cleanup);

  it("status starts at step 1, 0% complete", async () => {
    const res = await req("/onboarding/status", creator.jwt);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.onboarding_step).toBe(1);
    expect(body.onboarding_completed).toBe(false);
    expect(body.completion_pct).toBe(0);
  });

  it("profile saves categories (self-RLS) and advances the step", async () => {
    const res = await req("/onboarding/profile", creator.jwt, {
      method: "PUT",
      body: JSON.stringify({ categories: ["美容", "餐飲"], step: 3 }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).onboarding_step).toBe(3);
  });

  it("profile never regresses the step pointer", async () => {
    const res = await req("/onboarding/profile", creator.jwt, {
      method: "PUT",
      body: JSON.stringify({ step: 2 }),
    });
    expect((await res.json()).onboarding_step).toBe(3);
  });

  it("social/connect appends a handle", async () => {
    const res = await req("/onboarding/social/connect", creator.jwt, {
      method: "POST",
      body: JSON.stringify({ platform: "ig", handle: "@me", followers: 1200 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.social_handles).toHaveLength(1);
    expect(body.social_handles[0]).toMatchObject({ platform: "ig", handle: "@me", verified: false });
  });

  it("recommended-missions returns matching open missions (<=3)", async () => {
    const res = await req("/onboarding/recommended-missions", creator.jwt);
    expect(res.status).toBe(200);
    const { missions } = await res.json();
    expect(missions.length).toBeGreaterThan(0);
    expect(missions.length).toBeLessThanOrEqual(3);
    // categories were set to 美容/餐飲 above → every result is in that set.
    for (const m of missions) expect(["美容", "餐飲"]).toContain(m.category);
  });

  it("complete awards 100 points once and is idempotent", async () => {
    const first = await req("/onboarding/complete", creator.jwt, { method: "POST" });
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.onboarding_completed).toBe(true);
    expect(body.referral_code).toMatch(/^[0-9A-F]{8}$/);

    const bal1 = await req("/wallet/points", creator.jwt);
    expect((await bal1.json()).balance).toBe(100);

    // Second call must not double-award.
    await req("/onboarding/complete", creator.jwt, { method: "POST" });
    const bal2 = await req("/wallet/points", creator.jwt);
    expect((await bal2.json()).balance).toBe(100);
  });
});
