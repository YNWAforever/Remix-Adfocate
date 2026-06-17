export const REVIEW_STATUSES = ["needs_review", "approved", "flagged"] as const;
export const RISK_LEVELS = ["low", "medium", "high", "unknown"] as const;
export const NOTE_CATEGORIES = ["quality", "brand_safety", "fit", "social", "other"] as const;
export const SHORTLIST_STATUSES = ["shortlisted", "invited", "dismissed", "accepted", "declined"] as const;
export const SHORTLIST_SOURCES = ["manual", "applicant", "match", "review_queue"] as const;
export const SOCIAL_SYNC_STATUSES = ["pending", "synced", "stale", "failed", "rate_limited"] as const;

export type CreatorReviewStatus = (typeof REVIEW_STATUSES)[number];
export type CreatorRiskLevel = (typeof RISK_LEVELS)[number];
export type CreatorReviewNoteCategory = (typeof NOTE_CATEGORIES)[number];
export type MissionShortlistStatus = (typeof SHORTLIST_STATUSES)[number];
export type MissionShortlistSource = (typeof SHORTLIST_SOURCES)[number];
export type SocialSyncStatus = (typeof SOCIAL_SYNC_STATUSES)[number];

export type OperatorContext = {
  operatorId: string;
  actorLabel: string;
};

export type ReviewProjection = {
  status: CreatorReviewStatus;
  riskLevel: CreatorRiskLevel;
  summary: string | null;
  reviewedBy: string | null;
  lastReviewedAt: string | null;
  updatedAt: string | null;
};

export type SocialSummaryProjection = {
  platforms: string[];
  syncStatus: SocialSyncStatus | null;
  followerCount: number | null;
  engagementRate: number | null;
  apiSyncedAt: string | null;
  label: "API-synced" | "Not synced";
  ownershipLabel: "Ownership not verified";
};

export type CreatorQueueFilters = {
  status?: CreatorReviewStatus;
  riskLevel?: CreatorRiskLevel;
  missionId?: string;
  q?: string;
  page: number;
  pageSize: number;
  sort: "last_activity" | "trust_score" | "level" | "social_freshness";
};

export type CreatorReviewRow = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  level: string;
  categories: string[];
  scores: Record<string, number | null>;
  social: SocialSummaryProjection;
  review: ReviewProjection;
  shortlist: {
    status: MissionShortlistStatus;
    source: MissionShortlistSource;
    notes: string | null;
    updatedAt: string;
  } | null;
  lastActivityAt: string | null;
};
