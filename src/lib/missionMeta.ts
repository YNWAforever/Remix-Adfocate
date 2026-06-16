import { levelIndex } from "./levels";

export const MISSION_TYPE_LABEL: Record<string, string> = {
  koc_trial: "體驗開箱",
  ugc: "原創內容",
  clipping: "短片剪輯",
  affiliate: "分潤帶貨",
  performance_cpm: "流量任務",
  live_commerce: "直播帶貨",
  brand_ambassador: "品牌大使",
};
export function missionTypeLabel(type: string): string {
  return MISSION_TYPE_LABEL[type] ?? type;
}

export const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  xiaohongshu: "小紅書",
  youtube: "YouTube",
  threads: "Threads",
  facebook: "Facebook",
};
export function platformLabel(p: string): string {
  return PLATFORM_LABEL[p] ?? p.charAt(0).toUpperCase() + p.slice(1);
}

export type EffortLevel = "low" | "medium" | "high";
const EFFORT_LABEL: Record<EffortLevel, string> = { low: "低", medium: "中", high: "高" };
export function effortLabel(effort: EffortLevel | null | undefined): string | null {
  return effort ? EFFORT_LABEL[effort] : null;
}

export function spotsLeft(quota: number, filled: number): number {
  return Math.max(0, quota - filled);
}

export type Eligibility = { qualified: boolean; label: string };
/** Display-only. The real gate is server-side (join/apply return `level_locked` 409). */
export function eligibility(
  requiredLevel: string | undefined | null,
  creatorLevel: string | undefined | null,
): Eligibility {
  const need = levelIndex(requiredLevel);
  const have = levelIndex(creatorLevel);
  const reqId = requiredLevel ?? "L0";
  if (have >= need) {
    return { qualified: true, label: need === 0 ? "所有等級可參加" : `需 ${reqId} · 你符合` };
  }
  return { qualified: false, label: `需 ${reqId} · 你係 ${creatorLevel ?? "L0"}` };
}
