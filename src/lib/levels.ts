export type LevelDef = {
  id: string;
  label: string;
  emoji: string;
  xpRequired: number;
  /** What unlocks at this level (shown as a hint when it's the *next* level). Empty for L0. */
  unlock: string;
};

export const LEVELS: LevelDef[] = [
  { id: "L0", label: "Newcomer", emoji: "🌱", xpRequired: 0, unlock: "" },
  { id: "L1", label: "Explorer", emoji: "🌟", xpRequired: 500, unlock: "聯盟連結、評測任務、積分兌換" },
  { id: "L2", label: "Creator", emoji: "🎨", xpRequired: 2000, unlock: "UGC 有薪工作、CPM 軌道、工作室" },
  { id: "L3", label: "Amplifier", emoji: "📢", xpRequired: 6000, unlock: "活動費用、完整 Copilot 工具" },
  { id: "L4", label: "Micro-Influencer", emoji: "🚀", xpRequired: 15000, unlock: "直播帶貨、優先任務配對" },
  { id: "L5", label: "Pro Creator", emoji: "💎", xpRequired: 40000, unlock: "品牌大使、Finance Readiness" },
  { id: "L6", label: "Elite", emoji: "👑", xpRequired: 100000, unlock: "客製品牌合作、創作者資本" },
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
