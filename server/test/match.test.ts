import { FIXTURE_WORKSPACE_SLUG } from "./helpers";
import { fixtureName } from "./helpers";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, makeMission, seedSubmission, setCreatorProfile, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function req(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, "X-Workspace-Slug": FIXTURE_WORKSPACE_SLUG, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const plusDays = (n: number) => iso(Date.now() + n * DAY);

suite("mission matcher", () => {
  let koc: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator(fixtureName("match@test.local"), 0); // default level L0
    await setCreatorProfile(koc.userId, { categories: ["美妝"] });
    await makeMission({ slug: fixtureName("test-match-niche"), category: "美妝", points_reward: 200, deadline: plusDays(5) });
    await makeMission({ slug: fixtureName("test-match-offniche"), category: "科技", points_reward: 100, deadline: plusDays(20) });
    await makeMission({ slug: fixtureName("test-match-locked"), category: "美妝", required_level: "L1", points_reward: 999, deadline: plusDays(2) });
    await makeMission({ slug: fixtureName("test-match-full"), category: "美妝", quota: 3, filled: 3 });
    await makeMission({ slug: fixtureName("test-match-app"), category: "美妝", access_type: "application" });
    await makeMission({ slug: fixtureName("test-match-past"), category: "美妝", deadline: plusDays(-2) });
    await seedSubmission(koc.userId, "joined", fixtureName("test-match-joined")); // engaged → excluded
  });
  afterAll(cleanup);

  it("returns scored, ranked candidates each with a 0-100 fit_score and a rationale", async () => {
    const res = await req("/match", koc.jwt);
    expect(res.status).toBe(200);
    const { matches } = await res.json();
    const slugs = matches.map((m: { slug: string }) => m.slug);
    expect(slugs).toContain(fixtureName("test-match-niche"));
    expect(slugs).toContain(fixtureName("test-match-offniche"));
    expect(slugs).toContain(fixtureName("test-match-locked"));
    for (const m of matches) {
      expect(m.fit_score).toBeGreaterThanOrEqual(0);
      expect(m.fit_score).toBeLessThanOrEqual(100);
      expect(typeof m.rationale).toBe("string");
      expect(m.rationale.length).toBeGreaterThan(0);
    }
  });

  it("excludes full / application / past-deadline / already-engaged missions", async () => {
    const { matches } = await (await req("/match", koc.jwt)).json();
    const slugs = matches.map((m: { slug: string }) => m.slug);
    expect(slugs).not.toContain(fixtureName("test-match-full"));
    expect(slugs).not.toContain(fixtureName("test-match-app"));
    expect(slugs).not.toContain(fixtureName("test-match-past"));
    expect(slugs).not.toContain(fixtureName("test-match-joined"));
  });

  it("ranks in-niche above off-niche, and sinks the locked mission to the bottom", async () => {
    const { matches } = await (await req("/match", koc.jwt)).json();
    const idx = (slug: string) => matches.findIndex((m: { slug: string }) => m.slug === slug);
    expect(idx(fixtureName("test-match-niche"))).toBeLessThan(idx(fixtureName("test-match-offniche")));
    expect(idx(fixtureName("test-match-locked"))).toBeGreaterThan(idx(fixtureName("test-match-niche")));
    expect(idx(fixtureName("test-match-locked"))).toBeGreaterThan(idx(fixtureName("test-match-offniche")));
    const locked = matches.find((m: { slug: string }) => m.slug === fixtureName("test-match-locked"));
    expect(locked.locked).toBe(true);
    expect(locked.rationale).toContain("解鎖");
  });
});
