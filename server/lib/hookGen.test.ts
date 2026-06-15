import { describe, it, expect } from "vitest";
import { buildHooks } from "./hookGen";

const base = { title: "夏日保濕面膜", description: "試用裝", category: "美容", creatorNiche: "美妝" };

describe("buildHooks", () => {
  it("returns exactly 5 hooks with the five angles in order", () => {
    expect(buildHooks(base).map((h) => h.angle)).toEqual(["問題式", "好奇式", "優惠式", "體驗式", "對比式"]);
  });

  it("interpolates the mission title and category into the hooks", () => {
    const hooks = buildHooks(base);
    expect(hooks.every((h) => h.text.includes("夏日保濕面膜"))).toBe(true);
    expect(hooks.find((h) => h.angle === "優惠式")!.text).toContain("美容");
    expect(hooks.find((h) => h.angle === "問題式")!.text).toContain("美容揀唔啱");
  });

  it("falls back to creatorNiche for 優惠式 when category is null", () => {
    expect(buildHooks({ ...base, category: null }).find((h) => h.angle === "優惠式")!.text).toContain("美妝");
  });

  it("uses neutral fallbacks when category and creatorNiche are both null (no null leaks)", () => {
    const hooks = buildHooks({ title: "神秘任務", description: null, category: null, creatorNiche: null });
    for (const h of hooks) expect(h.text).not.toMatch(/null|undefined/);
    expect(hooks.find((h) => h.angle === "優惠式")!.text).toContain("呢個範疇");
    expect(hooks.find((h) => h.angle === "問題式")!.text).toContain("揀唔啱嘢");
  });
});
