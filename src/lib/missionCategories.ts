// src/lib/missionCategories.ts
// Canonical mission-category list (zh-HK). Single source for BOTH the operator authoring
// dropdown (MissionEditor) and the creator mission filter, so authored values always match
// what creators can filter by and what the matcher's category-fit compares (missionMatch.ts).
export const MISSION_CATEGORIES = ["社交", "美容", "餐飲", "生活", "寵物", "旅遊"] as const;
export type MissionCategory = (typeof MISSION_CATEGORIES)[number];

// UI-only sentinel for "no filter" — never stored on a mission.
export const ALL_CATEGORY = "全部";

// Read/filter aliases only. Never rewrite an existing mission's stored category.
const LEGACY_VALUES: Record<MissionCategory, readonly string[]> = {
  社交: ["social"], 美容: ["beauty", "美妝"], 餐飲: ["food"],
  生活: ["life", "lifestyle"], 寵物: ["pet", "pets"], 旅遊: ["travel"],
};
const aliasVariants = (value: string) => [value, value.toUpperCase(), value[0].toUpperCase() + value.slice(1)];
export function missionCategoryValues(category: string): string[] {
  const canonical = canonicalMissionCategory(category);
  const aliases = LEGACY_VALUES[canonical as MissionCategory];
  return aliases ? [...new Set([canonical, ...aliases.flatMap(aliasVariants)])] : [category];
}
export function canonicalMissionCategory(value: string): string {
  return MISSION_CATEGORIES.find((category) => category === value
    || LEGACY_VALUES[category].some((alias) => aliasVariants(alias).includes(value))) ?? value;
}
export function missionCategoryOptions(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set<string>([...MISSION_CATEGORIES, ...values.filter((value): value is string => Boolean(value)).map(canonicalMissionCategory)])];
}
