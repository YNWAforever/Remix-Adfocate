import { describe, it, expect } from "vitest";
import { SCORE_META, SCORE_ORDER, BADGES, type ScoreKey } from "./passport";

describe("passport metadata", () => {
  it("weights sum to 100 (master-spec weights)", () => {
    const sum = (Object.keys(SCORE_META) as ScoreKey[]).reduce((s, k) => s + SCORE_META[k].weight, 0);
    expect(sum).toBe(100);
  });
  it("orders all four scores and every key has metadata", () => {
    expect(SCORE_ORDER).toHaveLength(4);
    for (const k of SCORE_ORDER) expect(SCORE_META[k]).toBeDefined();
  });
  it("defines the five data-derived badges", () => {
    for (const id of ["level_l1", "first_approval", "reliable", "social_linked", "referrer"]) {
      expect(BADGES[id]).toBeDefined();
    }
  });
});
