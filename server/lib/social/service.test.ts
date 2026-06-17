import { describe, expect, it, vi } from "vitest";
import { scanSocialAccountWithDeps } from "./service";
import type { SocialAccountRecord, SocialScanResult } from "./types";

const baseAccount: SocialAccountRecord = {
  id: "acc-1",
  creator_id: "creator-1",
  workspace_id: "workspace-1",
  platform: "instagram",
  handle: "ming",
  profile_url: null,
  owner_verified: false,
  api_synced_at: null,
  sync_status: "pending",
  follower_count: null,
  following_count: null,
  post_count: null,
  bio: null,
  external_avatar_url: null,
  engagement_rate: null,
  avg_likes: null,
  avg_comments: null,
  posting_frequency: null,
  freshness_score: null,
  content_themes: [],
  summary: {},
  last_error_code: null,
  last_error_message: null,
};

const scanResult: SocialScanResult = {
  platform: "instagram",
  handle: "ming",
  profileUrl: "https://www.instagram.com/ming/",
  followerCount: 12000,
  followingCount: 321,
  postCount: 42,
  bio: "Beauty creator",
  externalAvatarUrl: "https://cdn.example.com/ming.jpg",
  engagementRate: 4.38,
  avgLikes: 500,
  avgComments: 25,
  postingFrequency: 2,
  freshnessScore: 100,
  contentThemes: ["beauty"],
  recentPostsSummary: [],
  summary: {
    postSampleSize: 0,
    hasRecentPosts: false,
    hasAvatar: true,
    hasBio: true,
  },
};

describe("social scan service", () => {
  it("stores latest metrics and a snapshot after a successful scan", async () => {
    const repo = {
      getAccountForCreator: vi.fn().mockResolvedValue(baseAccount),
      updateAccountFromScan: vi
        .fn()
        .mockResolvedValue({ ...baseAccount, sync_status: "synced", follower_count: 12000 }),
      insertSnapshot: vi.fn().mockResolvedValue(undefined),
      markAccountScanFailed: vi.fn(),
    };
    const provider = vi.fn().mockResolvedValue(scanResult);

    const account = await scanSocialAccountWithDeps({
      creatorId: "creator-1",
      accountId: "acc-1",
      repo,
      provider,
    });

    expect(account.follower_count).toBe(12000);
    expect(provider).toHaveBeenCalledWith({ platform: "instagram", handle: "ming" });
    expect(repo.updateAccountFromScan).toHaveBeenCalledWith("acc-1", scanResult);
    expect(repo.insertSnapshot).toHaveBeenCalledWith("acc-1", "rapidapi", "synced", scanResult);
  });

  it("records failed status without erasing prior metrics", async () => {
    const repo = {
      getAccountForCreator: vi.fn().mockResolvedValue({ ...baseAccount, follower_count: 1000 }),
      updateAccountFromScan: vi.fn(),
      insertSnapshot: vi.fn().mockResolvedValue(undefined),
      markAccountScanFailed: vi
        .fn()
        .mockResolvedValue({ ...baseAccount, sync_status: "rate_limited", follower_count: 1000 }),
    };
    const provider = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("limited"), { code: "rate_limited", status: "rate_limited" }));

    const account = await scanSocialAccountWithDeps({
      creatorId: "creator-1",
      accountId: "acc-1",
      repo,
      provider,
    });

    expect(account.sync_status).toBe("rate_limited");
    expect(account.follower_count).toBe(1000);
    expect(repo.updateAccountFromScan).not.toHaveBeenCalled();
    expect(repo.insertSnapshot).toHaveBeenCalledWith(
      "acc-1",
      "rapidapi",
      "rate_limited",
      expect.objectContaining({ errorCode: "rate_limited" }),
    );
  });
});
