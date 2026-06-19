import { describe, it, expect } from "vitest";
import { chunkText } from "./chunk.js";

describe("chunkText", () => {
  it("returns one chunk for short text", () => {
    const chunks = chunkText("hello world", { maxChars: 100, overlapChars: 10 });
    expect(chunks).toEqual(["hello world"]);
  });

  it("splits long text into overlapping chunks on word boundaries", () => {
    const text = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkText(text, { maxChars: 60, overlapChars: 12 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(60));
    // overlap: end of chunk[0] reappears at start of chunk[1]
    const tail = chunks[0].split(" ").slice(-1)[0];
    expect(chunks[1].startsWith(tail)).toBe(true);
  });

  it("ignores empty/whitespace input", () => {
    expect(chunkText("   ", { maxChars: 100, overlapChars: 10 })).toEqual([]);
  });
});
