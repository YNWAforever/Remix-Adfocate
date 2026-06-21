import { describe, it, expect } from "vitest";
import { academyTracks } from "./academy";
import { levelIndex, LEVELS } from "@/lib/levels";

const IDS = new Set(LEVELS.map((l) => l.id));

describe("academyTracks", () => {
  it("every track has a canonical requiredLevel id and a teaserKey", () => {
    expect(academyTracks.length).toBeGreaterThan(0);
    for (const t of academyTracks) {
      expect(IDS.has(t.requiredLevel)).toBe(true);              // never a range like "L2+"
      expect(levelIndex(t.requiredLevel)).toBe(LEVELS.findIndex((l) => l.id === t.requiredLevel));
      expect(typeof t.teaserKey).toBe("string");
    }
  });
});
