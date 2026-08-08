import type { SupabaseClient } from "@supabase/supabase-js";
import { lastActivityAt, projectReviewStatus, summarizeSocialAccounts } from "../operatorCrm/serializers";
import type { CreatorReviewRow, MissionShortlistSource, MissionShortlistStatus, ReviewProjection } from "../operatorCrm/types";
import { getProfileMediaForWorkspace } from "../profileMedia/repo";
import { readOptional } from "./enrichment";
import { CreatorCaseError, type CreatorCaseErrorCode } from "./errors";
import type { CreatorCaseRepository } from "./repository";
import type {
  AppendCreatorNoteCommand,
  ApplyCreatorReviewCommand,
  CreatorAuditEvent,
  CreatorCaseCommandContext,
  CreatorCaseReadContext,
  CreatorCaseReadModel,
  CreatorReviewNote,
  CreatorReviewQueue,
  CreatorReviewQueueFilters,
  MissionHistoryProjection,
  ProfileProjection,
  SocialProjection,
} from "./types";

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
  creator_id?: string;
  workspace_id?: string;
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
  creator_id: string;
  status: MissionShortlistStatus;
  source: MissionShortlistSource;
  notes: string | null;
  updated_at: string;
};

type NoteRow = {
  id: string;
  creator_id: string;
  workspace_id: string;
  operator_id: string;
  category: CreatorReviewNote["category"];
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
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const CREATOR_PROJECTION = "id, workspace_id, display_name, avatar_url, level, categories, scores, social_handles, created_at";
const REVIEW_PROJECTION = "status, risk_level, summary, reviewed_by, last_reviewed_at, updated_at";
const NOTE_PROJECTION = "id, creator_id, workspace_id, operator_id, category, body, created_at";
const AUDIT_PROJECTION = "id, workspace_id, operator_id, actor_label, event_type, target_type, target_id, creator_id, mission_id, metadata, created_at";
const SOCIAL_PROJECTION = "creator_id, platform, handle, sync_status, follower_count, engagement_rate, api_synced_at, external_avatar_url, bio, post_count, following_count, avg_likes, avg_comments, posting_frequency, freshness_score, content_themes";
const SHORTLIST_PROJECTION = "creator_id, status, source, notes, updated_at";
const MISSION_HISTORY_PROJECTION = "id, mission_id, status, content_urls, reviewer_notes, submitted_at, reviewed_at, created_at, missions(id, slug, title)";
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

const KNOWN_ERROR_CODES: CreatorCaseErrorCode[] = [
  "workspace_required",
  "actor_required",
  "actor_label_required",
  "command_required",
  "creator_not_found",
  "mission_not_found",
  "workspace_mismatch",
  "bad_review_status",
  "bad_risk_level",
  "bad_note_category",
  "bad_note_body",
  "flagged_review_note_required",
  "command_conflict",
  "enrichment_unavailable",
];

function failDb(error: { message?: string | null } | null): never {
  const message = error?.message ?? "Database request failed";
  const code = KNOWN_ERROR_CODES.find((candidate) => message.includes(candidate));
  if (code) throw new CreatorCaseError(code, message);
  throw new CreatorCaseError("db_error", message);
}

function requireContextText(value: unknown, code: CreatorCaseErrorCode, label: string): void {
  if (typeof value !== "string" || !value.trim()) throw new CreatorCaseError(code, `${label} is required`);
}

function validateReadContext(context: CreatorCaseReadContext): void {
  requireContextText(context.workspaceId, "workspace_required", "workspaceId");
  requireContextText(context.actorId, "actor_required", "actorId");
  requireContextText(context.actorLabel, "actor_label_required", "actorLabel");
}

function validateCommandContext(context: CreatorCaseCommandContext): void {
  validateReadContext(context);
  requireContextText(context.commandId, "command_required", "commandId");
}

function snapshotFromRpc(value: unknown): CreatorCaseReadModel {
  const snapshot = value as Partial<CreatorCaseReadModel> | null;
  if (!snapshot
    || !snapshot.creator
    || !snapshot.review
    || !Array.isArray(snapshot.notes)
    || !Array.isArray(snapshot.audit)) {
    throw new CreatorCaseError("db_error", "Creator case command returned an invalid result snapshot");
  }

  return {
    creator: {
      ...snapshot.creator,
      categories: snapshot.creator.categories ?? [],
      scores: snapshot.creator.scores ?? {},
    },
    review: { ...snapshot.review },
    notes: snapshot.notes.map((note) => ({ ...note })),
    audit: snapshot.audit.map((event) => ({ ...event, metadata: event.metadata ?? {} })),
    social: { status: "unavailable", reason: "not_configured" },
    profile: { status: "unavailable", reason: "not_configured" },
    missionHistory: { status: "unavailable", reason: "not_configured" },
  };
}

function toNote(row: NoteRow): CreatorReviewNote {
  return {
    id: row.id,
    creatorId: row.creator_id,
    workspaceId: row.workspace_id,
    operatorId: row.operator_id,
    category: row.category,
    body: row.body,
    createdAt: row.created_at,
  };
}

function toAudit(row: AuditRow): CreatorAuditEvent {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    operatorId: row.operator_id,
    actorLabel: row.actor_label,
    eventType: row.event_type,
    targetType: row.target_type,
    targetId: row.target_id,
    creatorId: row.creator_id,
    missionId: row.mission_id,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

function unavailableSocialSummary(): CreatorReviewRow["social"] {
  return {
    platforms: [],
    syncStatus: null,
    followerCount: null,
    engagementRate: null,
    apiSyncedAt: null,
    label: "Not synced",
    ownershipLabel: "Ownership not verified",
  };
}

function compareNullableDesc(left: string | number | null, right: string | number | null): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (left > right) return -1;
  if (left < right) return 1;
  return 0;
}

function trustScore(scores: Record<string, number | null>): number {
  const values = Object.values(scores).filter((value): value is number => typeof value === "number");
  return values.length === 0 ? -1 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function levelRank(level: string): number {
  const numeric = Number(level.replace(/^L/i, ""));
  return Number.isFinite(numeric) ? numeric : -1;
}

function reviewMatchesFilter(review: ReviewProjection, filters: CreatorReviewQueueFilters): boolean {
  if (filters.status && review.status !== filters.status) return false;
  if (filters.riskLevel && review.riskLevel !== filters.riskLevel) return false;
  return true;
}

export class SupabaseCreatorCaseRepository implements CreatorCaseRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listReviewQueue(
    context: CreatorCaseReadContext,
    filters: CreatorReviewQueueFilters,
  ): Promise<CreatorReviewQueue> {
    validateReadContext(context);
    if (filters.missionId) {
      const missionRes = await this.supabase
        .from("missions")
        .select("id")
        .eq("id", filters.missionId)
        .eq("workspace_id", context.workspaceId)
        .maybeSingle();
      if (missionRes.error) failDb(missionRes.error);
      if (!missionRes.data) throw new CreatorCaseError("mission_not_found", "Mission was not found");
    }

    let creatorsQuery = this.supabase
      .from("creators")
      .select(CREATOR_PROJECTION)
      .eq("workspace_id", context.workspaceId);
    if (filters.q) creatorsQuery = creatorsQuery.ilike("display_name", `%${filters.q}%`);
    const creatorsRes = await creatorsQuery;
    if (creatorsRes.error) failDb(creatorsRes.error);

    const creators = (creatorsRes.data ?? []) as CreatorRow[];
    const creatorIds = creators.map((creator) => creator.id);
    const reviewsRes = creatorIds.length === 0
      ? { data: [], error: null }
      : await this.supabase
        .from("creator_review_statuses")
        .select(`creator_id, ${REVIEW_PROJECTION}`)
        .eq("workspace_id", context.workspaceId)
        .in("creator_id", creatorIds);
    if (reviewsRes.error) failDb(reviewsRes.error);
    const reviews = new Map(
      ((reviewsRes.data ?? []) as ReviewRow[]).flatMap((review) => review.creator_id ? [[review.creator_id, review] as const] : []),
    );

    const shortlistsRes = creatorIds.length === 0
      ? { data: [], error: null }
      : await this.readShortlists(context.workspaceId, creatorIds, filters.missionId);
    if (shortlistsRes.error) failDb(shortlistsRes.error);
    const shortlists = new Map(
      ((shortlistsRes.data ?? []) as ShortlistRow[]).map((shortlist) => [shortlist.creator_id, shortlist]),
    );

    const [socials, profiles] = await Promise.all([
      readOptional(() => this.readSocialMap(context.workspaceId, creatorIds)),
      readOptional(() => this.readProfileMap(context.workspaceId, creators)),
    ]);

    const rows = creators
      .map((creator) => {
        const social = socials.status === "available"
          ? socials.value.get(creator.id) ?? unavailableSocialSummary()
          : unavailableSocialSummary();
        const profileMedia = profiles.status === "available"
          ? profiles.value.get(creator.id) ?? this.emptyProfileMediaSummary(creator)
          : this.emptyProfileMediaSummary(creator);
        const shortlist = shortlists.get(creator.id) ?? null;
        const review = projectReviewStatus(reviews.get(creator.id) ?? null);
        return {
          id: creator.id,
          displayName: creator.display_name ?? creator.id,
          avatarUrl: creator.avatar_url,
          level: creator.level ?? "L0",
          categories: creator.categories ?? [],
          scores: creator.scores ?? {},
          social,
          profileMedia,
          review,
          enrichment: {
            social: socials.status === "available" ? { status: "available" as const, value: social } : socials,
            profile: profiles.status === "available" ? { status: "available" as const, value: profileMedia } : profiles,
          },
          shortlist: shortlist ? {
            status: shortlist.status,
            source: shortlist.source,
            notes: shortlist.notes,
            updatedAt: shortlist.updated_at,
          } : null,
          lastActivityAt: lastActivityAt([review.updatedAt, shortlist?.updated_at, social.apiSyncedAt, creator.created_at]),
        };
      })
      .filter((row) => reviewMatchesFilter(row.review, filters))
      .filter((row) => !(filters.missionId && !filters.status && row.review.status === "flagged"));

    rows.sort((left, right) => {
      if (filters.missionId) {
        const priority = (left.review.status === "approved" ? 0 : 1) - (right.review.status === "approved" ? 0 : 1);
        if (priority !== 0) return priority;
      }
      switch (filters.sort) {
        case "trust_score": return compareNullableDesc(trustScore(left.scores), trustScore(right.scores));
        case "level": return compareNullableDesc(levelRank(left.level), levelRank(right.level));
        case "social_freshness": return compareNullableDesc(left.social.apiSyncedAt, right.social.apiSyncedAt);
        case "last_activity":
        default: return compareNullableDesc(left.lastActivityAt, right.lastActivityAt);
      }
    });

    const page = Math.max(filters.page || 1, 1);
    const pageSize = Math.min(Math.max(filters.pageSize || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    return { creators: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: rows.length };
  }

  async getCase(context: CreatorCaseReadContext, creatorId: string): Promise<CreatorCaseReadModel> {
    validateReadContext(context);

    const creatorRes = await this.supabase
      .from("creators")
      .select(CREATOR_PROJECTION)
      .eq("id", creatorId)
      .eq("workspace_id", context.workspaceId)
      .maybeSingle();
    if (creatorRes.error) failDb(creatorRes.error);
    if (!creatorRes.data) throw new CreatorCaseError("creator_not_found", "Creator was not found");

    const [reviewRes, notesRes, auditRes] = await Promise.all([
      this.supabase
        .from("creator_review_statuses")
        .select(REVIEW_PROJECTION)
        .eq("creator_id", creatorId)
        .eq("workspace_id", context.workspaceId)
        .maybeSingle(),
      this.supabase
        .from("creator_review_notes")
        .select(NOTE_PROJECTION)
        .eq("creator_id", creatorId)
        .eq("workspace_id", context.workspaceId)
        .order("created_at", { ascending: true }),
      this.supabase
        .from("operator_audit_events")
        .select(AUDIT_PROJECTION)
        .eq("creator_id", creatorId)
        .eq("workspace_id", context.workspaceId)
        .order("created_at", { ascending: true }),
    ]);
    if (reviewRes.error) failDb(reviewRes.error);
    if (notesRes.error) failDb(notesRes.error);
    if (auditRes.error) failDb(auditRes.error);

    const creator = creatorRes.data as CreatorRow;
    const [social, profile, missionHistory] = await Promise.all([
      readOptional(() => this.readSocial(context.workspaceId, creatorId)),
      readOptional(() => this.readProfile(context.workspaceId, creatorId)),
      readOptional(() => this.readMissionHistory(context.workspaceId, creatorId)),
    ]);
    return {
      creator: {
        id: creator.id,
        workspaceId: creator.workspace_id,
        displayName: creator.display_name,
        avatarUrl: creator.avatar_url,
        level: creator.level,
        categories: creator.categories ?? [],
        scores: creator.scores ?? {},
        socialHandles: creator.social_handles,
        createdAt: creator.created_at,
      },
      review: projectReviewStatus((reviewRes.data as ReviewRow | null) ?? null),
      notes: ((notesRes.data ?? []) as NoteRow[]).map(toNote),
      audit: ((auditRes.data ?? []) as AuditRow[]).map(toAudit),
      social,
      profile,
      missionHistory,
    };
  }

  private async readSocial(workspaceId: string, creatorId: string): Promise<SocialProjection> {
    const { data, error } = await this.supabase
      .from("creator_social_accounts")
      .select(SOCIAL_PROJECTION)
      .eq("creator_id", creatorId)
      .eq("workspace_id", workspaceId)
      .order("api_synced_at", { ascending: false });
    if (error) throw error;
    const accounts = (data ?? []) as SocialRow[];
    return { accounts: accounts as Array<Record<string, unknown>>, summary: summarizeSocialAccounts(accounts) };
  }

  private async readProfile(workspaceId: string, creatorId: string): Promise<ProfileProjection> {
    const profile = await getProfileMediaForWorkspace(this.supabase, creatorId, workspaceId);
    return {
      avatarUrl: profile.avatarUrl,
      portfolioLinks: profile.portfolioLinks.map((link) => ({ ...link })),
      publicHighlights: profile.publicHighlights.map((highlight) => ({ ...highlight })),
      published: {
        ...profile.published,
        highlights: profile.published.highlights.map((highlight) => ({ ...highlight })),
      },
      completeness: {
        score: profile.completeness.score,
        items: profile.completeness.items.map((item) => ({ ...item })),
      },
    };
  }

  private async readMissionHistory(workspaceId: string, creatorId: string): Promise<MissionHistoryProjection> {
    const { data, error } = await this.supabase
      .from("mission_submissions")
      .select(MISSION_HISTORY_PROJECTION)
      .eq("creator_id", creatorId)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as MissionHistoryProjection;
  }

  private async readSocialMap(workspaceId: string, creatorIds: string[]): Promise<Map<string, CreatorReviewRow["social"]>> {
    if (creatorIds.length === 0) return new Map();
    const { data, error } = await this.supabase
      .from("creator_social_accounts")
      .select(SOCIAL_PROJECTION)
      .eq("workspace_id", workspaceId)
      .in("creator_id", creatorIds);
    if (error) throw error;
    const grouped = new Map<string, SocialRow[]>();
    for (const row of (data ?? []) as SocialRow[]) {
      const accounts = grouped.get(row.creator_id) ?? [];
      accounts.push(row);
      grouped.set(row.creator_id, accounts);
    }
    return new Map([...grouped].map(([creatorId, accounts]) => [creatorId, summarizeSocialAccounts(accounts)]));
  }

  private async readProfileMap(workspaceId: string, creators: CreatorRow[]): Promise<Map<string, CreatorReviewRow["profileMedia"]>> {
    const result = new Map<string, CreatorReviewRow["profileMedia"]>();
    await Promise.all(creators.map(async (creator) => {
      const profile = await this.readProfile(workspaceId, creator.id);
      result.set(creator.id, {
        avatarUrl: profile.avatarUrl,
        portfolioCount: profile.portfolioLinks.length,
        publicHighlightCount: profile.publicHighlights.length,
        completenessScore: profile.completeness.score,
      });
    }));
    return result;
  }

  private async readShortlists(workspaceId: string, creatorIds: string[], missionId?: string) {
    let query = this.supabase
      .from("mission_shortlists")
      .select(SHORTLIST_PROJECTION)
      .eq("workspace_id", workspaceId)
      .in("creator_id", creatorIds);
    if (missionId) query = query.eq("mission_id", missionId);
    return query.order("updated_at", { ascending: false });
  }

  private emptyProfileMediaSummary(creator: CreatorRow): CreatorReviewRow["profileMedia"] {
    return { avatarUrl: creator.avatar_url, portfolioCount: 0, publicHighlightCount: 0, completenessScore: 0 };
  }

  async applyReview(context: CreatorCaseCommandContext, command: ApplyCreatorReviewCommand): Promise<CreatorCaseReadModel> {
    validateCommandContext(context);
    const { data, error } = await this.supabase.rpc("apply_creator_review", {
      p_command_id: context.commandId,
      p_workspace_id: context.workspaceId,
      p_creator_id: command.creatorId,
      p_operator_id: context.actorId,
      p_actor_label: context.actorLabel,
      p_status: command.status,
      p_risk_level: command.riskLevel,
      p_summary: command.summary,
      p_note_category: command.note?.category ?? null,
      p_note_body: command.note?.body ?? null,
    });
    if (error) failDb(error);
    return snapshotFromRpc(data);
  }

  async appendNote(context: CreatorCaseCommandContext, command: AppendCreatorNoteCommand): Promise<CreatorCaseReadModel> {
    validateCommandContext(context);
    const { data, error } = await this.supabase.rpc("append_creator_review_note", {
      p_command_id: context.commandId,
      p_workspace_id: context.workspaceId,
      p_creator_id: command.creatorId,
      p_operator_id: context.actorId,
      p_actor_label: context.actorLabel,
      p_note_category: command.category,
      p_note_body: command.body,
    });
    if (error) failDb(error);
    return snapshotFromRpc(data);
  }
}
