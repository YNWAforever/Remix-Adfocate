import { describe, it, expect } from "vitest";
import { shapeLeaderboard, myStanding, spotsToPrize, type RankRow } from "./campaignLeaderboard.js";

const rows: RankRow[] = [
  { creator_id: "a", rank: 1, approved: "5" as unknown as number, avg_quality: "4.5" as unknown as number },
  { creator_id: "b", rank: 2, approved: 3, avg_quality: 0 },
];
const profiles = [
  { id: "a", display_name: "Amy", avatar_url: "ax", level: 4 },
  { id: "b", display_name: null, avatar_url: null, level: null },
];

describe("shapeLeaderboard", () => {
  it("joins profiles and coerces numerics", () => {
    const out = shapeLeaderboard(rows, profiles);
    expect(out[0]).toMatchObject({ creator_id: "a", rank: 1, approved: 5, avg_quality: 4.5, display_name: "Amy", level: 4 });
    expect(out[1].approved).toBe(3);
    expect(out[1].display_name).toBe(""); // null name → empty string, never "null"
  });
  it("tolerates a missing profile (decorates with empty fields)", () => {
    const out = shapeLeaderboard(rows, [{ id: "a", display_name: "Amy", avatar_url: null, level: 1 }]);
    expect(out[1].display_name).toBe("");
  });
});

describe("myStanding", () => {
  it("returns the caller row or null", () => {
    expect(myStanding(rows, "b")?.rank).toBe(2);
    expect(myStanding(rows, "zzz")).toBeNull();
  });
});

describe("spotsToPrize", () => {
  it("0 when inside the cutoff, else the gap", () => {
    expect(spotsToPrize(2, 3)).toBe(0);
    expect(spotsToPrize(5, 3)).toBe(2);
  });
});
