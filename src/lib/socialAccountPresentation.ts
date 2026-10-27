/** A private, read-only view. Legacy claims never establish ownership or a sync. */
export type SocialAccountPresentation = {
  platform: string;
  handle: string;
  source: "legacy" | "canonical" | "conflict";
  syncStatus: "not_connected" | "pending" | "synced" | "stale" | "failed" | "rate_limited";
  ownershipVerified: boolean;
  lastSyncedAt: string | null;
  accountId: string | null;
  legacyHandles: string[];
};

export type LegacySocialHandle = { platform: string; handle: string; followers?: number | null; verified?: boolean };
type CanonicalAccount = { id: string; platform: string; handle: string; sync_status: Exclude<SocialAccountPresentation["syncStatus"], "not_connected">; owner_verified: boolean; api_synced_at?: string | null };
const identity = (handle: string) => handle.trim().replace(/^@/, "").toLowerCase();
export const socialPlatformName = (platform: string): string => ({ instagram: "Instagram", threads: "Threads", youtube: "YouTube", tiktok: "TikTok" } as Record<string, string>)[platform] ?? platform;

export function projectSocialAccounts(accounts: readonly CanonicalAccount[], legacy: readonly LegacySocialHandle[] = []): SocialAccountPresentation[] {
  const reported = (Array.isArray(legacy) ? legacy : []).filter((item): item is LegacySocialHandle => item != null && typeof item.platform === "string" && typeof item.handle === "string");
  const presentations: SocialAccountPresentation[] = accounts.map((account) => {
    const platform = account.platform.toLowerCase();
    const legacyHandles = [...new Set(reported.filter((item) => item.platform.toLowerCase() === platform && item.handle.trim()
      && !accounts.some((candidate) => candidate.platform.toLowerCase() === platform && identity(candidate.handle) === identity(item.handle)))
      .map((item) => item.handle))];
    return { platform, handle: account.handle, source: legacyHandles.length ? "conflict" : "canonical", syncStatus: account.sync_status,
      ownershipVerified: account.owner_verified === true, lastSyncedAt: account.api_synced_at ?? null, accountId: account.id, legacyHandles };
  });
  for (const item of reported) {
    const platform = item.platform.toLowerCase();
    if (!item.handle.trim() || accounts.some((account) => account.platform.toLowerCase() === platform)) continue;
    if (presentations.some((row) => row.platform === platform && identity(row.handle) === identity(item.handle))) continue;
    presentations.push({ platform, handle: item.handle, source: "legacy", syncStatus: "not_connected", ownershipVerified: false,
      lastSyncedAt: null, accountId: null, legacyHandles: [] });
  }
  return presentations;
}
