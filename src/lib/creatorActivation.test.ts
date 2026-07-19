import { describe, expect, it } from "vitest";
import type { Me, MissionMatch, MyMission, SocialAccount } from "./queries/kocmax";
import { deriveCreatorActivation, type CreatorActivationInput } from "./creatorActivation";

const me = (overrides: Partial<Me> = {}): Me => ({
  id: "creator-1",
  level: "L0",
  xp: 0,
  onboarding_step: 1,
  onboarding_completed: false,
  categories: [],
  social_handles: [],
  ...overrides,
});

const social = (overrides: Partial<SocialAccount> = {}): SocialAccount => ({
  id: "social-1",
  platform: "instagram",
  handle: "creator",
  owner_verified: false,
  sync_status: "pending",
  ...overrides,
});

const mission = (overrides: Partial<MyMission> = {}): MyMission => ({
  id: "submission-1",
  status: "joined",
  content_urls: [],
  points_awarded: 0,
  created_at: "2026-07-14T00:00:00.000Z",
  missions: {
    slug: "first-brief",
    title: "First brief",
    points_reward: 0,
    mission_type: "content",
  },
  ...overrides,
});

const match = (overrides: Partial<MissionMatch> = {}): MissionMatch => ({
  id: "mission-1",
  slug: "recommended-brief",
  title: "Recommended brief",
  mission_type: "content",
  required_level: "L0",
  points_reward: 0,
  quota: 10,
  filled: 0,
  fit_score: 70,
  reasons: [],
  rationale: "",
  locked: false,
  ...overrides,
});

describe("deriveCreatorActivation readiness", () => {
  it("uses five exact 20-point evidence milestones from 0 through 100", () => {
    const cases: Array<[CreatorActivationInput, number]> = [
      [{}, 0],
      [{ me: me() }, 20],
      [{ me: me(), onboarding: { onboarding_step: 5, onboarding_completed: true, completion_pct: 100 } }, 40],
      [{ me: me({ categories: ["beauty"] }), onboarding: { onboarding_step: 5, onboarding_completed: true, completion_pct: 100 } }, 60],
      [{ me: me({ categories: ["beauty"] }), onboarding: { onboarding_step: 5, onboarding_completed: true, completion_pct: 100 }, socialAccounts: [social()] }, 80],
      [{ me: me({ categories: ["beauty"] }), onboarding: { onboarding_step: 5, onboarding_completed: true, completion_pct: 100 }, socialAccounts: [social({ owner_verified: true })] }, 100],
    ];

    for (const [input, expected] of cases) {
      const snapshot = deriveCreatorActivation(input);
      expect(snapshot.completedReadinessWeight).toBe(expected);
      expect(snapshot.readinessPercent).toBe(expected);
      expect(snapshot.totalReadinessWeight).toBe(100);
    }
  });

  it("counts a self-reported handle as social entry but not ownership verification", () => {
    const snapshot = deriveCreatorActivation({
      me: me({ social_handles: [{ platform: "instagram", handle: "creator", verified: true }] }),
    });

    expect(snapshot.milestones.find(({ id }) => id === "social_added")?.state).toBe("complete");
    expect(snapshot.milestones.find(({ id }) => id === "social_verified")?.state).toBe("recommended");
    expect(snapshot.readinessPercent).toBe(40);
  });

  it("keeps payment and first-mission milestones visible without changing readiness weight", () => {
    const snapshot = deriveCreatorActivation({ me: me(), myMissions: [mission()] });
    const nonWeighted = snapshot.milestones.filter(({ id }) =>
      ["payment_ready", "first_mission_viewed", "first_mission_joined"].includes(id),
    );

    expect(nonWeighted.map(({ id }) => id)).toEqual([
      "payment_ready",
      "first_mission_viewed",
      "first_mission_joined",
    ]);
    expect(nonWeighted.every(({ countsTowardReadiness, weight }) => !countsTowardReadiness && weight === 0)).toBe(true);
    expect(snapshot.readinessPercent).toBe(20);
  });

  it("sorts suitable matches by fit score without mutating the query data", () => {
    const matches = [match({ id: "low", fit_score: 20 }), match({ id: "high", fit_score: 95 })];

    const snapshot = deriveCreatorActivation({ me: me({ onboarding_completed: true }), missionMatches: matches });

    expect(snapshot.suitableMissions.map(({ id }) => id)).toEqual(["high", "low"]);
    expect(matches.map(({ id }) => id)).toEqual(["low", "high"]);
  });

  it("marks durable activation only with completed onboarding and evidence of a joined mission", () => {
    expect(deriveCreatorActivation({ me: me({ onboarding_completed: true }) }).activated).toBe(false);
    expect(deriveCreatorActivation({ me: me(), myMissions: [mission({ status: "approved" })] }).activated).toBe(false);
    expect(
      deriveCreatorActivation({ me: me({ onboarding_completed: true }), myMissions: [mission({ status: "approved" })] })
        .activated,
    ).toBe(true);
  });
});

describe("deriveCreatorActivation next-best action", () => {
  it("prioritizes proof submission for a currently joined mission", () => {
    const snapshot = deriveCreatorActivation({ me: me(), myMissions: [mission()] });

    expect(snapshot.nextAction).toMatchObject({
      kind: "submit_proof",
      to: "/mission/first-brief",
      missionType: "content",
    });
  });

  it("opens the active workspace for a joined active-workflow submission", () => {
    const active = mission({
      id: "sub-active",
      creator_workflow_mode: "active_workspace",
      active_workflow_id: "workflow-1",
      missions: {
        slug: "active-brief",
        title: "Active brief",
        points_reward: 0,
        mission_type: "content",
        creator_workflow_mode: "active_workspace",
      },
    });

    expect(deriveCreatorActivation({ me: me(), myMissions: [active] }).nextAction.to).toBe("/my/sub-active");
  });

  it("resumes incomplete onboarding when no mission is joined", () => {
    expect(deriveCreatorActivation({ me: me() }).nextAction).toMatchObject({
      kind: "resume_onboarding",
      to: "/onboarding",
    });
  });

  it("improves the profile when a match is locked and no social ownership is verified", () => {
    const snapshot = deriveCreatorActivation({
      me: me({ onboarding_completed: true, categories: ["beauty"] }),
      missionMatches: [match({ locked: true })],
    });

    expect(snapshot.nextAction).toMatchObject({ kind: "improve_profile", to: "/profile" });
  });

  it("views the highest-scoring unlocked recommendation", () => {
    const snapshot = deriveCreatorActivation({
      me: me({ onboarding_completed: true, categories: ["beauty"] }),
      socialAccounts: [social({ owner_verified: true })],
      missionMatches: [
        match({ id: "second", slug: "second", fit_score: 60 }),
        match({ id: "first", slug: "first", fit_score: 92 }),
        match({ id: "locked", slug: "locked", fit_score: 99, locked: true }),
      ],
    });

    expect(snapshot.nextAction).toMatchObject({
      kind: "view_recommended_mission",
      to: "/mission/first",
      missionId: "first",
    });
  });

  it("sets preferences after onboarding when no recommendation is available", () => {
    const snapshot = deriveCreatorActivation({ me: me({ onboarding_completed: true }) });

    expect(snapshot.nextAction).toMatchObject({ kind: "set_preferences", to: "/profile" });
  });

  it("falls back to growth review", () => {
    const snapshot = deriveCreatorActivation({ me: me({ onboarding_completed: true, categories: ["beauty"] }) });

    expect(snapshot.nextAction).toMatchObject({ kind: "review_growth", to: "/guide" });
  });
});
