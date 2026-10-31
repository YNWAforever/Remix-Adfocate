// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizeInstagramMedia } from "./instagram.js";

const now = new Date("2026-10-31T03:00:00.000Z");
const media = { id: "mock-media", title: "茶的日常", version: "mock-v1", observedAt: "2026-10-29T03:00:00.000Z" };

describe("mock Instagram media normalization", () => {
  it("preserves a genuine zero and never fills absent or invalid measurements with zero", async () => {
    const result = await normalizeInstagramMedia({ ...media, metrics: { reach: null, views: 0, likes: -1, saves: Number.NaN } }, now);
    expect(result.metrics.views).toEqual({ value: 0, availability: "available", reason: null });
    for (const name of ["reach", "likes", "saves"]) expect(result.metrics[name]).toMatchObject({ value: null, availability: "missing" });
    expect(result.excerpt).toContain("views: 0");
    expect(result.excerpt).toContain("reach: 資料不足／未驗證");
    const empty = await normalizeInstagramMedia({ ...media, metrics: {} }, now);
    expect(Object.values(empty.metrics).every(metric => metric.value === null && metric.availability === "missing")).toBe(true);
  });

  it.each(["unsupported", "stale"] as const)("preserves explicit %s availability while dropping any cached value", async availability => {
    const result = await normalizeInstagramMedia({ ...media, metrics: { reach: { value: 999, availability, reason: "mock unavailable" } } }, now);
    expect(result.metrics.reach).toMatchObject({ value: null, availability });
    expect(result.metrics.reach.reason).toEqual(expect.any(String));
    expect(result.excerpt).not.toContain("999");
  });

  it("keeps observation and fetch times without inventing a metric measurement period", async () => {
    const result = await normalizeInstagramMedia({ ...media, metrics: { reach: 42 } }, now, true);
    expect(result.period).toBeNull();
    expect(result.observedAt).toBe(media.observedAt);
    expect(result.fetchedAt).toBe(now.toISOString());
    expect(result.coverage).toEqual({ region: null, language: null, partial: true });
    expect(result.excerpt).toContain("模擬資料");
    expect(result.excerpt).toContain("此則媒體");
    expect(result.excerpt).toContain("不代表所有廣告互動");
  });

  it("keeps the metric whitelist and changes the fingerprint when values or source version change", async () => {
    const first = await normalizeInstagramMedia({ ...media, metrics: { reach: 42, ads_spend: 12345 } }, now);
    const changed = await normalizeInstagramMedia({ ...media, metrics: { reach: 43 } }, now);
    const version = await normalizeInstagramMedia({ ...media, version: "mock-v2", metrics: { reach: 42 } }, now);
    expect(Object.keys(first.metrics)).toEqual(["reach", "views", "likes", "saves"]);
    expect(first.excerpt).not.toContain("12345");
    expect(changed.contentHash).not.toBe(first.contentHash);
    expect(version.contentHash).not.toBe(first.contentHash);
  });
});
