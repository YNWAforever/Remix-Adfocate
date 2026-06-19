import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./prompt.js";

describe("buildSystemPrompt", () => {
  it("includes retrieved context and grounding rules", () => {
    const p = buildSystemPrompt({
      locale: "zh-HK",
      context: [{ title: "積分規則", content: "完成任務可獲積分。" }],
    });
    expect(p).toContain("積分規則");
    expect(p).toContain("完成任務可獲積分。");
    expect(p.toLowerCase()).toContain("zh-hk");
  });

  it("states there is no context when retrieval is empty", () => {
    const p = buildSystemPrompt({ locale: "zh-HK", context: [] });
    expect(p).toMatch(/no (knowledge|relevant)/i);
  });
});
