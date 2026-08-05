import { describe, it, expect } from "vitest";
import { shapeLeaderboard, publicDisplayName, myStanding, spotsToPrize, type RankRow } from "./campaignLeaderboard.js";

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

describe("publicDisplayName", () => {
  const id = "3f9c1b2a-0000-4000-8000-000000000001";
  it("masks a bootstrap email display_name", () => {
    const out = publicDisplayName("boot@test.local", id);
    expect(out).toBe("KOC 3F9C");
    expect(out).not.toContain("boot");
    expect(out).not.toContain("@");
  });
  it("masks a bootstrap E.164 phone display_name (with or without '+', separators)", () => {
    expect(publicDisplayName("+15555550100", id)).toBe("KOC 3F9C");
    expect(publicDisplayName("15555550100", id)).toBe("KOC 3F9C");
    expect(publicDisplayName("+1 (555) 555-0100", id)).toBe("KOC 3F9C");
  });
  it("passes a real display name through untouched", () => {
    expect(publicDisplayName("Amy", id)).toBe("Amy");
    expect(publicDisplayName("小美 KOC", id)).toBe("小美 KOC");
    expect(publicDisplayName("KOC", id)).toBe("KOC");
    expect(publicDisplayName("@amywong", id)).toBe("@amywong");
  });
  it("is deterministic per creator and differs between creators", () => {
    const other = "8ab4cd00-0000-4000-8000-000000000002";
    expect(publicDisplayName("boot@test.local", id)).toBe(publicDisplayName("boot@test.local", id));
    expect(publicDisplayName("+15555550100", id)).toBe(publicDisplayName("boot@test.local", id));
    expect(publicDisplayName("boot@test.local", other)).not.toBe(publicDisplayName("boot@test.local", id));
  });
  it("keeps a missing name empty", () => {
    expect(publicDisplayName(null, id)).toBe("");
    expect(publicDisplayName("   ", id)).toBe("");
  });
});

describe("shapeLeaderboard contact masking", () => {
  const contactRows: RankRow[] = [
    { creator_id: "3f9c1b2a-0000-4000-8000-000000000001", rank: 1, approved: 2, avg_quality: 0 },
    { creator_id: "8ab4cd00-0000-4000-8000-000000000002", rank: 2, approved: 1, avg_quality: 0 },
  ];
  it("never emits contact information, but keeps real names", () => {
    const out = shapeLeaderboard(contactRows, [
      { id: contactRows[0].creator_id, display_name: "koc@example.com" },
      { id: contactRows[1].creator_id, display_name: "Amy" },
    ]);
    expect(out[0].display_name).toBe("KOC 3F9C");
    expect(out[1].display_name).toBe("Amy");
    expect(out[0].creator_id).toBe(contactRows[0].creator_id); // own-row match still available
  });
  it("reveals raw names only when the caller opts in", () => {
    const out = shapeLeaderboard(contactRows, [
      { id: contactRows[0].creator_id, display_name: "koc@example.com" },
    ], undefined, { revealContactNames: true });
    expect(out[0].display_name).toBe("koc@example.com");
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

describe("shapeLeaderboard movement", () => {
  it("computes movement vs previous ranks (up/down/new/unchanged)", () => {
    const rows = [
      { creator_id: "a", rank: 1, approved: 5, avg_quality: 0 },
      { creator_id: "b", rank: 2, approved: 3, avg_quality: 0 },
      { creator_id: "c", rank: 3, approved: 1, avg_quality: 0 },
    ];
    const profiles = rows.map((r) => ({ id: r.creator_id, display_name: r.creator_id }));
    const prev = new Map([["a", 2], ["b", 2], ["c", 5]]); // a 2→1 (+1), b unchanged (0), c 5→3 (+2)
    const out = shapeLeaderboard(rows, profiles, prev);
    expect(out.find((e) => e.creator_id === "a")!.movement).toBe(1);
    expect(out.find((e) => e.creator_id === "b")!.movement).toBe(0);
    expect(out.find((e) => e.creator_id === "c")!.movement).toBe(2);
  });
  it("movement is null when no previous rank exists (NEW)", () => {
    const out = shapeLeaderboard([{ creator_id: "z", rank: 1, approved: 1, avg_quality: 0 }],
      [{ id: "z", display_name: "Z" }], new Map());
    expect(out[0].movement).toBeNull();
  });
  it("back-compat: omitting prevRanks yields null movement", () => {
    const out = shapeLeaderboard([{ creator_id: "z", rank: 1, approved: 1, avg_quality: 0 }],
      [{ id: "z", display_name: "Z" }]);
    expect(out[0].movement).toBeNull();
  });
});
