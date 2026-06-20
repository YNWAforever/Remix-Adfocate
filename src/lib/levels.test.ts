import { describe, it, expect } from "vitest";
import { LEVELS, levelIndex, progressToNext } from "./levels";

describe("levels", () => {
  it("has 7 levels L0..L6 with ascending thresholds", () => {
    expect(LEVELS.map((l) => l.id)).toEqual(["L0", "L1", "L2", "L3", "L4", "L5", "L6"]);
    expect(LEVELS[1].xpRequired).toBe(500);
    expect(LEVELS[6].xpRequired).toBe(100000);
  });

  it("levelIndex maps ids to 0..6 and unknown → 0", () => {
    expect(levelIndex("L0")).toBe(0);
    expect(levelIndex("L2")).toBe(2);
    expect(levelIndex("L6")).toBe(6);
    expect(levelIndex(undefined)).toBe(0);
    expect(levelIndex("nope")).toBe(0);
  });

  it("progressToNext computes the band, remaining xp and pct", () => {
    const p0 = progressToNext(0);
    expect(p0.current.id).toBe("L0");
    expect(p0.next?.id).toBe("L1");
    expect(p0.xpIntoCurrent).toBe(0);
    expect(p0.xpForNext).toBe(500);
    expect(p0.pct).toBe(0);

    const p250 = progressToNext(250);
    expect(p250.current.id).toBe("L0");
    expect(p250.pct).toBe(50);

    const p500 = progressToNext(500);
    expect(p500.current.id).toBe("L1");
    expect(p500.next?.id).toBe("L2");
    expect(p500.xpIntoCurrent).toBe(0);
    expect(p500.xpForNext).toBe(1500);

    const pMax = progressToNext(100000);
    expect(pMax.current.id).toBe("L6");
    expect(pMax.next).toBeNull();
    expect(pMax.pct).toBe(100);
  });
});

describe("canonical LEVELS", () => {
  it("uses marketing names via i18n keys and engine XP thresholds", () => {
    expect(LEVELS.map((l) => l.id)).toEqual(["L0", "L1", "L2", "L3", "L4", "L5", "L6"]);
    expect(LEVELS.map((l) => l.xpRequired)).toEqual([0, 500, 2000, 6000, 15000, 40000, 100000]);
    expect(LEVELS.map((l) => l.labelKey)).toEqual([
      "app.level.l0", "app.level.l1", "app.level.l2", "app.level.l3",
      "app.level.l4", "app.level.l5", "app.level.l6",
    ]);
    // Marketing narrative fields are present for the _site pages.
    expect(LEVELS[2].emoji).toBe("💬");
    expect(LEVELS[2].goal).toBe("Prove reliability");
  });
});
