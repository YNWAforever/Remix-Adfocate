export type SocialPlatform = "instagram" | "threads";

export type SocialSyncStatus = "pending" | "synced" | "stale" | "failed" | "rate_limited";

export type SocialProviderErrorCode =
  | "provider_not_configured"
  | "not_found"
  | "private_or_unavailable"
  | "rate_limited"
  | "provider_error";

export class SocialProviderError extends Error {
  code: SocialProviderErrorCode;
  status: SocialSyncStatus;

  constructor(code: SocialProviderErrorCode, message: string, status: SocialSyncStatus = "failed") {
    super(message);
    this.name = "SocialProviderError";
    this.code = code;
    this.status = status;
  }
}

export type RecentPostSummary = {
  id: string;
  postedAt: string | null;
  likeCount: number | null;
  commentCount: number | null;
  text: string | null;
};

export type SocialScanResult = {
  platform: SocialPlatform;
  handle: string;
  profileUrl: string;
  followerCount: number | null;
  followingCount: number | null;
  postCount: number | null;
  bio: string | null;
  externalAvatarUrl: string | null;
  engagementRate: number | null;
  avgLikes: number | null;
  avgComments: number | null;
  postingFrequency: number | null;
  freshnessScore: number | null;
  contentThemes: string[];
  recentPostsSummary: RecentPostSummary[];
  summary: Record<string, unknown>;
};

export type SocialAccountRecord = {
  id: string;
  creator_id: string;
  workspace_id: string;
  platform: SocialPlatform;
  handle: string;
  profile_url: string | null;
  owner_verified: boolean;
  api_synced_at: string | null;
  sync_status: SocialSyncStatus;
  follower_count: number | null;
  following_count: number | null;
  post_count: number | null;
  bio: string | null;
  external_avatar_url: string | null;
  engagement_rate: number | null;
  avg_likes: number | null;
  avg_comments: number | null;
  posting_frequency: number | null;
  freshness_score: number | null;
  content_themes: string[];
  summary: Record<string, unknown>;
  last_error_code: string | null;
  last_error_message: string | null;
};
