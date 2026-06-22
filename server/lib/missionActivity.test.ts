import { describe, it, expect } from "vitest";
import { shapeMissionActivity, type MissionActivityRow } from "./missionActivity";

let n = 0;
function row(over: Partial<MissionActivityRow> & { status: string }): MissionActivityRow {
  return {
    id: over.id ?? `s${n++}`,
    mission_id: over.mission_id ?? "m1",
    creator_id: over.creator_id ?? "c1",
    status: over.status,
    content_urls: over.content_urls ?? null,
    submitted_at: over.submitted_at ?? null,
    created_at: over.created_at ?? "2026-06-01T00:00:00Z",
    creators: over.creators ?? { display_name: "C" },
    missions: over.missions ?? { slug: "m1", title: "M1", points_reward: 100 },
    creator_review: over.creator_review ?? { status: "needs_review", risk_level: "unknown" },
    mission_shortlist: over.mission_shortlist ?? null,
  };
}

describe("shapeMissionActivity", () => {
  it("buckets by status and computes fill", () => {
    const out = shapeMissionActivity({ filled: 3, quota: 10 }, [
      row({ status: "applied" }),
      row({ status: "submitted" }),
      row({ status: "under_review" }),
      row({ status: "joined" }),
      row({ status: "approved" }),
    ]);
    expect(out.applicants).toHaveLength(1);
    expect(out.submissions).toHaveLength(2);
    expect(out.engaged).toHaveLength(2);
    expect(out.fill).toEqual({ filled: 3, quota: 10 });
  });

  it("handles an empty mission and null fill/quota", () => {
    const out = shapeMissionActivity({ filled: null, quota: null }, []);
    expect(out.applicants).toEqual([]);
    expect(out.submissions).toEqual([]);
    expect(out.engaged).toEqual([]);
    expect(out.fill).toEqual({ filled: 0, quota: 0 });
  });
});
