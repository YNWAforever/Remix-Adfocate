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

export type AdminProfileMediaLink = {
  id: string;
  creatorId: string;
  workspaceId: string;
  url: string;
  title: string;
  platformType: string;
  caption: string | null;
  sortOrder: number;
  publicHighlight: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminProfileMedia = {
  avatarUrl: string | null;
  portfolioLinks: AdminProfileMediaLink[];
  publicHighlights: Array<{
    url: string;
    title: string;
    platform_type: string;
    caption: string | null;
    sort_order: number;
  }>;
  published: {
    avatarUrl: string | null;
    highlights: Array<{
      url: string;
      title: string;
      platform_type: string;
      caption: string | null;
      sort_order: number;
    }>;
    publishedAt: string | null;
  };
  completeness: {
    score: number;
    items: Array<{ key: string; label: string; complete: boolean }>;
  };
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
  profileMedia: {
    avatarUrl: string | null;
    portfolioCount: number;
    publicHighlightCount: number;
    completenessScore: number;
  };
  review: AdminReviewProjection;
  shortlist: { status: AdminShortlistStatus; source: AdminShortlistSource; notes: string | null; updatedAt: string } | null;
  lastActivityAt: string | null;
};

export type CreatorReviewQueueFilters = {
  status?: AdminReviewStatus;
  riskLevel?: AdminRiskLevel;
  missionId?: string;
  workspace?: string;
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
  profileMedia: AdminProfileMedia;
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

export class AdminRequestError extends Error {
  code?: string;
  fields?: Record<string, string>;
  constructor(message: string, code?: string, fields?: Record<string, string>) {
    super(message);
    this.code = code;
    this.fields = fields;
  }
}

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
    throw new AdminRequestError(body.error ?? res.statusText, body.code, body.fields);
  }
  return res.json() as Promise<T>;
}

