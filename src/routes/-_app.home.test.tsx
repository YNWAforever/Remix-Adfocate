import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import { dict } from "@/lib/i18n.dict";
import type { MissionMatch, MyMission } from "@/lib/queries/kocmax";
import type { UseCreatorActivationResult } from "@/lib/useCreatorActivation";

const mocks = vi.hoisted<{
  track: ReturnType<typeof vi.fn>;
  activation: UseCreatorActivationResult;
  balance: {
    data: { balance: number; available_to: string | null } | undefined;
    isLoading: boolean;
    isError: boolean;
  };
}>(() => ({
  track: vi.fn(),
  balance: {
    data: { balance: 0, available_to: null },
    isLoading: false,
    isError: false,
  },
  activation: {
    snapshot: {
      readinessPercent: 60,
      completedReadinessWeight: 60,
      totalReadinessWeight: 100 as const,
      milestones: [],
      nextAction: {
        kind: "view_recommended_mission",
        titleKey: "app.activation.next.viewRecommendedMission.title",
        bodyKey: "app.activation.next.viewRecommendedMission.body",
        to: "/mission/recommended",
        ctaKey: "app.activation.next.viewRecommendedMission.cta",
        missionId: "mission-1",
        missionType: "content_creation",
      },
      activeMissions: [],
      suitableMissions: [],
      activated: false,
    },
    me: {
      data: { id: "u1", display_name: "阿明", avatar_url: null, level: "L1", effective_level: "L1", xp: 0, onboarding_step: 0, onboarding_completed: true },
      loading: false,
      error: null,
      refetch: vi.fn(),
    },
    activeMissions: { data: [], loading: false, error: null, refetch: vi.fn() },
    recommendations: { data: [], loading: false, error: null, refetch: vi.fn() },
    earnings: { data: { available: 125, pending: 75 }, loading: false, error: null, refetch: vi.fn() },
    readiness: {
      data: { readinessPercent: 60, completedReadinessWeight: 60, totalReadinessWeight: 100 as const, milestones: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    },
  },
}));

const unlockedMission: MissionMatch = {
  id: "mission-1", slug: "recommended", title: "推薦美容任務", category: "美容", points_reward: 300,
  deadline: "2026-08-31T00:00:00Z", locked: false, fit_score: 0.92, rationale: "符合你的美容內容經驗",
  reasons: ["beauty_experience"], required_level: "L1", quota: 20, filled: 5,
  mission_type: "content_creation", cash_reward: 800,
};
const lockedMission = { ...unlockedMission, id: "mission-locked", slug: "locked", title: "未解鎖任務", locked: true };

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode } & Record<string, unknown>) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
  };
});

