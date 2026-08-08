import { adminFetch } from "@/lib/adminTransport";

export type CreatorReviewStatus = "needs_review" | "approved" | "flagged";
export type CreatorRiskLevel = "low" | "medium" | "high" | "unknown";
export type CreatorNoteCategory = "quality" | "brand_safety" | "fit" | "social" | "other";
export type CreatorShortlistStatus = "shortlisted" | "invited" | "dismissed" | "accepted" | "declined";
export type CreatorShortlistSource = "manual" | "applicant" | "match" | "review_queue";

export type CreatorReviewProjection = {
  status: CreatorReviewStatus;
  riskLevel: CreatorRiskLevel;
  summary: string | null;
  reviewedBy: string | null;
  lastReviewedAt: string | null;
  updatedAt: string | null;
};

export type CreatorSocialSummary = {
  platforms: string[];
  syncStatus: string | null;
  followerCount: number | null;
  engagementRate: number | null;
  apiSyncedAt: string | null;
  label: "API-synced" | "Not synced";
  ownershipLabel: "Ownership not verified";
};

export type CreatorCaseEnrichment<T> =
  | { status: "available"; value: T }
  | { status: "unavailable"; reason: "source_error" | "not_configured" };

export type CreatorReviewQueueFilters = {
  status?: CreatorReviewStatus;
  riskLevel?: CreatorRiskLevel;
  missionId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: "last_activity" | "trust_score" | "level" | "social_freshness";
};

export type CreatorReviewQueueRow = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  level: string;
  categories: string[];
  scores: Record<string, number | null>;
  social: CreatorSocialSummary;
  profileMedia: { avatarUrl: string | null; portfolioCount: number; publicHighlightCount: number; completenessScore: number };
  review: CreatorReviewProjection;
  enrichment: {
    social: CreatorCaseEnrichment<CreatorSocialSummary>;
    profile: CreatorCaseEnrichment<{ avatarUrl: string | null; portfolioCount: number; publicHighlightCount: number; completenessScore: number }>;
  };
  shortlist: { status: CreatorShortlistStatus; source: CreatorShortlistSource; notes: string | null; updatedAt: string } | null;
  lastActivityAt: string | null;
};

export type CreatorReviewQueue = { creators: CreatorReviewQueueRow[]; page: number; pageSize: number; total: number };

export type CreatorReviewCommandInput = {
  status: CreatorReviewStatus;
  riskLevel: CreatorRiskLevel;
  summary?: string;
  note?: string;
};

export type CreatorNoteInput = { category: CreatorNoteCategory; body: string };

type CreatorCaseDetailResponse = {
  creator: {
    id: string;
    workspaceId: string;
    displayName: string | null;
    avatarUrl: string | null;
    level: string | null;
    categories: string[];
    scores: Record<string, number | null>;
    socialHandles: unknown;
    createdAt: string;
  };
  review: CreatorReviewProjection;
  notes: Array<{ id: string; creatorId: string; workspaceId: string; operatorId: string; category: CreatorNoteCategory; body: string; createdAt: string }>;
  audit: Array<{ id: string; eventType: string; createdAt: string; metadata: Record<string, unknown> }>;
  social: CreatorCaseEnrichment<{ accounts: Array<CreatorSocialAccount>; summary: CreatorSocialSummary }>;
  profile: CreatorCaseEnrichment<CreatorProfileMedia>;
  missionHistory: CreatorCaseEnrichment<Array<Record<string, unknown>>>;
  shortlists: Array<{
    mission_id: string;
    creator_id: string;
    workspace_id: string;
    status: CreatorShortlistStatus;
    source: CreatorShortlistSource;
    notes: string | null;
    updated_at: string;
  }>;
};

export type CreatorSocialAccount = {
  id: string;
  platform: string;
  handle: string | null;
  sync_status: string | null;
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
  content_themes: string[] | null;
};

export type CreatorProfileMedia = {
  avatarUrl: string | null;
  portfolioLinks: Array<{ id: string; url: string; title: string; platformType: string; caption: string | null; publicHighlight: boolean }>;
  publicHighlights: Array<{ url: string; title: string; platform_type: string; caption: string | null; sort_order: number }>;
  published: { avatarUrl: string | null; highlights: Array<Record<string, unknown>>; publishedAt: string | null };
  completeness: { score: number; items: Array<{ key: string; label: string; complete: boolean }> };
};

export type CreatorCaseDetail = CreatorCaseDetailResponse;

function requireWorkspace(workspaceId: string): string {
  const workspace = workspaceId.trim();
  if (!workspace) throw new Error("workspace_required");
  return workspace;
}

function creatorPath(workspaceId: string, path: string): string {
  return `${path}?${new URLSearchParams({ workspace: requireWorkspace(workspaceId) }).toString()}`;
}

function queueQuery(workspaceId: string, filters: CreatorReviewQueueFilters): string {
  const params = new URLSearchParams({ workspace: requireWorkspace(workspaceId) });
  if (filters.status) params.set("status", filters.status);
  if (filters.riskLevel) params.set("risk_level", filters.riskLevel);
  if (filters.missionId) params.set("mission_id", filters.missionId);
  if (filters.q) params.set("q", filters.q);
  params.set("page", String(filters.page ?? 1));
  params.set("page_size", String(filters.pageSize ?? 25));
  params.set("sort", filters.sort ?? "last_activity");
  return params.toString();
}

function commandIdOrNew(commandId?: string): string {
  return commandId ?? crypto.randomUUID();
}

export function fetchCreatorReviewQueue(workspaceId: string, filters: CreatorReviewQueueFilters = {}) {
  return adminFetch<CreatorReviewQueue>(`/admin/creators/review?${queueQuery(workspaceId, filters)}`);
}

export function fetchCreatorDetail(workspaceId: string, creatorId: string) {
  return adminFetch<CreatorCaseDetail>(creatorPath(workspaceId, `/admin/creators/${creatorId}`));
}

export function postCreatorReview(
  workspaceId: string,
  creatorId: string,
  body: CreatorReviewCommandInput,
  commandId?: string,
) {
  return adminFetch<{ review: CreatorReviewProjection }>(creatorPath(workspaceId, `/admin/creators/${creatorId}/review`), {
    method: "POST",
    body: JSON.stringify({
      command_id: commandIdOrNew(commandId),
      status: body.status,
      risk_level: body.riskLevel,
      summary: body.summary,
      note: body.note,
    }),
  });
}

export function postCreatorNote(
  workspaceId: string,
  creatorId: string,
  body: CreatorNoteInput,
  commandId?: string,
) {
  return adminFetch<{ note: { id: string; category: CreatorNoteCategory; body: string; createdAt: string } }>(
    creatorPath(workspaceId, `/admin/creators/${creatorId}/notes`),
    { method: "POST", body: JSON.stringify({ command_id: commandIdOrNew(commandId), ...body }) },
  );
}
