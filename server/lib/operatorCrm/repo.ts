import type { SupabaseClient } from "@supabase/supabase-js";
import { getProfileMedia } from "../profileMedia/repo.js";
import { chunk } from "../queryPaging.js";
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
} from "./types.js";

const CREATOR_PROJECTION = "id, workspace_id, display_name, avatar_url, level, categories, scores, social_handles, created_at";
const REVIEW_PROJECTION = "revision, creator_id, workspace_id, status, risk_level, summary, reviewed_by, last_reviewed_at, updated_at";
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
      | "db_error"
      | "CRM_STALE" | "IDEMPOTENCY_CONFLICT" | "FORBIDDEN" | "invalid_command",
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
  const missionIds = new Set(rows.map((row) => row.mission_id));

  // Batched: one `in.(...)` with every id overflows the URL limit at ~250 rows.
  const reviews: Array<Record<string, unknown>> = [];
  const shortlists: Array<Record<string, unknown>> = [];
  for (const ids of chunk(creatorIds)) {
    const { data, error: reviewError } = await supabase
      .from("creator_review_statuses")
      .select("creator_id, status, risk_level")
      .in("creator_id", ids);
    if (reviewError) throw new OperatorCrmError("db_error", reviewError.message);
    reviews.push(...(data ?? []));

    const { data: listed, error: shortlistError } = await supabase
      .from("mission_shortlists")
      .select("creator_id, mission_id, status")
      .in("creator_id", ids);
    if (shortlistError) throw new OperatorCrmError("db_error", shortlistError.message);
    shortlists.push(...(listed ?? []).filter((row) => missionIds.has(row.mission_id as string)));
  }

  const reviewByCreator = new Map(reviews.map((row) => [row.creator_id as string, row]));
  const shortlistByPair = new Map(shortlists.map((row) => [`${row.mission_id}:${row.creator_id}`, row]));

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
  if (!filters.workspace || !filters.operatorId) throw new OperatorCrmError("FORBIDDEN");
  const pageResult = await supabase.rpc("list_creator_review_queue_page", {
    p_workspace: filters.workspace, p_operator: filters.operatorId, p_mission: filters.missionId ?? null,
    p_query: filters.q ?? "", p_status: filters.status ?? null, p_risk: filters.riskLevel ?? null,
    p_sort: filters.sort, p_page: filters.page,
  });
  if (pageResult.error) commandError(pageResult.error);
  const pageData = pageResult.data as { creatorIds: string[]; total: number; page: number; pageSize: number };
  if (!pageData || !Array.isArray(pageData.creatorIds) || pageData.creatorIds.length > 25) throw new OperatorCrmError("db_error");
  if (pageData.creatorIds.length === 0) return { creators: [], total: pageData.total, page: pageData.page, pageSize: 25 };
  const { data: creatorsData, error: creatorsError } = await supabase.from("creators").select(CREATOR_PROJECTION)
    .eq("workspace_id", filters.workspace).in("id", pageData.creatorIds);
  if (creatorsError) failDb(creatorsError);
  const positions = new Map(pageData.creatorIds.map((id, index) => [id, index]));
  const creators = ((creatorsData ?? []) as CreatorRow[]).sort((a, b) => positions.get(a.id)! - positions.get(b.id)!);
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
;
  return { creators: rows, total: pageData.total, page: pageData.page, pageSize: 25 };
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

type CommandIdentity = { requestId?: string; expectedRevision?: number; context: OperatorContext; creatorId: string };
function commandArgs(input: CommandIdentity) {
  if (!input.requestId || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision! < 0 || !input.context.workspaceId) {
    throw new OperatorCrmError("invalid_command");
  }
  return { p_workspace: input.context.workspaceId, p_operator: input.context.operatorId,
    p_request: input.requestId, p_expected_revision: input.expectedRevision, p_creator: input.creatorId };
}
function commandError(error: { message: string; code?: string }) {
  if (["CRM_STALE", "IDEMPOTENCY_CONFLICT", "FORBIDDEN", "invalid_command", "creator_not_found"].includes(error.message)) {
    throw new OperatorCrmError(error.message as "CRM_STALE" | "IDEMPOTENCY_CONFLICT" | "FORBIDDEN" | "invalid_command" | "creator_not_found");
  }
  if (error.code === "23505") throw new OperatorCrmError("IDEMPOTENCY_CONFLICT");
  failDb(error);
}
export async function updateCreatorReview(supabase: SupabaseClient, input: CommandIdentity & {
  status: CreatorReviewStatus; riskLevel: CreatorRiskLevel; summary: string | null; note: string | null;
}) {
  const { data, error } = await supabase.rpc("apply_creator_review_command", { ...commandArgs(input),
    p_status: input.status, p_risk_level: input.riskLevel, p_summary: input.summary, p_note: input.note });
  if (error) commandError(error);
  if (!data?.review || !Number.isSafeInteger(data.revision)) throw new OperatorCrmError("db_error");
  return { ...projectReviewStatus(data.review as ReviewRow), revision: data.revision as number, receiptId: data.receipt_id as string };
}
export async function addCreatorReviewNote(supabase: SupabaseClient, input: CommandIdentity & {
  category: CreatorReviewNoteCategory; body: string;
}) {
  const { data, error } = await supabase.rpc("add_creator_review_note_command", { ...commandArgs(input),
    p_category: input.category, p_body: input.body });
  if (error) commandError(error);
  if (!data?.note || !Number.isSafeInteger(data.revision)) throw new OperatorCrmError("db_error");
  return { ...(data.note as NoteRow), revision: data.revision as number, receiptId: data.receipt_id as string };
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
