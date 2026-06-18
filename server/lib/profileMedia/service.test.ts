import { describe, expect, it } from "vitest";
import {
  calculateCompleteness,
  publicHighlightsFromLinks,
  validateAvatarUpload,
  normalizePortfolioUrl,
  ProfileMediaError,
} from "./service";
import type { ProfileMediaLink } from "./types";

function link(overrides: Partial<ProfileMediaLink>): ProfileMediaLink {
  return {
    id: overrides.id ?? "link-1",
    creatorId: overrides.creatorId ?? "creator-1",
    workspaceId: overrides.workspaceId ?? "workspace-1",
    url: overrides.url ?? "https://example.com/work",
    title: overrides.title ?? "Work",
    platformType: overrides.platformType ?? "website",
    caption: overrides.caption ?? null,
    sortOrder: overrides.sortOrder ?? 0,
    publicHighlight: overrides.publicHighlight ?? false,
    createdAt: overrides.createdAt ?? "2026-06-18T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-18T00:00:00.000Z",
  };
}

describe("profile media service", () => {
  it("normalizes HTTP URLs and rejects unsafe protocols", () => {
    expect(normalizePortfolioUrl(" example.com/work ")).toBe("https://example.com/work");
    expect(normalizePortfolioUrl("https://example.com/work?x=1")).toBe("https://example.com/work?x=1");
    expect(() => normalizePortfolioUrl("javascript:alert(1)")).toThrow(ProfileMediaError);
    expect(() => normalizePortfolioUrl("ftp://example.com/file")).toThrow(ProfileMediaError);
  });

  it("validates avatar upload metadata", () => {
    expect(validateAvatarUpload({ fileName: "headshot.png", contentType: "image/png", sizeBytes: 1024 })).toEqual({
      fileName: "headshot.png",
      contentType: "image/png",
      sizeBytes: 1024,
      extension: "png",
    });
    expect(() => validateAvatarUpload({ fileName: "headshot.gif", contentType: "image/gif", sizeBytes: 1024 })).toThrow(ProfileMediaError);
    expect(() => validateAvatarUpload({ fileName: "huge.png", contentType: "image/png", sizeBytes: 5_242_881 })).toThrow(ProfileMediaError);
  });

  it("serializes only three selected public highlights", () => {
    const result = publicHighlightsFromLinks([
      link({ id: "private", title: "Private", publicHighlight: false, sortOrder: 0 }),
      link({ id: "three", title: "Three", publicHighlight: true, sortOrder: 30 }),
      link({ id: "one", title: "One", publicHighlight: true, sortOrder: 10 }),
      link({ id: "two", title: "Two", publicHighlight: true, sortOrder: 20 }),
    ]);

    expect(result).toEqual([
      { url: "https://example.com/work", title: "One", platform_type: "website", caption: null, sort_order: 10 },
      { url: "https://example.com/work", title: "Two", platform_type: "website", caption: null, sort_order: 20 },
      { url: "https://example.com/work", title: "Three", platform_type: "website", caption: null, sort_order: 30 },
    ]);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("creatorId");
  });

  it("calculates private completeness score and checklist", () => {
    const complete = calculateCompleteness({
      avatarUrl: "https://cdn.example.com/avatar.jpg",
      displayName: "Amy",
      bio: "Creator bio",
      categories: ["beauty"],
      portfolioLinks: [link({ publicHighlight: true })],
      hasSocialScan: true,
    });

    expect(complete.score).toBe(100);
    expect(complete.items.every((item) => item.complete)).toBe(true);

    const partial = calculateCompleteness({
      avatarUrl: null,
      displayName: "",
      bio: null,
      categories: [],
      portfolioLinks: [],
      hasSocialScan: false,
    });

    expect(partial.score).toBe(0);
    expect(partial.items.map((item) => item.key)).toEqual([
      "avatar",
      "display_name",
      "bio",
      "categories",
      "portfolio",
      "public_highlight",
      "social_scan",
    ]);
  });
});
