import { describe, it, expect } from "vitest";
import {
  slugify, uniqueSlug, validateContentInput, validateContentEdit,
  canTransition, isPublishable, isAllowedImageUrl,
} from "./contentAuthoring.js";

describe("slugify", () => {
  it("lowercases, trims, hyphenates", () => {
    expect(slugify("  Summer Sunscreen 2026!! ")).toBe("summer-sunscreen-2026");
  });
  it("falls back for empty/punctuation-only input", () => {
    expect(slugify("！！！").length).toBeGreaterThan(0);
  });
});

describe("uniqueSlug", () => {
  it("returns base when free", () => {
    expect(uniqueSlug("news", [])).toBe("news");
  });
  it("appends -2, -3 on collision", () => {
    expect(uniqueSlug("news", ["news"])).toBe("news-2");
    expect(uniqueSlug("news", ["news", "news-2"])).toBe("news-3");
  });
});

describe("validateContentInput", () => {
  it("requires kind + title_zh", () => {
    const { errors } = validateContentInput({ kind: "", title_zh: "", body_zh: "" } as never);
    expect(errors.kind).toBeDefined();
    expect(errors.title_zh).toBeDefined();
  });
  it("rejects an unknown kind", () => {
    const { errors } = validateContentInput({ kind: "video", title_zh: "x", body_zh: "" } as never);
    expect(errors.kind).toBeDefined();
  });
  it("rejects an over-long title", () => {
    const { errors } = validateContentInput({ kind: "article", title_zh: "x".repeat(201), body_zh: "" });
    expect(errors.title_zh).toBeDefined();
  });
  it("passes a minimal valid draft", () => {
    const { errors } = validateContentInput({ kind: "article", title_zh: "標題", body_zh: "" });
    expect(Object.keys(errors)).toHaveLength(0);
  });
});

describe("validateContentEdit", () => {
  it("only errors on PRESENT invalid fields", () => {
    expect(Object.keys(validateContentEdit({}).errors)).toHaveLength(0);
    expect(validateContentEdit({ title_zh: "" }).errors.title_zh).toBeDefined();
  });
});

describe("validateContentInput audience", () => {
  it("accepts 'creator', 'brand', and omitted (no default applied here — the DB defaults it)", () => {
    expect(Object.keys(validateContentInput({ kind: "article", title_zh: "t", body_zh: "", audience: "creator" }).errors)).toHaveLength(0);
    expect(Object.keys(validateContentInput({ kind: "article", title_zh: "t", body_zh: "", audience: "brand" }).errors)).toHaveLength(0);
    expect(Object.keys(validateContentInput({ kind: "article", title_zh: "t", body_zh: "" }).errors)).toHaveLength(0);
  });
  it("rejects an unknown audience", () => {
    const { errors } = validateContentInput({ kind: "article", title_zh: "t", body_zh: "", audience: "everyone" } as never);
    expect(errors.audience).toBeDefined();
  });
});

describe("validateContentEdit audience", () => {
  it("only errors when audience is PRESENT and invalid", () => {
    expect(Object.keys(validateContentEdit({}).errors)).toHaveLength(0);
    expect(Object.keys(validateContentEdit({ audience: "brand" }).errors)).toHaveLength(0);
    expect(validateContentEdit({ audience: "everyone" } as never).errors.audience).toBeDefined();
  });
});

describe("canTransition", () => {
  it("allows draft→published, scheduled→published, published→archived", () => {
    expect(canTransition("draft", "published")).toBe(true);
    expect(canTransition("scheduled", "published")).toBe(true);
    expect(canTransition("published", "archived")).toBe(true);
    expect(canTransition("archived", "draft")).toBe(true);
  });
  it("rejects nonsense transitions", () => {
    expect(canTransition("archived", "scheduled")).toBe(false);
    expect(canTransition("published", "scheduled")).toBe(false);
  });
});

describe("isPublishable", () => {
  it("needs a title and non-empty body", () => {
    expect(isPublishable({ title_zh: "t", body_zh: "hi" })).toBe(true);
    expect(isPublishable({ title_zh: "t", body_zh: "   " })).toBe(false);
    expect(isPublishable({ title_zh: "", body_zh: "hi" })).toBe(false);
  });
});

describe("isAllowedImageUrl", () => {
  const hosts = ["abc.supabase.co"];
  it("accepts https on an allowed host", () => {
    expect(isAllowedImageUrl("https://abc.supabase.co/x.png", hosts)).toBe(true);
  });
  it("rejects other hosts, http, and javascript:", () => {
    expect(isAllowedImageUrl("https://evil.com/x.png", hosts)).toBe(false);
    expect(isAllowedImageUrl("http://abc.supabase.co/x.png", hosts)).toBe(false);
    expect(isAllowedImageUrl("javascript:alert(1)", hosts)).toBe(false);
    expect(isAllowedImageUrl("not a url", hosts)).toBe(false);
  });
});
