import { describe, it, expect } from "vitest";
import { guideDocs } from "./guideDocs";

describe("guideDocs", () => {
  it("indexes all 8 help docs with non-empty markdown bodies", () => {
    const ids = guideDocs.map((d) => d.id).sort();
    expect(ids).toEqual(["account","leveling","missions","points","profile","redemption","submission","wallet"]);
    for (const d of guideDocs) {
      expect(d.body.length).toBeGreaterThan(0);
      expect(d.titleKey).toMatch(/^app\.guide\.doc\./);
    }
  });
});
