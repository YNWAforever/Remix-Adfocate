import { normalizeHandle, profileUrlFor } from "./normalize";
import {
  SocialProviderError,
  type RecentPostSummary,
  type SocialPlatform,
  type SocialScanResult,
  type SocialScanSummary,
} from "./types";

type ScanEnv = Partial<Record<string, string | undefined>>;
type ParsedPost = RecentPostSummary & { themeSourceText: string | null };

export type RapidApiScanInput = {
  platform: SocialPlatform;
  handle: string;
  env?: ScanEnv;
  fetchImpl?: typeof fetch;
};

const RAPIDAPI_NETWORK_ERROR_MESSAGE = "RapidAPI request failed";
const RAPIDAPI_INVALID_JSON_ERROR_MESSAGE = "RapidAPI returned invalid JSON";

function numberFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringFrom(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function firstRecord(raw: unknown, keys: string[]): Record<string, unknown> {
  const root = recordFrom(raw);
  for (const key of keys) {
    const value = root[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return root;
}

function postsFrom(profile: Record<string, unknown>): ParsedPost[] {
  const rawPosts = profile.recent_posts ?? profile.posts ?? profile.threads ?? profile.items;
  if (!Array.isArray(rawPosts)) return [];
  return rawPosts.slice(0, 12).map((item, index) => {
    const post = recordFrom(item);
    return {
      id: String(post.id ?? post.pk ?? post.code ?? `post-${index}`),
      postedAt: stringFrom(post.taken_at) ?? stringFrom(post.posted_at) ?? stringFrom(post.timestamp),
      likeCount: numberFrom(post.like_count ?? post.likes),
      commentCount: numberFrom(post.comment_count ?? post.reply_count ?? post.comments ?? post.replies),
      themeSourceText: stringFrom(post.caption) ?? stringFrom(post.text) ?? stringFrom(post.title),
    };
  });
}

function average(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((sum, v) => sum + v, 0) / nums.length) * 100) / 100;
}

function freshnessScore(posts: RecentPostSummary[], now = Date.now()): number | null {
  const latest = posts
    .map((p) => (p.postedAt ? Date.parse(p.postedAt) : NaN))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => b - a)[0];
  if (!latest) return null;
  const days = (now - latest) / 86_400_000;
  if (days <= 7) return 100;
  if (days <= 30) return 70;
  if (days <= 90) return 40;
  return 10;
}

function contentThemes(posts: ParsedPost[]): string[] {
  const counts = new Map<string, number>();
  for (const post of posts) {
    const words = (post.themeSourceText ?? "").toLowerCase().match(/[a-z0-9\u4e00-\u9fff]{3,}/g) ?? [];
    for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);
}

function usableIdentity(profile: Record<string, unknown>): boolean {
  return Boolean(
    stringFrom(profile.username) ??
      stringFrom(profile.full_name) ??
      numberFrom(profile.follower_count ?? profile.followers ?? profile.followerCount) ??
      numberFrom(profile.following_count ?? profile.following ?? profile.followingCount) ??
      numberFrom(profile.media_count ?? profile.posts_count ?? profile.post_count),
  );
}

function looksPrivateOrUnavailable(raw: unknown, profile: Record<string, unknown>): boolean {
  if (usableIdentity(profile)) return false;

  const rawRecord = recordFrom(raw);
  const message = [
    stringFrom(rawRecord.message),
    stringFrom(rawRecord.error),
    stringFrom(rawRecord.detail),
    stringFrom(profile.message),
    stringFrom(profile.error),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  if (/(private|unavailable|not available|login|restricted)/.test(message)) return true;

  return Object.keys(profile).length === 0 || !Array.isArray(profile.recent_posts ?? profile.posts ?? profile.threads ?? profile.items);
}

function providerUrl(platform: SocialPlatform, env: ScanEnv): string {
  if (platform === "instagram") return env.RAPIDAPI_INSTAGRAM_PROFILE_URL ?? "";
  return env.RAPIDAPI_THREADS_PROFILE_URL ?? "";
}

function providerHost(url: string): string {
  return new URL(url).host;
}

function appendHandleParam(url: string, platform: SocialPlatform, handle: string): string {
  const u = new URL(url);
  u.searchParams.set(platform === "instagram" ? "username_or_url" : "username", handle);
  return u.toString();
}

export async function scanRapidApiProfile(input: RapidApiScanInput): Promise<SocialScanResult> {
  const env = input.env ?? process.env;
  const key = env.RAPIDAPI_KEY;
  const baseUrl = providerUrl(input.platform, env);
  if (!key || !baseUrl) {
    throw new SocialProviderError("provider_not_configured", "RapidAPI social scan is not configured", "failed");
  }

  const handle = normalizeHandle(input.platform, input.handle);
  const url = appendHandleParam(baseUrl, input.platform, handle);
  let res: Response;
  try {
    res = await (input.fetchImpl ?? fetch)(url, {
      method: "GET",
      headers: {
        "X-RapidAPI-Key": key,
        "X-RapidAPI-Host": providerHost(baseUrl),
      },
    });
  } catch {
    throw new SocialProviderError("provider_error", RAPIDAPI_NETWORK_ERROR_MESSAGE, "failed");
  }

  if (res.status === 429) throw new SocialProviderError("rate_limited", "RapidAPI rate limit reached", "rate_limited");
  if (res.status === 404) throw new SocialProviderError("not_found", "Social profile not found", "failed");
  if (!res.ok) throw new SocialProviderError("provider_error", `RapidAPI returned ${res.status}`, "failed");

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new SocialProviderError("provider_error", RAPIDAPI_INVALID_JSON_ERROR_MESSAGE, "failed");
  }
  const profile = firstRecord(raw, ["user_data", "data", "user", "profile"]);
  if (looksPrivateOrUnavailable(raw, profile)) {
    throw new SocialProviderError(
      "private_or_unavailable",
      "Social profile is private or unavailable",
      "failed",
    );
  }

  const posts = postsFrom(profile);
  const followerCount = numberFrom(profile.follower_count ?? profile.followers ?? profile.followerCount);
  const avgLikes = average(posts.map((p) => p.likeCount));
  const avgComments = average(posts.map((p) => p.commentCount));
  const bio = stringFrom(profile.biography) ?? stringFrom(profile.bio);
  const externalAvatarUrl =
    stringFrom(profile.profile_pic_url) ??
    stringFrom(profile.profile_pic_url_hd) ??
    stringFrom(recordFrom(profile.hd_profile_pic_url_info).url);
  const summary: SocialScanSummary = {
    postSampleSize: posts.length,
    hasRecentPosts: posts.length > 0,
    hasAvatar: Boolean(externalAvatarUrl),
    hasBio: Boolean(bio),
  };
  const engagementRate =
    followerCount && followerCount > 0 && avgLikes != null
      ? Math.round((((avgLikes + (avgComments ?? 0)) / followerCount) * 100) * 100) / 100
      : null;

  return {
    platform: input.platform,
    handle,
    profileUrl: profileUrlFor(input.platform, handle),
    followerCount,
    followingCount: numberFrom(profile.following_count ?? profile.following ?? profile.followingCount),
    postCount: numberFrom(profile.media_count ?? profile.posts_count ?? profile.post_count),
    bio,
    externalAvatarUrl,
    engagementRate,
    avgLikes,
    avgComments,
    postingFrequency: posts.length,
    freshnessScore: freshnessScore(posts),
    contentThemes: contentThemes(posts),
    recentPostsSummary: posts.map(({ id, postedAt, likeCount, commentCount }) => ({
      id,
      postedAt,
      likeCount,
      commentCount,
    })),
    summary,
  };
}
