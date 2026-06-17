import { afterEach, describe, it, expect, vi } from "vitest";
import instagramFixture from "./fixtures/instagram-profile.json";
import threadsFixture from "./fixtures/threads-profile.json";
import { normalizeHandle, profileUrlFor } from "./normalize";
import { scanRapidApiProfile } from "./rapidApi";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("social RapidAPI adapter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("normalizes handles and profile URLs", () => {
    expect(normalizeHandle("instagram", "@Ming.KOC ")).toBe("ming.koc");
    expect(normalizeHandle("threads", " @Creator ")).toBe("creator");
    expect(profileUrlFor("instagram", "ming")).toBe("https://www.instagram.com/ming/");
    expect(profileUrlFor("threads", "ming")).toBe("https://www.threads.net/@ming");
    expect(() => normalizeHandle("instagram", "https://www.threads.net/@ming")).toThrow("mismatched_instagram_handle");
    expect(() => normalizeHandle("threads", "https://www.instagram.com/ming/")).toThrow("mismatched_threads_handle");
  });

  it("normalizes an Instagram profile response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T08:00:00.000Z"));

    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(instagramFixture));
    const result = await scanRapidApiProfile({
      platform: "instagram",
      handle: "@ming",
      env: {
        RAPIDAPI_KEY: "test-key",
        RAPIDAPI_INSTAGRAM_PROFILE_URL: "https://instagram-scraper-stable-api.p.rapidapi.com/ig_get_fb_profile_hover.php",
      },
      fetchImpl,
    });

    expect(result).toMatchObject({
      platform: "instagram",
      handle: "ming",
      profileUrl: "https://www.instagram.com/ming/",
      followerCount: 12000,
      followingCount: 321,
      postCount: 42,
      bio: "Beauty creator in HK",
      externalAvatarUrl: "https://cdn.example.com/ig/ming.jpg",
      engagementRate: 4.38,
      avgLikes: 500,
      avgComments: 25,
      freshnessScore: 100,
    });
    expect(result.recentPostsSummary).toEqual([
      {
        id: "ig-1",
        postedAt: "2026-06-16T08:00:00.000Z",
        likeCount: 600,
        commentCount: 30,
      },
      {
        id: "ig-2",
        postedAt: "2026-06-15T08:00:00.000Z",
        likeCount: 400,
        commentCount: 20,
      },
    ]);
    expect(result.summary).toEqual({
      postSampleSize: 2,
      hasRecentPosts: true,
      hasAvatar: true,
      hasBio: true,
    });
    expect(result.summary).not.toHaveProperty("rawUsername");
    expect(result.summary).not.toHaveProperty("providerShape");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://instagram-scraper-stable-api.p.rapidapi.com/ig_get_fb_profile_hover.php?username_or_url=ming",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "X-RapidAPI-Key": "test-key",
          "X-RapidAPI-Host": "instagram-scraper-stable-api.p.rapidapi.com",
        }),
      }),
    );
  });

  it("normalizes a Threads profile response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T09:00:00.000Z"));

    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(threadsFixture));
    const result = await scanRapidApiProfile({
      platform: "threads",
      handle: "ming",
      env: {
        RAPIDAPI_KEY: "test-key",
        RAPIDAPI_THREADS_PROFILE_URL: "https://threads-scraper-api2.p.rapidapi.com/profile",
      },
      fetchImpl,
    });

    expect(result).toMatchObject({
      platform: "threads",
      handle: "ming",
      profileUrl: "https://www.threads.net/@ming",
      followerCount: 8800,
      bio: "Threads-first creator",
      externalAvatarUrl: "https://cdn.example.com/threads/ming.jpg",
      engagementRate: 2.05,
      avgLikes: 160,
      avgComments: 20,
    });
    expect(result.recentPostsSummary[0]).not.toHaveProperty("text");
  });

  it("returns provider_not_configured when the key or provider URL is missing", async () => {
    await expect(
      scanRapidApiProfile({
        platform: "instagram",
        handle: "ming",
        env: {},
        fetchImpl: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: "provider_not_configured" });
  });

  it("maps provider HTTP failures to stable app error codes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: "quota exceeded" }, 429));
    await expect(
      scanRapidApiProfile({
        platform: "instagram",
        handle: "ming",
        env: {
          RAPIDAPI_KEY: "test-key",
          RAPIDAPI_INSTAGRAM_PROFILE_URL: "https://instagram-scraper-stable-api.p.rapidapi.com/ig_get_fb_profile_hover.php",
        },
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("maps private or unusable success payloads to private_or_unavailable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: "This profile is private" }));
    await expect(
      scanRapidApiProfile({
        platform: "instagram",
        handle: "ming",
        env: {
          RAPIDAPI_KEY: "test-key",
          RAPIDAPI_INSTAGRAM_PROFILE_URL: "https://instagram-scraper-stable-api.p.rapidapi.com/ig_get_fb_profile_hover.php",
        },
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "private_or_unavailable" });
  });

  it("normalizes network failures to provider_error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("socket hang up"));
    await expect(
      scanRapidApiProfile({
        platform: "instagram",
        handle: "ming",
        env: {
          RAPIDAPI_KEY: "test-key",
          RAPIDAPI_INSTAGRAM_PROFILE_URL: "https://instagram-scraper-stable-api.p.rapidapi.com/ig_get_fb_profile_hover.php",
        },
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      code: "provider_error",
      message: "RapidAPI request failed",
    });
  });

  it("normalizes invalid JSON payloads to provider_error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new Error("Unexpected token <")),
    });
    await expect(
      scanRapidApiProfile({
        platform: "instagram",
        handle: "ming",
        env: {
          RAPIDAPI_KEY: "test-key",
          RAPIDAPI_INSTAGRAM_PROFILE_URL: "https://instagram-scraper-stable-api.p.rapidapi.com/ig_get_fb_profile_hover.php",
        },
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({
      code: "provider_error",
      message: "RapidAPI returned invalid JSON",
    });
  });
});
