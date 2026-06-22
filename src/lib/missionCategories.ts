// src/lib/missionCategories.ts
// Canonical mission-category list (zh-HK). Single source for BOTH the operator authoring
// dropdown (MissionEditor) and the creator mission filter, so authored values always match
// what creators can filter by and what the matcher's category-fit compares (missionMatch.ts).
export const MISSION_CATEGORIES = ["社交", "美容", "餐飲", "生活"] as const;
export type MissionCategory = (typeof MISSION_CATEGORIES)[number];

// UI-only sentinel for "no filter" — never stored on a mission.
export const ALL_CATEGORY = "全部";
