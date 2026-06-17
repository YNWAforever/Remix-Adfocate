import { describe, it, expect, vi } from "vitest";
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
  it("normalizes handles and profile URLs", () => {
    expect(normalizeHandle("instagram", "@Ming.KOC ")).toBe("ming.koc");
    expect(normalizeHandle("threads", " @Creator ")).toBe("creator");
    expect(profileUrlFor("instagram", "ming")).toBe("https://www.instagram.com/ming/");
    expect(profileUrlFor("threads", "ming")).toBe("https://www.threads.net/@ming");
  });

  it("normalizes an Instagram profile response", async () => {
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
    expect(result.recentPostsSummary).toHaveLength(2);
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
});
