import { describe, it, expect } from "vitest";
import {
  categoryTerm, rewardTerm, urgencyTerm, readinessTerm, levelFitTerm,
  scoreMissions, rankMissions, filterCandidates, rationaleFor, creatorQualifiesForCampaign,
  type MatchCreator, type MatchMission,
} from "./missionMatch";

const NOW = new Date("2026-06-16T00:00:00Z");
function mission(over: Partial<MatchMission> = {}): MatchMission {
  return {
    id: over.id ?? "m1", slug: over.slug ?? "s1", title: over.title ?? "T",
    category: over.category ?? "美妝", mission_type: "ugc", required_level: over.required_level ?? "L0",
    points_reward: over.points_reward ?? 100, cash_reward: over.cash_reward ?? null,
    deadline: over.deadline ?? null, quota: over.quota ?? 10, filled: over.filled ?? 0,
  };
}
function creator(over: Partial<MatchCreator> = {}): MatchCreator {
  return {
    level: over.level ?? "L1", categories: over.categories ?? ["美妝"],
    reliability: over.reliability ?? null, brandSafety: over.brandSafety ?? null, content: over.content ?? null,
  };
}

describe("categoryTerm", () => {
  it("is 1 on a niche match, 0 on a miss", () => {
    expect(categoryTerm(creator({ categories: ["美妝"] }), mission({ category: "美妝" }))).toBe(1);
    expect(categoryTerm(creator({ categories: ["美妝"] }), mission({ category: "科技" }))).toBe(0);
  });
  it("is a 0.5 neutral when the creator has no niches set", () => {
    expect(categoryTerm(creator({ categories: [] }), mission({ category: "科技" }))).toBe(0.5);
  });
});

describe("rewardTerm", () => {
  it("is proportional to the set max points", () => {
    expect(rewardTerm(mission({ points_reward: 200 }), 200, 0)).toBe(1);
    expect(rewardTerm(mission({ points_reward: 100 }), 200, 0)).toBe(0.5);
  });
  it("takes the stronger of points or cash, and is 0 when all rewards are 0", () => {
    expect(rewardTerm(mission({ points_reward: 0, cash_reward: 50 }), 0, 100)).toBe(0.5);
    expect(rewardTerm(mission({ points_reward: 0, cash_reward: null }), 0, 0)).toBe(0);
  });
});

describe("urgencyTerm", () => {
  it("buckets days-to-deadline and treats no-deadline as neutral", () => {
    expect(urgencyTerm(mission({ deadline: null }), NOW)).toBe(0.4);
    expect(urgencyTerm(mission({ deadline: "2026-06-18" }), NOW)).toBe(1);   // 2d
    expect(urgencyTerm(mission({ deadline: "2026-06-22" }), NOW)).toBe(0.7);  // 6d
    expect(urgencyTerm(mission({ deadline: "2026-06-28" }), NOW)).toBe(0.4);  // 12d
    expect(urgencyTerm(mission({ deadline: "2026-08-01" }), NOW)).toBe(0.2);  // far
    expect(urgencyTerm(mission({ deadline: "2026-06-10" }), NOW)).toBe(0);    // past (defensive)
  });
});

describe("readinessTerm", () => {
  it("averages the non-null passport scores, /100", () => {
    expect(readinessTerm(creator({ reliability: 80, brandSafety: 100, content: null }))).toBeCloseTo(0.9);
  });
  it("is 0.5 neutral for a creator with no scores yet", () => {
    expect(readinessTerm(creator({ reliability: null, brandSafety: null, content: null }))).toBe(0.5);
  });
});

describe("levelFitTerm", () => {
  it("is 1 when eligible, 0 when the required level is above the creator", () => {
    expect(levelFitTerm(creator({ level: "L1" }), mission({ required_level: "L1" }))).toBe(1);
    expect(levelFitTerm(creator({ level: "L1" }), mission({ required_level: "L3" }))).toBe(0);
  });
});

