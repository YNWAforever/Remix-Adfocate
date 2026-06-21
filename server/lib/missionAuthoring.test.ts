// server/lib/missionAuthoring.test.ts
import { describe, it, expect } from "vitest";
import { isValidSlug, suggestSlug, MISSION_LEVELS, MISSION_TYPES } from "./missionAuthoring.js";

describe("isValidSlug", () => {
  it("accepts lowercase alnum + hyphens", () => {
    expect(isValidSlug("summer-koc-2026")).toBe(true);
    expect(isValidSlug("a1")).toBe(true);
  });
  it("rejects empty, uppercase, leading hyphen, spaces, zh chars", () => {
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("Summer")).toBe(false);
    expect(isValidSlug("-x")).toBe(false);
    expect(isValidSlug("a b")).toBe(false);
    expect(isValidSlug("夏日")).toBe(false);
  });
});

describe("suggestSlug", () => {
  it("kebabs the mission type", () => {
    expect(suggestSlug("koc_trial")).toBe("koc-trial");
    expect(suggestSlug("performance_cpm")).toBe("performance-cpm");
  });
});

describe("canonical sets", () => {
  it("levels are the seven-level L0..L6 set (mirrors src/lib/levels.ts)", () => {
    expect(MISSION_LEVELS).toEqual(["L0", "L1", "L2", "L3", "L4", "L5", "L6"]);
  });
  it("mission types match the 0001 CHECK", () => {
    expect(MISSION_TYPES).toEqual([
      "koc_trial", "ugc", "clipping", "affiliate", "performance_cpm", "live_commerce", "brand_ambassador",
    ]);
  });
});
