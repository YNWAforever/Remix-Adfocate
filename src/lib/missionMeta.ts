import { levelIndex } from "./levels";

// Maps hold translation keys, not display strings.
// Consumers call t(missionTypeLabelKey(type)) to get the translated label.

const MISSION_TYPE_KEY: Record<string, string> = {
  koc_trial: "app.missionType.kocTrial",
  ugc: "app.missionType.ugc",
  clipping: "app.missionType.clipping",
  affiliate: "app.missionType.affiliate",
  performance_cpm: "app.missionType.performanceCpm",
  live_commerce: "app.missionType.liveCommerce",
  brand_ambassador: "app.missionType.brandAmbassador",
};
/** Returns a dict key like "app.missionType.ugc". Pass to t() in a component. */
export function missionTypeLabelKey(type: string): string {
  return MISSION_TYPE_KEY[type] ?? type;
}

// Keep old name as alias returning a key (so test file can be updated).
/** @deprecated Use missionTypeLabelKey + t() in components */
export const missionTypeLabel = missionTypeLabelKey;

const PLATFORM_KEY: Record<string, string> = {
  xiaohongshu: "app.platform.xiaohongshu",
};
// Correct brand casing for English-identical platforms where naive title-casing
// would be wrong (Tiktok→TikTok, Youtube→YouTube).
const PLATFORM_BRAND: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
};
/** Returns a dict key for platforms that need translation (e.g. xiaohongshu → 小紅書/RED).
 *  Brand-name platforms return their proper brand casing (English-identical in both
 *  locales); unknown values fall back to title-case. */
export function platformLabelKey(p: string): string {
  return PLATFORM_KEY[p] ?? PLATFORM_BRAND[p.toLowerCase()] ?? p.charAt(0).toUpperCase() + p.slice(1);
}

// Keep old name as alias.
/** @deprecated Use platformLabelKey + t() in components; returns key or brand name */
export const platformLabel = platformLabelKey;

export type EffortLevel = "low" | "medium" | "high";
const EFFORT_KEY: Record<EffortLevel, string> = {
  low: "app.effort.low",
  medium: "app.effort.medium",
  high: "app.effort.high",
};
/** Returns a dict key like "app.effort.high". Pass to t() in a component. */
export function effortLabelKey(effort: EffortLevel | null | undefined): string | null {
  return effort ? EFFORT_KEY[effort] : null;
}

// Keep old name as alias.
/** @deprecated Use effortLabelKey + t() in components */
export const effortLabel = effortLabelKey;

export function spotsLeft(quota: number, filled: number): number {
  return Math.max(0, quota - filled);
}

export type Eligibility = {
  qualified: boolean;
  labelKey: string;
  params?: Record<string, string>;
  /** @deprecated use labelKey+params with t(); kept for test compatibility only */
  label?: string;
};

/** Display-only. The real gate is server-side (join/apply return `level_locked` 409).
 *  Returns a key + params for t() interpolation.
 *  Pass creatorLevel = the EFFECTIVE level (already capped at L1 for unverified creators).
 *  Pass isTrusted = me.data.is_trusted so the verify-to-unlock branch can fire. */
export function eligibility(
  requiredLevel: string | undefined | null,
  creatorLevel: string | undefined | null,
  isTrusted = true,
): Eligibility {
  const need = levelIndex(requiredLevel);
  const have = levelIndex(creatorLevel);
  const reqId = requiredLevel ?? "L0";
  if (have >= need) {
    if (need === 0) {
      return { qualified: true, labelKey: "app.eligibility.allLevels" };
    }
    return {
      qualified: true,
      labelKey: "app.eligibility.qualified",
      params: { req: reqId },
    };
  }
  // The creator's XP would qualify them (raw level ≥ need) but verification is the gate.
  // Specifically: effective level is capped at L1 for untrusted, so if need ≥ 2 and
  // the creator's effective level is at least L1, they need to verify — not earn more XP.
  if (need >= 2 && !isTrusted && have >= 1) {
    return {
      qualified: false,
      labelKey: "app.eligibility.verifyToUnlock",
      params: { req: reqId },
    };
  }
  return {
    qualified: false,
    labelKey: "app.eligibility.notQualified",
    params: { req: reqId, level: creatorLevel ?? "L0" },
  };
}
