// Admin/operator API client. B3a: authenticates with the staff member's Supabase JWT
// (Authorization: Bearer), resolved server-side against staff_users. Staff are global, so
// no X-Workspace-Slug is sent (workspace scoping is the ?workspace/?ws query convenience).
import { supabase } from "@/lib/supabase";

export type AdminReviewStatus = "needs_review" | "approved" | "flagged";
export type AdminRiskLevel = "low" | "medium" | "high" | "unknown";
export type AdminNoteCategory = "quality" | "brand_safety" | "fit" | "social" | "other";
export type AdminShortlistStatus = "shortlisted" | "invited" | "dismissed" | "accepted" | "declined";
export type AdminShortlistSource = "manual" | "applicant" | "match" | "review_queue";

export type AdminReviewProjection = {
  revision?: number;
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

export class AdminAuthError extends Error {
  constructor(message: string, public status = 401) { super(message); this.name = "AdminAuthError"; }
}

export class AdminRequestError extends Error {
  code?: string;
  fields?: Record<string, string>;
  status?: number;
  constructor(message: string, code?: string, fields?: Record<string, string>, status?: number) {
    super(message);
    this.code = code;
    this.fields = fields;
    this.status = status;
  }
}

export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) {
    throw new AdminAuthError("unauthorized");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
      if (res.status === 403 && ["STAFF_CAPABILITY_REQUIRED", "WORKSPACE_MEMBERSHIP_REQUIRED", "STAFF_ACCESS_FORBIDDEN"].includes(body.code) && typeof window !== "undefined") window.dispatchEvent(new Event("adfocate:staff-access-denied"));
    if (res.status === 403 && body.code === "not_staff") throw new AdminAuthError("not_staff", 403);
    throw new AdminRequestError(body.error ?? res.statusText, body.code, body.fields, res.status);
  }
  return res.json() as Promise<T>;
}

// ---- Active mission operator review --------------------------------------

export type ActiveMissionRiskBucket = "overdue" | "due_soon" | "on_track" | "no_sla";
export type ActiveMissionReviewState = "submitted" | "under_review";
export type ActiveMissionReviewCategory = "format" | "key_message" | "compliance" | "quality" | "other";

export type ActiveMissionQueueItem = {
  workflowId: string;
  workItemId: string;
  missionId: string;
  creatorDisplayName: string;
  missionTitle: string;
  deliverableTitle: string;
  state: string;
  creatorDeadline: string | null;
  submittedAt: string | null;
  reviewDueAt: string | null;
  proofAttemptId?: string | null;
  proofAttemptNumber?: number | null;
  submittedLate?: boolean;
  metadataStatus?: string | null;
  platform?: string | null;
  publicationDueAt?: string | null;
  creatorResponseDeadline?: string | null;
  proofReviewerId?: string | null;
  reviewerId: string | null;
  riskBucket: ActiveMissionRiskBucket;
};

export type ActiveMissionQueueFilters = {
  workspace: string;
  risk?: ActiveMissionRiskBucket;
  state?: ActiveMissionReviewState;
  reviewer?: string;
  mission?: string;
  proofState?: string;
  late?: boolean;
  metadataStatus?: string;
  platform?: string;
  publicationDeadline?: string;
};

export type ActiveMissionRequirement = {
  id?: string;
  category?: ActiveMissionReviewCategory;
  text: string;
  required?: boolean;
};

export type ActiveMissionWorkItem = {
  id: string;
  title: string;
  platform: string;
  position: number;
  state: string;
  deadline: string | null;
  current_reviewer_id: string | null;
  current_submitted_version_id: string | null;
  approved_version_id: string | null;
  requirements_snapshot: ActiveMissionRequirement[];
  current_proof_attempt_id?: string | null;
  revision?: number;
  publicationSetupRequired?: boolean;
};

export type ActiveMissionVersion = {
  id: string;
  mission_work_item_id: string;
  version_number: number;
  caption_snapshot: string;
  external_draft_url_snapshot: string | null;
  checklist_snapshot: Record<string, boolean>;
  submitted_at: string;
};

export type ActiveMissionReviewRound = {
  id: string;
  mission_work_item_id: string;
  mission_draft_version_id: string;
  round_number: number;
  state: string;
  mission_review_items?: Array<Record<string, unknown>>;
};

export type ActiveMissionRevisionGrant = {
  id: string;
  mission_work_item_id: string;
  reason: string;
  granted_count: number;
  granted_at?: string;
};

export type ActiveMissionAsset = {
  id: string;
  mission_work_item_id: string;
  mission_draft_version_id: string | null;
  original_filename: string;
  mime_type: string;
  signedUrl: string;
};

