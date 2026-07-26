export type DeviceCategory = "mobile" | "tablet" | "desktop";

export type ActivationAuthErrorCategory =
  | "expired"
  | "already_used"
  | "malformed"
  | "rate_limited"
  | "delivery_failed"
  | "unknown";

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
  publication_instructions_viewed: { locale: string; missionType: string; platform: string; state: string };
  publication_proof_form_started: {
    locale: string; missionType: string; platform: string; state: string;
    timingBucket: string; attemptNumber: number;
  };
  publication_proof_submitted: {
    locale: string; missionType: string; platform: string; state: string;
    timingBucket: string; attemptNumber: number; urlCount: number; evidenceCount: number;
    lateness: string; metadataStatus: "available" | "unavailable";
  };
  publication_proof_metadata_unavailable: {
    locale: string; missionType: string; platform: string; state: string;
    attemptNumber: number; metadataStatus: "unavailable";
  };
  publication_proof_review_started: {
    locale: string; missionType: string; platform: string; state: string;
    timingBucket: string; attemptNumber: number; reviewNumber: number;
    metadataStatus: "available" | "unavailable";
  };
  publication_proof_correction_requested: {
    locale: string; missionType: string; platform: string; state: string;
    timingBucket: string; attemptNumber: number; reviewNumber: number;
    checklistFailureCategories: string[];
  };
  publication_proof_resubmitted: {
    locale: string; missionType: string; platform: string; state: string;
    timingBucket: string; attemptNumber: number; urlCount: number; evidenceCount: number;
    lateness: string; metadataStatus: "available" | "unavailable";
  };
  publication_proof_verified: {
    locale: string; missionType: string; platform: string; state: string;
    timingBucket: string; attemptNumber: number; reviewNumber: number;
    metadataStatus: "available" | "unavailable";
  };
  publication_proof_recovery_used: {
    locale: string; missionType: string; platform: string; state: string;
    attemptNumber: number; recoveryCategory: string;
  };
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
} as const satisfies Record<keyof ActivationEventMap, readonly string[]>;

type ActivationAnalyticsSink = (event: {
  name: keyof ActivationEventMap;
  properties: object;
}) => void;

// Analytics is intentionally a no-op until the application configures a provider.
let activationAnalyticsSink: ActivationAnalyticsSink | null = null;

export function trackActivationEvent<K extends keyof ActivationEventMap>(
  name: K,
  properties: ActivationEventMap[K],
): void {
  const allowed = new Set<string>(ACTIVATION_PROPERTY_KEYS[name]);
  const safeProperties = Object.fromEntries(
    Object.entries(properties).filter(([key]) => allowed.has(key)),
  );
  activationAnalyticsSink?.({ name, properties: safeProperties });
}

export function setActivationAnalyticsSink(
  sink: ActivationAnalyticsSink | null,
): void {
  activationAnalyticsSink = sink;
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
