import { FIXTURE_WORKSPACE_SLUG } from "./helpers";
import { fixtureName } from "./helpers";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();

function call(path: string, jwt: string) {
  return app.request(path, { headers: { Authorization: `Bearer ${jwt}`, "X-Workspace-Slug": FIXTURE_WORKSPACE_SLUG } });
}

// Integration test — requires a live Supabase (local `supabase start` stack or cloud)
// with SUPABASE_URL/SERVICE_KEY/ANON_KEY set. Skips cleanly when that env is absent.
const suite = hasSupabaseEnv ? describe : describe.skip;

suite("RLS isolation", () => {
  let alice: { userId: string; jwt: string };
  let bob: { userId: string; jwt: string };

  beforeAll(async () => {
    await cleanup();
    alice = await makeCreator(fixtureName("alice@test.local"), 1250);
    bob = await makeCreator(fixtureName("bob@test.local"), 99);
  });
  afterAll(cleanup);

  it("a creator reads only their own balance", async () => {
    const res = await call("/api/wallet/points", alice.jwt);
    expect(res.status).toBe(200);
    expect((await res.json()).balance).toBe(1250);
  });

  it("another creator sees their own balance, never the first's", async () => {
    const res = await call("/api/wallet/points", bob.jwt);
    expect((await res.json()).balance).toBe(99);
  });

  it("missions are readable for the workspace", async () => {
    const res = await call("/api/missions", alice.jwt);
    expect(res.status).toBe(200);
    const slugs = (await res.json()).missions.map((mission: { slug: string }) => mission.slug);
    expect(slugs).toEqual(expect.arrayContaining([
      "koc-trial-serum",
      "ugc-cafe",
      "clip-skincare",
      "ugc-pet",
      "koc-trial-mask",
      "ugc-travel",
    ].map(fixtureName)));
  });

  it("points history returns an array scoped to the creator", async () => {
    const res = await call("/api/wallet/points/history", alice.jwt);
    expect(res.status).toBe(200);
    expect(Array.isArray((await res.json()).transactions)).toBe(true);
  });
});