export type ActiveMissionPublicationInstruction = {
  id: string;
  workItemId: string;
  publicationInstructions: string;
  publicationWindowHours: number;
  requiredDisclosures: string[];
  expectedAccount: string | null;
  proofEvidencePolicy: Record<string, unknown>;
  publicationDueAt: string;
  frozenAt: string | null;
  revision: number;
};

export type ActiveMissionPublicationProofAttempt = {
  id: string;
  workItemId: string;
  attemptNumber: number;
  primaryUrl: string;
  additionalUrls: string[];
  submittedAt: string;
  submittedLate: boolean;
  metadataStatus: string;
  metadataSnapshot: Record<string, unknown>;
  metadataErrorCategory: string | null;
};

export type ActiveMissionPublicationProofReview = {
  id: string;
  attemptId: string;
  reviewNumber: number;
  state: "open" | "correction_requested" | "verified";
  decision: string | null;
  reviewerId: string | null;
  reviewedAt: string | null;
  decisionAt: string | null;
  creatorResponseDeadline: string | null;
  checklist: Record<string, boolean> | null;
  summary: string | null;
  items: Array<{ id: string; category: string; text: string; passed: boolean | null; position: number }>;
};

export type ActiveMissionPublicationProofAsset = {
  id: string;
  attemptId: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  signedUrl: string;
};

type ActiveMissionBrief = {
  id: string;
  title: string;
  description?: string | null;
  key_messages?: string[] | null;
  dos?: string[] | null;
  donts?: string[] | null;
  [key: string]: unknown;
};

export type ActiveMissionWorkflow = {
  workflow: { id: string; revision_limit: number; [key: string]: unknown };
  submission: {
    creators: { id: string; display_name: string | null } | Array<{ id: string; display_name: string | null }>;
    missions: ActiveMissionBrief | ActiveMissionBrief[];
    [key: string]: unknown;
  };
  workItems: ActiveMissionWorkItem[];
  fulfillment: ({ status: string; [key: string]: unknown } | null);
  versions: ActiveMissionVersion[];
  reviews: ActiveMissionReviewRound[];
  grants: ActiveMissionRevisionGrant[];
  events: Array<Record<string, unknown>>;
  assets: ActiveMissionAsset[];
  publicationInstructions?: ActiveMissionPublicationInstruction[];
  proofAttempts?: ActiveMissionPublicationProofAttempt[];
  proofReviews?: ActiveMissionPublicationProofReview[];
  proofAssets?: ActiveMissionPublicationProofAsset[];
};

export type ActiveMissionRevisionItem = {
  requirementId?: string | null;
  category: ActiveMissionReviewCategory;
  text: string;
  required: boolean;
};

function activeMissionWorkspaceHeader(workspace: string): HeadersInit {
  return { "X-Workspace-Slug": workspace };
}

export function fetchActiveMissionQueue(filters: ActiveMissionQueueFilters) {
  const qs = new URLSearchParams();
  if (filters.risk) qs.set("risk", filters.risk);
  if (filters.state) qs.set("state", filters.state);
  if (filters.reviewer) qs.set("reviewer", filters.reviewer);
  if (filters.mission) qs.set("mission", filters.mission);
  if (filters.proofState) qs.set("proofState", filters.proofState);
  if (filters.late !== undefined) qs.set("late", String(filters.late));
  if (filters.metadataStatus) qs.set("metadataStatus", filters.metadataStatus);
  if (filters.platform) qs.set("platform", filters.platform);
  if (filters.publicationDeadline) qs.set("publicationDeadline", filters.publicationDeadline);
  const suffix = qs.size ? `?${qs.toString()}` : "";
  return adminFetch<{ items: ActiveMissionQueueItem[] }>(`/admin/active-missions/queue${suffix}`, {
    headers: activeMissionWorkspaceHeader(filters.workspace),
  });
}

export function fetchActiveMissionWorkflow(workflowId: string, workspace: string) {
  return adminFetch<ActiveMissionWorkflow>(`/admin/active-missions/${workflowId}`, {
    headers: activeMissionWorkspaceHeader(workspace),
  });
}

export function startActiveMissionReview(
  workflowId: string,
  workItemId: string,
  body: { workspace: string; expectedState: string },
) {
  return adminFetch(`/admin/active-missions/${workflowId}/work-items/${workItemId}/start-review`, {
    method: "POST",
    headers: activeMissionWorkspaceHeader(body.workspace),
    body: JSON.stringify({ expectedState: body.expectedState }),
  });
}

