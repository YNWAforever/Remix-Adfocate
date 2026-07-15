import { describe, expect, it } from "vitest";
import type { Me, MyMission } from "./queries/kocmax";
import { deriveCreatorActivation } from "./creatorActivation";

const creator: Me = {
  id: "creator-1",
  level: "L0",
  xp: 0,
  onboarding_step: 5,
  onboarding_completed: true,
  categories: ["beauty"],
  social_handles: [],
};

const mission = (status: MyMission["status"]): MyMission => ({
  id: `submission-${status}`,
  status,
  content_urls: [],
  points_awarded: 0,
  created_at: "2026-07-14T00:00:00.000Z",
  missions: {
    slug: "first-brief",
    title: "First brief",
    points_reward: 0,
    mission_type: "content",
  },
});

describe("deriveCreatorActivation mission status evidence", () => {
  it.each([
    ["applied", false],
    ["declined", false],
    ["expired", true],
  ] as const)("treats %s as joined evidence: %s", (status, joined) => {
    const snapshot = deriveCreatorActivation({ me: creator, myMissions: [mission(status)] });
    const milestone = snapshot.milestones.find(({ id }) => id === "first_mission_joined");

    expect(milestone?.state === "complete").toBe(joined);
    expect(snapshot.activated).toBe(joined);
  });
});
