import { describe, it, expect } from "vitest";
import { hashContent, toKbDocument } from "./collect.js";

describe("collect helpers", () => {
  it("hashContent is stable and changes with content", () => {
    expect(hashContent("a")).toBe(hashContent("a"));
    expect(hashContent("a")).not.toBe(hashContent("b"));
  });
  it("toKbDocument builds a document row from an article", () => {
    const doc = toKbDocument({ sourceType: "article", sourceRef: "points", title: "積分", locale: "zh-HK", content: "內容" });
    expect(doc).toMatchObject({ source_type: "article", source_ref: "points", title: "積分", locale: "zh-HK", content: "內容" });
    expect(doc.content_hash).toBe(hashContent("內容"));
  });
});
