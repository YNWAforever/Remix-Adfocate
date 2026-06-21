import { describe, expect, it } from "vitest";
import { effectiveSocialHandles, privateSocialTrustSummary, publicSocialTrustBadges } from "./passportSocial";
import type { SocialAccountRecord } from "./types";

function account(partial: Partial<SocialAccountRecord>): SocialAccountRecord {
  return {
    id: "acc",
    creator_id: "creator",
    workspace_id: "workspace",
    platform: "instagram",
    handle: "ming",
    profile_url: "https://www.instagram.com/ming/",
    owner_verified: false,
    verification_code: null,
    verification_code_expires_at: null,
    verified_at: null,
    api_synced_at: "2026-06-17T00:00:00.000Z",
    sync_status: "synced",
    follower_count: 12000,
    following_count: null,
    post_count: null,
    bio: null,
    external_avatar_url: null,
    engagement_rate: 4.5,
    avg_likes: 500,
    avg_comments: 40,
    posting_frequency: 2,
    freshness_score: 100,
    content_themes: ["beauty"],
    summary: {},
    last_error_code: null,
    last_error_message: null,
    ...partial,
  };
}

describe("passport social inputs", () => {
  it("prefers synced social follower counts over self-reported handles", () => {
    const handles = effectiveSocialHandles({
      syncedAccounts: [account({ follower_count: 12000 })],
      selfReportedHandles: [{ followers: 999999 }],
    });
    expect(handles).toEqual([{ followers: 12000 }]);
  });

  it("falls back to self-reported handles when no synced counts exist", () => {
    const handles = effectiveSocialHandles({
      syncedAccounts: [account({ follower_count: null })],
      selfReportedHandles: [{ followers: 5000 }],
    });
    expect(handles).toEqual([{ followers: 5000 }]);
  });

  it("builds private social trust metrics and labels", () => {
    const summary = privateSocialTrustSummary([
      account({ platform: "threads", handle: "ming", engagement_rate: 2.2 }),
    ]);

    expect(summary.accounts[0]).toMatchObject({
      platform: "threads",
      handle: "ming",
      followerCount: 12000,
      engagementRate: 2.2,
      ownerVerified: false,
      labels: ["API-synced", "Ownership not verified"],
    });
    expect(summary.badges).toContain("social_scan_connected");
    expect(summary.badges).toContain("fresh_profile_activity");
  });

  it("returns an empty private social trust summary when no synced accounts exist", () => {
    expect(privateSocialTrustSummary([])).toEqual({
      accounts: [],
      badges: [],
    });
  });

  it("returns only public-safe social trust badges", () => {
    expect(publicSocialTrustBadges([account({})])).toEqual([
      "social_scan_connected",
      "fresh_profile_activity",
      "active_creator",
    ]);
  });
});