export function requestActiveMissionRevision(
  workflowId: string,
  workItemId: string,
  body: {
    workspace: string;
    expectedState: string;
    versionId: string;
    deadline?: string | null;
    items: ActiveMissionRevisionItem[];
  },
) {
  return adminFetch(`/admin/active-missions/${workflowId}/work-items/${workItemId}/request-revision`, {
    method: "POST",
    headers: activeMissionWorkspaceHeader(body.workspace),
    body: JSON.stringify({
      expectedState: body.expectedState,
      versionId: body.versionId,
      deadline: body.deadline,
      items: body.items,
    }),
  });
}

export function grantActiveMissionRevision(
  workflowId: string,
  workItemId: string,
  body: { workspace: string; reason: string; grantedCount: number },
) {
  return adminFetch(`/admin/active-missions/${workflowId}/work-items/${workItemId}/grant-revision`, {
    method: "POST",
    headers: activeMissionWorkspaceHeader(body.workspace),
    body: JSON.stringify({ reason: body.reason, grantedCount: body.grantedCount }),
  });
}

export function approveActiveMissionVersion(
  workflowId: string,
  workItemId: string,
  body: { workspace: string; expectedState: string; versionId: string },
) {
  return adminFetch(`/admin/active-missions/${workflowId}/work-items/${workItemId}/approve-to-publish`, {
    method: "POST",
    headers: activeMissionWorkspaceHeader(body.workspace),
    body: JSON.stringify({ expectedState: body.expectedState, versionId: body.versionId }),
  });
}

export function markActiveMissionShipped(workflowId: string, body: { workspace: string; note?: string }) {
  return adminFetch(`/admin/active-missions/${workflowId}/fulfillment/shipped`, {
    method: "POST",
    headers: activeMissionWorkspaceHeader(body.workspace),
    body: JSON.stringify({ note: body.note }),
  });
}

export type PublicationProofChecklistInput = {
  publiclyAccessible: boolean;
  platformMatches: boolean;
  accountMatches: boolean;
  contentMatchesApprovedVersion: boolean;
  timingAcceptable: boolean;
  disclosuresPresent: boolean;
};

export type PublicationProofCorrectionInput = {
  category: "access" | "platform" | "account" | "content" | "timing" | "disclosure" | "evidence" | "other";
  text: string;
  position: number;
};

type PublicationProofMutationInput = {
  workspace: string;
  expectedState: string;
  expectedRevision: number;
  attemptId: string;
  idempotencyKey: string;
};

function proofMutationHeaders(body: PublicationProofMutationInput): HeadersInit {
  return {
    ...activeMissionWorkspaceHeader(body.workspace),
    "Idempotency-Key": body.idempotencyKey,
  };
}

function proofChecklistBody(checklist: PublicationProofChecklistInput) {
  return {
    publicly_accessible: checklist.publiclyAccessible,
    platform_matches: checklist.platformMatches,
    account_matches: checklist.accountMatches,
    content_matches_approved_version: checklist.contentMatchesApprovedVersion,
    timing_acceptable: checklist.timingAcceptable,
    disclosures_present: checklist.disclosuresPresent,
  };
}

function proofMutationBody(body: PublicationProofMutationInput) {
  return {
    expectedState: body.expectedState,
    expectedRevision: body.expectedRevision,
    attemptId: body.attemptId,
  };
}

export function startPublicationProofReview(
  workflowId: string,
  workItemId: string,
  body: PublicationProofMutationInput,
) {
  return adminFetch(`/admin/active-missions/${workflowId}/work-items/${workItemId}/proof-review/start`, {
    method: "POST",
    headers: proofMutationHeaders(body),
    body: JSON.stringify(proofMutationBody(body)),
  });
}

export function requestPublicationProofCorrection(
  workflowId: string,
  workItemId: string,
  body: PublicationProofMutationInput & {
    checklist: PublicationProofChecklistInput;
    corrections: PublicationProofCorrectionInput[];
    summary?: string | null;
  },
) {
  return adminFetch(`/admin/active-missions/${workflowId}/work-items/${workItemId}/proof-review/corrections`, {
    method: "POST",
    headers: proofMutationHeaders(body),
    body: JSON.stringify({
      ...proofMutationBody(body),
      checklist: proofChecklistBody(body.checklist),
      corrections: body.corrections,
      summary: body.summary,
    }),
  });
}

