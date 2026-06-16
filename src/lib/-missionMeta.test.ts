import { describe, it, expect } from "vitest";
import { missionTypeLabel, platformLabel, effortLabel, spotsLeft, eligibility } from "./missionMeta";

describe("missionMeta", () => {
  it("maps mission types, falling back to the raw value", () => {
    expect(missionTypeLabel("ugc")).toBe("原創內容");
    expect(missionTypeLabel("koc_trial")).toBe("體驗開箱");
    expect(missionTypeLabel("mystery_type")).toBe("mystery_type");
  });

  it("maps platforms, capitalising unknowns", () => {
    expect(platformLabel("tiktok")).toBe("TikTok");
    expect(platformLabel("xiaohongshu")).toBe("小紅書");
    expect(platformLabel("bilibili")).toBe("Bilibili");
  });

  it("labels effort, null for none", () => {
    expect(effortLabel("high")).toBe("高");
    expect(effortLabel(null)).toBeNull();
    expect(effortLabel(undefined)).toBeNull();
  });

  it("computes spots left, clamped at 0", () => {
    expect(spotsLeft(10, 7)).toBe(3);
    expect(spotsLeft(5, 9)).toBe(0);
  });

  it("computes eligibility against the creator level", () => {
    expect(eligibility("L0", "L0").qualified).toBe(true);
    expect(eligibility("L1", "L3").qualified).toBe(true);
    const locked = eligibility("L2", "L1");
    expect(locked.qualified).toBe(false);
    expect(locked.label).toBe("需 L2 · 你係 L1");
  });
});
