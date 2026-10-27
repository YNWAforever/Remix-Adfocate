import { describe, expect, it } from "vitest";
import { MISSION_CATEGORIES } from "./missionCategories";
import { categoryLabelKey } from "./labels";

describe("D09 mission category contract", () => {
  it("shares pet and travel with authoring and discovery", () => {
    expect(MISSION_CATEGORIES).toContain("寵物"); expect(MISSION_CATEGORIES).toContain("旅遊");
  });
  it.each([["pets","app.category.pet"],["travel","app.category.travel"],["美妝","app.category.beauty"]])("maps historical %s without overwriting its stored value", (value,key) => {
    expect(categoryLabelKey(value)).toBe(key);
  });
  it("preserves an unknown category verbatim", () => {
    expect(categoryLabelKey("未分類的既有中文值")).toBe("未分類的既有中文值");
  });
});
