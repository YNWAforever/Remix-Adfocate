import type {
  CreatorQueueFilters,
  CreatorReviewNoteCategory,
  CreatorReviewRow,
  CreatorReviewStatus,
  CreatorRiskLevel,
  OperatorProfileMediaSummary,
  ReviewProjection,
  SocialSummaryProjection,
} from "../operatorCrm/types.js";

export type CreatorCaseReadContext = {
  workspaceId: string;
  actorId: string;
  actorLabel: string;
};

export type CreatorCaseCommandContext = CreatorCaseReadContext & {
  commandId: string;
};

export type CreatorCaseEnrichment<T> =
  | { status: "available"; value: T }
  | { status: "unavailable"; reason: "source_error" | "not_configured" };

export type CreatorIdentity = {
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

export type CreatorReviewNote = {
  id: string;
  creatorId: string;
  workspaceId: string;
  operatorId: string;
  category: CreatorReviewNoteCategory;
  body: string;
  createdAt: string;
};

export type CreatorAuditEvent = {
  id: string;
  workspaceId: string;
  operatorId: string;
  actorLabel: string;
  eventType: string;
  targetType: string;
  targetId: string;
  creatorId: string | null;
  missionId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type SocialProjection = {
  accounts: Array<Record<string, unknown>>;
  summary: SocialSummaryProjection;
};

export type ProfileProjection = {
  avatarUrl: string | null;
  portfolioLinks: Array<Record<string, unknown>>;
  publicHighlights: Array<Record<string, unknown>>;
  published: Record<string, unknown>;
  completeness: {
    score: number;
    items: Array<{ key: string; label: string; complete: boolean }>;
  };
};

export type MissionHistoryProjection = Array<Record<string, unknown>>;

export type CreatorReviewQueueFilters = Omit<CreatorQueueFilters, "workspace">;

export type CreatorReviewQueueEnrichment = {
  social: CreatorCaseEnrichment<CreatorReviewRow["social"]>;
  profile: CreatorCaseEnrichment<OperatorProfileMediaSummary>;
};

export type CreatorReviewQueueRow = CreatorReviewRow & {
  enrichment: CreatorReviewQueueEnrichment;
};

export type CreatorReviewQueue = {
  creators: CreatorReviewQueueRow[];
  page: number;
  pageSize: number;
  total: number;
};

export type ApplyCreatorReviewCommand = {
  creatorId: string;
  status: CreatorReviewStatus;
  riskLevel: CreatorRiskLevel;
  summary: string | null;
  note: { category: CreatorReviewNoteCategory; body: string } | null;
};

export type AppendCreatorNoteCommand = {
  creatorId: string;
  category: CreatorReviewNoteCategory;
  body: string;
};

export type CreatorCaseReadModel = {
  creator: CreatorIdentity;
  review: ReviewProjection;
  notes: CreatorReviewNote[];
  audit: CreatorAuditEvent[];
  social: CreatorCaseEnrichment<SocialProjection>;
  profile: CreatorCaseEnrichment<ProfileProjection>;
  missionHistory: CreatorCaseEnrichment<MissionHistoryProjection>;
  insertedNote?: CreatorReviewNote;
};