describe("scoreMissions", () => {
  it("composes a 0-100 fit_score and flags locked", () => {
    const [a] = scoreMissions(creator({ level: "L1", categories: ["美妝"], reliability: 100, brandSafety: 100, content: 100 }),
      [mission({ category: "美妝", points_reward: 100, deadline: "2026-06-18", required_level: "L1" })], NOW);
    expect(a.fit_score).toBe(100);
    expect(a.locked).toBe(false);
  });
  it("clamps and marks a locked mission", () => {
    const [a] = scoreMissions(creator({ level: "L0", categories: ["美妝"] }),
      [mission({ category: "美妝", required_level: "L3" })], NOW);
    expect(a.locked).toBe(true);
    expect(a.fit_score).toBeGreaterThanOrEqual(0);
    expect(a.fit_score).toBeLessThanOrEqual(100);
  });
});

describe("rankMissions", () => {
  it("keeps every eligible mission above every locked one, regardless of raw signals", () => {
    const scored = scoreMissions(creator({ level: "L0", categories: ["美妝"] }), [
      mission({ id: "lock", slug: "locked", category: "美妝", required_level: "L5", points_reward: 999, deadline: "2026-06-17" }),
      mission({ id: "elig", slug: "eligible", category: "科技", required_level: "L0", points_reward: 1 }),
    ], NOW);
    const ranked = rankMissions(scored);
    expect(ranked[0].slug).toBe("eligible");
    expect(ranked[ranked.length - 1].slug).toBe("locked");
  });
  it("orders eligible by fit_score descending", () => {
    const scored = scoreMissions(creator({ categories: ["美妝"], level: "L1" }), [
      mission({ id: "off", slug: "off", category: "科技", points_reward: 50 }),
      mission({ id: "on", slug: "on", category: "美妝", points_reward: 100 }),
    ], NOW);
    const ranked = rankMissions(scored);
    expect(ranked[0].slug).toBe("on");
  });
});

describe("filterCandidates", () => {
  const today = "2026-06-16";
  it("drops full, past-deadline, and already-engaged missions", () => {
    const missions = [
      mission({ id: "ok", slug: "ok" }),
      mission({ id: "full", slug: "full", quota: 3, filled: 3 }),
      mission({ id: "past", slug: "past", deadline: "2026-06-10" }),
      mission({ id: "eng", slug: "eng" }),
    ];
    const out = filterCandidates(missions, new Set(["eng"]), today);
    expect(out.map((m) => m.slug)).toEqual(["ok"]);
  });
});

describe("rationaleFor", () => {
  it("leads with the lock reason and contains 解鎖", () => {
    const { reasons, rationale } = rationaleFor(mission({ required_level: "L2", category: "美妝" }),
      { category: 1, reward: 0.9, urgency: 1 }, true);
    expect(reasons[0]).toContain("解鎖");
    expect(rationale).toContain("解鎖");
  });
  it("falls back to a recommendation when no signal fires", () => {
    const { rationale } = rationaleFor(mission({ category: null }), { category: 0, reward: 0.1, urgency: 0.2 }, false);
    expect(rationale).toBe("為你推薦");
  });
});

describe("creatorQualifiesForCampaign", () => {
  it("matches on niche + level fit", () => {
    expect(creatorQualifiesForCampaign(creator({ level: "L2", categories: ["beauty"] }), [mission({ category: "beauty", required_level: "L1" })])).toBe(true);
  });
  it("no match when niche differs", () => {
    expect(creatorQualifiesForCampaign(creator({ level: "L2", categories: ["food"] }), [mission({ category: "beauty", required_level: "L1" })])).toBe(false);
  });
  it("no match when under-level even if niche fits", () => {
    expect(creatorQualifiesForCampaign(creator({ level: "L0", categories: ["beauty"] }), [mission({ category: "beauty", required_level: "L3" })])).toBe(false);
  });
  it("EXCLUDES no-niche creators (categoryTerm 0.5, never 1)", () => {
    expect(creatorQualifiesForCampaign(creator({ level: "L2", categories: [] }), [mission({ category: "beauty", required_level: "L1" })])).toBe(false);
  });
  it("matches if ANY mission in the set qualifies", () => {
    expect(creatorQualifiesForCampaign(creator({ level: "L1", categories: ["food"] }), [mission({ category: "beauty", required_level: "L1" }), mission({ category: "food", required_level: "L1" })])).toBe(true);
  });
});
