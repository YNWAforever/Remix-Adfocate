import { describe, it, expect, beforeEach } from "vitest";
import { markRead, getRead } from "./guideProgress";

beforeEach(() => localStorage.clear());

describe("guideProgress", () => {
  it("records and reads per-creator", () => {
    markRead("c1", "leveling");
    markRead("c1", "missions");
    expect([...getRead("c1")].sort()).toEqual(["leveling", "missions"]);
    expect(getRead("c2").size).toBe(0); // namespaced by creator
  });
  it("no-ops without a creatorId", () => {
    markRead(undefined, "leveling");
    expect(getRead(undefined).size).toBe(0);
  });
});
