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
  it("keeps legacy handles visible without granting ownership or a sync", () => {
    const result = privateSocialTrustSummary([], [{ platform: "Instagram", handle: "@legacy", verified: true, followers: 999999 }]);
    expect(result.presentations).toEqual([expect.objectContaining({ platform: "instagram", handle: "@legacy", source: "legacy", ownershipVerified: false, syncStatus: "not_connected", lastSyncedAt: null, accountId: null })]);
    expect(result.accounts).toEqual([]);
    expect(result.badges).toEqual([]);
  });

  it("retains conflicting handles and all pending or failed canonical accounts", () => {
    const canonical = [account({ id: "first", handle: "first", sync_status: "pending", api_synced_at: null }), account({ id: "second", handle: "second", sync_status: "failed", api_synced_at: null })];
    const legacy = [{ platform: "Instagram", handle: "@old", verified: true }];
    const before = JSON.stringify({ canonical, legacy });
    const result = privateSocialTrustSummary(canonical, legacy);
    expect(result.presentations).toEqual([
      expect.objectContaining({ accountId: "first", handle: "first", source: "conflict", legacyHandles: ["@old"], syncStatus: "pending", ownershipVerified: false }),
      expect.objectContaining({ accountId: "second", handle: "second", source: "conflict", legacyHandles: ["@old"], syncStatus: "failed", ownershipVerified: false }),
    ]);
    expect(JSON.stringify({ canonical, legacy })).toBe(before);
  });

  it("deduplicates a matching legacy handle and never leaks verification secrets", () => {
    const result = privateSocialTrustSummary([account({ verification_code: "private-code" })], [{ platform: "Instagram", handle: "@MING", verified: true }]);
    expect(result.presentations).toHaveLength(1);
    expect(result.presentations[0]).toMatchObject({ source: "canonical", handle: "ming", ownershipVerified: false });
    expect(JSON.stringify(result)).not.toContain("private-code");
  });

  it("reports actual verified ownership without a contradictory unverified label", () => {
    const result = privateSocialTrustSummary([account({ owner_verified: true })]);
    expect(result.accounts[0].labels).toContain("Ownership verified");
    expect(result.accounts[0].labels).not.toContain("Ownership not verified");
  });

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
      presentations: [],
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
