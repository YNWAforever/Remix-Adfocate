import { describe, it, expect } from "vitest";
import {
  validateCampaign, validateEdit, validatePrizeTiers, canAttachMission,
  campaignBonusRef, campaignPrizeRef,
  type CampaignInput, type CampaignRecord, type PrizeTier,
} from "./campaignAuthoring.js";

const base: CampaignInput = {
  workspace_id: "ws1", slug: "test-c", title: "六月挑戰", description: "",
  starts_at: "2026-06-01T00:00:00Z", ends_at: "2026-06-30T00:00:00Z",
  goal_target: 3, completion_bonus_points: 200, completion_bonus_xp: 50, prize_tiers: [],
};
const tiers = (xs: Partial<PrizeTier>[]): PrizeTier[] =>
  xs.map((x) => ({ rank_from: 1, rank_to: 1, cash: 0, points: 0, xp: 0, ...x }));

describe("validatePrizeTiers", () => {
  it("accepts ascending non-overlapping ranges", () => {
    expect(validatePrizeTiers(tiers([{ rank_from: 1, rank_to: 1, cash: 500 }, { rank_from: 2, rank_to: 3, cash: 200 }])).ok).toBe(true);
  });
  it("rejects overlap", () => {
    expect(validatePrizeTiers(tiers([{ rank_from: 1, rank_to: 3 }, { rank_from: 3, rank_to: 4 }])).ok).toBe(false);
  });
  it("rejects rank_from < 1 and negative reward", () => {
    expect(validatePrizeTiers(tiers([{ rank_from: 0, rank_to: 1 }])).ok).toBe(false);
    expect(validatePrizeTiers(tiers([{ rank_from: 1, rank_to: 1, cash: -5 }])).ok).toBe(false);
  });
});

describe("validateCampaign", () => {
  it("draft requires workspace/slug/title only", () => {
    expect(validateCampaign({ ...base, starts_at: "", ends_at: "" }, "draft").ok).toBe(true);
    expect(validateCampaign({ ...base, slug: "" }, "draft").ok).toBe(false);
  });
  it("publish requires window, goal, a reward, valid tiers", () => {
    expect(validateCampaign(base, "publish").ok).toBe(true);
    expect(validateCampaign({ ...base, ends_at: base.starts_at }, "publish").ok).toBe(false); // ends<=starts
    expect(validateCampaign({ ...base, goal_target: 0 }, "publish").ok).toBe(false);
    expect(validateCampaign({ ...base, completion_bonus_points: 0, completion_bonus_xp: 0, prize_tiers: [] }, "publish").ok).toBe(false); // no reward
    expect(validateCampaign({ ...base, prize_tiers: tiers([{ rank_from: 2, rank_to: 1 }]) }, "publish").ok).toBe(false);
  });
});

describe("validateEdit", () => {
  const draft: CampaignRecord = { ...base, id: "c1", status: "draft", published_at: null, closed_at: null, settled_at: null };
  const active: CampaignRecord = { ...draft, status: "active", published_at: "2026-06-01T00:00:00Z" };
  it("draft: everything editable", () => {
    expect(validateEdit(draft, { ...base, slug: "test-new", goal_target: 9 }, false).ok).toBe(true);
  });
  it("active: slug + goal + bonus + tiers locked", () => {
    expect(validateEdit(active, { ...base, slug: "test-new" }, false).ok).toBe(false);
    expect(validateEdit(active, { ...base, goal_target: 9 }, false).ok).toBe(false);
    expect(validateEdit(active, { ...base, completion_bonus_points: 999 }, false).ok).toBe(false);
  });
  it("active: ends_at may extend but not shrink", () => {
    expect(validateEdit(active, { ...base, ends_at: "2026-07-15T00:00:00Z" }, false).ok).toBe(true);
    expect(validateEdit(active, { ...base, ends_at: "2026-06-10T00:00:00Z" }, false).ok).toBe(false);
  });
  it("active: title/description always editable", () => {
    expect(validateEdit(active, { ...base, title: "新名", description: "x" }, true).ok).toBe(true);
  });
});

describe("canAttachMission", () => {
  it("rejects a mission already attached to an active campaign", () => {
    expect(canAttachMission(new Set(["m1"]), "m1").ok).toBe(false);
    expect(canAttachMission(new Set(["m1"]), "m2").ok).toBe(true);
  });
});

describe("source_ref builders", () => {
  it("build per-(campaign,creator) refs with the 15-char prefix", () => {
    expect(campaignBonusRef("c1", "cr1")).toBe("campaign_bonus:c1:cr1");
    expect(campaignPrizeRef("c1", "cr1")).toBe("campaign_prize:c1:cr1");
    expect("campaign_bonus:".length).toBe(15);
    expect("campaign_prize:".length).toBe(15);
  });
});
