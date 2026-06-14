export type ScoreKey = "influence" | "content" | "reliability" | "brandSafety";

/** Display metadata for the four passport scores. `weight` is the master-spec score weight
 *  (Influence 40 / Content 30 / Reliability 20 / Brand Safety 10); `accent` is the ring
 *  stroke colour (Content + Brand Safety always render locked, so their accent is unused). */
export const SCORE_META: Record<ScoreKey, { label: string; weight: number; accent: string }> = {
  influence: { label: "影響力", weight: 40, accent: "var(--color-acid)" },
  content: { label: "內容", weight: 30, accent: "var(--color-ink)" },
  reliability: { label: "可靠度", weight: 20, accent: "var(--color-magenta)" },
  brandSafety: { label: "品牌安全", weight: 10, accent: "var(--color-ink)" },
};

/** Render order for the 2×2 grid (highest weight first). */
export const SCORE_ORDER: ScoreKey[] = ["influence", "content", "reliability", "brandSafety"];

/** Render metadata for the five data-derived badge ids the backend can return. */
export const BADGES: Record<string, { emoji: string; label: string; desc: string }> = {
  level_l1: { emoji: "🌟", label: "升級者", desc: "達到 L1 等級" },
  first_approval: { emoji: "✅", label: "首單達成", desc: "首個任務獲批核" },
  reliable: { emoji: "🛡️", label: "可靠創作者", desc: "3+ 個已結算任務，可靠度 ≥ 80" },
  social_linked: { emoji: "🔗", label: "已連結社交", desc: "已連結社交帳號" },
  referrer: { emoji: "🤝", label: "推薦大使", desc: "成功推薦朋友加入" },
};
