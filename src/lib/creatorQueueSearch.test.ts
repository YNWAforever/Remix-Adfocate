import { describe, expect, it } from "vitest";
import { creatorQueueUrl, parseCreatorQueueSearch, safeCreatorQueueReturn } from "./creatorQueueSearch";
describe("creator queue navigation", () => {
  it("round trips workspace, filters, stable page and search through a URL", () => {
    const state = parseCreatorQueueSearch({ ws: "a", q: "香港", status: "approved", risk: "low", sort: "level", page: "3" });
    expect(parseCreatorQueueSearch(Object.fromEntries(new URL(creatorQueueUrl(state), "https://local.invalid").searchParams))).toEqual(state);
  });
  it.each([NaN, Infinity, -2, 0, 1.5, "bad"])("bounds invalid pages: %s", (page) => expect(parseCreatorQueueSearch({ page }).page).toBe(1));
  it.each(["https://evil.test", "//evil.test", "javascript:alert(1)", "/admin/creators-evil", "/admin/creators\\evil"])("rejects unsafe return target: %s", (url) => expect(safeCreatorQueueReturn(url)).toBe("/admin/creators"));
  it("bounds query by code points and sort by allowlist", () => {
    const state = parseCreatorQueueSearch({ q: "😀".repeat(201), sort: "id);delete" });
    expect([...state.q]).toHaveLength(200); expect(state.sort).toBe("last_activity");
  });
});
