export type DeviceCategory = "mobile" | "tablet" | "desktop";

export type ActivationAuthErrorCategory =
  | "expired"
  | "already_used"
  | "malformed"
  | "rate_limited"
  | "delivery_failed"
  | "unknown";

const PUBLICATION_ANALYTICS_LOCALES = ["en", "zh"] as const;
const PUBLICATION_MISSION_TYPES = [
  "koc_trial", "ugc", "clipping", "affiliate", "performance_cpm", "live_commerce",
  "brand_ambassador",
] as const;
const PUBLICATION_PLATFORMS = [
  "instagram", "threads", "facebook", "tiktok", "youtube", "linkedin", "x", "other",
] as const;
const PUBLICATION_STATES = [
  "approved_to_publish", "proof_submitted", "proof_under_review",
  "proof_correction_requested", "proof_verified",
] as const;
const PUBLICATION_TIMING_BUCKETS = ["within_24h", "on_time", "within_sla", "late"] as const;
const PUBLICATION_LATENESS = ["on_time", "late"] as const;
const PUBLICATION_METADATA_STATUSES = ["available", "unavailable"] as const;
const PUBLICATION_CHECKLIST_FAILURE_CATEGORIES = [
  "access", "platform", "account", "content", "timing", "disclosure", "evidence", "other",
] as const;
const PUBLICATION_RECOVERY_CATEGORIES = [
  "stale_conflict", "upload_failed", "metadata_unavailable", "other",
] as const;

export type PublicationAnalyticsLocale = (typeof PUBLICATION_ANALYTICS_LOCALES)[number];
export type PublicationMissionType = (typeof PUBLICATION_MISSION_TYPES)[number];
export type PublicationPlatform = (typeof PUBLICATION_PLATFORMS)[number];
export type PublicationAnalyticsState = (typeof PUBLICATION_STATES)[number];
export type PublicationTimingBucket = (typeof PUBLICATION_TIMING_BUCKETS)[number];
export type PublicationLateness = (typeof PUBLICATION_LATENESS)[number];
export type PublicationMetadataStatus = (typeof PUBLICATION_METADATA_STATUSES)[number];
export type PublicationChecklistFailureCategory =
  (typeof PUBLICATION_CHECKLIST_FAILURE_CATEGORIES)[number];
export type PublicationRecoveryCategory = (typeof PUBLICATION_RECOVERY_CATEGORIES)[number];

const REWARD_HANDOFF_WORKFLOW_STATES = ["proof_verified", "reward_pending"] as const;
const REWARD_HANDOFF_CONTRACT_SOURCES = ["join", "operator_backfill", "missing"] as const;
const REWARD_HANDOFF_DUE_FILTERS = ["all", "overdue", "due_soon", "no_target"] as const;
const REWARD_HANDOFF_COMPONENT_FILTERS = ["all", "points", "cash", "xp"] as const;
const REWARD_HANDOFF_STATUS_FILTERS = ["pending", "cancelled"] as const;
const REWARD_HANDOFF_ERROR_CATEGORIES = [
  "wrong_state",
  "required_proof_incomplete",
  "reward_contract_required",
  "pending_reward_exists",
  "workflow_stale",
  "notification_failed",
  "contract_error",
  "eligibility_error",
  "duplicate",
  "other",
  "unknown",
] as const;

export type RewardHandoffAnalyticsEvent =
  | "mission_completion_review_viewed"
  | "mission_completion_approved"
  | "mission_reward_pending_viewed"
  | "mission_reward_pending_cancelled"
  | "mission_reward_support_selected"
  | "reward_handoff_queue_viewed"
  | "reward_handoff_queue_filtered";

export type RewardHandoffAnalyticsProperties = {
  missionId?: string;
  locale?: PublicationAnalyticsLocale;
  deviceCategory?: DeviceCategory;
  workflowState?: (typeof REWARD_HANDOFF_WORKFLOW_STATES)[number];
  contractSource?: (typeof REWARD_HANDOFF_CONTRACT_SOURCES)[number];
  errorCategory?: (typeof REWARD_HANDOFF_ERROR_CATEGORIES)[number];
  hasPoints?: boolean;
  hasCash?: boolean;
  hasXp?: boolean;
  dueFilter?: (typeof REWARD_HANDOFF_DUE_FILTERS)[number];
  componentFilter?: (typeof REWARD_HANDOFF_COMPONENT_FILTERS)[number];
  statusFilter?: (typeof REWARD_HANDOFF_STATUS_FILTERS)[number];
};

