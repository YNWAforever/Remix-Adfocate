import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createApp } from "../app";
import { cleanup, hasSupabaseEnv, makeCreator, makeMission, serviceForTests } from "./helpers";

// Mock the provider so confirm finds the code we inject into the returned bio.
let nextBio = "";
vi.mock("../lib/social/rapidApi.js", () => ({
  scanRapidApiProfile: vi.fn(async ({ platform, handle }: { platform: string; handle: string }) => ({
    platform, handle,
    profileUrl: `https://www.instagram.com/${handle}/`,
    followerCount: 12000, followingCount: 100, postCount: 20,
    bio: nextBio,
    externalAvatarUrl: null, engagementRate: 4, avgLikes: 100, avgComments: 5,
    postingFrequency: 1, freshnessScore: 90, contentThemes: [], recentPostsSummary: [],
    summary: { postSampleSize: 0, hasRecentPosts: false, hasAvatar: false, hasBio: true },
  })),
}));

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function req(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, "X-Workspace-Slug": "demo", "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

suite("verification + L2 gate", () => {
  let c: { userId: string; jwt: string };
  let accountId: string;

  beforeAll(async () => {
    await cleanup();
    c = await makeCreator("verify-gate@test.local");
    const created = await (await req("/social/accounts", c.jwt, {
      method: "POST", body: JSON.stringify({ platform: "instagram", handle: "@verifyme" }),
    })).json();
    accountId = created.id;
  });
  afterAll(cleanup);

  it("issue → confirm flips owner_verified when the code is in the bio", async () => {
    const issued = await (await req(`/social/accounts/${accountId}/verification`, c.jwt, { method: "POST" })).json();
    expect(issued.code).toMatch(/^ADF-/);
    nextBio = `beauty creator ${issued.code}`;
    const res = await req(`/social/accounts/${accountId}/verification/confirm`, c.jwt, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json()).account.owner_verified).toBe(true);
  });

  it("confirm returns 422 code_not_in_bio when absent", async () => {
    // re-issue then confirm with a bio missing the code
    await serviceForTests().from("creator_social_accounts").update({ owner_verified: false }).eq("id", accountId);
    const issued = await (await req(`/social/accounts/${accountId}/verification`, c.jwt, { method: "POST" })).json();
    nextBio = "no code here";
    const res = await req(`/social/accounts/${accountId}/verification/confirm`, c.jwt, { method: "POST" });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("code_not_in_bio");
    // restore verified for the gate tests
    nextBio = `restore ${issued.code}`;
    const reIssueRes = await req(`/social/accounts/${accountId}/verification`, c.jwt, { method: "POST" });
    const i2 = await reIssueRes.json(); nextBio = `restore ${i2.code}`;
    await req(`/social/accounts/${accountId}/verification/confirm`, c.jwt, { method: "POST" });
  });

  it("untrusted high-XP creator is blocked from an L2 mission with verification_required", async () => {
    const u = await makeCreator("xp-no-verify@test.local");
    await serviceForTests().from("creators").update({ xp: 5000, level: "L2" }).eq("id", u.userId); // raw L2, no verified handle
    const mission = await makeMission({ slug: "test-l2-open", access_type: "open", required_level: "L2" });
    const res = await req(`/missions/${mission.slug}/join`, u.jwt, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("verification_required");
  });

  it("low-XP creator gets level_locked (not verification_required)", async () => {
    const u = await makeCreator("low-xp@test.local");
    await serviceForTests().from("creators").update({ xp: 100, level: "L0" }).eq("id", u.userId);
    const mission = await makeMission({ slug: "test-l2-open2", access_type: "open", required_level: "L2" });
    const res = await req(`/missions/${mission.slug}/join`, u.jwt, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("level_locked");
  });

  it("verified + enough XP can join the L2 mission", async () => {
    await serviceForTests().from("creators").update({ xp: 5000, level: "L2" }).eq("id", c.userId); // c has a verified handle
    const mission = await makeMission({ slug: "test-l2-open3", access_type: "open", required_level: "L2" });
    const res = await req(`/missions/${mission.slug}/join`, c.jwt, { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("operator manual-verify flips a handle without the provider", async () => {
    const u = await makeCreator("manual-verify@test.local");
    const acc = await (await req("/social/accounts", u.jwt, {
      method: "POST", body: JSON.stringify({ platform: "threads", handle: "manualme" }),
    })).json();
    const res = await app.request(`/api/admin/social/${acc.id}/verify`, {
      method: "POST", headers: { "x-admin-secret": process.env.ADMIN_SECRET ?? "test-admin-secret", "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).account.owner_verified).toBe(true);
  });
});
