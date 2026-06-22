import { describe, expect, it } from "vitest";
import { parseAllowlist } from "../lib/staffAuth";

describe("parseAllowlist", () => {
  it("returns an empty set for undefined/empty/whitespace", () => {
    expect(parseAllowlist(undefined).size).toBe(0);
    expect(parseAllowlist("").size).toBe(0);
    expect(parseAllowlist("   ").size).toBe(0);
    expect(parseAllowlist(" , ,").size).toBe(0);
  });

  it("splits on commas, trims, lowercases, drops blanks", () => {
    const set = parseAllowlist("  Alice@Fimmick.com , bob@fimmick.com ,, ");
    expect(set.has("alice@fimmick.com")).toBe(true);
    expect(set.has("bob@fimmick.com")).toBe(true);
    expect(set.size).toBe(2);
  });
});
