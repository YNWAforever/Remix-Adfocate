import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreatorProfileMedia, ProfileMediaLink } from "./types.js";
import { PROFILE_MEDIA_BUCKET } from "./types.js";
import {
  ProfileMediaError,
  assertOwnedAvatarPath,
  calculateCompleteness,
  normalizeCaption,
  normalizePortfolioUrl,
  normalizeSortOrder,
  normalizeTitle,
  parsePlatformType,
  publicHighlightsFromLinks,
} from "./service.js";

type LinkRow = {
  id: string;
  creator_id: string;
  workspace_id: string;
  url: string;
  title: string;
  platform_type: ProfileMediaLink["platformType"];
  caption: string | null;
  sort_order: number;
  public_highlight: boolean;
  created_at: string;
  updated_at: string;
};

type CreatorBasics = {
  id: string;
  workspace_id: string;
  display_name: string | null;
  avatar_url: string | null;
  categories: string[] | null;
};

type SnapshotRow = {
  avatar_url: string | null;
  highlights: unknown;
  published_at: string;
};

const LINK_PROJECTION =
  "id, creator_id, workspace_id, url, title, platform_type, caption, sort_order, public_highlight, created_at, updated_at";

function failDb(error: { message?: string | null } | null): never {
  throw new ProfileMediaError("db_error", error?.message ?? "db_error");
}

