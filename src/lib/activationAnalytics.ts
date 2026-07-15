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
};

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
  activationAnalyticsSink?.({ name, properties });
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
