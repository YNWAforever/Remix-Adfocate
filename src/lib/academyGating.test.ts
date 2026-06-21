import { describe, it, expect } from "vitest";
import { isTrackUnlocked } from "./academyGating";

describe("isTrackUnlocked", () => {
  it("unlocks when effective level >= required", () => {
    expect(isTrackUnlocked("L0", "L1")).toBe(true);
    expect(isTrackUnlocked("L1", "L1")).toBe(true);
    expect(isTrackUnlocked("L2", "L1")).toBe(false); // untrusted capped at L1
    expect(isTrackUnlocked("L3", "L5")).toBe(true);
  });
  it("treats missing effective level as L0", () => {
    expect(isTrackUnlocked("L0", undefined)).toBe(true);
    expect(isTrackUnlocked("L2", undefined)).toBe(false);
    expect(isTrackUnlocked("L1", null)).toBe(false);
  });
});
