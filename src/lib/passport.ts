export type ScoreKey = "influence" | "content" | "reliability" | "brandSafety";

/** Display metadata for the four passport scores. `weight` is the master-spec score weight
 *  (Influence 40 / Content 30 / Reliability 20 / Brand Safety 10); `accent` is the ring
 *  stroke colour; `noteKey` is an optional i18n key for a provisional caveat shown below the ring. */
export const SCORE_META: Record<ScoreKey, { labelKey: string; weight: number; accent: string; noteKey?: string }> = {
  influence: { labelKey: "app.score.influence", weight: 40, accent: "var(--color-acid)", noteKey: "app.score.influenceNote" },
  content: { labelKey: "app.score.content", weight: 30, accent: "var(--color-ink)" },
  reliability: { labelKey: "app.score.reliability", weight: 20, accent: "var(--color-magenta)" },
  brandSafety: { labelKey: "app.score.brandSafety", weight: 10, accent: "var(--color-ink)", noteKey: "app.score.brandSafetyNote" },
};

/** Render order for the 2×2 grid (highest weight first). */
export const SCORE_ORDER: ScoreKey[] = ["influence", "content", "reliability", "brandSafety"];

/** Render metadata for the five data-derived badge ids the backend can return. */
export const BADGES: Record<string, { emoji: string; labelKey: string; descKey: string }> = {
  level_l1: { emoji: "🌟", labelKey: "app.badge.level_l1", descKey: "app.badge.level_l1Desc" },
  first_approval: { emoji: "✅", labelKey: "app.badge.first_approval", descKey: "app.badge.first_approvalDesc" },
  reliable: { emoji: "🛡️", labelKey: "app.badge.reliable", descKey: "app.badge.reliableDesc" },
  social_linked: { emoji: "🔗", labelKey: "app.badge.social_linked", descKey: "app.badge.social_linkedDesc" },
  referrer: { emoji: "🤝", labelKey: "app.badge.referrer", descKey: "app.badge.referrerDesc" },
  perfect_rating: { emoji: "💯", labelKey: "app.badge.perfect_rating", descKey: "app.badge.perfect_ratingDesc" },
  content_pro: { emoji: "🎯", labelKey: "app.badge.content_pro", descKey: "app.badge.content_proDesc" },
  spotless: { emoji: "💎", labelKey: "app.badge.spotless", descKey: "app.badge.spotlessDesc" },
};
