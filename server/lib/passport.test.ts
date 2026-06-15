import { describe, it, expect } from "vitest";
import { influenceFor, reliabilityFor, countTerminal, levelOrdinal, buildPassport, contentFor, brandSafetyFor } from "./passport";

describe("influenceFor", () => {
  it("is null when there are no handles", () => {
    expect(influenceFor(null)).toBeNull();
    expect(influenceFor([])).toBeNull();
  });
  it("maps total followers to the tier (step function)", () => {
    expect(influenceFor([{ followers: 0 }])).toBe(0);
    expect(influenceFor([{ followers: 999 }])).toBe(0);
    expect(influenceFor([{ followers: 1000 }])).toBe(20);
    expect(influenceFor([{ followers: 5000 }, { followers: 6000 }])).toBe(50); // 11k
    expect(influenceFor([{ followers: 100000 }])).toBe(80);
    expect(influenceFor([{ followers: 1000000 }])).toBe(100);
  });
  it("treats missing followers as 0", () => {
    expect(influenceFor([{ followers: null }, {}])).toBe(0);
  });
});

describe("reliabilityFor", () => {
  it("is null with no concluded submissions", () => {
    expect(reliabilityFor({ approved: 0, rejected: 0, expired: 0 })).toBeNull();
  });
  it("is the rounded approval rate over concluded", () => {
    expect(reliabilityFor({ approved: 2, rejected: 1, expired: 1 })).toBe(50);
    expect(reliabilityFor({ approved: 2, rejected: 1, expired: 0 })).toBe(67);
    expect(reliabilityFor({ approved: 3, rejected: 0, expired: 0 })).toBe(100);
  });
});

describe("countTerminal", () => {
  it("counts only terminal statuses (in-flight ignored)", () => {
    expect(
      countTerminal(["approved", "approved", "rejected", "expired", "joined", "submitted", "under_review"]),
    ).toEqual({ approved: 2, rejected: 1, expired: 1 });
  });
});

describe("levelOrdinal", () => {
  it("maps L0..L6 → 0..6 and junk → -1", () => {
    expect(levelOrdinal("L0")).toBe(0);
    expect(levelOrdinal("L6")).toBe(6);
    expect(levelOrdinal("nope")).toBe(-1);
    expect(levelOrdinal(null)).toBe(-1);
  });
});

describe("contentFor", () => {
  it("is null when nothing is rated", () => {
    expect(contentFor([])).toBeNull();
  });
  it("scales the average 1-5 rating to 0-100", () => {
    expect(contentFor([5])).toBe(100);
    expect(contentFor([1])).toBe(20);
    expect(contentFor([4, 5])).toBe(90); // round(20 * 4.5)
    expect(contentFor([3, 3, 3])).toBe(60);
  });
});

describe("brandSafetyFor", () => {
  it("is null when nothing is reviewed", () => {
    expect(brandSafetyFor({ approved: 0, rejected: 0, expired: 0 })).toBeNull();
  });
  it("is the non-rejection rate over reviewed (expired excluded)", () => {
    expect(brandSafetyFor({ approved: 3, rejected: 1, expired: 0 })).toBe(75);
    expect(brandSafetyFor({ approved: 0, rejected: 2, expired: 5 })).toBe(0); // expired ignored → 0/2
    expect(brandSafetyFor({ approved: 2, rejected: 0, expired: 9 })).toBe(100); // expired ignored → 2/2
  });
});

describe("buildPassport", () => {
  const base = { level: "L0", xp: 0, socialHandles: null, statuses: [] as string[], ratings: [] as number[], referredCount: 0 };

  it("a fresh creator earns nothing and has all-null scores", () => {
    const p = buildPassport(base);
    expect(p.scores).toEqual({ influence: null, reliability: null, content: null, brandSafety: null });
    expect(p.badges).toEqual([]);
    expect(p.level).toBe("L0");
    expect(p.xp).toBe(0);
  });
  it("computes content from ratings and brand safety from reviewed submissions", () => {
    const p = buildPassport({ ...base, statuses: ["approved", "rejected"], ratings: [4] });
    expect(p.scores.content).toBe(80); // round(20 * 4)
    expect(p.scores.brandSafety).toBe(50); // 1 approved / (1 approved + 1 rejected)
  });
  it("earns level_l1 at L1+", () => {
    expect(buildPassport({ ...base, level: "L1" }).badges).toContain("level_l1");
  });
  it("earns first_approval with one approved submission", () => {
    expect(buildPassport({ ...base, statuses: ["approved"] }).badges).toContain("first_approval");
  });
  it("earns reliable only at 3+ concluded AND reliability >= 80", () => {
    expect(buildPassport({ ...base, statuses: ["approved", "approved", "rejected"] }).badges).not.toContain("reliable"); // 67%
    expect(
      buildPassport({ ...base, statuses: ["approved", "approved", "approved", "approved", "rejected"] }).badges,
    ).toContain("reliable"); // 80% over 5
  });
  it("earns social_linked with a handle and referrer with a referral", () => {
    expect(buildPassport({ ...base, socialHandles: [{ followers: 0 }] }).badges).toContain("social_linked");
    expect(buildPassport({ ...base, referredCount: 1 }).badges).toContain("referrer");
  });
  it("earns perfect_rating when any submission is rated 5", () => {
    expect(buildPassport({ ...base, statuses: ["approved"], ratings: [5] }).badges).toContain("perfect_rating");
    expect(buildPassport({ ...base, statuses: ["approved"], ratings: [4] }).badges).not.toContain("perfect_rating");
  });
  it("earns content_pro at 3+ ratings AND content >= 80", () => {
    expect(buildPassport({ ...base, statuses: ["approved", "approved", "approved"], ratings: [5, 4, 5] }).badges).toContain("content_pro"); // avg 4.67 → 93
    expect(buildPassport({ ...base, statuses: ["approved", "approved"], ratings: [5, 5] }).badges).not.toContain("content_pro"); // only 2 ratings
  });
  it("earns spotless at 3+ reviewed AND brand safety 100", () => {
    expect(buildPassport({ ...base, statuses: ["approved", "approved", "approved"] }).badges).toContain("spotless");
    expect(buildPassport({ ...base, statuses: ["approved", "approved", "rejected"] }).badges).not.toContain("spotless"); // 67
  });
});
