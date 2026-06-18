import type { SupabaseClient } from "@supabase/supabase-js";
import { getProfileMedia } from "../profileMedia/repo.js";
import { lastActivityAt, nonEmptyText, projectReviewStatus, summarizeSocialAccounts } from "./serializers.js";
import type {
  CreatorQueueFilters,
  CreatorReviewNoteCategory,
  CreatorReviewRow,
  CreatorReviewStatus,
  CreatorRiskLevel,
  MissionShortlistSource,
  MissionShortlistStatus,
  OperatorContext,
  ReviewProjection,
} from "./types.js";

const CREATOR_PROJECTION = "id, workspace_id, display_name, avatar_url, level, categories, scores, social_handles, created_at";
const REVIEW_PROJECTION = "creator_id, workspace_id, status, risk_level, summary, reviewed_by, last_reviewed_at, updated_at";
const SOCIAL_PROJECTION =
  "creator_id, platform, handle, sync_status, follower_count, engagement_rate, api_synced_at, external_avatar_url, bio, post_count, following_count, avg_likes, avg_comments, posting_frequency, freshness_score, content_themes";
const SHORTLIST_PROJECTION =
  "mission_id, creator_id, workspace_id, status, source, notes, created_by, updated_by, created_at, updated_at, missions(id, slug, title)";
const NOTE_PROJECTION = "id, creator_id, workspace_id, operator_id, category, body, created_at";
const AUDIT_PROJECTION =
  "id, workspace_id, operator_id, actor_label, event_type, target_type, target_id, creator_id, mission_id, metadata, created_at";

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export class OperatorCrmError extends Error {
  constructor(
    public code:
      | "creator_not_found"
      | "mission_not_found"
      | "shortlist_not_found"
      | "workspace_mismatch"
      | "flagged_note_required"
      | "flagged_invite_blocked"
      | "db_error",
    message: string = code,
  ) {
    super(message);
  }
}

type CreatorRow = {
  id: string;
  workspace_id: string;
  display_name: string | null;
  avatar_url: string | null;
  level: string | null;
  categories: string[] | null;
  scores: Record<string, number | null> | null;
  social_handles: unknown;
  created_at: string;
};

type ReviewRow = {
  creator_id: string;
  workspace_id: string;
  status: string;
  risk_level: string;
  summary: string | null;
  reviewed_by: string | null;
  last_reviewed_at: string | null;
  updated_at: string | null;
};

type SocialRow = {
  creator_id: string;
  platform: string;
  handle: string;
  sync_status: string;
  follower_count: number | null;
  engagement_rate: number | null;
  api_synced_at: string | null;
  external_avatar_url: string | null;
  bio: string | null;
  post_count: number | null;
  following_count: number | null;
  avg_likes: number | null;
  avg_comments: number | null;
  posting_frequency: number | null;
  freshness_score: number | null;
  content_themes: unknown;
};

type ShortlistRow = {
  mission_id: string;
  creator_id: string;
  workspace_id: string;
  status: MissionShortlistStatus;
  source: MissionShortlistSource;
  notes: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  missions?: { id: string; slug: string; title: string } | Array<{ id: string; slug: string; title: string }> | null;
};

type NoteRow = {
  id: string;
  creator_id: string;
  workspace_id: string;
  operator_id: string;
  category: CreatorReviewNoteCategory;
  body: string;
  created_at: string;
};