export function verifyPublicationProof(
  workflowId: string,
  workItemId: string,
  body: PublicationProofMutationInput & { checklist: PublicationProofChecklistInput; summary?: string | null },
) {
  return adminFetch(`/admin/active-missions/${workflowId}/work-items/${workItemId}/proof-review/verify`, {
    method: "POST",
    headers: proofMutationHeaders(body),
    body: JSON.stringify({
      ...proofMutationBody(body),
      checklist: proofChecklistBody(body.checklist),
      summary: body.summary,
    }),
  });
}

export function refreshPublicationProofMetadata(
  workflowId: string,
  workItemId: string,
  body: PublicationProofMutationInput,
) {
  return adminFetch(`/admin/active-missions/${workflowId}/work-items/${workItemId}/proofs/${body.attemptId}/metadata-refresh`, {
    method: "POST",
    headers: proofMutationHeaders(body),
    body: JSON.stringify(proofMutationBody(body)),
  });
}

export function setActiveMissionPublicationInstructions(
  workflowId: string,
  workItemId: string,
  body: {
    workspace: string;
    expectedState: string;
    expectedRevision: number;
    idempotencyKey: string;
    overrideReason: string;
    instructions: {
      publicationInstructions: string;
      publicationWindowHours: number;
      requiredDisclosures: string[];
      expectedAccount: string | null;
      proofEvidencePolicy: Record<string, unknown>;
    };
  },
) {
  return adminFetch(`/admin/active-missions/${workflowId}/work-items/${workItemId}/publication-instructions`, {
    method: "PUT",
    headers: {
      ...activeMissionWorkspaceHeader(body.workspace),
      "Idempotency-Key": body.idempotencyKey,
    },
    body: JSON.stringify({
      expectedState: body.expectedState,
      expectedRevision: body.expectedRevision,
      idempotencyKey: body.idempotencyKey,
      overrideReason: body.overrideReason,
      instructions: body.instructions,
    }),
  });
}