function queryString(filters: CreatorReviewQueueFilters): string {
  const qs = new URLSearchParams();
  if (filters.status) qs.set("status", filters.status);
  if (filters.riskLevel) qs.set("risk_level", filters.riskLevel);
  if (filters.missionId) qs.set("mission_id", filters.missionId);
  if (filters.workspace) qs.set("workspace", filters.workspace);
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

// ---- Unified /admin dashboard: shared query keys, types, fetchers ----------

export const adminKeys = {
  applications: (workspace: string) => ["admin-applications", workspace] as const,
  submissions: (status: string, workspace: string) => ["admin-submissions", status, workspace] as const,
  engaged: (workspace: string) => ["admin-engaged", workspace] as const,
};

function wsq(workspace?: string) {
  return workspace ? `workspace=${encodeURIComponent(workspace)}` : "";
}

export type Application = {
  id: string;
  mission_id?: string;
  creator_id?: string;
  creator_review?: { status: AdminReviewStatus; risk_level: AdminRiskLevel } | null;
  mission_shortlist?: { status: string } | null;
  creators: { display_name: string };
  missions: { slug: string; title: string; points_reward: number };
};

export type Submission = Application & {
  status: string;
  content_urls: string[];
  submitted_at: string | null;
};

// NOTE: these mirror the server-side shapes in server/lib/engagedRoster.ts
// (the source of truth, returned by GET /admin/engaged). Keep them in sync.
export type EngagedActiveMission = {
  submissionId: string;
  missionId: string;
  missionSlug: string;
  missionTitle: string;
  status: string;
  joinedAt: string;
  submittedAt: string | null;
  reviewDeadline: string | null;
};

export type EngagedCreator = {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  level: string;
  xp: number;
  activeCount: number;
  completedCount: number;
  pointsEarned: number;
  lastActivityAt: string | null;
  activeMissions: EngagedActiveMission[];
};

export function fetchApplications(workspace = "") {
  const qs = wsq(workspace);
  return adminFetch<{ applications: Application[] }>(`/admin/applications${qs ? `?${qs}` : ""}`);
}

export function acceptApplication(id: string) {
  return adminFetch(`/admin/applications/${id}/accept`, { method: "POST", body: JSON.stringify({}) });
}

export function declineApplication(id: string, notes?: string) {
  return adminFetch(`/admin/applications/${id}/decline`, {
    method: "POST",
    body: JSON.stringify(notes ? { notes } : {}),
  });
}

export function fetchSubmissions(status = "submitted", workspace = "") {
  const parts = [`status=${encodeURIComponent(status)}`, wsq(workspace)].filter(Boolean);
  return adminFetch<{ submissions: Submission[] }>(`/admin/submissions?${parts.join("&")}`);
}

export function approveSubmission(id: string, body: { notes?: string; rating?: number }) {
  return adminFetch(`/admin/submissions/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ notes: body.notes, quality_rating: body.rating }),
  });
}

export function rejectSubmission(id: string, notes?: string) {
  return adminFetch(`/admin/submissions/${id}/reject`, {
    method: "POST",
    body: JSON.stringify(notes ? { notes } : {}),
  });
}

export function fetchEngagedUsers(workspace = "") {
  const qs = wsq(workspace);
  return adminFetch<{ creators: EngagedCreator[] }>(`/admin/engaged${qs ? `?${qs}` : ""}`);
}

// ---- B1 mission authoring -------------------------------------------------
export type AdminWorkspace = { id: string; slug: string; name: string };

export type AdminMission = {
  id: string;
  workspace_id: string;
  slug: string;
  title: string;
  description: string | null;
  category: string | null;
  mission_type: string;
  access_type: "open" | "application";
  required_level: string;
  points_reward: number;
  cash_reward: number | null;
  cpm_rate: number | null;
  cpm_budget_pool: number | null;
  deadline: string | null;
  quota: number;
  filled: number;
  status: "draft" | "active" | "closed";
  deliverables: string[];
  requirements: string[];
  platforms: string[];
  effort: "low" | "medium" | "high" | null;
  target_audience: string | null;
  dos: string[];
  donts: string[];
  key_messages: string[];
  reference_links: string[];
  updated_at: string;
  published_at: string | null;
  closed_at: string | null;
};
export type AdminMissionRow = AdminMission & { engaged: boolean };

export type MissionDraftInput = {
  workspace_id: string;
  slug: string;
  title: string;
  mission_type: string;
  description?: string | null;
  category?: string | null;
  access_type?: "open" | "application";
  required_level?: string;
  points_reward?: number | null;
  cash_reward?: number | null;
  cpm_rate?: number | null;
  cpm_budget_pool?: number | null;
  deadline?: string | null;
  quota?: number | null;
  deliverables?: string[];
  requirements?: string[];
  platforms?: string[];
  effort?: "low" | "medium" | "high" | null;
  target_audience?: string | null;
  dos?: string[];
  donts?: string[];
  key_messages?: string[];
  reference_links?: string[];
};
export type MissionPatch = Partial<MissionDraftInput>;

export const adminMissionKeys = {
  workspaces: ["admin-workspaces"] as const,
  list: (workspace: string, status: string) => ["admin-missions", workspace, status] as const,
  detail: (id: string) => ["admin-mission", id] as const,
  activity: (id: string) => ["admin-mission-activity", id] as const,
};

export function fetchWorkspaces() {
  return adminFetch<{ workspaces: AdminWorkspace[] }>("/admin/workspaces");
}
export function fetchAdminMissions(workspace: string, status: string) {
  const qs = new URLSearchParams();
  if (workspace) qs.set("workspace", workspace);
  if (status) qs.set("status", status);
  return adminFetch<{ missions: AdminMissionRow[] }>(`/admin/missions?${qs.toString()}`);
}
export function fetchAdminMission(id: string) {
  return adminFetch<{ mission: AdminMission }>(`/admin/missions/${id}`);
}

export type MissionActivityRow = {
  id: string;
  mission_id?: string;
  creator_id?: string;
  status: string;
  content_urls: string[] | null;
  submitted_at: string | null;
  created_at: string;
  creators: { display_name: string };
  missions: { slug: string; title: string; points_reward: number };
  creator_review: { status: AdminReviewStatus; risk_level: AdminRiskLevel };
  mission_shortlist: { status: string } | null;
};

export type MissionActivity = {
  mission: AdminMission;
  applicants: MissionActivityRow[];
  submissions: MissionActivityRow[];
  engaged: MissionActivityRow[];
  fill: { filled: number; quota: number };
};

export function fetchMissionActivity(id: string) {
  return adminFetch<MissionActivity>(`/admin/missions/${id}/activity`);
}
export function createMission(body: MissionDraftInput) {
  return adminFetch<{ mission: AdminMission }>("/admin/missions", { method: "POST", body: JSON.stringify(body) });
}
export function updateMission(id: string, patch: MissionPatch) {
  return adminFetch<{ mission: AdminMission }>(`/admin/missions/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}
export function publishMission(id: string) {
  return adminFetch<{ mission: AdminMission }>(`/admin/missions/${id}/publish`, { method: "POST", body: JSON.stringify({}) });
}
export function closeMission(id: string) {
  return adminFetch<{ mission: AdminMission }>(`/admin/missions/${id}/close`, { method: "POST", body: JSON.stringify({}) });
}
export function deleteMissionDraft(id: string) {
  return adminFetch<{ ok: true }>(`/admin/missions/${id}`, { method: "DELETE" });
}

export function duplicateMission(id: string, body?: { workspace_id?: string }) {
  return adminFetch<{ mission: AdminMission }>(`/admin/missions/${id}/duplicate`, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
}
