// server/lib/missionAuthoring.test.ts
import { describe, it, expect } from "vitest";
import { isValidSlug, suggestSlug, MISSION_LEVELS, MISSION_TYPES, validateMission, type MissionInput } from "./missionAuthoring.js";

describe("isValidSlug", () => {
  it("accepts lowercase alnum + hyphens", () => {
    expect(isValidSlug("summer-koc-2026")).toBe(true);
    expect(isValidSlug("a1")).toBe(true);
  });
  it("rejects empty, uppercase, leading hyphen, spaces, zh chars", () => {
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("Summer")).toBe(false);
    expect(isValidSlug("-x")).toBe(false);
    expect(isValidSlug("a b")).toBe(false);
    expect(isValidSlug("夏日")).toBe(false);
  });
});

describe("suggestSlug", () => {
  it("kebabs the mission type", () => {
    expect(suggestSlug("koc_trial")).toBe("koc-trial");
    expect(suggestSlug("performance_cpm")).toBe("performance-cpm");
  });
});

describe("canonical sets", () => {
  it("levels are the seven-level L0..L6 set (mirrors src/lib/levels.ts)", () => {
    expect(MISSION_LEVELS).toEqual(["L0", "L1", "L2", "L3", "L4", "L5", "L6"]);
  });
  it("mission types match the 0001 CHECK", () => {
    expect(MISSION_TYPES).toEqual([
      "koc_trial", "ugc", "clipping", "affiliate", "performance_cpm", "live_commerce", "brand_ambassador",
    ]);
  });
});

const TODAY = "2026-06-22";
const draftOk: MissionInput = { workspace_id: "ws", title: "夏日試用", slug: "test-x", mission_type: "ugc" };

describe("validateMission draft mode", () => {
  it("requires workspace_id, title, slug AND mission_type (mission_type is NOT NULL in DB)", () => {
    expect(validateMission(draftOk, "draft").ok).toBe(true);
    expect(validateMission({ ...draftOk, mission_type: undefined }, "draft").errors).toHaveProperty("mission_type");
    expect(validateMission({ ...draftOk, slug: "Bad Slug" }, "draft").errors).toHaveProperty("slug");
    expect(validateMission({ ...draftOk, title: "  " }, "draft").errors).toHaveProperty("title");
    expect(validateMission({ ...draftOk, workspace_id: null }, "draft").errors).toHaveProperty("workspace_id");
  });
  it("allows everything else to be sparse in draft mode", () => {
    expect(validateMission(draftOk, "draft").ok).toBe(true); // no reward/category/deadline needed
  });
});

describe("validateMission publish mode", () => {
  const base: MissionInput = {
    ...draftOk, description: "做啲嘢", category: "美容", access_type: "open",
    required_level: "L2", quota: 5, deadline: "2026-07-01", points_reward: 100,
  };
  it("passes a complete points/cash mission", () => {
    expect(validateMission(base, "publish", TODAY).ok).toBe(true);
  });
  it("flags missing description/category/quota/deadline", () => {
    expect(validateMission({ ...base, description: "" }, "publish", TODAY).errors).toHaveProperty("description");
    expect(validateMission({ ...base, category: "" }, "publish", TODAY).errors).toHaveProperty("category");
    expect(validateMission({ ...base, quota: 0 }, "publish", TODAY).errors).toHaveProperty("quota");
    expect(validateMission({ ...base, deadline: "2026-06-21" }, "publish", TODAY).errors).toHaveProperty("deadline");
  });
  it("accepts all seven levels incl. L5/L6", () => {
    for (const lvl of ["L0", "L5", "L6"]) {
      expect(validateMission({ ...base, required_level: lvl }, "publish", TODAY).ok).toBe(true);
    }
    expect(validateMission({ ...base, required_level: "L9" }, "publish", TODAY).errors).toHaveProperty("required_level");
  });
  it("reward-by-type: points OR cash for koc_trial/ugc/clipping/brand_ambassador/affiliate/live_commerce", () => {
    for (const t of ["koc_trial", "ugc", "clipping", "brand_ambassador", "affiliate", "live_commerce"]) {
      expect(validateMission({ ...base, mission_type: t, points_reward: 0, cash_reward: 0 }, "publish", TODAY).errors)
        .toHaveProperty("points_reward");
      expect(validateMission({ ...base, mission_type: t, points_reward: 0, cash_reward: 50 }, "publish", TODAY).ok).toBe(true);
    }
  });
  it("reward-by-type: performance_cpm needs cpm_rate>0 AND cpm_budget_pool>0", () => {
    const cpm = { ...base, mission_type: "performance_cpm", points_reward: 0, cash_reward: 0 };
    expect(validateMission(cpm, "publish", TODAY).errors).toHaveProperty("cpm_rate");
    expect(validateMission({ ...cpm, cpm_rate: 5 }, "publish", TODAY).errors).toHaveProperty("cpm_rate"); // pool still missing
    expect(validateMission({ ...cpm, cpm_rate: 5, cpm_budget_pool: 1000 }, "publish", TODAY).ok).toBe(true);
  });
});
