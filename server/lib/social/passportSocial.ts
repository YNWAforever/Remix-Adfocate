import type { PassportSocialHandle } from "../passport.js";
import type { SocialAccountRecord } from "./types.js";

export type PrivateSocialTrustAccount = {
  id: string;
  platform: "instagram" | "threads";
  handle: string;
  followerCount: number | null;
  engagementRate: number | null;
  avgLikes: number | null;
  avgComments: number | null;
  freshnessScore: number | null;
  apiSyncedAt: string | null;
  ownerVerified: boolean;
  labels: string[];
};

export type PrivateSocialTrustSummary = {
  accounts: PrivateSocialTrustAccount[];
  badges: string[];
};

const PUBLIC_SOCIAL_TRUST_BADGE_ALLOWLIST = new Set([
  "social_scan_connected",
  "fresh_profile_activity",
  "active_creator",
]);

function isUsableSyncedAccount(account: SocialAccountRecord): boolean {
  return (account.sync_status === "synced" || account.sync_status === "stale") && account.follower_count != null;
}

export function effectiveSocialHandles(input: {
  syncedAccounts: SocialAccountRecord[];
  selfReportedHandles: PassportSocialHandle[] | null | undefined;
}): PassportSocialHandle[] | null {
  const synced = input.syncedAccounts.filter(isUsableSyncedAccount).map((account) => ({ followers: account.follower_count }));
  if (synced.length > 0) return synced;
  return input.selfReportedHandles ?? null;
}

export function privateSocialTrustSummary(accounts: SocialAccountRecord[]): PrivateSocialTrustSummary {
  const synced = accounts.filter((account) => account.sync_status === "synced" || account.sync_status === "stale");
  const badges = new Set<string>();

  if (synced.length > 0) badges.add("social_scan_connected");
  if (synced.some((account) => (account.freshness_score ?? 0) >= 70)) badges.add("fresh_profile_activity");
  if (synced.some((account) => (account.engagement_rate ?? 0) >= 2)) badges.add("active_creator");

  return {
    accounts: synced.map((account) => ({
      id: account.id,
      platform: account.platform,
      handle: account.handle,
      followerCount: account.follower_count,
      engagementRate: account.engagement_rate,
      avgLikes: account.avg_likes,
      avgComments: account.avg_comments,
      freshnessScore: account.freshness_score,
      apiSyncedAt: account.api_synced_at,
      ownerVerified: account.owner_verified,
      labels: ["API-synced", "Ownership not verified"],
    })),
    badges: [...badges],
  };
}

export function publicSocialTrustBadges(accounts: SocialAccountRecord[]): string[] {
  return privateSocialTrustSummary(accounts).badges.filter((badge) => PUBLIC_SOCIAL_TRUST_BADGE_ALLOWLIST.has(badge));
}
