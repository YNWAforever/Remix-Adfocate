import {
  NOTE_CATEGORIES,
  REVIEW_STATUSES,
  RISK_LEVELS,
  SHORTLIST_SOURCES,
  SHORTLIST_STATUSES,
  type CreatorReviewNoteCategory,
  type CreatorReviewStatus,
  type CreatorRiskLevel,
  type MissionShortlistSource,
  type MissionShortlistStatus,
  type ReviewProjection,
  type SocialSummaryProjection,
} from "./types.js";

export const DEFAULT_REVIEW_STATUS: ReviewProjection = {
  status: "needs_review",
  riskLevel: "unknown",
  summary: null,
  reviewedBy: null,
  lastReviewedAt: null,
  updatedAt: null,
};

function enumValue<const T extends readonly string[]>(values: T, value: unknown): T[number] | null {
  return typeof value === "string" && values.includes(value) ? value : null;
}

export function parseReviewStatus(value: unknown): CreatorReviewStatus | null {
  return enumValue(REVIEW_STATUSES, value);
}

export function parseRiskLevel(value: unknown): CreatorRiskLevel | null {
  return enumValue(RISK_LEVELS, value);
}

export function parseNoteCategory(value: unknown): CreatorReviewNoteCategory | null {
  return enumValue(NOTE_CATEGORIES, value);
}

export function parseShortlistStatus(value: unknown): MissionShortlistStatus | null {
  return enumValue(SHORTLIST_STATUSES, value);
}

export function parseShortlistSource(value: unknown): MissionShortlistSource | null {
  return enumValue(SHORTLIST_SOURCES, value);
}

export function nonEmptyText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function projectReviewStatus(row: {
  status: string;
  risk_level: string;
  summary: string | null;
  reviewed_by: string | null;
  last_reviewed_at: string | null;
  updated_at: string | null;
} | null): ReviewProjection {
  if (!row) return DEFAULT_REVIEW_STATUS;

  return {
    status: parseReviewStatus(row.status) ?? "needs_review",
    riskLevel: parseRiskLevel(row.risk_level) ?? "unknown",
    summary: row.summary ?? null,
    reviewedBy: row.reviewed_by ?? null,
    lastReviewedAt: row.last_reviewed_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export function summarizeSocialAccounts(
  accounts: Array<{
    platform: string;
    sync_status: string;
    follower_count: number | null;
    engagement_rate: number | null;
    api_synced_at: string | null;
  }>,
): SocialSummaryProjection {
  const synced = accounts
    .filter((account) => account.sync_status === "synced")
    .sort((a, b) => (b.api_synced_at ?? "").localeCompare(a.api_synced_at ?? ""));
  const best = synced[0] ?? null;
  const status = best ? "synced" : accounts[0]?.sync_status ?? null;

  return {
    platforms: accounts.map((account) => account.platform),
    syncStatus: status as SocialSummaryProjection["syncStatus"],
    followerCount: best?.follower_count ?? null,
    engagementRate: best?.engagement_rate ?? null,
    apiSyncedAt: best?.api_synced_at ?? null,
    label: best ? "API-synced" : "Not synced",
    ownershipLabel: "Ownership not verified",
  };
}

export function lastActivityAt(values: Array<string | null | undefined>): string | null {
  const sorted = values.filter((value): value is string => Boolean(value)).sort((a, b) => b.localeCompare(a));
  return sorted[0] ?? null;
}