vi.mock("@/lib/queries/kocmax", () => ({
  useMe: () => ({ data: { id: "u1", display_name: "阿明", avatar_url: null, level: "L1", effective_level: "L1", is_trusted: false }, isLoading: false }),
  useBalance: () => mocks.balance,
  useMissions: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock("@/lib/useRealtimeBalance", () => ({ useRealtimeBalance: vi.fn() }));
vi.mock("@/lib/useCreatorActivation", () => ({ useCreatorActivation: () => mocks.activation }));
vi.mock("@/lib/activationAnalytics", () => ({
  trackActivationEvent: (...args: unknown[]) => mocks.track(...args),
}));
vi.mock("@/lib/content", () => ({
  contentKeys: { news: () => ["news"] },
  fetchNews: vi.fn(async () => ({ items: [] })),
}));

import { Route } from "./_app.home";
vi.spyOn(Route, "useParams").mockReturnValue({ slug: "demo" } as never);

function renderHome() {
  const C = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider>
        <C />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

function setRecommendations(items: typeof unlockedMission[], error: Error | null = null) {
  mocks.activation.recommendations = { data: items, loading: false, error, refetch: vi.fn() };
  mocks.activation.snapshot.suitableMissions = items;
}

function expectBefore(first: HTMLElement, second: HTMLElement) {
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

function resetActivation() {
  mocks.balance = {
    data: { balance: 0, available_to: null },
    isLoading: false,
    isError: false,
  };
  mocks.activation.snapshot.nextAction = {
    kind: "view_recommended_mission",
    titleKey: "app.activation.next.viewRecommendedMission.title",
    bodyKey: "app.activation.next.viewRecommendedMission.body",
    to: "/mission/recommended",
    ctaKey: "app.activation.next.viewRecommendedMission.cta",
    missionId: "mission-1",
    missionType: "content_creation",
  };
  mocks.activation.snapshot.activeMissions = [];
  mocks.activation.snapshot.suitableMissions = [];
  mocks.activation.snapshot.activated = false;
  mocks.activation.activeMissions = {
    data: [], loading: false, error: null, refetch: vi.fn(),
  };
  mocks.activation.recommendations = {
    data: [], loading: false, error: null, refetch: vi.fn(),
  };
  mocks.activation.earnings = {
    data: { available: 125, pending: 75 }, loading: false, error: null, refetch: vi.fn(),
  };
  mocks.activation.readiness = {
    data: { readinessPercent: 60, completedReadinessWeight: 60, totalReadinessWeight: 100 as const, milestones: [] },
    loading: false, error: null, refetch: vi.fn(),
  };
}
describe("Home", () => {
  beforeEach(() => {
    window.localStorage.setItem("lang", "zh");
    mocks.track.mockClear();
    resetActivation();
  });

  it("shows an avatar button linking to /profile", () => {
    renderHome();
    const link = screen.getByLabelText("個人檔案");
    expect(link).toHaveAttribute("href", "/profile");
  });

  it("shows a level chip with the effective level label (not raw ID)", () => {
    renderHome();
    // effective_level = "L1" → emoji 🌱, label = "KOC 新手" (zh locale)
    expect(screen.getByText("🌱 KOC 新手")).toBeInTheDocument();
  });

  it("links the level chip to the creator passport", () => {
    renderHome();
    expect(screen.getByLabelText("創作者護照")).toHaveAttribute("href", "/passport");
  });

  it("shows a '今日整乜好' CTA linking to /match", () => {
    renderHome();
    expect(screen.getByLabelText("今日整乜好")).toHaveAttribute("href", "/match");
  });

  it("orders welcome, next action, active work, earnings, recommendations, and readiness", () => {
    const joined: MyMission = {
      id: "submission-1",
      status: "joined",
      content_urls: [],
      points_awarded: 0,
      created_at: "2026-07-14T00:00:00Z",
      missions: { slug: "joined-mission", title: "進行中任務", mission_type: "content_creation", points_reward: 300 },
    };
    mocks.activation.snapshot.nextAction = {
      kind: "submit_proof", titleKey: "app.activation.next.submitProof.title", bodyKey: "app.activation.next.submitProof.body",
      to: "/mission/joined-mission", ctaKey: "app.activation.next.submitProof.cta", missionType: "content_creation",
    };
    mocks.activation.snapshot.activeMissions = [joined];
    mocks.activation.activeMissions = { data: [joined], loading: false, error: null, refetch: vi.fn() };
    setRecommendations([unlockedMission]);

    renderHome();

    const headings = [
      screen.getByRole("heading", { name: /歡迎返嚟/ }),
      screen.getByRole("heading", { name: dict.zh["app.activation.next.submitProof.title"] }),
      screen.getByRole("heading", { name: dict.zh["app.activation.missions.heading"] }),
      screen.getByRole("heading", { name: dict.zh["app.activation.earnings.heading"] }),
      screen.getByRole("heading", { name: dict.zh["app.home.suitableMissions"] }),
      screen.getByRole("heading", { name: dict.zh["app.activation.progress.heading"] }),
    ];
    headings.slice(0, -1).forEach((heading, index) => expectBefore(heading, headings[index + 1]));
    expect(screen.getByRole("link", { name: dict.zh["app.activation.next.submitProof.cta"] })).toHaveAttribute("href", "/mission/joined-mission");
  });

  it("falls back to onboarding when activation says onboarding is next", () => {
    mocks.activation.snapshot.nextAction = {
      kind: "resume_onboarding", titleKey: "app.activation.next.resumeOnboarding.title", bodyKey: "app.activation.next.resumeOnboarding.body",
      to: "/onboarding", ctaKey: "app.activation.next.resumeOnboarding.cta",
    };
    mocks.activation.snapshot.activeMissions = [];
    mocks.activation.activeMissions = { data: [], loading: false, error: null, refetch: vi.fn() };
    renderHome();
    expect(screen.getByRole("link", { name: dict.zh["app.activation.next.resumeOnboarding.cta"] })).toHaveAttribute("href", "/onboarding");
  });

  it("shows only real unlocked suitable recommendations as joinable", () => {
    setRecommendations([unlockedMission, lockedMission]);
    renderHome();
    expect(screen.getByRole("link", { name: /推薦美容任務/ })).toHaveAttribute("href", "/mission/recommended");
    expect(screen.queryByText("未解鎖任務")).not.toBeInTheDocument();
    expect(screen.getByText("符合你的美容內容經驗")).toBeInTheDocument();
  });

  it("keeps mission recommendations visible when earnings fail", () => {
    setRecommendations([unlockedMission]);
    mocks.activation.earnings = { data: undefined, loading: false, error: new Error("wallet failed"), refetch: vi.fn() };
    renderHome();
    expect(screen.getByText(dict.zh["app.activation.earnings.error"])).toBeInTheDocument();
    expect(screen.getByText("推薦美容任務")).toBeInTheDocument();
  });

  it("keeps cached realtime points and recommendations visible when the points query refetch fails", () => {
    setRecommendations([unlockedMission]);
    mocks.balance = {
      data: { balance: 450, available_to: "2026-09-01T00:00:00Z" },
      isLoading: false,
      isError: true,
    };

    renderHome();

    expect(screen.getByRole("alert")).toHaveTextContent(dict.zh["common.balanceError"]);
    expect(screen.getByText("450")).toBeInTheDocument();
    expect(screen.getByText(unlockedMission.title)).toBeInTheDocument();
  });

  it("keeps readiness visible when recommendations fail", () => {
    setRecommendations([], new Error("recommendations failed"));
    renderHome();
    expect(screen.getByText(dict.zh["app.home.recommendationsError"])).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: dict.zh["app.activation.progress.heading"] })).toBeInTheDocument();
  });

  it("offers a useful growth action when all work and recommendations are empty", () => {
    setRecommendations([]);
    mocks.activation.snapshot.nextAction = {
      kind: "review_growth", titleKey: "app.activation.next.reviewGrowth.title", bodyKey: "app.activation.next.reviewGrowth.body",
      to: "/guide", ctaKey: "app.activation.next.reviewGrowth.cta",
    };
    mocks.activation.activeMissions = { data: [], loading: false, error: null, refetch: vi.fn() };
    renderHome();
    expect(screen.getByRole("link", { name: dict.zh["app.activation.next.reviewGrowth.cta"] })).toHaveAttribute("href", "/guide");
    expect(screen.getByText(dict.zh["app.home.recommendationsEmpty"])).toBeInTheDocument();
  });

  it("tracks one PII-free view per dashboard action and rendered recommendation plus action clicks", async () => {
    setRecommendations([unlockedMission, { ...unlockedMission, id: "mission-2", slug: "second", title: "第二個推薦" }]);
    renderHome();

    await waitFor(() => expect(mocks.track).toHaveBeenCalledWith("dashboard_viewed", expect.any(Object)));
    expect(mocks.track.mock.calls.filter(([event]) => event === "dashboard_viewed")).toHaveLength(1);
    expect(mocks.track.mock.calls.filter(([event]) => event === "activation_action_viewed")).toHaveLength(1);
    expect(mocks.track.mock.calls.filter(([event]) => event === "mission_recommendation_viewed")).toHaveLength(2);

    const actionLink = screen.getByRole("link", { name: dict.zh[mocks.activation.snapshot.nextAction.ctaKey] });
    actionLink.addEventListener("click", (event) => event.preventDefault(), { once: true });
    fireEvent.click(actionLink);
    expect(mocks.track).toHaveBeenCalledWith("activation_action_clicked", expect.any(Object));
    const serialized = JSON.stringify(mocks.track.mock.calls);
    expect(serialized).not.toContain("u1");
    expect(serialized).not.toContain("阿明");
    expect(serialized).not.toContain("email");
  });

  it("does not re-emit viewed analytics when the creator changes language", async () => {
    setRecommendations([unlockedMission]);
    renderHome();

    await waitFor(() => expect(mocks.track).toHaveBeenCalledWith("dashboard_viewed", expect.any(Object)));
    const viewCounts = () => ({
      dashboard: mocks.track.mock.calls.filter(([event]) => event === "dashboard_viewed").length,
      action: mocks.track.mock.calls.filter(([event]) => event === "activation_action_viewed").length,
      recommendation: mocks.track.mock.calls.filter(([event]) => event === "mission_recommendation_viewed").length,
    });
    expect(viewCounts()).toEqual({ dashboard: 1, action: 1, recommendation: 1 });

    fireEvent.click(screen.getByRole("button", { name: dict.zh["common.toggleLang"] }));
    await waitFor(() => expect(screen.getByRole("heading", { name: /Welcome back/ })).toBeInTheDocument());

    expect(viewCounts()).toEqual({ dashboard: 1, action: 1, recommendation: 1 });
  });
});