type AuditRow = {
  id: string;
  workspace_id: string;
  operator_id: string;
  actor_label: string;
  event_type: string;
  target_type: string;
  target_id: string;
  creator_id: string | null;
  mission_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

type MissionRow = {
  id: string;
  workspace_id: string;
  slug: string;
  title: string;
  category?: string | null;
};

function failDb(error: { message?: string | null } | null): never {
  throw new OperatorCrmError("db_error", error?.message ?? "db_error");
}

async function mustGetCreator(supabase: SupabaseClient, creatorId: string): Promise<CreatorRow> {
  const { data, error } = await supabase.from("creators").select(CREATOR_PROJECTION).eq("id", creatorId).maybeSingle();
  if (error) failDb(error);
  if (!data) throw new OperatorCrmError("creator_not_found");
  return data as CreatorRow;
}

async function mustGetMission(supabase: SupabaseClient, missionId: string): Promise<MissionRow> {
  const { data, error } = await supabase.from("missions").select("id, workspace_id, slug, title, category").eq("id", missionId).maybeSingle();
  if (error) failDb(error);
  if (!data) throw new OperatorCrmError("mission_not_found");
  return data as MissionRow;
}

async function getReviewMap(supabase: SupabaseClient, creatorIds: string[]) {
  if (creatorIds.length === 0) return new Map<string, ReviewRow>();
  const { data, error } = await supabase.from("creator_review_statuses").select(REVIEW_PROJECTION).in("creator_id", creatorIds);
  if (error) failDb(error);
  return new Map((data ?? []).map((row) => [(row as ReviewRow).creator_id, row as ReviewRow]));
}

async function getSocialMap(supabase: SupabaseClient, creatorIds: string[]) {
  if (creatorIds.length === 0) return new Map<string, SocialRow[]>();
  const { data, error } = await supabase.from("creator_social_accounts").select(SOCIAL_PROJECTION).in("creator_id", creatorIds);
  if (error) failDb(error);
  const map = new Map<string, SocialRow[]>();
  for (const row of (data ?? []) as SocialRow[]) {
    const bucket = map.get(row.creator_id) ?? [];
    bucket.push(row);
    map.set(row.creator_id, bucket);
  }
  return map;
}

async function getShortlistMap(supabase: SupabaseClient, creatorIds: string[], missionId?: string) {
  if (creatorIds.length === 0) return new Map<string, ShortlistRow[]>();
  let query = supabase.from("mission_shortlists").select(SHORTLIST_PROJECTION).in("creator_id", creatorIds);
  if (missionId) query = query.eq("mission_id", missionId);
  const { data, error } = await query.order("updated_at", { ascending: false });
  if (error) failDb(error);
  const map = new Map<string, ShortlistRow[]>();
  for (const row of (data ?? []) as ShortlistRow[]) {
    const bucket = map.get(row.creator_id) ?? [];
    bucket.push(row);
    map.set(row.creator_id, bucket);
  }
  return map;
}

type ProfileMediaSummaryRow = {
  creator_id: string;
  public_highlight: boolean;
};

type SyncedSocialSummaryRow = {
  creator_id: string;
};

function calculateProfileMediaCompletenessScore(input: {
  avatarUrl: string | null;
  displayName: string | null;
  categories: string[];
  portfolioCount: number;
  publicHighlightCount: number;
  hasSocialScan: boolean;
}) {
  const completed = [
    Boolean(input.avatarUrl),
    Boolean(input.displayName?.trim()),
    false,
    input.categories.length > 0,
    input.portfolioCount > 0,
    input.publicHighlightCount > 0,
    input.hasSocialScan,
  ].filter(Boolean).length;
  return Math.round((completed / 7) * 100);
}

function buildProfileMediaSummary(creator: CreatorRow, rows: ProfileMediaSummaryRow[], hasSocialScan: boolean) {
  const portfolioCount = rows.length;
  const publicHighlightCount = rows.filter((row) => row.public_highlight).length;
  const completenessScore = calculateProfileMediaCompletenessScore({
    avatarUrl: creator.avatar_url ?? null,
    displayName: creator.display_name ?? null,
    categories: creator.categories ?? [],
    portfolioCount,
    publicHighlightCount,
    hasSocialScan,
  });

  return {
    avatarUrl: creator.avatar_url ?? null,
    portfolioCount,
    publicHighlightCount,
    completenessScore,
  } satisfies CreatorReviewRow["profileMedia"];
}

async function getProfileMediaSummaryMap(supabase: SupabaseClient, creators: CreatorRow[]) {
  const map = new Map<string, CreatorReviewRow["profileMedia"]>();
  const creatorIds = creators.map((creator) => creator.id);
  if (creatorIds.length === 0) return map;

  const [portfolioRes, socialRes] = await Promise.all([
    supabase.from("creator_portfolio_links").select("creator_id, public_highlight").in("creator_id", creatorIds),
    supabase.from("creator_social_accounts").select("creator_id").in("creator_id", creatorIds).eq("sync_status", "synced"),
  ]);
  if (portfolioRes.error) failDb(portfolioRes.error);
  if (socialRes.error) failDb(socialRes.error);

  const portfolioByCreator = new Map<string, ProfileMediaSummaryRow[]>();
  for (const row of (portfolioRes.data ?? []) as ProfileMediaSummaryRow[]) {
    const bucket = portfolioByCreator.get(row.creator_id) ?? [];
    bucket.push(row);
    portfolioByCreator.set(row.creator_id, bucket);
  }

  const socialByCreator = new Set(((socialRes.data ?? []) as SyncedSocialSummaryRow[]).map((row) => row.creator_id));
  for (const creator of creators) {
    map.set(creator.id, buildProfileMediaSummary(creator, portfolioByCreator.get(creator.id) ?? [], socialByCreator.has(creator.id)));
  }
  return map;
}

export async function enrichAdminMissionRows<
  T extends { creator_id: string; mission_id: string },
>(
  supabase: SupabaseClient,
  rows: T[],
): Promise<
  Array<
    T & {
      creator_review: { status: string; risk_level: string };
      mission_shortlist: { status: string } | null;
    }
  >
> {
  if (rows.length === 0) return [];

  const creatorIds = [...new Set(rows.map((row) => row.creator_id))];
  const missionIds = [...new Set(rows.map((row) => row.mission_id))];

  const { data: reviews, error: reviewError } = await supabase
    .from("creator_review_statuses")
    .select("creator_id, status, risk_level")
    .in("creator_id", creatorIds);
  if (reviewError) throw new OperatorCrmError("db_error", reviewError.message);

  const { data: shortlists, error: shortlistError } = await supabase
    .from("mission_shortlists")
    .select("creator_id, mission_id, status")
    .in("creator_id", creatorIds)
    .in("mission_id", missionIds);
  if (shortlistError) throw new OperatorCrmError("db_error", shortlistError.message);

  const reviewByCreator = new Map((reviews ?? []).map((row) => [row.creator_id as string, row]));
  const shortlistByPair = new Map((shortlists ?? []).map((row) => [`${row.mission_id}:${row.creator_id}`, row]));

  return rows.map((row) => {
    const review = reviewByCreator.get(row.creator_id);
    const shortlist = shortlistByPair.get(`${row.mission_id}:${row.creator_id}`);

    return {
      ...row,
      creator_review: {
        status: (review?.status as string | undefined) ?? "needs_review",
        risk_level: (review?.risk_level as string | undefined) ?? "unknown",
      },
      mission_shortlist: shortlist ? { status: shortlist.status as string } : null,
    };
  });
}

function levelRank(level: string | null | undefined) {
  const raw = typeof level === "string" ? level : "";
  const numeric = Number(raw.replace(/^L/i, ""));
  return Number.isFinite(numeric) ? numeric : -1;
}

function trustScore(scores: Record<string, number | null> | null | undefined) {
  if (!scores) return -1;
  const values = Object.values(scores).filter((value): value is number => typeof value === "number");
  if (values.length === 0) return -1;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function compareNullableDesc(left: string | number | null, right: string | number | null) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (left > right) return -1;
  if (left < right) return 1;
  return 0;
}

function compareMissionQueuePriority(left: CreatorReviewRow, right: CreatorReviewRow) {
  const rank = (status: CreatorReviewStatus) => (status === "approved" ? 0 : 1);
  return rank(left.review.status) - rank(right.review.status);
}

function reviewMatchesFilter(review: ReviewProjection, filters: CreatorQueueFilters) {
  if (filters.status && review.status !== filters.status) return false;
  if (filters.riskLevel && review.riskLevel !== filters.riskLevel) return false;
  return true;
}

function assertMatchingWorkspace(mission: MissionRow, creator: CreatorRow) {
  if (mission.workspace_id !== creator.workspace_id) {
    throw new OperatorCrmError("workspace_mismatch");
  }
}

function normalizeShortlistRow(row: ShortlistRow) {
  const mission = Array.isArray(row.missions) ? row.missions[0] ?? null : row.missions ?? null;
  return {
    mission_id: row.mission_id,
    creator_id: row.creator_id,
    workspace_id: row.workspace_id,
    status: row.status,
    source: row.source,
    notes: row.notes,
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    mission,
  };
}

async function insertAuditEvent(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    context: OperatorContext;
    eventType: string;
    targetType: string;
    targetId: string;
    creatorId?: string | null;
    missionId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const { error } = await supabase.from("operator_audit_events").insert({
    workspace_id: input.workspaceId,
    operator_id: input.context.operatorId,
    actor_label: input.context.actorLabel,
    event_type: input.eventType,
    target_type: input.targetType,
    target_id: input.targetId,
    creator_id: input.creatorId ?? null,
    mission_id: input.missionId ?? null,
    metadata: input.metadata ?? {},
  });
  if (error) failDb(error);
}

export async function listCreatorReviewQueue(
  supabase: SupabaseClient,
  filters: CreatorQueueFilters,
): Promise<{ creators: CreatorReviewRow[]; page: number; pageSize: number; total: number }> {
  if (filters.missionId) await mustGetMission(supabase, filters.missionId);

  let creatorQuery = supabase.from("creators").select(CREATOR_PROJECTION);
  if (filters.q) creatorQuery = creatorQuery.ilike("display_name", `%${filters.q}%`);
  const { data: creatorsData, error: creatorsError } = await creatorQuery;
  if (creatorsError) failDb(creatorsError);

  const creators = (creatorsData ?? []) as CreatorRow[];
  const creatorIds = creators.map((creator) => creator.id);
  const [reviews, socials, shortlists, profileMedia] = await Promise.all([
    getReviewMap(supabase, creatorIds),
    getSocialMap(supabase, creatorIds),
    getShortlistMap(supabase, creatorIds, filters.missionId),
    getProfileMediaSummaryMap(supabase, creators),
  ]);

  const rows = creators
    .map((creator) => {
      const review = projectReviewStatus(reviews.get(creator.id) ?? null);
      const socialAccounts = socials.get(creator.id) ?? [];
      const social = summarizeSocialAccounts(socialAccounts);
      const shortlistRows = shortlists.get(creator.id) ?? [];
      const shortlist = shortlistRows[0] ? normalizeShortlistRow(shortlistRows[0]) : null;
      const activityAt = lastActivityAt([
        review.updatedAt,
        shortlist?.updated_at,
        social.apiSyncedAt,
        creator.created_at,
      ]);

      return {
        id: creator.id,
        displayName: creator.display_name ?? creator.id,
        avatarUrl: creator.avatar_url ?? null,
        level: creator.level ?? "L0",
        categories: creator.categories ?? [],
        scores: creator.scores ?? {},
        social,
        profileMedia: profileMedia.get(creator.id) ?? {
          avatarUrl: creator.avatar_url ?? null,
          portfolioCount: 0,
          publicHighlightCount: 0,
          completenessScore: 0,
        },
        review,
        shortlist: shortlist
          ? {
              status: shortlist.status,
              source: shortlist.source,
              notes: shortlist.notes,
              updatedAt: shortlist.updated_at,
            }
          : null,
        lastActivityAt: activityAt,
      } satisfies CreatorReviewRow;
    })
    .filter((row) => reviewMatchesFilter(row.review, filters))
    .filter((row) => !(filters.missionId && !filters.status && row.review.status === "flagged"));

  rows.sort((left, right) => {
    if (filters.missionId) {
      const priority = compareMissionQueuePriority(left, right);
      if (priority !== 0) return priority;
    }

    switch (filters.sort) {
      case "trust_score":
        return compareNullableDesc(trustScore(left.scores), trustScore(right.scores));
      case "level":
        return compareNullableDesc(levelRank(left.level), levelRank(right.level));
      case "social_freshness":
        return compareNullableDesc(left.social.apiSyncedAt, right.social.apiSyncedAt);
      case "last_activity":
      default:
        return compareNullableDesc(left.lastActivityAt, right.lastActivityAt);
    }
  });

  const total = rows.length;
  const page = Math.max(filters.page || 1, 1);
  const pageSize = Math.min(Math.max(filters.pageSize || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const start = (page - 1) * pageSize;

  return {
    creators: rows.slice(start, start + pageSize),
    page,
    pageSize,
    total,
  };
}

export async function getCreatorOperatorDetail(supabase: SupabaseClient, creatorId: string) {
  const creator = await mustGetCreator(supabase, creatorId);
  const [reviewRes, notesRes, socialRes, shortlistRes, auditRes, missionHistoryRes, profileMedia] = await Promise.all([
    supabase.from("creator_review_statuses").select(REVIEW_PROJECTION).eq("creator_id", creatorId).maybeSingle(),
    supabase.from("creator_review_notes").select(NOTE_PROJECTION).eq("creator_id", creatorId).order("created_at", { ascending: false }),
    supabase.from("creator_social_accounts").select(SOCIAL_PROJECTION).eq("creator_id", creatorId).order("api_synced_at", { ascending: false }),
    supabase.from("mission_shortlists").select(SHORTLIST_PROJECTION).eq("creator_id", creatorId).order("updated_at", { ascending: false }),
    supabase.from("operator_audit_events").select(AUDIT_PROJECTION).eq("creator_id", creatorId).order("created_at", { ascending: false }),
    supabase
      .from("mission_submissions")
      .select("id, mission_id, status, content_urls, reviewer_notes, submitted_at, reviewed_at, created_at, missions(id, slug, title)")
      .eq("creator_id", creatorId)
      .order("created_at", { ascending: false }),
    getProfileMedia(supabase, creatorId),
  ]);

  if (reviewRes.error) failDb(reviewRes.error);
  if (notesRes.error) failDb(notesRes.error);
  if (socialRes.error) failDb(socialRes.error);
  if (shortlistRes.error) failDb(shortlistRes.error);
  if (auditRes.error) failDb(auditRes.error);
  if (missionHistoryRes.error) failDb(missionHistoryRes.error);

  const socialAccounts = (socialRes.data ?? []) as SocialRow[];

  return {
    creator: {
      id: creator.id,
      workspace_id: creator.workspace_id,
      display_name: creator.display_name,
      avatar_url: creator.avatar_url ?? socialAccounts[0]?.external_avatar_url ?? null,
      level: creator.level ?? "L0",
      categories: creator.categories ?? [],
      scores: creator.scores ?? {},
      social_handles: creator.social_handles,
      created_at: creator.created_at,
    },
    social: summarizeSocialAccounts(socialAccounts),
    socialAccounts,
    profileMedia,
    review: projectReviewStatus((reviewRes.data as ReviewRow | null) ?? null),
    notes: (notesRes.data ?? []) as NoteRow[],
    shortlists: ((shortlistRes.data ?? []) as ShortlistRow[]).map(normalizeShortlistRow),
    audit: (auditRes.data ?? []) as AuditRow[],
    missionHistory: (missionHistoryRes.data ?? []) as Array<Record<string, unknown>>,
  };
}

export async function updateCreatorReview(
  supabase: SupabaseClient,
  input: {
    creatorId: string;
    status: CreatorReviewStatus;
    riskLevel: CreatorRiskLevel;
    summary: string | null;
    note: string | null;
    context: OperatorContext;
  },
) {
  const creator = await mustGetCreator(supabase, input.creatorId);
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("creator_review_statuses")
    .upsert(
      {
        creator_id: input.creatorId,
        workspace_id: creator.workspace_id,
        status: input.status,
        risk_level: input.riskLevel,
        summary: input.summary,
        reviewed_by: input.context.operatorId,
        last_reviewed_at: now,
      },
      { onConflict: "workspace_id,creator_id" },
    )
    .select(REVIEW_PROJECTION)
    .single();
  if (error) failDb(error);

  await insertAuditEvent(supabase, {
    workspaceId: creator.workspace_id,
    context: input.context,
    eventType: "creator_review.updated",
    targetType: "creator",
    targetId: input.creatorId,
    creatorId: input.creatorId,
    metadata: { status: input.status, risk_level: input.riskLevel, summary: input.summary },
  });

  if (input.note) {
    const { error: noteError } = await supabase.from("creator_review_notes").insert({
      creator_id: input.creatorId,
      workspace_id: creator.workspace_id,
      operator_id: input.context.operatorId,
      category: "other",
      body: input.note,
    });
    if (noteError) failDb(noteError);

    await insertAuditEvent(supabase, {
      workspaceId: creator.workspace_id,
      context: input.context,
      eventType: "creator_note.created",
      targetType: "creator",
      targetId: input.creatorId,
      creatorId: input.creatorId,
      metadata: { category: "other" },
    });
  }

  return projectReviewStatus(data as ReviewRow);
}

export async function addCreatorReviewNote(
  supabase: SupabaseClient,
  input: {
    creatorId: string;
    category: CreatorReviewNoteCategory;
    body: string;
    context: OperatorContext;
  },
) {
  const creator = await mustGetCreator(supabase, input.creatorId);
  const { data, error } = await supabase
    .from("creator_review_notes")
    .insert({
      creator_id: input.creatorId,
      workspace_id: creator.workspace_id,
      operator_id: input.context.operatorId,
      category: input.category,
      body: input.body,
    })
    .select(NOTE_PROJECTION)
    .single();
  if (error) failDb(error);

  await insertAuditEvent(supabase, {
    workspaceId: creator.workspace_id,
    context: input.context,
    eventType: "creator_note.created",
    targetType: "creator",
    targetId: input.creatorId,
    creatorId: input.creatorId,
    metadata: { category: input.category },
  });

  return data as NoteRow;
}

export async function listMissionShortlist(supabase: SupabaseClient, missionId: string) {
  const mission = await mustGetMission(supabase, missionId);
  const { data, error } = await supabase
    .from("mission_shortlists")
    .select("mission_id, creator_id, workspace_id, status, source, notes, created_by, updated_by, created_at, updated_at, creators(id, display_name, avatar_url, level)")
    .eq("mission_id", missionId)
    .order("updated_at", { ascending: false });
  if (error) failDb(error);

  return {
    mission,
    shortlists: data ?? [],
  };
}

export async function upsertMissionShortlist(
  supabase: SupabaseClient,
  input: {
    missionId: string;
    creatorId: string;
    source: MissionShortlistSource;
    notes: string | null;
    context: OperatorContext;
  },
) {
  const [mission, creator] = await Promise.all([
    mustGetMission(supabase, input.missionId),
    mustGetCreator(supabase, input.creatorId),
  ]);
  assertMatchingWorkspace(mission, creator);
  const { data: review, error: reviewError } = await supabase
    .from("creator_review_statuses")
    .select(REVIEW_PROJECTION)
    .eq("creator_id", input.creatorId)
    .maybeSingle();
  if (reviewError) failDb(reviewError);
  const projectedReview = projectReviewStatus((review as ReviewRow | null) ?? null);
  if (projectedReview.status === "flagged" && !nonEmptyText(input.notes)) {
    throw new OperatorCrmError("flagged_note_required");
  }

  const insertAttempt = await supabase
    .from("mission_shortlists")
    .insert({
      mission_id: input.missionId,
      creator_id: input.creatorId,
      workspace_id: mission.workspace_id,
      status: "shortlisted",
      source: input.source,
      notes: input.notes,
      created_by: input.context.operatorId,
      updated_by: input.context.operatorId,
    })
    .select(SHORTLIST_PROJECTION)
    .single();

  let data = insertAttempt.data as ShortlistRow | null;
  let eventType: "mission_shortlist.created" | "mission_shortlist.updated" = "mission_shortlist.created";

  if (insertAttempt.error) {
    if (insertAttempt.error.code !== "23505") failDb(insertAttempt.error);

    const updateAttempt = await supabase
      .from("mission_shortlists")
      .update({
        status: "shortlisted",
        source: input.source,
        notes: input.notes,
        updated_by: input.context.operatorId,
      })
      .eq("mission_id", input.missionId)
      .eq("creator_id", input.creatorId)
      .select(SHORTLIST_PROJECTION)
      .single();
    if (updateAttempt.error) failDb(updateAttempt.error);
    data = updateAttempt.data as ShortlistRow;
    eventType = "mission_shortlist.updated";
  }

  await insertAuditEvent(supabase, {
    workspaceId: mission.workspace_id,
    context: input.context,
    eventType,
    targetType: "mission_shortlist",
    targetId: `${input.missionId}:${input.creatorId}`,
    creatorId: creator.id,
    missionId: mission.id,
    metadata: { status: "shortlisted", source: input.source },
  });

  return normalizeShortlistRow(data as ShortlistRow);
}

export async function updateMissionShortlistStatus(
  supabase: SupabaseClient,
  input: {
    missionId: string;
    creatorId: string;
    status: MissionShortlistStatus;
    notes?: string | null;
    context: OperatorContext;
  },
) {
  const { data: shortlist, error: shortlistError } = await supabase
    .from("mission_shortlists")
    .select(SHORTLIST_PROJECTION)
    .eq("mission_id", input.missionId)
    .eq("creator_id", input.creatorId)
    .maybeSingle();
  if (shortlistError) failDb(shortlistError);
  if (!shortlist) throw new OperatorCrmError("shortlist_not_found");

  const { data: review, error: reviewError } = await supabase
    .from("creator_review_statuses")
    .select(REVIEW_PROJECTION)
    .eq("creator_id", input.creatorId)
    .maybeSingle();
  if (reviewError) failDb(reviewError);
  if (input.status === "invited" && projectReviewStatus((review as ReviewRow | null) ?? null).status === "flagged") {
    throw new OperatorCrmError("flagged_invite_blocked");
  }

  const existing = shortlist as ShortlistRow;
  const notes = input.notes === undefined ? existing.notes : input.notes;
  const { data, error } = await supabase
    .from("mission_shortlists")
    .update({
      status: input.status,
      notes,
      updated_by: input.context.operatorId,
    })
    .eq("mission_id", input.missionId)
    .eq("creator_id", input.creatorId)
    .select(SHORTLIST_PROJECTION)
    .single();
  if (error) failDb(error);

  await insertAuditEvent(supabase, {
    workspaceId: existing.workspace_id,
    context: input.context,
    eventType: "mission_shortlist.updated",
    targetType: "mission_shortlist",
    targetId: `${input.missionId}:${input.creatorId}`,
    creatorId: input.creatorId,
    missionId: input.missionId,
    metadata: { status: input.status },
  });

  return normalizeShortlistRow(data as ShortlistRow);
}
