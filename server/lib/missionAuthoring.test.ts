// server/lib/missionAuthoring.test.ts
import { describe, it, expect } from "vitest";
import { isValidSlug, suggestSlug, MISSION_LEVELS, MISSION_TYPES, validateMission, validateEdit, normBriefArray, normAudience, normalizeBrief, nextDuplicateSlug, type MissionInput, type MissionRecord } from "./missionAuthoring.js";

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

const draftRec: MissionRecord = {
  status: "draft", workspace_id: "ws", slug: "test-x", title: "t", mission_type: "ugc",
  points_reward: 100, cash_reward: null, access_type: "open", required_level: "L0",
  quota: 10, filled: 0, deadline: "2026-07-01",
};
const activeRec: MissionRecord = { ...draftRec, status: "active" };

describe("validateEdit", () => {
  it("draft: nothing frozen — slug/type/rewards all editable", () => {
    expect(validateEdit(draftRec, { slug: "test-y", mission_type: "clipping", points_reward: 200 }, false).ok).toBe(true);
  });
  it("published + unengaged: slug & mission_type are frozen, rest editable", () => {
    expect(validateEdit(activeRec, { slug: "test-z" }, false).errors).toHaveProperty("slug");
    expect(validateEdit(activeRec, { mission_type: "ugc" }, false).ok).toBe(true); // same value = no-op
    expect(validateEdit(activeRec, { mission_type: "clipping" }, false).errors).toHaveProperty("mission_type");
    expect(validateEdit(activeRec, { points_reward: 999 }, false).ok).toBe(true); // unengaged → editable
  });
  it("engaged: economic fields locked, but re-sending the same value is a no-op", () => {
    expect(validateEdit(activeRec, { points_reward: 999 }, true).errors).toHaveProperty("points_reward");
    expect(validateEdit(activeRec, { cash_reward: 5 }, true).errors).toHaveProperty("cash_reward");
    expect(validateEdit(activeRec, { access_type: "application" }, true).errors).toHaveProperty("access_type");
    expect(validateEdit(activeRec, { required_level: "L3" }, true).errors).toHaveProperty("required_level");
    expect(validateEdit(activeRec, { points_reward: 100 }, true).ok).toBe(true); // unchanged
    expect(validateEdit(activeRec, { title: "新標題", description: "x" }, true).ok).toBe(true); // brief always editable
  });
  it("engaged: quota floor = max(existing.quota, filled); deadline extend-only", () => {
    const engaged: MissionRecord = { ...activeRec, quota: 10, filled: 7 };
    expect(validateEdit(engaged, { quota: 6 }, true).errors).toHaveProperty("quota"); // below filled
    expect(validateEdit(engaged, { quota: 12 }, true).ok).toBe(true);
    expect(validateEdit(engaged, { deadline: "2026-06-30" }, true).errors).toHaveProperty("deadline"); // earlier
    expect(validateEdit(engaged, { deadline: "2026-08-01" }, true).ok).toBe(true);
  });
  it("all-declined mission stays fully editable (hasEngagement=false)", () => {
    expect(validateEdit(activeRec, { points_reward: 500, quota: 1 }, false).ok).toBe(true);
  });
  it("format checks apply regardless of status", () => {
    expect(validateEdit(draftRec, { slug: "Bad Slug" }, false).errors).toHaveProperty("slug");
    expect(validateEdit(draftRec, { required_level: "L9" }, false).errors).toHaveProperty("required_level");
    expect(validateEdit(draftRec, { quota: 0 }, false).errors).toHaveProperty("quota");
    expect(validateEdit(draftRec, { effort: "extreme" }, false).errors).toHaveProperty("effort");
  });
});

describe("brief normalization", () => {
  it("trims, drops empties, caps at 12 items", () => {
    const raw = ["  a ", "", "  ", ...Array.from({ length: 13 }, (_, i) => `x${i}`)];
    const out = normBriefArray(raw);
    expect(out[0]).toBe("a");
    expect(out).toHaveLength(12);
    expect(out.includes("")).toBe(false);
  });

  it("normAudience empties to null and trims", () => {
    expect(normAudience("   ")).toBeNull();
    expect(normAudience(null)).toBeNull();
    expect(normAudience("  hello ")).toBe("hello");
  });

  it("normalizeBrief returns the 5 cleaned fields", () => {
    const out = normalizeBrief({
      target_audience: "  20-30 urban  ",
      dos: [" be authentic ", ""],
      donts: ["no profanity"],
      key_messages: ["fresh", "  fast "],
      reference_links: [" https://ex.com/a ", ""],
    });
    expect(out).toEqual({
      target_audience: "20-30 urban",
      dos: ["be authentic"],
      donts: ["no profanity"],
      key_messages: ["fresh", "fast"],
      reference_links: ["https://ex.com/a"],
    });
  });
});

describe("validateMission — brief fields", () => {
  const base = {
    workspace_id: "w1", title: "T", slug: "ugc-1", mission_type: "ugc",
  };

  it("accepts missing brief fields at publish (they do not gate)", () => {
    const r = validateMission(
      { ...base, description: "d", category: "社交", access_type: "open", required_level: "L0",
        quota: 5, deadline: "2099-01-01", points_reward: 100 },
      "publish",
      "2026-06-22",
    );
    expect(r.ok).toBe(true);
  });

  it("rejects a reference_links entry that is not an http(s) URL", () => {
    const r = validateMission({ ...base, reference_links: ["not a url"] }, "draft");
    expect(r.ok).toBe(false);
    expect(r.errors.reference_links).toBeTruthy();
  });

  it("accepts a bare-domain reference link (normalizePortfolioUrl prepends https)", () => {
    const r = validateMission({ ...base, reference_links: ["example.com/post"] }, "draft");
    expect(r.errors.reference_links).toBeUndefined();
  });

  it("rejects a key_messages item longer than 200 chars", () => {
    const r = validateMission({ ...base, key_messages: ["x".repeat(201)] }, "draft");
    expect(r.errors.key_messages).toBeTruthy();
  });

  it("rejects target_audience longer than 500 chars", () => {
    const r = validateMission({ ...base, target_audience: "x".repeat(501) }, "draft");
    expect(r.errors.target_audience).toBeTruthy();
  });
});

describe("validateEdit — brief fields", () => {
  const existing = { status: "active" as const, slug: "ugc-1", mission_type: "ugc" };
  it("allows editing brief fields after publish", () => {
    const r = validateEdit(existing, { key_messages: ["new point"] }, false);
    expect(r.ok).toBe(true);
  });
  it("flags a bad reference link in a patch", () => {
    const r = validateEdit(existing, { reference_links: ["javascript:alert(1)"] }, false);
    expect(r.ok).toBe(false);
    expect(r.errors.reference_links).toBeTruthy();
  });
});

describe("nextDuplicateSlug", () => {
  it("appends -copy when free", () => {
    expect(nextDuplicateSlug("ugc-1", ["ugc-1"])).toBe("ugc-1-copy");
  });
  it("appends -copy-2 when -copy is taken", () => {
    expect(nextDuplicateSlug("ugc-1", ["ugc-1", "ugc-1-copy"])).toBe("ugc-1-copy-2");
  });
  it("finds the first free suffix among many collisions", () => {
    expect(nextDuplicateSlug("ugc-1", ["ugc-1-copy", "ugc-1-copy-2", "ugc-1-copy-3"])).toBe("ugc-1-copy-4");
  });
  it("treats the slug set as workspace-local (only what is passed in)", () => {
    expect(nextDuplicateSlug("ugc-1", [])).toBe("ugc-1-copy");
  });
});