/**
 * The allowed activation analytics payloads and their PII boundary.
 * Do not add direct creator identifiers or creator-authored content here.
 */
export type ActivationEventMap = {
  landing_page_viewed: { locale: string; deviceCategory: DeviceCategory };
  signup_started: {
    locale: string;
    deviceCategory: DeviceCategory;
    source: "creators_hero" | "creators_footer";
  };
  signup_completed: {
    locale: string;
    deviceCategory: DeviceCategory;
    method: "email_magic_link" | "whatsapp" | "google" | "unknown";
  };
  auth_link_requested: { locale: string; method: "email_magic_link" };
  auth_link_failed: {
    locale: string;
    method: "email_magic_link";
    errorCategory: ActivationAuthErrorCategory;
  };
  onboarding_step_viewed: { locale: string; step: number };
  onboarding_step_completed: {
    locale: string;
    step: number;
    status: "saved" | "skipped";
  };
  onboarding_abandoned: { locale: string; step: number };
  social_profile_added: { locale: string; platform: string };
  onboarding_completed: { locale: string; rewardType: "welcome_points" };
  dashboard_viewed: { locale: string; creatorLevel?: string };
  activation_action_viewed: { locale: string; actionKind: string };
  activation_action_clicked: { locale: string; actionKind: string };
  mission_recommendation_viewed: {
    locale: string;
    missionId: string;
    missionType: string;
  };
  mission_viewed: {
    locale: string;
    missionId: string;
    missionType: string;
  };
  creator_activated: {
    locale: string;
    activationPath: "mission_viewed" | "readiness_action";
  };
  active_mission_workspace_viewed: {
    locale: string;
    missionType: string;
    state: string;
  };
  active_mission_action_clicked: {
    locale: string;
    missionType: string;
    state: string;
    action: string;
  };
  mission_product_received_confirmed: { locale: string; missionType: string };
  mission_draft_started: {
    locale: string;
    missionType: string;
    timingBucket: string;
  };
  mission_draft_version_submitted: {
    locale: string;
    missionType: string;
    assetCount: number;
    versionNumber: number;
  };
  mission_review_started: {
    locale: string;
    missionType: string;
    timingBucket: string;
    versionNumber: number;
    roundNumber: number;
  };
  mission_draft_revision_requested: {
    locale: string;
    missionType: string;
    timingBucket: string;
    roundNumber: number;
  };
  mission_draft_approved_to_publish: {
    locale: string;
    missionType: string;
    timingBucket: string;
    versionNumber: number;
    roundNumber: number;
  };
  active_mission_approved_to_publish: {
    locale: string;
    missionType: string;
    timingBucket: string;
    requiredItemCount: number;
    revisionRoundCount: number;
  };
  active_mission_recovery_used: {
    locale: string;
    missionType: string;
    state: string;
    action: string;
    errorCategory: string;
  };
  publication_instructions_viewed: {
    locale: PublicationAnalyticsLocale;
    missionType: PublicationMissionType;
    platform: PublicationPlatform;
    state: PublicationAnalyticsState;
  };
  publication_proof_form_started: {
    locale: PublicationAnalyticsLocale; missionType: PublicationMissionType;
    platform: PublicationPlatform; state: PublicationAnalyticsState;
    timingBucket: PublicationTimingBucket; attemptNumber: number;
  };
  publication_proof_submitted: {
    locale: PublicationAnalyticsLocale; missionType: PublicationMissionType;
    platform: PublicationPlatform; state: PublicationAnalyticsState;
    timingBucket: PublicationTimingBucket; attemptNumber: number;
    urlCount: number; evidenceCount: number;
    lateness: PublicationLateness; metadataStatus: PublicationMetadataStatus;
  };
  publication_proof_metadata_unavailable: {
    locale: PublicationAnalyticsLocale; missionType: PublicationMissionType;
    platform: PublicationPlatform; state: PublicationAnalyticsState;
    attemptNumber: number; metadataStatus: "unavailable";
  };
  publication_proof_review_started: {
    locale: PublicationAnalyticsLocale; missionType: PublicationMissionType;
    platform: PublicationPlatform; state: PublicationAnalyticsState;
    timingBucket: PublicationTimingBucket; attemptNumber: number; reviewNumber: number;
    metadataStatus: PublicationMetadataStatus;
  };
  publication_proof_correction_requested: {
    locale: PublicationAnalyticsLocale; missionType: PublicationMissionType;
    platform: PublicationPlatform; state: PublicationAnalyticsState;
    timingBucket: PublicationTimingBucket; attemptNumber: number; reviewNumber: number;
    checklistFailureCategories: readonly PublicationChecklistFailureCategory[];
  };
  publication_proof_resubmitted: {
    locale: PublicationAnalyticsLocale; missionType: PublicationMissionType;
    platform: PublicationPlatform; state: PublicationAnalyticsState;
    timingBucket: PublicationTimingBucket; attemptNumber: number;
    urlCount: number; evidenceCount: number;
    lateness: PublicationLateness; metadataStatus: PublicationMetadataStatus;
  };
  publication_proof_verified: {
    locale: PublicationAnalyticsLocale; missionType: PublicationMissionType;
    platform: PublicationPlatform; state: PublicationAnalyticsState;
    timingBucket: PublicationTimingBucket; attemptNumber: number; reviewNumber: number;
    metadataStatus: PublicationMetadataStatus;
  };
  publication_proof_recovery_used: {
    locale: PublicationAnalyticsLocale; missionType: PublicationMissionType;
    platform: PublicationPlatform; state: PublicationAnalyticsState;
    attemptNumber: number; recoveryCategory: PublicationRecoveryCategory;
  };
  mission_completion_review_viewed: RewardHandoffAnalyticsProperties;
  mission_completion_approved: RewardHandoffAnalyticsProperties;
  mission_reward_pending_viewed: RewardHandoffAnalyticsProperties;
  mission_reward_pending_cancelled: RewardHandoffAnalyticsProperties;
  mission_reward_support_selected: RewardHandoffAnalyticsProperties;
  reward_handoff_queue_viewed: RewardHandoffAnalyticsProperties;
  reward_handoff_queue_filtered: RewardHandoffAnalyticsProperties;
};

