export type LevelDef = {
  id: string;
  label: string;
  emoji: string;
  xpRequired: number;
  /** i18n key for what unlocks at this level (shown as a hint when it's the *next* level). Empty string for L0. */
  unlockKey: string;
};

export const LEVELS: LevelDef[] = [
  { id: "L0", label: "Newcomer", emoji: "🌱", xpRequired: 0, unlockKey: "" },
  { id: "L1", label: "Explorer", emoji: "🌟", xpRequired: 500, unlockKey: "app.levelUnlock.l1" },
  { id: "L2", label: "Creator", emoji: "🎨", xpRequired: 2000, unlockKey: "app.levelUnlock.l2" },
  { id: "L3", label: "Amplifier", emoji: "📢", xpRequired: 6000, unlockKey: "app.levelUnlock.l3" },
  { id: "L4", label: "Micro-Influencer", emoji: "🚀", xpRequired: 15000, unlockKey: "app.levelUnlock.l4" },
  { id: "L5", label: "Pro Creator", emoji: "💎", xpRequired: 40000, unlockKey: "app.levelUnlock.l5" },
  { id: "L6", label: "Elite", emoji: "👑", xpRequired: 100000, unlockKey: "app.levelUnlock.l6" },
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
