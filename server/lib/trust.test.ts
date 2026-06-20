import { describe, it, expect } from "vitest";
import { effectiveLevel } from "./trust.js";

describe("effectiveLevel", () => {
  it("returns raw level when trusted", () => {
    expect(effectiveLevel("L4", true)).toBe("L4");
  });
  it("caps at L1 when not trusted", () => {
    expect(effectiveLevel("L5", false)).toBe("L1");
    expect(effectiveLevel("L2", false)).toBe("L1");
  });
  it("leaves L0/L1 unchanged when not trusted", () => {
    expect(effectiveLevel("L0", false)).toBe("L0");
    expect(effectiveLevel("L1", false)).toBe("L1");
  });
  it("caps L3/L4/L6 to L1 when not trusted", () => {
    expect(effectiveLevel("L3", false)).toBe("L1");
    expect(effectiveLevel("L4", false)).toBe("L1");
    expect(effectiveLevel("L6", false)).toBe("L1");
  });
  it("returns all levels through when trusted", () => {
    expect(effectiveLevel("L0", true)).toBe("L0");
    expect(effectiveLevel("L1", true)).toBe("L1");
    expect(effectiveLevel("L2", true)).toBe("L2");
    expect(effectiveLevel("L6", true)).toBe("L6");
  });
  it("treats null/undefined raw level as L0 when not trusted", () => {
    expect(effectiveLevel(null, false)).toBe("L0");
    expect(effectiveLevel(undefined, false)).toBe("L0");
  });
  it("treats null/undefined raw level as L0 when trusted", () => {
    expect(effectiveLevel(null, true)).toBe("L0");
    expect(effectiveLevel(undefined, true)).toBe("L0");
  });
});
