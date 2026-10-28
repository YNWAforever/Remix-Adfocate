/**
 * Pure mapping helpers: zh category/platform value → dict key.
 * No hooks. Call t(categoryLabelKey(value)) in components.
 */

import { canonicalMissionCategory } from "./missionCategories";

const CATEGORY_KEY_MAP: Record<string, string> = {
  "全部": "app.category.all",
  "社交": "app.category.social",
  "美容": "app.category.beauty",
  "餐飲": "app.category.food",
  "生活": "app.category.life",
  "娛樂": "app.category.entertainment",
  "電子": "app.category.electronics",
  "健康": "app.category.health",
  "時尚": "app.category.fashion",
  "科技": "app.category.tech",
  "旅遊": "app.category.travel",
  "媽媽": "app.category.parenting",
  "寵物": "app.category.pet",
};

/** Maps a zh category value to its dict key. Falls back to the value itself. */
export function categoryLabelKey(value: string): string {
  return CATEGORY_KEY_MAP[canonicalMissionCategory(value)] ?? value;
}

const PLATFORM_DISPLAY_KEY_MAP: Record<string, string> = {
  "小紅書": "app.platform.xiaohongshu",
};

/** Maps a platform display value (as stored in PLATFORMS arrays) to its dict key.
 *  Brand names like Instagram/TikTok/YouTube are English-identical → returns the value as-is. */
export function platformDisplayLabelKey(value: string): string {
  return PLATFORM_DISPLAY_KEY_MAP[value] ?? value;
}
