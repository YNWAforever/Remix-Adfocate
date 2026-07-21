import { describe, expect, it } from "vitest";

import { calculateOnTimeApprovalMetric } from "./metrics";

describe("calculateOnTimeApprovalMetric", () => {
  it("counts a required item approved by its deadline", () => {
    expect(calculateOnTimeApprovalMetric([
      { required: true, deadline: "2026-07-17T00:00:00Z", approvedAt: "2026-07-16T23:00:00Z" },
    ])).toEqual({ numerator: 1, denominator: 1, rate: 1 });
  });

  it("excludes optional and no-deadline items from the denominator", () => {
    expect(calculateOnTimeApprovalMetric([
      { required: false, deadline: "2026-07-17T00:00:00Z", approvedAt: "2026-07-16T23:00:00Z" },
      { required: true, deadline: null, approvedAt: "2026-07-16T23:00:00Z" },
      { required: true, deadline: "2026-07-17T00:00:00Z", approvedAt: "2026-07-17T01:00:00Z" },
    ])).toEqual({ numerator: 0, denominator: 1, rate: 0 });
  });

  it("returns a zero rate when no rows qualify", () => {
    expect(calculateOnTimeApprovalMetric([])).toEqual({
      numerator: 0,
      denominator: 0,
      rate: 0,
    });
  });
});