const ACTIVATION_PROPERTY_KEYS = {
  landing_page_viewed: ["locale", "deviceCategory"],
  signup_started: ["locale", "deviceCategory", "source"],
  signup_completed: ["locale", "deviceCategory", "method"],
  auth_link_requested: ["locale", "method"],
  auth_link_failed: ["locale", "method", "errorCategory"],
  onboarding_step_viewed: ["locale", "step"],
  onboarding_step_completed: ["locale", "step", "status"],
  onboarding_abandoned: ["locale", "step"],
  social_profile_added: ["locale", "platform"],
  onboarding_completed: ["locale", "rewardType"],
  dashboard_viewed: ["locale", "creatorLevel"],
  activation_action_viewed: ["locale", "actionKind"],
  activation_action_clicked: ["locale", "actionKind"],
  mission_recommendation_viewed: ["locale", "missionId", "missionType"],
  mission_viewed: ["locale", "missionId", "missionType"],
  creator_activated: ["locale", "activationPath"],
  active_mission_workspace_viewed: ["locale", "missionType", "state"],
  active_mission_action_clicked: ["locale", "missionType", "state", "action"],
  mission_product_received_confirmed: ["locale", "missionType"],
  mission_draft_started: ["locale", "missionType", "timingBucket"],
  mission_draft_version_submitted: ["locale", "missionType", "assetCount", "versionNumber"],
  mission_review_started: ["locale", "missionType", "timingBucket", "versionNumber", "roundNumber"],
  mission_draft_revision_requested: ["locale", "missionType", "timingBucket", "roundNumber"],
  mission_draft_approved_to_publish: ["locale", "missionType", "timingBucket", "versionNumber", "roundNumber"],
  active_mission_approved_to_publish: ["locale", "missionType", "timingBucket", "requiredItemCount", "revisionRoundCount"],
  active_mission_recovery_used: ["locale", "missionType", "state", "action", "errorCategory"],
  publication_instructions_viewed: ["locale", "missionType", "platform", "state"],
  publication_proof_form_started: ["locale", "missionType", "platform", "state", "timingBucket", "attemptNumber"],
  publication_proof_submitted: ["locale", "missionType", "platform", "state", "timingBucket", "attemptNumber", "urlCount", "evidenceCount", "lateness", "metadataStatus"],
  publication_proof_metadata_unavailable: ["locale", "missionType", "platform", "state", "attemptNumber", "metadataStatus"],
  publication_proof_review_started: ["locale", "missionType", "platform", "state", "timingBucket", "attemptNumber", "reviewNumber", "metadataStatus"],
  publication_proof_correction_requested: ["locale", "missionType", "platform", "state", "timingBucket", "attemptNumber", "reviewNumber", "checklistFailureCategories"],
  publication_proof_resubmitted: ["locale", "missionType", "platform", "state", "timingBucket", "attemptNumber", "urlCount", "evidenceCount", "lateness", "metadataStatus"],
  publication_proof_verified: ["locale", "missionType", "platform", "state", "timingBucket", "attemptNumber", "reviewNumber", "metadataStatus"],
  publication_proof_recovery_used: ["locale", "missionType", "platform", "state", "attemptNumber", "recoveryCategory"],
  mission_completion_review_viewed: ["missionId", "locale", "deviceCategory", "workflowState", "contractSource", "errorCategory", "hasPoints", "hasCash", "hasXp"],
  mission_completion_approved: ["missionId", "locale", "deviceCategory", "workflowState", "contractSource", "errorCategory", "hasPoints", "hasCash", "hasXp"],
  mission_reward_pending_viewed: ["missionId", "locale", "deviceCategory", "workflowState", "contractSource", "errorCategory", "hasPoints", "hasCash", "hasXp"],
  mission_reward_pending_cancelled: ["missionId", "locale", "deviceCategory", "workflowState", "contractSource", "errorCategory", "hasPoints", "hasCash", "hasXp"],
  mission_reward_support_selected: ["missionId", "locale", "deviceCategory", "workflowState", "contractSource", "errorCategory", "hasPoints", "hasCash", "hasXp"],
  reward_handoff_queue_viewed: ["missionId", "locale", "deviceCategory", "workflowState", "contractSource", "errorCategory", "hasPoints", "hasCash", "hasXp", "dueFilter", "componentFilter", "statusFilter"],
  reward_handoff_queue_filtered: ["missionId", "locale", "deviceCategory", "workflowState", "contractSource", "errorCategory", "hasPoints", "hasCash", "hasXp", "dueFilter", "componentFilter", "statusFilter"],
} as const satisfies Record<keyof ActivationEventMap, readonly string[]>;

