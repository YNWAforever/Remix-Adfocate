import { describe, it, expect } from "vitest";
import { missionTypeLabelKey, platformLabelKey, effortLabelKey, spotsLeft, eligibility } from "./missionMeta";

describe("missionMeta", () => {
  it("maps mission types to dict keys, falling back to the raw value", () => {
    expect(missionTypeLabelKey("ugc")).toBe("app.missionType.ugc");
    expect(missionTypeLabelKey("koc_trial")).toBe("app.missionType.kocTrial");
    expect(missionTypeLabelKey("mystery_type")).toBe("mystery_type");
  });

  it("maps platforms to dict keys or brand names", () => {
    expect(platformLabelKey("tiktok")).toBe("TikTok");
    expect(platformLabelKey("xiaohongshu")).toBe("app.platform.xiaohongshu");
    expect(platformLabelKey("bilibili")).toBe("Bilibili");
  });

  it("labels effort as dict keys, null for none", () => {
    expect(effortLabelKey("high")).toBe("app.effort.high");
    expect(effortLabelKey(null)).toBeNull();
    expect(effortLabelKey(undefined)).toBeNull();
  });

  it("computes spots left, clamped at 0", () => {
    expect(spotsLeft(10, 7)).toBe(3);
    expect(spotsLeft(5, 9)).toBe(0);
  });

  it("computes eligibility against the creator level", () => {
    expect(eligibility("L0", "L0").qualified).toBe(true);
    expect(eligibility("L1", "L3").qualified).toBe(true);
    // trusted creator at L1 trying L2 mission → XP not enough
    const locked = eligibility("L2", "L1", true);
    expect(locked.qualified).toBe(false);
    expect(locked.labelKey).toBe("app.eligibility.notQualified");
    expect(locked.params).toEqual({ req: "L2", level: "L1" });
  });

  it("returns verifyToUnlock when untrusted creator at effective L1 needs L2+", () => {
    // effective_level=L1, isTrusted=false, need=L2 → verify path
    const e = eligibility("L2", "L1", false);
    expect(e.qualified).toBe(false);
    expect(e.labelKey).toBe("app.eligibility.verifyToUnlock");
    expect(e.params).toEqual({ req: "L2" });
  });

  it("qualifies when trusted creator meets the requirement", () => {
    expect(eligibility("L2", "L2", true).qualified).toBe(true);
  });

  it("does NOT return verifyToUnlock when effective level is still L0 (XP not there yet)", () => {
    // effective=L0, untrusted — they need more XP first, not just verification
    const e = eligibility("L2", "L0", false);
    expect(e.qualified).toBe(false);
    expect(e.labelKey).toBe("app.eligibility.notQualified");
  });
});
