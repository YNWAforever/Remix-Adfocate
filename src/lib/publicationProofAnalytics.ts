import type {
  PublicationAnalyticsLocale,
  PublicationAnalyticsState,
  PublicationMetadataStatus,
  PublicationMissionType,
  PublicationPlatform,
  PublicationTimingBucket,
} from "./activationAnalytics";

const MISSION_TYPES = new Set<PublicationMissionType>([
  "koc_trial", "ugc", "clipping", "affiliate", "performance_cpm", "live_commerce",
  "brand_ambassador",
]);
const PLATFORMS = new Set<PublicationPlatform>([
  "instagram", "threads", "facebook", "tiktok", "youtube", "linkedin", "x", "other",
]);
const STATES = new Set<PublicationAnalyticsState>([
  "approved_to_publish", "proof_submitted", "proof_under_review",
  "proof_correction_requested", "proof_verified",
]);

export type PublicationAnalyticsBase = {
  locale: PublicationAnalyticsLocale;
  missionType: PublicationMissionType;
  platform: PublicationPlatform;
  state: PublicationAnalyticsState;
};

export function publicationAnalyticsBase(input: {
  locale: string;
  missionType: unknown;
  platform: unknown;
  state: unknown;
}): PublicationAnalyticsBase | null {
  if (typeof input.missionType !== "string"
    || !MISSION_TYPES.has(input.missionType as PublicationMissionType)
    || typeof input.state !== "string"
    || !STATES.has(input.state as PublicationAnalyticsState)) {
    return null;
  }
  const platform = typeof input.platform === "string"
    && PLATFORMS.has(input.platform as PublicationPlatform)
    ? input.platform as PublicationPlatform
    : "other";
  return {
    locale: input.locale === "zh" ? "zh" : "en",
    missionType: input.missionType as PublicationMissionType,
    platform,
    state: input.state as PublicationAnalyticsState,
  };
}

export function creatorPublicationTimingBucket(
  deadline: string | null | undefined,
  now = Date.now(),
): PublicationTimingBucket {
  const dueAt = deadline ? Date.parse(deadline) : Number.NaN;
  if (Number.isNaN(dueAt)) return "on_time";
  if (dueAt < now) return "late";
  return dueAt - now <= 24 * 60 * 60 * 1000 ? "within_24h" : "on_time";
}

export function proofReviewTimingBucket(
  submittedAt: string,
  reviewSlaHours: unknown,
  now = Date.now(),
): PublicationTimingBucket {
  const submitted = Date.parse(submittedAt);
  const hours = typeof reviewSlaHours === "number" ? reviewSlaHours : Number(reviewSlaHours);
  if (Number.isNaN(submitted) || !Number.isFinite(hours) || hours <= 0) return "within_sla";
  return now <= submitted + hours * 60 * 60 * 1000 ? "within_sla" : "late";
}

export function publicationMetadataStatus(value: unknown): PublicationMetadataStatus {
  return value === "available" ? "available" : "unavailable";
}

export function publicationResultInteger(
  value: unknown,
  camelKey: string,
  snakeKey: string,
  fallback: number,
): number {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const candidate = record[camelKey] ?? record[snakeKey];
    if (typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 1) {
      return candidate;
    }
  }
  return fallback;
}

export function publicationResultMetadataStatus(
  value: unknown,
  fallback: unknown,
): unknown {
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  return record.metadataStatus ?? record.metadata_status ?? fallback;
}
