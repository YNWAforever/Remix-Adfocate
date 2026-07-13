import { describe, expect, it } from "vitest";

import {
  formatCreatorCurrency,
  formatCreatorDate,
  formatMissionReward,
} from "./creatorFormatting";

describe("creator formatting", () => {
  it("formats HKD in both creator locales", () => {
    expect(formatCreatorCurrency(1234.5, "en")).toBe("HK$1,234.50");
    expect(formatCreatorCurrency(1234.5, "zh")).toBe("HK$1,234.50");
  });

  it("formats points-plus-cash mission rewards in both creator locales", () => {
    expect(formatMissionReward({ points: 1200, cash: 345.5 }, "en")).toBe(
      "1,200 points + HK$345.50",
    );
    expect(formatMissionReward({ points: 1200, cash: 345.5 }, "zh")).toBe(
      "1,200 積分 + HK$345.50",
    );
  });

  it("formats valid dates in both creator locales", () => {
    const value = new Date("2026-07-13T00:00:00.000Z");

    expect(formatCreatorDate(value, "en")).toBe("13 Jul 2026");
    expect(formatCreatorDate(value, "zh")).toBe("2026年7月13日");
  });

  it.each([null, undefined, "not-a-date"])(
    "returns null for an absent or invalid date (%s)",
    (value) => {
      expect(formatCreatorDate(value, "en")).toBeNull();
    },
  );
});
