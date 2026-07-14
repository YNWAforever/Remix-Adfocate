import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCreatorActivation } from "./useCreatorActivation";

const hooks = vi.hoisted(() => ({
  useMe: vi.fn(),
  useOnboardingStatus: vi.fn(),
  useSocialAccounts: vi.fn(),
  useMyMissions: vi.fn(),
  useMissionMatch: vi.fn(),
  useEarnings: vi.fn(),
}));

vi.mock("./queries/kocmax", () => hooks);

function query<T>(data: T, error: Error | null = null) {
  return {
    data,
    isLoading: false,
    error,
    refetch: vi.fn().mockResolvedValue({ data }),
  };
}

const creator = {
  id: "creator-1",
  level: "L0",
  xp: 0,
  onboarding_step: 5,
  onboarding_completed: true,
  categories: ["beauty"],
  social_handles: [],
};

const joinedMission = {
  id: "submission-1",
  status: "joined",
  content_urls: [],
  points_awarded: 0,
  created_at: "2026-07-14T00:00:00.000Z",
  missions: { slug: "brief", title: "Brief", points_reward: 0, mission_type: "content" },
};

const recommendation = {
  id: "mission-1",
  slug: "recommended",
  title: "Recommended",
  mission_type: "content",
  required_level: "L0",
  points_reward: 0,
  quota: 10,
  filled: 0,
  fit_score: 80,
  reasons: [],
  rationale: "",
  locked: false,
};

function setSuccessfulQueries() {
  hooks.useMe.mockReturnValue(query(creator));
  hooks.useOnboardingStatus.mockReturnValue(
    query({ onboarding_step: 5, onboarding_completed: true, completion_pct: 100 }),
  );
  hooks.useSocialAccounts.mockReturnValue(
    query([{ id: "social-1", platform: "instagram", handle: "creator", owner_verified: true, sync_status: "synced" }]),
  );
  hooks.useMyMissions.mockReturnValue(query([joinedMission]));
  hooks.useMissionMatch.mockReturnValue(query([recommendation]));
  hooks.useEarnings.mockReturnValue(query({ available: 100, pending: 25 }));
}

describe("useCreatorActivation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSuccessfulQueries();
  });

  it("composes the six existing queries into a snapshot and independent sections", () => {
    const { result } = renderHook(() => useCreatorActivation());

    expect(result.current.snapshot).toMatchObject({
      readinessPercent: 100,
      activated: true,
      nextAction: { kind: "submit_proof" },
    });
    expect(result.current.me.data).toBe(creator);
    expect(result.current.activeMissions.data).toEqual([joinedMission]);
    expect(result.current.recommendations.data).toEqual([recommendation]);
    expect(result.current.earnings.data).toEqual({ available: 100, pending: 25 });
    expect(result.current.readiness.data).toMatchObject({ readinessPercent: 100, totalReadinessWeight: 100 });
    expect(result.current.me.loading).toBe(false);
    expect(result.current.activeMissions.error).toBeNull();
    expect(typeof result.current.readiness.refetch).toBe("function");
    expect(hooks.useMe).toHaveBeenCalledOnce();
    expect(hooks.useOnboardingStatus).toHaveBeenCalledOnce();
    expect(hooks.useSocialAccounts).toHaveBeenCalledOnce();
    expect(hooks.useMyMissions).toHaveBeenCalledOnce();
    expect(hooks.useMissionMatch).toHaveBeenCalledOnce();
    expect(hooks.useEarnings).toHaveBeenCalledOnce();
  });

  it("isolates an earnings failure to the earnings section", () => {
    const failure = new Error("earnings unavailable");
    hooks.useEarnings.mockReturnValue(query(undefined, failure));

    const { result } = renderHook(() => useCreatorActivation());

    expect(result.current.earnings.error).toBe(failure);
    expect(result.current.me.error).toBeNull();
    expect(result.current.recommendations.error).toBeNull();
    expect(result.current.readiness.error).toBeNull();
    expect(result.current.snapshot.readinessPercent).toBe(100);
  });

  it("isolates a recommendation failure to the recommendations section", () => {
    const failure = new Error("recommendations unavailable");
    hooks.useMissionMatch.mockReturnValue(query(undefined, failure));

    const { result } = renderHook(() => useCreatorActivation());

    expect(result.current.recommendations.error).toBe(failure);
    expect(result.current.me.error).toBeNull();
    expect(result.current.activeMissions.error).toBeNull();
    expect(result.current.earnings.error).toBeNull();
    expect(result.current.readiness.error).toBeNull();
  });

  it("isolates a social failure to readiness while preserving the other sections", () => {
    const failure = new Error("social unavailable");
    hooks.useSocialAccounts.mockReturnValue(query(undefined, failure));

    const { result } = renderHook(() => useCreatorActivation());

    expect(result.current.readiness.error).toBe(failure);
    expect(result.current.me.error).toBeNull();
    expect(result.current.activeMissions.error).toBeNull();
    expect(result.current.recommendations.error).toBeNull();
    expect(result.current.earnings.error).toBeNull();
    expect(result.current.snapshot.nextAction.kind).toBe("submit_proof");
  });
});
