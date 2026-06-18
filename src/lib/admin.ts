// Interim operator auth: a shared ADMIN_SECRET kept in sessionStorage (cleared on tab
// close). Single-operator internal tool only — real per-workspace role auth lands with
// the Brand Dashboard. Mirrors the x-admin-secret check in server/routes/admin.ts.
const KEY = "adfocate_admin_secret";

export type AdminReviewStatus = "needs_review" | "approved" | "flagged";
export type AdminRiskLevel = "low" | "medium" | "high" | "unknown";
export type AdminNoteCategory = "quality" | "brand_safety" | "fit" | "social" | "other";
export type AdminShortlistStatus = "shortlisted" | "invited" | "dismissed" | "accepted" | "declined";
export type AdminShortlistSource = "manual" | "applicant" | "match" | "review_queue";

export type AdminReviewProjection = {
  status: AdminReviewStatus;
  riskLevel: AdminRiskLevel;
  summary: string | null;
  reviewedBy: string | null;
  lastReviewedAt: string | null;
  updatedAt: string | null;
};

export type AdminCreatorReviewRow = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  level: string;
  categories: string[];
  scores: Record<string, number | null>;
  social: {
    platforms: string[];
    syncStatus: string | null;
    followerCount: number | null;
    engagementRate: number | null;
    apiSyncedAt: string | null;
    label: "API-synced" | "Not synced";
    ownershipLabel: "Ownership not verified";
  };
  review: AdminReviewProjection;
  shortlist: { status: AdminShortlistStatus; source: AdminShortlistSource; notes: string | null; updatedAt: string } | null;
  lastActivityAt: string | null;
};

export type CreatorReviewQueueFilters = {
  status?: AdminReviewStatus;
  riskLevel?: AdminRiskLevel;
  missionId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: "last_activity" | "trust_score" | "level" | "social_freshness";
};

type AdminCreatorDetailResponse = {
  creator: {
    id: string;
    workspace_id: string;
    display_name: string | null;
    avatar_url: string | null;
    level: string;
    categories: string[];
    scores: Record<string, number | null>;
    social_handles: unknown;
    created_at: string;
  };
  socialAccounts: Array<{
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
  }>;
  social: AdminCreatorReviewRow["social"];
  review: AdminReviewProjection;
  notes: Array<{ id: string; creator_id: string; workspace_id: string; operator_id: string; category: AdminNoteCategory; body: string; created_at: string }>;
  shortlists: Array<{
    mission_id: string;
    creator_id: string;
    workspace_id: string;
    status: AdminShortlistStatus;
    source: AdminShortlistSource;
    notes: string | null;
    created_by: string;
    updated_by: string;
    created_at: string;
    updated_at: string;
  }>;
  audit: Array<Record<string, unknown>>;
  missionHistory: Array<Record<string, unknown>>;
};

export function getAdminSecret(): string | null {
  return sessionStorage.getItem(KEY);
}
export function setAdminSecret(secret: string) {
  sessionStorage.setItem(KEY, secret);
}
export function clearAdminSecret() {
  sessionStorage.removeItem(KEY);
}

export class AdminAuthError extends Error {}

export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const secret = getAdminSecret();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "x-admin-secret": secret } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) {
    clearAdminSecret();
    throw new AdminAuthError("unauthorized");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

function queryString(filters: CreatorReviewQueueFilters): string {
  const qs = new URLSearchParams();
  if (filters.status) qs.set("status", filters.status);
  if (filters.riskLevel) qs.set("risk_level", filters.riskLevel);
  if (filters.missionId) qs.set("mission_id", filters.missionId);
  if (filters.q) qs.set("q", filters.q);
  qs.set("page", String(filters.page ?? 1));
  qs.set("page_size", String(filters.pageSize ?? 25));
  qs.set("sort", filters.sort ?? "last_activity");
  return qs.toString();
}

export function fetchCreatorReviewQueue(filters: CreatorReviewQueueFilters = {}) {
  return adminFetch<{ creators: AdminCreatorReviewRow[]; page: number; pageSize: number; total: number }>(
    `/admin/creators/review?${queryString(filters)}`,
  );
}

export function fetchCreatorDetail(creatorId: string) {
  return adminFetch<AdminCreatorDetailResponse>(`/admin/creators/${creatorId}`);
}

export function postCreatorReview(
  creatorId: string,
  body: { status: AdminReviewStatus; riskLevel: AdminRiskLevel; summary?: string; note?: string },
) {
  return adminFetch<{ review: AdminReviewProjection }>(`/admin/creators/${creatorId}/review`, {
    method: "POST",
    body: JSON.stringify({
      status: body.status,
      risk_level: body.riskLevel,
      summary: body.summary,
      note: body.note,
    }),
  });
}

export function postCreatorNote(creatorId: string, body: { category: AdminNoteCategory; body: string }) {
  return adminFetch<{ note: { id: string; category: AdminNoteCategory; body: string; created_at: string } }>(
    `/admin/creators/${creatorId}/notes`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export function fetchMissionShortlist(missionId: string) {
  return adminFetch<{
    mission: { id: string; slug: string; title: string };
    shortlists: Array<{
      creator_id: string;
      status: AdminShortlistStatus;
      source: AdminShortlistSource;
      notes: string | null;
      creators?: { display_name?: string | null };
    }>;
  }>(`/admin/missions/${missionId}/shortlist`);
}

export function postMissionShortlist(
  missionId: string,
  body: { creatorId: string; source: AdminShortlistSource; notes?: string },
) {
  return adminFetch<{ shortlist: { creator_id: string; status: AdminShortlistStatus } }>(
    `/admin/missions/${missionId}/shortlist`,
    {
      method: "POST",
      body: JSON.stringify({ creator_id: body.creatorId, source: body.source, notes: body.notes }),
    },
  );
}

export function patchMissionShortlist(
  missionId: string,
  creatorId: string,
  body: { status: AdminShortlistStatus; notes?: string },
) {
  return adminFetch<{ shortlist: { creator_id: string; status: AdminShortlistStatus } }>(
    `/admin/missions/${missionId}/shortlist/${creatorId}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}