const PUBLICATION_ANALYTICS_EVENT_NAMES = [
  "publication_instructions_viewed",
  "publication_proof_form_started",
  "publication_proof_submitted",
  "publication_proof_metadata_unavailable",
  "publication_proof_review_started",
  "publication_proof_correction_requested",
  "publication_proof_resubmitted",
  "publication_proof_verified",
  "publication_proof_recovery_used",
] as const satisfies readonly (keyof ActivationEventMap)[];

type PublicationAnalyticsEventName = (typeof PUBLICATION_ANALYTICS_EVENT_NAMES)[number];

const PUBLICATION_ANALYTICS_EVENT_SET: ReadonlySet<keyof ActivationEventMap> =
  new Set(PUBLICATION_ANALYTICS_EVENT_NAMES);

const REWARD_HANDOFF_ANALYTICS_EVENT_NAMES = [
  "mission_completion_review_viewed",
  "mission_completion_approved",
  "mission_reward_pending_viewed",
  "mission_reward_pending_cancelled",
  "mission_reward_support_selected",
  "reward_handoff_queue_viewed",
  "reward_handoff_queue_filtered",
] as const satisfies readonly RewardHandoffAnalyticsEvent[];

const REWARD_HANDOFF_ANALYTICS_EVENT_SET: ReadonlySet<keyof ActivationEventMap> =
  new Set(REWARD_HANDOFF_ANALYTICS_EVENT_NAMES);

function isAllowedString(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === "string" && allowed.includes(value);
}

function isPositiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isSafePublicationProperty(key: string, value: unknown): boolean {
  switch (key) {
    case "locale": return isAllowedString(value, PUBLICATION_ANALYTICS_LOCALES);
    case "missionType": return isAllowedString(value, PUBLICATION_MISSION_TYPES);
    case "platform": return isAllowedString(value, PUBLICATION_PLATFORMS);
    case "state": return isAllowedString(value, PUBLICATION_STATES);
    case "timingBucket": return isAllowedString(value, PUBLICATION_TIMING_BUCKETS);
    case "attemptNumber":
    case "reviewNumber": return isPositiveInteger(value);
    case "urlCount":
    case "evidenceCount": return isNonNegativeInteger(value);
    case "lateness": return isAllowedString(value, PUBLICATION_LATENESS);
    case "metadataStatus": return isAllowedString(value, PUBLICATION_METADATA_STATUSES);
    case "checklistFailureCategories":
      return Array.isArray(value)
        && value.length > 0
        && value.every((category) =>
          isAllowedString(category, PUBLICATION_CHECKLIST_FAILURE_CATEGORIES));
    case "recoveryCategory": return isAllowedString(value, PUBLICATION_RECOVERY_CATEGORIES);
    default: return false;
  }
}

