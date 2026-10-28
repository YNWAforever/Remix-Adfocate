import { FIXTURE_WORKSPACE_SLUG } from "./helpers";
import { fixtureName } from "./helpers";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createApp } from "../app";
import { cleanup, hasSupabaseEnv, makeCreator } from "./helpers";

vi.mock("../lib/social/rapidApi.js", () => ({
  scanRapidApiProfile: vi.fn(
    async ({ platform, handle }: { platform: "instagram" | "threads"; handle: string }) => {
      if (handle === "no-provider") {
        throw Object.assign(new Error("RapidAPI social scan is not configured"), {
          code: "provider_not_configured",
          status: "failed",
        });
      }
      if (handle === "private") {
        throw Object.assign(new Error("Profile is private or unavailable"), {
          code: "private_or_unavailable",
          status: "failed",
        });
      }
      if (handle === "rate-limit") {
        throw Object.assign(new Error("RapidAPI rate limit reached"), {
          code: "rate_limited",
          status: "rate_limited",
        });
      }

      return {
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
      };
    },
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

suite("social account endpoints", () => {
  let c: { userId: string; jwt: string };

  beforeAll(async () => {
    await cleanup();
    c = await makeCreator(fixtureName("social-api@test.local"));
  });

  afterAll(cleanup);

  beforeEach(() => vi.clearAllMocks());

  async function createAccount(platform: "instagram" | "threads", handle: string) {
    const res = await req("/social/accounts", c.jwt, {
      method: "POST",
      body: JSON.stringify({ platform, handle }),
    });
    expect(res.status).toBe(200);
    return res.json();
  }

  it("adds and lists an Instagram account", async () => {
    const account = await createAccount("instagram", "@Ming");
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
    const created = await createAccount("threads", "ming");

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

  it("returns 503 with a stable code when the provider is not configured", async () => {
    const created = await createAccount("threads", "no-provider");

    const scan = await req(`/social/accounts/${created.id}/scan`, c.jwt, { method: "POST" });
    expect(scan.status).toBe(503);
    expect(await scan.json()).toMatchObject({
      error: "Social scan provider is unavailable",
      code: "provider_not_configured",
    });

    const list = await (await req("/social/accounts", c.jwt)).json();
    const account = list.accounts.find((entry: { id: string }) => entry.id === created.id);
    expect(account).toMatchObject({
      id: created.id,
      sync_status: "pending",
      last_error_code: null,
    });
  });

  it("returns 422 for failed scans without ownership verification labels", async () => {
    const created = await createAccount("threads", "private");

    const scan = await req(`/social/accounts/${created.id}/scan`, c.jwt, { method: "POST" });
    expect(scan.status).toBe(422);
    expect(await scan.json()).toMatchObject({
      account: {
        id: created.id,
        sync_status: "failed",
        last_error_code: "private_or_unavailable",
      },
      labels: [],
    });
  });

  it("returns 429 for rate-limited scans without ownership verification labels", async () => {
    const created = await createAccount("threads", "rate-limit");

    const scan = await req(`/social/accounts/${created.id}/scan`, c.jwt, { method: "POST" });
    expect(scan.status).toBe(429);
    expect(await scan.json()).toMatchObject({
      account: {
        id: created.id,
        sync_status: "rate_limited",
        last_error_code: "rate_limited",
      },
      labels: [],
    });
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
