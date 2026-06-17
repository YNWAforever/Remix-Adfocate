import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createApp } from "../app";
import { cleanup, hasSupabaseEnv, makeCreator } from "./helpers";

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
      "X-Workspace-Slug": "demo",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

suite("social account endpoints", () => {
  let c: { userId: string; jwt: string };

  beforeAll(async () => {
    await cleanup();
    c = await makeCreator("social-api@test.local");
  });

  afterAll(cleanup);

  beforeEach(() => vi.clearAllMocks());

  it("adds and lists an Instagram account", async () => {
    const res = await req("/social/accounts", c.jwt, {
      method: "POST",
      body: JSON.stringify({ platform: "instagram", handle: "@Ming" }),
    });
    expect(res.status).toBe(200);
    const account = await res.json();
    expect(account).toMatchObject({
      platform: "instagram",
      handle: "ming",
      sync_status: "pending",
      owner_verified: false,
    });

    const list = await (await req("/social/accounts", c.jwt)).json();
    expect(list.accounts).toHaveLength(1);
    expect(list.accounts[0].handle).toBe("ming");
  });

  it("scans an account and returns API-synced metrics", async () => {
    const created = await (
      await req("/social/accounts", c.jwt, {
        method: "POST",
        body: JSON.stringify({ platform: "threads", handle: "ming" }),
      })
    ).json();

    const scan = await req(`/social/accounts/${created.id}/scan`, c.jwt, { method: "POST" });
    expect(scan.status).toBe(200);
    const body = await scan.json();
    expect(body.account).toMatchObject({
      platform: "threads",
      sync_status: "synced",
      follower_count: 12000,
      engagement_rate: 4.5,
    });
    expect(body.labels).toEqual(["API-synced", "Ownership not verified"]);
  });

  it("rejects unsupported platforms", async () => {
    const res = await req("/social/accounts", c.jwt, {
      method: "POST",
      body: JSON.stringify({ platform: "x", handle: "bad" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "bad_platform" });
  });
});
