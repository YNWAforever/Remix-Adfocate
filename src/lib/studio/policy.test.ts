import { describe, expect, it } from "vitest";
import { buildSharedCaption, publicMission, sourceInput, studioReturn, taskProgress } from "./policy";
import type { StudioSource } from "./types";

const source: StudioSource = { id: "source-a", thread_id: "thread-a", title: "訪問筆記", content: "觀眾想知道份量", url: null, kind: "manual", shareable: false, question: "觀眾想知道甚麼？", platform: "manual", region: "HK", language: "zh-Hant", observed_at: "2026-10-30T10:00:00Z", revoked_at: null, status: "unverified" };
describe("studio boundaries", () => {
  it("never exposes draft or expired missions or private fields in public teasers", () => {
    const row = { id: "m", slug: "tea", title: "試飲", status: "active", points_reward: 100, required_level: "L0", deadline: "2026-11-12", description: "private brief", creator_id: "secret", cash_reward: 300 };
    expect(publicMission(row, new Date("2026-10-31"))).toEqual({ slug: "tea", title: "試飲", points: 100, level: "L0", deadline: "2026-11-12" });
    expect(publicMission({ ...row, status: "draft" }, new Date("2026-10-31"))).toBeNull();
    expect(publicMission(row, new Date("2026-12-01"))).toBeNull();
  });
  it("retains a safe task destination and rejects external or auth-loop destinations", () => {
    expect(studioReturn("/my/submission-1?item=reel")).toBe("/my/submission-1?item=reel");
    for (const path of ["//evil.test", "/\\evil.test", "https://evil.test", "/login", "/auth/callback", "/%2f%2fevil.test", "/admin"]) expect(studioReturn(path)).toBe("/home");
  });
  it("does not promote approval or pending rewards into an earned badge", () => {
    expect(taskProgress("proof_submitted", null).step).toBe(3);
    expect(taskProgress("proof_under_review", null).step).toBe(3);
    expect(taskProgress("approved_to_publish", null).earned).toBe(false);
    expect(taskProgress("reward_pending", "pending").earned).toBe(false);
    expect(taskProgress("reward_pending", "settled")).toMatchObject({ earned: true, step: 6 });
    expect(taskProgress("cancelled", "cancelled").earned).toBe(false);
  });
  it("requires every selected paragraph's current source permission, including manual sources", () => {
    const sections = [{ id: "intro", text: "試飲份量", sourceIds: [source.id] }];
    expect(() => buildSharedCaption(sections, [source], ["intro"])).toThrow("SOURCE_PRIVATE");
    expect(buildSharedCaption(sections, [{ ...source, shareable: true }], ["intro"])).toContain("試飲份量");
    expect(buildSharedCaption(sections, [{ ...source, shareable: true }], ["intro"])).toContain("2026-10-30 18:00 HKT");
    expect(() => buildSharedCaption(sections, [{ ...source, shareable: true, revoked_at: "2026-10-31" }], ["intro"])).toThrow("SOURCE_UNAVAILABLE");
    expect(() => buildSharedCaption(sections, [], ["intro"])).toThrow("SOURCE_UNAVAILABLE");
  });
  it("excludes unselected private paragraphs and rejects invented section ids", () => {
    const sections = [{ id: "private", text: "秘密", sourceIds: [source.id] }, { id: "idea", text: "我的拍攝想法", sourceIds: [] }];
    expect(buildSharedCaption(sections, [source], ["idea"])).toBe("我的拍攝想法");
    expect(() => buildSharedCaption(sections, [source], ["missing"])).toThrow("INVALID_SELECTION");
  });
  it("never treats a pasted source as provider-verified or accepts executable URLs", () => {
    expect(sourceInput({ ...source, status: "verified" }).status).toBe("unverified");
    expect(() => sourceInput({ ...source, url: "javascript:alert(1)" })).toThrow("INVALID_SOURCE");
    expect(() => sourceInput({ ...source, region: "US" })).toThrow("UNSUPPORTED_COVERAGE");
  });
});
