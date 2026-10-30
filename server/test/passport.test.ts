import { FIXTURE_WORKSPACE_SLUG } from "./helpers";
import { fixtureName } from "./helpers";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const failingSocialAccountReads = new Set<string>();

vi.mock("../lib/social/repo.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/social/repo.js")>("../lib/social/repo.js");
  return {
    ...actual,
    listSocialAccounts: vi.fn(async (supabase, creatorId: string) => {
      if (failingSocialAccountReads.has(creatorId)) throw new Error("social accounts exploded");
      return actual.listSocialAccounts(supabase, creatorId);
    }),
  };
});

import { createApp } from "../app";
import { makeCreator, seedSubmission, setReferredBy, setXp, cleanup, hasSupabaseEnv } from "./helpers";

vi.mock("../lib/social/rapidApi.js", () => ({
  scanRapidApiProfile: vi.fn(
    async ({ platform, handle }: { platform: "instagram" | "threads"; handle: string }) => ({
      platform,
      handle,
      profileUrl:
        platform === "instagram"
          ? `https://www.instagram.com/${handle}/`
          : `https://www.threads.net/@${handle}`,
      followerCount: 12000,
      followingCount: 321,
      postCount: 42,
      bio: "Mock scanned creator",
      externalAvatarUrl: "https://cdn.example.com/avatar.jpg",
      engagementRate: 4.5,
      avgLikes: 500,
      avgComments: 40,
      postingFrequency: 2,
      freshnessScore: 100,
      contentThemes: ["beauty"],
      recentPostsSummary: [],
      summary: { mocked: true },
    }),
  ),
}));

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

suite("creator passport", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("a fresh creator gets all-null scores and no badges", async () => {
    const c = await makeCreator(fixtureName("passport-empty@test.local"));
    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.scores).toEqual({ influence: null, reliability: null, content: null, brandSafety: null });
    expect(p.badges).toEqual([]);
    expect(p.level).toBe("L0");
  });

  it("computes reliability from concluded submissions (in-flight ignored)", async () => {
    const c = await makeCreator(fixtureName("passport-rel@test.local"));
    await seedSubmission(c.userId, "approved", fixtureName("test-pp-rel-1"));
    await seedSubmission(c.userId, "approved", fixtureName("test-pp-rel-2"));
    await seedSubmission(c.userId, "rejected", fixtureName("test-pp-rel-3"));
    await seedSubmission(c.userId, "expired", fixtureName("test-pp-rel-4"));
    await seedSubmission(c.userId, "joined", fixtureName("test-pp-rel-5")); // in-flight → excluded
    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.scores.reliability).toBe(50); // round(100 * 2/4)
    expect(p.badges).toContain("first_approval");
  });

  it("reliability is null when only in-flight submissions exist", async () => {
    const c = await makeCreator(fixtureName("passport-relnull@test.local"));
    await seedSubmission(c.userId, "joined", fixtureName("test-pp-relnull-1"));
    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.scores.reliability).toBeNull();
  });

  it("computes influence from social-handle followers and earns social_linked", async () => {
    const c = await makeCreator(fixtureName("passport-inf@test.local"));
    await req("/me/profile", c.jwt, {
      method: "PUT",
      body: JSON.stringify({ social_handles: [{ platform: "Instagram", handle: "@x", followers: 12000 }] }),
    });
    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.scores.influence).toBe(50); // 12k ≥ 10k tier
    expect(p.badges).toContain("social_linked");
  });

  it("computes content from quality ratings (unrated approvals excluded)", async () => {
    const c = await makeCreator(fixtureName("passport-content@test.local"));
    await seedSubmission(c.userId, "approved", fixtureName("test-pp-con-1"), 5);
    await seedSubmission(c.userId, "approved", fixtureName("test-pp-con-2"), 3);
    await seedSubmission(c.userId, "approved", fixtureName("test-pp-con-3")); // unrated → excluded from content
    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.scores.content).toBe(80); // round(20 * avg(5,3)) = round(20*4)
    expect(p.badges).toContain("perfect_rating"); // a 5★ is present
  });

  it("computes brand safety as the non-rejection rate (expired excluded)", async () => {
    const c = await makeCreator(fixtureName("passport-bs@test.local"));
    await seedSubmission(c.userId, "approved", fixtureName("test-pp-bs-1"));
    await seedSubmission(c.userId, "rejected", fixtureName("test-pp-bs-2"));
    await seedSubmission(c.userId, "expired", fixtureName("test-pp-bs-3")); // never reviewed → excluded
    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.scores.brandSafety).toBe(50); // round(100 * 1/(1+1))
  });

  it("content and brand safety are null for a creator with no rated/reviewed work", async () => {
    const c = await makeCreator(fixtureName("passport-noscore@test.local"));
    await seedSubmission(c.userId, "joined", fixtureName("test-pp-noscore-1")); // in-flight only
    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.scores.content).toBeNull();
    expect(p.scores.brandSafety).toBeNull();
  });

  it("earns content_pro and spotless from 3+ high-quality reviewed submissions", async () => {
    const c = await makeCreator(fixtureName("passport-pro@test.local"));
    await seedSubmission(c.userId, "approved", fixtureName("test-pp-pro-1"), 5);
    await seedSubmission(c.userId, "approved", fixtureName("test-pp-pro-2"), 4);
    await seedSubmission(c.userId, "approved", fixtureName("test-pp-pro-3"), 5);
    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.badges).toContain("content_pro"); // content round(20*avg(5,4,5))=93 ≥ 80, 3 ratings
    expect(p.badges).toContain("spotless"); // brand safety 100 over 3 reviewed
  });

  it("earns level_l1 once xp crosses L1 and referrer with a referred creator", async () => {
    const c = await makeCreator(fixtureName("passport-badges@test.local"));
    const child = await makeCreator(fixtureName("passport-child@test.local"));
    await setXp(c.userId, 500); // → L1
    await setReferredBy(child.userId, c.userId);
    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.level).toBe("L1");
    expect(p.badges).toContain("level_l1");
    expect(p.badges).toContain("referrer");
  });

  it("prefers API-synced follower counts over self-reported followers", async () => {
    const c = await makeCreator(fixtureName("passport-api-synced@test.local"));
    await req("/me/profile", c.jwt, {
      method: "PUT",
      body: JSON.stringify({ social_handles: [{ platform: "Instagram", handle: "@x", followers: 999999 }] }),
    });
    await req("/social/accounts", c.jwt, {
      method: "POST",
      body: JSON.stringify({ platform: "instagram", handle: "@x" }),
    });
    const accounts = await (await req("/social/accounts", c.jwt)).json();
    const id = accounts.accounts[0].id;
    await req(`/social/accounts/${id}/scan`, c.jwt, { method: "POST" });

    const p = await (await req("/me/passport", c.jwt)).json();
    expect(p.scores.influence).toBe(50);
    expect(p.socialTrust.accounts[0]).toMatchObject({
      handle: "x",
      followerCount: 12000,
      labels: ["API-synced", "Ownership not verified"],
    });
  });

  it("returns db_error when synced social accounts cannot be loaded", async () => {
    const c = await makeCreator(fixtureName("passport-social-db-error@test.local"));
    failingSocialAccountReads.add(c.userId);

    try {
      const res = await req("/me/passport", c.jwt);
      expect(res.status).toBe(500);
      const body = await res.json();
      // F-032: the code is kept, but raw database text never reaches the client.
      expect(body).toMatchObject({ code: "db_error" });
      expect(JSON.stringify(body)).not.toContain("social accounts exploded");
    } finally {
      failingSocialAccountReads.delete(c.userId);
    }
  });
});