export function setupActiveMissionPublicationInstructions(
  workflowId: string,
  workItemId: string,
  body: {
    workspace: string;
    expectedState: string;
    expectedRevision: number;
    idempotencyKey: string;
    instructions: {
      publicationInstructions: string;
      publicationWindowHours: number;
      requiredDisclosures: string[];
      expectedAccount: string | null;
      proofEvidencePolicy: Record<string, unknown>;
    };
  },
) {
  return adminFetch(`/admin/active-missions/${workflowId}/work-items/${workItemId}/publication-setup`, {
    method: "POST",
    headers: {
      ...activeMissionWorkspaceHeader(body.workspace),
      "Idempotency-Key": body.idempotencyKey,
    },
    body: JSON.stringify({
      expectedState: body.expectedState,
      expectedRevision: body.expectedRevision,
      idempotencyKey: body.idempotencyKey,
      instructions: body.instructions,
    }),
  });
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

export function fetchCreatorDetail(creatorId: string, workspace = "") {
  return adminFetch<AdminCreatorDetailResponse>(`/admin/creators/${creatorId}`, {
    headers: activeMissionWorkspaceHeader(workspace),
  });
}

/** Mirrors `CreatorCaseEnrichment` on the server: side panels degrade, they don't throw. */
export type CreatorCaseEnrichment<T> =
  | { status: "available"; value: T }
  | { status: "unavailable"; reason: "source_error" | "not_configured" };

export type CreatorCaseProofReviewState =
  | "awaiting_review"
  | "in_review"
  | "correction_requested"
  | "verified";

export type CreatorCaseProofItem = {
  attemptId: string;
  workspaceId: string;
  isCurrentAttempt: boolean;
  workflowId: string;
  workItemId: string;
  workItemTitle: string;
  platform: string;
  missionTitle: string | null;
  missionSlug: string | null;
  attemptNumber: number;
  primaryUrl: string;
  submittedAt: string;
  submittedLate: boolean;
  metadataStatus: "available" | "unavailable" | "unsafe";
  reviewState: CreatorCaseProofReviewState;
  reviewSummary: string | null;
  reviewedAt: string | null;
};

export function fetchCreatorPublicationProofs(creatorId: string, workspace = "") {
  return adminFetch<{ proofs: CreatorCaseEnrichment<CreatorCaseProofItem[]> }>(
    `/admin/creators/${creatorId}/publication-proofs`,
    { headers: activeMissionWorkspaceHeader(workspace) },
  );
}

export function postCreatorReview(
  creatorId: string,
  body: { status: AdminReviewStatus; riskLevel: AdminRiskLevel; summary?: string; note?: string; requestId?: string; expectedRevision?: number },
  workspace = "",
) {
  return adminFetch<{ review: AdminReviewProjection }>(`/admin/creators/${creatorId}/review`, {
    method: "POST",
    headers: activeMissionWorkspaceHeader(workspace),
    body: JSON.stringify({
      status: body.status,
      risk_level: body.riskLevel,
      summary: body.summary,
      note: body.note,
      request_id: body.requestId,
      expected_revision: body.expectedRevision,
    }),
  });
}

export function postCreatorNote(creatorId: string, body: { category: AdminNoteCategory; body: string; requestId?: string; expectedRevision?: number }, workspace = "") {
  return adminFetch<{ note: { id: string; category: AdminNoteCategory; body: string; created_at: string } }>(
    `/admin/creators/${creatorId}/notes`,
    { method: "POST", headers: activeMissionWorkspaceHeader(workspace), body: JSON.stringify({ category: body.category, body: body.body, request_id: body.requestId, expected_revision: body.expectedRevision }) },
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
  creator_review?: { status: AdminReviewStatus; risk_level: AdminRiskLevel } | null;
  mission_shortlist?: { status: string } | null;
  creators: { display_name: string };
  missions: { slug: string; title: string; points_reward: number };
};

export type Submission = Application & {
  evidence_revision?: number;
  legacy_evidence_sql_valid?: boolean;
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

export function acceptApplication(id: string, requestId?: string) {
  return adminFetch(`/admin/applications/${id}/accept`, { method: "POST", body: JSON.stringify({ request_id: requestId }) });
}

export function declineApplication(id: string, notes?: string, requestId?: string) {
  return adminFetch(`/admin/applications/${id}/decline`, {
    method: "POST",
    body: JSON.stringify({ notes: notes || undefined, request_id: requestId }),
  });
}

export function fetchSubmissions(status = "submitted", workspace = "", submissionId = "") {
  const parts = [`status=${encodeURIComponent(status)}`, wsq(workspace), submissionId ? `submission_id=${encodeURIComponent(submissionId)}` : ""].filter(Boolean);
  return adminFetch<{ submissions: Submission[] }>(`/admin/submissions?${parts.join("&")}`);
}

export function approveSubmission(id: string, body: { notes?: string; rating?: number }) {
  return adminFetch(`/admin/submissions/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ notes: body.notes, quality_rating: body.rating }),
  });
}
export function requestLegacyEvidenceCorrection(id: string, body: { note: string; requestId: string; expectedRevision: number }) {
  return adminFetch(`/admin/submissions/${id}/request-correction`, { method: "POST",
    body: JSON.stringify({ note: body.note, request_id: body.requestId, expected_revision: body.expectedRevision }) });
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

export type MissionWorkflowPolicyInput = {
  creator_workflow_mode: "legacy" | "active_workspace";
  fulfillment_required: boolean;
  revision_limit: number;
  review_sla_hours: number;
  revision_response_hours: number;
};

export type MissionDeliverableTemplateInput = {
  id?: string;
  title: string;
  platform: string | null;
  position: number;
  required: boolean;
  draft_due_offset_hours: number;
  publication_instructions: string;
  publication_window_hours: number;
  required_disclosures: string[];
  expected_account: string | null;
  proof_evidence_policy: Record<string, unknown>;
  requirements: {
    id?: string;
    category: "format" | "key_message" | "compliance" | "quality" | "other";
    text: string;
    required: boolean;
    position: number;
  }[];
};

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
  creator_workflow_mode: MissionWorkflowPolicyInput["creator_workflow_mode"];
  fulfillment_required: boolean;
  revision_limit: number;
  review_sla_hours: number;
  revision_response_hours: number;
  deliverable_templates: MissionDeliverableTemplateInput[];
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
  deliverable_templates?: MissionDeliverableTemplateInput[];
} & Partial<MissionWorkflowPolicyInput>;
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

// ---- Insights dashboard (mirrors server/lib/insights.ts — keep in sync) ----
export type InsightsMetric = { value: number; prev: number; deltaPct: number | null };

export type Insights = {
  window: { days: 7 | 30 | 90; from: string; to: string; timezone?: string };
  denominators?: import("../../server/lib/insights.js").Insights["denominators"];
  outcomes?: import("../../server/lib/insights.js").Insights["outcomes"];
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

export type { StaffAccessSnapshot, StaffCapability, StaffWorkspaceRole } from "../../server/lib/staffCapabilities";
export function fetchStaffAccess(workspace="") {
  return adminFetch<{access:import("../../server/lib/staffCapabilities").StaffAccessSnapshot}>(`/admin/access${workspace?`?workspace=${encodeURIComponent(workspace)}`:""}`);
}