export function projectLink(row: LinkRow): ProfileMediaLink {
  return {
    id: row.id,
    creatorId: row.creator_id,
    workspaceId: row.workspace_id,
    url: row.url,
    title: row.title,
    platformType: row.platform_type,
    caption: row.caption,
    sortOrder: row.sort_order,
    publicHighlight: row.public_highlight,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getCreatorBasics(
  supabase: SupabaseClient,
  creatorId: string,
  workspaceId?: string,
): Promise<CreatorBasics> {
  let query = supabase
    .from("creators")
    .select("id, workspace_id, display_name, avatar_url, categories")
    .eq("id", creatorId);
  if (workspaceId) query = query.eq("workspace_id", workspaceId);
  const { data, error } = await query.single();
  if (error) failDb(error);
  return data as CreatorBasics;
}

export async function listProfileMediaLinks(supabase: SupabaseClient, creatorId: string): Promise<ProfileMediaLink[]> {
  const { data, error } = await supabase
    .from("creator_portfolio_links")
    .select(LINK_PROJECTION)
    .eq("creator_id", creatorId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) failDb(error);
  return ((data ?? []) as LinkRow[]).map(projectLink);
}

export async function getProfileMedia(supabase: SupabaseClient, creatorId: string): Promise<CreatorProfileMedia> {
  return getProfileMediaWithScope(supabase, creatorId);
}

export async function getProfileMediaForWorkspace(
  supabase: SupabaseClient,
  creatorId: string,
  workspaceId: string,
): Promise<CreatorProfileMedia> {
  if (!workspaceId.trim()) throw new ProfileMediaError("db_error", "workspaceId is required");
  return getProfileMediaWithScope(supabase, creatorId, workspaceId);
}

async function getProfileMediaWithScope(
  supabase: SupabaseClient,
  creatorId: string,
  workspaceId?: string,
): Promise<CreatorProfileMedia> {
  let linksQuery = supabase
      .from("creator_portfolio_links")
      .select(LINK_PROJECTION)
      .eq("creator_id", creatorId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
  let snapshotQuery = supabase
      .from("creator_public_profile_snapshots")
      .select("avatar_url, highlights, published_at")
      .eq("creator_id", creatorId);
  let socialQuery = supabase
      .from("creator_social_accounts")
      .select("id")
      .eq("creator_id", creatorId)
      .eq("sync_status", "synced")
      .limit(1);
  if (workspaceId) {
    linksQuery = linksQuery.eq("workspace_id", workspaceId);
    snapshotQuery = snapshotQuery.eq("workspace_id", workspaceId);
    socialQuery = socialQuery.eq("workspace_id", workspaceId);
  }

  const [creator, linksRes, snapshotRes, socialRes] = await Promise.all([
    getCreatorBasics(supabase, creatorId, workspaceId),
    linksQuery,
    snapshotQuery.maybeSingle(),
    socialQuery,
  ]);
  if (linksRes.error) failDb(linksRes.error);
  if (snapshotRes.error) failDb(snapshotRes.error);
  if (socialRes.error) failDb(socialRes.error);

  const portfolioLinks = ((linksRes.data ?? []) as LinkRow[]).map(projectLink);
  const publicHighlights = publicHighlightsFromLinks(portfolioLinks);
  const snapshot = snapshotRes.data as SnapshotRow | null;

  return {
    avatarUrl: creator.avatar_url ?? null,
    portfolioLinks,
    publicHighlights,
    published: {
      avatarUrl: snapshot?.avatar_url ?? null,
      highlights: Array.isArray(snapshot?.highlights)
        ? (snapshot.highlights as CreatorProfileMedia["published"]["highlights"])
        : [],
      publishedAt: snapshot?.published_at ?? null,
    },
    completeness: calculateCompleteness({
      avatarUrl: creator.avatar_url ?? null,
      displayName: creator.display_name ?? null,
      bio: null,
      categories: creator.categories ?? [],
      portfolioLinks,
      hasSocialScan: (socialRes.data ?? []).length > 0,
    }),
  };
}

export async function createProfileMediaLink(
  supabase: SupabaseClient,
  input: {
    creatorId: string;
    workspaceId: string;
    url: unknown;
    title: unknown;
    platformType: unknown;
    caption?: unknown;
    sortOrder?: unknown;
    publicHighlight?: unknown;
  },
) {
  const platformType = parsePlatformType(input.platformType);
  if (!platformType) throw new ProfileMediaError("bad_platform_type", "Unsupported portfolio type");

  const { data, error } = await supabase
    .from("creator_portfolio_links")
    .insert({
      creator_id: input.creatorId,
      workspace_id: input.workspaceId,
      url: normalizePortfolioUrl(String(input.url ?? "")),
      title: normalizeTitle(input.title),
      platform_type: platformType,
      caption: normalizeCaption(input.caption),
      sort_order: normalizeSortOrder(input.sortOrder),
      public_highlight: input.publicHighlight === true,
    })
    .select(LINK_PROJECTION)
    .single();

  if (error?.message?.includes("highlight limit")) throw new ProfileMediaError("highlight_limit", error.message);
  if (error) failDb(error);
  return projectLink(data as LinkRow);
}

export async function updateProfileMediaLink(
  supabase: SupabaseClient,
  input: { creatorId: string; linkId: string; patch: Record<string, unknown> },
) {
  const patch: Record<string, unknown> = {};
  if ("url" in input.patch) patch.url = normalizePortfolioUrl(String(input.patch.url ?? ""));
  if ("title" in input.patch) patch.title = normalizeTitle(input.patch.title);
  if ("platform_type" in input.patch) {
    const platformType = parsePlatformType(input.patch.platform_type);
    if (!platformType) throw new ProfileMediaError("bad_platform_type", "Unsupported portfolio type");
    patch.platform_type = platformType;
  }
  if ("caption" in input.patch) patch.caption = normalizeCaption(input.patch.caption);
  if ("sort_order" in input.patch) patch.sort_order = normalizeSortOrder(input.patch.sort_order);
  if ("public_highlight" in input.patch) patch.public_highlight = input.patch.public_highlight === true;

  const { data, error } = await supabase
    .from("creator_portfolio_links")
    .update(patch)
    .eq("id", input.linkId)
    .eq("creator_id", input.creatorId)
    .select(LINK_PROJECTION)
    .maybeSingle();

  if (error?.message?.includes("highlight limit")) throw new ProfileMediaError("highlight_limit", error.message);
  if (error) failDb(error);
  if (!data) throw new ProfileMediaError("not_found", "Portfolio link not found");
  return projectLink(data as LinkRow);
}

export async function deleteProfileMediaLink(supabase: SupabaseClient, creatorId: string, linkId: string) {
  const { data, error } = await supabase
    .from("creator_portfolio_links")
    .delete()
    .eq("id", linkId)
    .eq("creator_id", creatorId)
    .select("id")
    .maybeSingle();
  if (error) failDb(error);
  if (!data) throw new ProfileMediaError("not_found", "Portfolio link not found");
}

export async function selectUploadedAvatar(
  supabase: SupabaseClient,
  input: { creatorId: string; storagePath: unknown },
) {
  const storagePath = assertOwnedAvatarPath(input.creatorId, input.storagePath);
  const fileName = storagePath.slice(`${input.creatorId}/`.length);
  const { data: objects, error: listError } = await supabase.storage
    .from(PROFILE_MEDIA_BUCKET)
    .list(input.creatorId, { limit: 1, search: fileName });
  if (listError) failDb(listError);
  if (!objects?.some((object) => object.name === fileName)) {
    throw new ProfileMediaError("not_found", "Avatar upload not found");
  }

  const { data } = supabase.storage.from(PROFILE_MEDIA_BUCKET).getPublicUrl(storagePath);
  const avatarUrl = data.publicUrl;

  const { error } = await supabase.from("creators").update({ avatar_url: avatarUrl }).eq("id", input.creatorId);
  if (error) failDb(error);

  return avatarUrl;
}

export async function publishProfileMedia(supabase: SupabaseClient, creatorId: string) {
  const creator = await getCreatorBasics(supabase, creatorId);
  const links = await listProfileMediaLinks(supabase, creatorId);
  const highlights = publicHighlightsFromLinks(links);

  const { data, error } = await supabase
    .from("creator_public_profile_snapshots")
    .upsert(
      {
        creator_id: creator.id,
        workspace_id: creator.workspace_id,
        avatar_url: creator.avatar_url,
        highlights,
        published_by: creator.id,
        published_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,creator_id" },
    )
    .select("avatar_url, highlights, published_at")
    .single();
  if (error) failDb(error);

  return {
    avatarUrl: data.avatar_url ?? null,
    highlights: Array.isArray(data.highlights) ? data.highlights : [],
    publishedAt: data.published_at,
  };
}
