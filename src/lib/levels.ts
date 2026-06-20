export type LevelDef = {
  id: string;
  /** i18n key for the bilingual level name, e.g. "app.level.l2". Render with t(). */
  labelKey: string;
  emoji: string;
  /** Engine XP threshold (canonical — drives the 0008 leveling trigger). */
  xpRequired: number;
  /** i18n key for what unlocks at this level (shown as a hint for the *next* level). "" for L0. */
  unlockKey: string;
  /** Marketing one-line goal for this level (English literal; _site pages only). */
  goal: string;
  /** Marketing bullets of what becomes available at this level (English literals; _site pages only). */
  unlocks: string[];
  /** Marketing income-range example for this level (English literal; _site pages only). */
  incomeExample: string;
  /** Marketing colour swatch token. */
  color: string;
};

export const LEVELS: LevelDef[] = [
  { id: "L0", labelKey: "app.level.l0", emoji: "🛒", xpRequired: 0, unlockKey: "",
    goal: "Discover missions and rewards", unlocks: ["Product trials", "Points", "Coupons"], incomeExample: "Points & coupons", color: "cream" },
  { id: "L1", labelKey: "app.level.l1", emoji: "🌱", xpRequired: 500, unlockKey: "app.levelUnlock.l1",
    goal: "Complete first missions", unlocks: ["Review tasks", "Simple submissions", "Starter badge"], incomeExample: "Points, product samples", color: "pink" },
  { id: "L2", labelKey: "app.level.l2", emoji: "💬", xpRequired: 2000, unlockKey: "app.levelUnlock.l2",
    goal: "Prove reliability", unlocks: ["Repeat missions", "Better rewards", "Badges"], incomeExample: "HK$200–800 per mission", color: "yellow" },
  { id: "L3", labelKey: "app.level.l3", emoji: "📱", xpRequired: 6000, unlockKey: "app.levelUnlock.l3",
    goal: "Build niche and consistency", unlocks: ["Profile insights", "Growth resources", "Affiliate eligibility"], incomeExample: "HK$800–2,500 per campaign", color: "mint" },
  { id: "L4", labelKey: "app.level.l4", emoji: "⭐", xpRequired: 15000, unlockKey: "app.levelUnlock.l4",
    goal: "Earn from campaigns", unlocks: ["Paid briefs", "Affiliate offers", "Content jobs"], incomeExample: "HK$2,500–8,000 per campaign", color: "blue" },
  { id: "L5", labelKey: "app.level.l5", emoji: "🌟", xpRequired: 40000, unlockKey: "app.levelUnlock.l5",
    goal: "Build recurring income", unlocks: ["Retainers", "Live commerce", "Brand deals"], incomeExample: "HK$8,000–25,000/month", color: "lilac" },
  { id: "L6", labelKey: "app.level.l6", emoji: "🚀", xpRequired: 100000, unlockKey: "app.levelUnlock.l6",
    goal: "Build a creator business", unlocks: ["Product drops", "Capital readiness", "Premium support"], incomeExample: "HK$25,000+/month", color: "gold" },
];

/** Index 0..6 of a level id; unknown / undefined → 0. */
export function levelIndex(id: string | undefined | null): number {
  const i = LEVELS.findIndex((l) => l.id === id);
  return i < 0 ? 0 : i;
}

export type Progress = {
  current: LevelDef;
  next: LevelDef | null;
  /** XP earned into the current band. */
  xpIntoCurrent: number;
  /** Width of the current band (next.xpRequired - current.xpRequired); null at L6. */
  xpForNext: number | null;
  /** 0..100 progress through the current band; 100 at L6. */
  pct: number;
};

/** Total for every xp >= 0 (and clamps negatives). Never throws. */
export function progressToNext(xp: number): Progress {
  const safeXp = Math.max(0, xp ?? 0);
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (safeXp >= LEVELS[i].xpRequired) idx = i;
  }
  const current = LEVELS[idx];
  const next = idx + 1 < LEVELS.length ? LEVELS[idx + 1] : null;
  if (!next) {
    return { current, next: null, xpIntoCurrent: safeXp - current.xpRequired, xpForNext: null, pct: 100 };
  }
  const span = next.xpRequired - current.xpRequired;
  const into = safeXp - current.xpRequired;
  const pct = Math.max(0, Math.min(100, Math.round((into / span) * 100)));
  return { current, next, xpIntoCurrent: into, xpForNext: span, pct };
}
