import { describe, it, expect } from "vitest";
import { shapeEngagedRoster, type EngagedSubmissionRow } from "./engagedRoster";

let n = 0;
function row(over: Partial<EngagedSubmissionRow> & { creator_id: string; status: string }): EngagedSubmissionRow {
  return {
    id: over.id ?? `s${n++}`,
    mission_id: over.mission_id ?? "m1",
    creator_id: over.creator_id,
    status: over.status,
    points_awarded: over.points_awarded ?? 0,
    created_at: over.created_at ?? "2026-06-01T00:00:00Z",
    submitted_at: over.submitted_at ?? null,
    reviewed_at: over.reviewed_at ?? null,
    review_deadline: over.review_deadline ?? null,
    creators: over.creators ?? { id: over.creator_id, display_name: "C", avatar_url: null, level: "L0", xp: 0 },
    missions: over.missions ?? { slug: "m1", title: "Mission 1" },
  };
}

describe("shapeEngagedRoster", () => {
  it("rolls up counts and nests only active missions", () => {
    const roster = shapeEngagedRoster([
      row({ creator_id: "a", status: "joined", mission_id: "m1", missions: { slug: "m1", title: "M1" } }),
      row({ creator_id: "a", status: "submitted", mission_id: "m2", missions: { slug: "m2", title: "M2" } }),
      row({ creator_id: "a", status: "approved", mission_id: "m3", points_awarded: 250 }),
    ]);
    expect(roster).toHaveLength(1);
    const a = roster[0]!;
    expect(a.id).toBe("a");
    expect(a.activeCount).toBe(2);
    expect(a.completedCount).toBe(1);
    expect(a.pointsEarned).toBe(250);
    expect(a.activeMissions.map((m) => m.missionSlug).sort()).toEqual(["m1", "m2"]);
    expect(a.activeMissions.every((m) => m.status !== "approved")).toBe(true);
  });

  it("nests under_review rows as active", () => {
    const roster = shapeEngagedRoster([row({ creator_id: "u", status: "under_review" })]);
    expect(roster[0]!.activeCount).toBe(1);
    expect(roster[0]!.activeMissions[0]!.status).toBe("under_review");
  });

  it("excludes creators whose every participation is terminal (no active)", () => {
    const roster = shapeEngagedRoster([row({ creator_id: "done", status: "approved", points_awarded: 100 })]);
    expect(roster).toEqual([]);
  });

  it("lastActivityAt is the max of created/submitted/reviewed; sorts roster desc", () => {
    const roster = shapeEngagedRoster([
      row({ creator_id: "old", status: "joined", created_at: "2026-06-01T00:00:00Z" }),
      row({ creator_id: "new", status: "submitted", created_at: "2026-06-02T00:00:00Z", submitted_at: "2026-06-05T00:00:00Z", reviewed_at: null }),
    ]);
    expect(roster.map((c) => c.id)).toEqual(["new", "old"]);
    expect(roster[0]!.lastActivityAt).toBe("2026-06-05T00:00:00Z");
  });
});
