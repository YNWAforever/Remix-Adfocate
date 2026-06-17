import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeHandle, profileUrlFor } from "./normalize";
import type {
  SocialAccountRecord,
  SocialPlatform,
  SocialScanResult,
  SocialSyncStatus,
} from "./types";

export async function listSocialAccounts(
  supabase: SupabaseClient,
  creatorId: string,
): Promise<SocialAccountRecord[]> {
  const { data, error } = await supabase
    .from("creator_social_accounts")
    .select("*")
    .eq("creator_id", creatorId)
    .order("platform");

  if (error) throw error;
  return (data ?? []) as SocialAccountRecord[];
}

export async function addOrUpdateSocialAccount(
  supabase: SupabaseClient,
  input: { creatorId: string; workspaceId: string; platform: SocialPlatform; handle: string },
): Promise<SocialAccountRecord> {
  const handle = normalizeHandle(input.platform, input.handle);
  const { data, error } = await supabase
    .from("creator_social_accounts")
    .upsert(
      {
        creator_id: input.creatorId,
        workspace_id: input.workspaceId,
        platform: input.platform,
        handle,
        profile_url: profileUrlFor(input.platform, handle),
        sync_status: "pending",
      },
      { onConflict: "creator_id,platform,handle_normalized" },
    )
    .select("*")
    .single();

  if (error) throw error;
  return data as SocialAccountRecord;
}

export async function getAccountForCreator(
  supabase: SupabaseClient,
  input: { creatorId: string; accountId: string },
): Promise<SocialAccountRecord | null> {
  const { data, error } = await supabase
    .from("creator_social_accounts")
    .select("*")
    .eq("id", input.accountId)
    .eq("creator_id", input.creatorId)
    .maybeSingle();

  if (error) throw error;
  return (data as SocialAccountRecord | null) ?? null;
}

export async function updateAccountFromScan(
  supabase: SupabaseClient,
  accountId: string,
  result: SocialScanResult,
): Promise<SocialAccountRecord> {
  const timestamp = new Date().toISOString();
  const { data, error } = await supabase
    .from("creator_social_accounts")
    .update({
      handle: result.handle,
      profile_url: result.profileUrl,
      api_synced_at: timestamp,
      sync_status: "synced",
      follower_count: result.followerCount,
      following_count: result.followingCount,
      post_count: result.postCount,
      bio: result.bio,
      external_avatar_url: result.externalAvatarUrl,
      engagement_rate: result.engagementRate,
      avg_likes: result.avgLikes,
      avg_comments: result.avgComments,
      posting_frequency: result.postingFrequency,
      freshness_score: result.freshnessScore,
      content_themes: result.contentThemes,
      summary: result.summary,
      last_error_code: null,
      last_error_message: null,
      updated_at: timestamp,
    })
    .eq("id", accountId)
    .select("*")
    .single();

  if (error) throw error;
  return data as SocialAccountRecord;
}

export async function markAccountScanFailed(
  supabase: SupabaseClient,
  accountId: string,
  input: { status: SocialSyncStatus; errorCode: string; errorMessage: string },
): Promise<SocialAccountRecord> {
  const { data, error } = await supabase
    .from("creator_social_accounts")
    .update({
      sync_status: input.status,
      last_error_code: input.errorCode,
      last_error_message: input.errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId)
    .select("*")
    .single();

  if (error) throw error;
  return data as SocialAccountRecord;
}

export async function insertSnapshot(
  supabase: SupabaseClient,
  accountId: string,
  provider: string,
  status: SocialSyncStatus,
  result: SocialScanResult | { errorCode: string; errorMessage: string },
): Promise<void> {
  const success = "platform" in result;
  const { error } = await supabase.from("creator_social_scan_snapshots").insert({
    account_id: accountId,
    provider,
    status,
    metrics: success
      ? {
          followerCount: result.followerCount,
          followingCount: result.followingCount,
          postCount: result.postCount,
          engagementRate: result.engagementRate,
          avgLikes: result.avgLikes,
          avgComments: result.avgComments,
          postingFrequency: result.postingFrequency,
          freshnessScore: result.freshnessScore,
          contentThemes: result.contentThemes,
        }
      : {},
    recent_posts_summary: success ? result.recentPostsSummary : [],
    error_code: success ? null : result.errorCode,
    error_message: success ? null : result.errorMessage,
  });

  if (error) throw error;
}

export async function listDueSocialAccounts(
  supabase: SupabaseClient,
  limit = 25,
): Promise<SocialAccountRecord[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("creator_social_accounts")
    .select("*")
    .in("sync_status", ["synced", "stale", "rate_limited"])
    .or(`api_synced_at.is.null,api_synced_at.lt.${sevenDaysAgo}`)
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as SocialAccountRecord[];
}
