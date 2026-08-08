// Admin/operator API client. B3a: authenticates with the staff member's Supabase JWT
// (Authorization: Bearer), resolved server-side against staff_users. Staff are global, so
// no X-Workspace-Slug is sent (workspace scoping is the ?workspace/?ws query convenience).
import { adminFetch } from "@/lib/adminTransport";
import type { CreatorReviewStatus, CreatorRiskLevel } from "@/lib/creatorCase";

export { AdminAuthError, AdminRequestError, adminFetch } from "@/lib/adminTransport";

export type AdminShortlistStatus = "shortlisted" | "invited" | "dismissed" | "accepted" | "declined";
export type AdminShortlistSource = "manual" | "applicant" | "match" | "review_queue";

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
  insights: (workspace: string, windowDays: number) => ["admin-insights", workspace, windowDays] as const,
  radar: (workspace: string, days: number) => ["admin-radar", workspace, days] as const,
  campaigns: (workspace: string, status: string) => ["admin-campaigns", workspace, status] as const,
  campaignDetail: (id: string) => ["admin-campaign", id] as const,
  campaignLeaderboard: (id: string) => ["admin-campaign-board", id] as const,
};

function wsq(workspace?: string) {
  return workspace ? `workspace=${encodeURIComponent(workspace)}` : "";
}

export type Application = {
  id: string;
  mission_id?: string;
  creator_id?: string;
  creator_review?: { status: CreatorReviewStatus; risk_level: CreatorRiskLevel } | null;
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
  creator_review: { status: CreatorReviewStatus; risk_level: CreatorRiskLevel };
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

// ---- Insights dashboard (mirrors server/lib/insights.ts — keep in sync) ----
export type InsightsMetric = { value: number; prev: number; deltaPct: number | null };

export type Insights = {
  window: { days: 7 | 30 | 90; from: string; to: string };
  kpis: {
    activeCreators: InsightsMetric;
    submitToApprove: InsightsMetric;
    pointsIssued: InsightsMetric;
    cashPaid: InsightsMetric;
    missionFillRate: InsightsMetric;
    completions: InsightsMetric;
  };
  funnel: { joined: number; submitted: number; approved: number; joinToSubmit: number; submitToApprove: number };
  levels: Array<{ level: string; count: number }>;
  trend: Array<{ bucket: string; joined: number; submitted: number; approved: number }>;
};

export function fetchInsights(workspace = "", windowDays = 30) {
  const parts = [`window=${windowDays}`, wsq(workspace)].filter(Boolean);
  return adminFetch<{ insights: Insights }>(`/admin/insights?${parts.join("&")}`);
}

// ---- Radar dashboard (mirrors server/lib/radar.ts — keep in sync) ------------

export type RadarQueue<T> = { items: T[]; total: number };

export type RadarAtRiskRow = {
  creator_id: string;
  display_name: string | null;
  phone: string | null;
  last_active: string;
  days_idle: number;
};

export type RadarOverdueRow = {
  submission_id: string;
  creator_id: string;
  display_name: string | null;
  mission_title: string;
  status: "submitted" | "under_review";
  review_deadline: string;
  urgency: "overdue" | "due_soon";
  hours_overdue: number;
};

export type RadarRisingRow = {
  creator_id: string;
  display_name: string | null;
  level: string;
  recent_approvals: number;
  avg_quality: number | null;
  score: number;
};

export type RadarNewCreatorRow = {
  creator_id: string;
  display_name: string | null;
  phone: string | null;
  created_at: string;
  days_since_join: number;
};

export type Radar = {
  window: { days: number; from: string };
  atRisk: RadarQueue<RadarAtRiskRow>;
  slaBreaching: RadarQueue<RadarOverdueRow>;
  rising: RadarQueue<RadarRisingRow>;
  newUnactivated: RadarQueue<RadarNewCreatorRow>;
};

export function fetchRadar(workspace = "", days = 30) {
  const parts = [`days=${days}`, wsq(workspace)].filter(Boolean);
  return adminFetch<{ radar: Radar }>(`/admin/radar?${parts.join("&")}`);
}

// ---- G1 Campaigns & Challenges (mirrors server/lib/campaignAuthoring.ts) ------
export type CampaignPrizeTier = { rank_from: number; rank_to: number; cash: number; points: number; xp: number };

export type AdminCampaign = {
  id: string;
  workspace_id: string;
  slug: string;
  title: string;
  description: string | null;
  status: string;
  starts_at: string;
  ends_at: string;
  goal_target: number;
  completion_bonus_points: number;
  completion_bonus_xp: number;
  prize_tiers: CampaignPrizeTier[];
};
export type CampaignDraftInput = Omit<AdminCampaign, "id" | "status"> & { workspace_id: string };

export type AdminCampaignMission = {
  mission_id: string;
  added_at: string;
  removed_at: string | null;
  missions: { title: string; slug: string; status: string } | null;
};

export function fetchCampaigns(workspace: string, status: string) {
  const qs = new URLSearchParams();
  if (workspace) qs.set("workspace", workspace);
  if (status) qs.set("status", status);
  return adminFetch<{ campaigns: AdminCampaign[] }>(`/admin/campaigns${qs.toString() ? `?${qs}` : ""}`);
}
export function fetchCampaign(id: string) {
  return adminFetch<{ campaign: AdminCampaign; missions: AdminCampaignMission[]; participants: number }>(`/admin/campaigns/${id}`);
}
export function createCampaign(body: Partial<CampaignDraftInput>) {
  return adminFetch<{ campaign: AdminCampaign }>("/admin/campaigns", { method: "POST", body: JSON.stringify(body) });
}
export function updateCampaign(id: string, patch: Partial<CampaignDraftInput>) {
  return adminFetch<{ campaign: AdminCampaign }>(`/admin/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}
export function publishCampaign(id: string) {
  return adminFetch(`/admin/campaigns/${id}/publish`, { method: "POST", body: JSON.stringify({}) });
}
export function attachCampaignMission(id: string, mission_id: string) {
  return adminFetch(`/admin/campaigns/${id}/missions`, { method: "POST", body: JSON.stringify({ mission_id }) });
}
export function detachCampaignMission(id: string, missionId: string) {
  return adminFetch(`/admin/campaigns/${id}/missions/${missionId}`, { method: "DELETE" });
}
export function closeCampaign(id: string) {
  return adminFetch(`/admin/campaigns/${id}/close`, { method: "POST", body: JSON.stringify({}) });
}
export function settleCampaign(id: string) {
  return adminFetch(`/admin/campaigns/${id}/settle`, { method: "POST", body: JSON.stringify({}) });
}
export function fetchCampaignLeaderboard(id: string) {
  return adminFetch<{ leaderboard: unknown[] }>(`/admin/campaigns/${id}/leaderboard`);
}