function isPublicationAnalyticsEvent(
  name: keyof ActivationEventMap,
): name is PublicationAnalyticsEventName {
  return PUBLICATION_ANALYTICS_EVENT_SET.has(name);
}

function isRewardHandoffAnalyticsEvent(
  name: keyof ActivationEventMap,
): name is RewardHandoffAnalyticsEvent {
  return REWARD_HANDOFF_ANALYTICS_EVENT_SET.has(name);
}

function isSafeRewardHandoffProperty(key: string, value: unknown): boolean {
  switch (key) {
    case "missionId":
      return typeof value === "string"
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    case "locale": return isAllowedString(value, PUBLICATION_ANALYTICS_LOCALES);
    case "deviceCategory": return isAllowedString(value, ["mobile", "tablet", "desktop"]);
    case "workflowState": return isAllowedString(value, REWARD_HANDOFF_WORKFLOW_STATES);
    case "contractSource": return isAllowedString(value, REWARD_HANDOFF_CONTRACT_SOURCES);
    case "errorCategory": return isAllowedString(value, REWARD_HANDOFF_ERROR_CATEGORIES);
    case "hasPoints":
    case "hasCash":
    case "hasXp": return typeof value === "boolean";
    case "dueFilter": return isAllowedString(value, REWARD_HANDOFF_DUE_FILTERS);
    case "componentFilter": return isAllowedString(value, REWARD_HANDOFF_COMPONENT_FILTERS);
    case "statusFilter": return isAllowedString(value, REWARD_HANDOFF_STATUS_FILTERS);
    default: return false;
  }
}

type ActivationAnalyticsEvent = {
  name: keyof ActivationEventMap;
  properties: object;
};

type ActivationAnalyticsSink = (event: ActivationAnalyticsEvent) => boolean | void;

/**
 * Browser-only first-party analytics transport contract. Consumers may listen
 * for this event without the application inventing an external endpoint.
 * The event detail has already passed the per-event privacy allowlist.
 * A consumer acknowledges durable acceptance by calling preventDefault().
 */
export const ACTIVATION_ANALYTICS_EVENT = "adfocate:activation-analytics";

let activationAnalyticsSink: ActivationAnalyticsSink | null = null;
let activationAnalyticsSinkVersion = 0;
const activationAnalyticsSinkListeners = new Set<() => void>();

export function trackActivationEvent<K extends keyof ActivationEventMap>(
  name: K,
  properties: ActivationEventMap[K],
): boolean {
  const allowed = new Set<string>(ACTIVATION_PROPERTY_KEYS[name]);
  const safeProperties = Object.fromEntries(
    Object.entries(properties).filter(([key, value]) =>
      allowed.has(key)
      && (!isPublicationAnalyticsEvent(name) || isSafePublicationProperty(key, value))
      && (!isRewardHandoffAnalyticsEvent(name) || isSafeRewardHandoffProperty(key, value))),
  );
  if (!activationAnalyticsSink) return false;
  try {
    return activationAnalyticsSink({ name, properties: safeProperties }) !== false;
  } catch {
    return false;
  }
}

export function setActivationAnalyticsSink(
  sink: ActivationAnalyticsSink | null,
): void {
  if (activationAnalyticsSink === sink) return;
  activationAnalyticsSink = sink;
  activationAnalyticsSinkVersion += 1;
  for (const listener of activationAnalyticsSinkListeners) listener();
}

export function initializeActivationAnalytics(): void {
  if (typeof window === "undefined") return;
  setActivationAnalyticsSink((event) => {
    const browserEvent = new CustomEvent(ACTIVATION_ANALYTICS_EVENT, {
      detail: event,
      cancelable: true,
    });
    window.dispatchEvent(browserEvent);
    return browserEvent.defaultPrevented;
  });
}

export function subscribeActivationAnalyticsSink(listener: () => void): () => void {
  activationAnalyticsSinkListeners.add(listener);
  return () => activationAnalyticsSinkListeners.delete(listener);
}

export function getActivationAnalyticsSinkVersion(): number {
  return activationAnalyticsSinkVersion;
}
export function getDeviceCategory(width?: number): DeviceCategory {
  const resolvedWidth =
    width ?? (typeof window === "undefined" ? 1024 : window.innerWidth);

  if (resolvedWidth < 768) {
    return "mobile";
  }
  if (resolvedWidth < 1024) {
    return "tablet";
  }
  return "desktop";
}
