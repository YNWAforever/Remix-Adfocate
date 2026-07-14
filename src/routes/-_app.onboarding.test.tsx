import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { dict } from "@/lib/i18n.dict";

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    Link: (p: { children: React.ReactNode; to: string; className?: string }) => (
      <a href={p.to} className={p.className}>{p.children}</a>
    ),
  };
});

const hoisted = vi.hoisted(() => ({
  saveProfile: vi.fn(),
  connectSocial: vi.fn(),
  complete: vi.fn(),
  onboardingStep: 2,
  statusLoading: false,
  statusError: null as Error | null,
  meData: {
    id: "creator-1",
    level: "L1",
    xp: 0,
    categories: [] as string[],
    social_handles: [] as Array<{ platform: string; handle: string }>,
    onboarding_step: 2,
    onboarding_completed: false,
  },
  recommendedData: [{ id: "1", slug: "m1", title: "美容體驗", category: "美容", points_reward: 300 }],
  recommendedLoading: false,
  recommendedError: null as Error | null,
  recommendedRefetch: vi.fn(),
  track: vi.fn(),
}));
vi.mock("@/lib/queries/kocmax", () => ({
  useMe: () => ({ data: hoisted.meData, isLoading: false, error: null }),
  useOnboardingStatus: () => ({ data: hoisted.statusLoading ? undefined : { onboarding_step: hoisted.onboardingStep, onboarding_completed: false, completion_pct: 25 }, isLoading: hoisted.statusLoading, error: hoisted.statusError, refetch: vi.fn() }),
  useRecommendedMissions: () => ({ data: hoisted.recommendedData, isLoading: hoisted.recommendedLoading, error: hoisted.recommendedError, refetch: hoisted.recommendedRefetch }),
  useSaveProfile: () => ({ mutateAsync: hoisted.saveProfile, isPending: false }),
  useConnectSocial: () => ({ mutateAsync: hoisted.connectSocial, isPending: false }),
  useCompleteOnboarding: () => ({ mutateAsync: hoisted.complete, isPending: false }),
}));
vi.mock("@/lib/activationAnalytics", () => ({ trackActivationEvent: hoisted.track }));

import { Route } from "./_app.onboarding";

vi.spyOn(Route, "useParams").mockReturnValue({ slug: "demo" } as never);

function renderWizard() {
  const Wizard = Route.options.component as React.ComponentType;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <Wizard />
    </QueryClientProvider>,
  );
  return { ...rendered, queryClient, invalidateSpy };
}

describe("Onboarding wizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.onboardingStep = 2;
    hoisted.statusLoading = false;
    hoisted.statusError = null;
    hoisted.meData = { id: "creator-1", level: "L1", xp: 0, categories: [], social_handles: [], onboarding_step: 2, onboarding_completed: false };
    hoisted.recommendedData = [{ id: "1", slug: "m1", title: "美容體驗", category: "美容", points_reward: 300 }];
    hoisted.recommendedLoading = false;
    hoisted.recommendedError = null;
    hoisted.saveProfile.mockResolvedValue({ onboarding_step: 3 });
    hoisted.connectSocial.mockResolvedValue({ social_handles: [] });
    hoisted.complete.mockResolvedValue({ referral_code: "ABCD1234", onboarding_completed: true, onboarding_step: 5 });
  });

  it("starts at the categories step (step 2)", () => {
    renderWizard();
    expect(screen.getByText("你的範疇")).toBeInTheDocument();
  });

  it("first-run primer (step 1): persists step 2 before advancing to categories", async () => {
    hoisted.onboardingStep = 1;
    renderWizard();
    // primer screen shows first
    expect(screen.getByText("你的成長階梯")).toBeInTheDocument();
    fireEvent.click(screen.getByText("開始"));
    // must persist step 2 so the primer is one-time (survives a reload)
    await waitFor(() => expect(hoisted.saveProfile).toHaveBeenCalledWith({ step: 2 }));
    expect(await screen.findByText("你的範疇")).toBeInTheDocument();
  });

  it("saves selected categories and advances to platforms", async () => {
    renderWizard();
    fireEvent.click(screen.getByText("美容"));
    fireEvent.click(screen.getByText("下一步"));
    await waitFor(() => expect(hoisted.saveProfile).toHaveBeenCalledWith({ categories: ["美容"], step: 3 }));
    expect(screen.getByText("你的平台")).toBeInTheDocument();
  });

  it("can skip categories and still advance", async () => {
    renderWizard();
    fireEvent.click(screen.getByText("略過"));
    await waitFor(() => expect(hoisted.saveProfile).toHaveBeenCalledWith({ categories: [], step: 3 }));
    expect(screen.getByText("你的平台")).toBeInTheDocument();
  });

  it("reaches the welcome step and completes, revealing the referral code", async () => {
    renderWizard();
    fireEvent.click(screen.getByText("略過"));
    await screen.findByText("你的平台");
    fireEvent.click(screen.getByText("略過"));
    await screen.findByText("你的第一個任務");
    fireEvent.click(screen.getByText("下一步"));
    await screen.findByText("迎新獎賞");
    fireEvent.click(screen.getByText("領取 100 積分"));
    await waitFor(() => expect(hoisted.complete).toHaveBeenCalled());
    expect(await screen.findByText(/ABCD1234/)).toBeInTheDocument();
  });

  it("waits for async status and resumes at the persisted server step", async () => {
    hoisted.onboardingStep = 4;
    hoisted.statusLoading = true;
    const view = renderWizard();

    expect(screen.getByRole("status")).toHaveTextContent(dict.zh["app.onboarding.loading"]);
    hoisted.statusLoading = false;
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        {(() => { const Wizard = Route.options.component as React.ComponentType; return <Wizard />; })()}
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: dict.zh["app.onboarding.missionsTitle"] })).toBeInTheDocument();
  });

  it("accepts newer server progress without overwriting an intentional local Back", async () => {
    const view = renderWizard();
    expect(screen.getByRole("heading", { name: dict.zh["app.onboarding.categoriesTitle"] })).toBeInTheDocument();

    hoisted.onboardingStep = 4;
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        {(() => { const Wizard = Route.options.component as React.ComponentType; return <Wizard />; })()}
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("heading", { name: dict.zh["app.onboarding.missionsTitle"] })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: dict.zh["common.back"] }));
    expect(await screen.findByRole("heading", { name: dict.zh["app.onboarding.platformsTitle"] })).toBeInTheDocument();

    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        {(() => { const Wizard = Route.options.component as React.ComponentType; return <Wizard />; })()}
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { name: dict.zh["app.onboarding.platformsTitle"] })).toBeInTheDocument();
  });

  it("updates onboarding cache after successful step and completion mutations", async () => {
    const firstView = renderWizard();
    fireEvent.click(screen.getByRole("button", { name: dict.zh["app.onboarding.next"] }));
    await waitFor(() => expect(hoisted.saveProfile).toHaveBeenCalledWith({ categories: [], step: 3 }));
    expect(firstView.queryClient.getQueryData(["onboarding-status"])).toMatchObject({ onboarding_step: 3 });
    firstView.unmount();

    hoisted.onboardingStep = 5;
    const completionView = renderWizard();
    fireEvent.click(screen.getByRole("button", { name: dict.zh["app.onboarding.claimCta"] }));
    await waitFor(() => expect(hoisted.complete).toHaveBeenCalled());
    expect(completionView.queryClient.getQueryData(["onboarding-status"])).toMatchObject({
      onboarding_step: 5,
      onboarding_completed: true,
    });
  });

  it("deduplicates analytics when revisiting a server-confirmed step", async () => {
    hoisted.onboardingStep = 3;
    renderWizard();

    const back = () => fireEvent.click(screen.getByRole("button", { name: dict.zh["common.back"] }));
    back();
    expect(await screen.findByRole("heading", { name: dict.zh["app.onboarding.categoriesTitle"] })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: dict.zh["app.onboarding.next"] }));
    expect(await screen.findByRole("heading", { name: dict.zh["app.onboarding.platformsTitle"] })).toBeInTheDocument();
    back();

    const completedStepTwo = hoisted.track.mock.calls.filter(
      ([event, payload]) => event === "onboarding_step_completed" && payload.step === 2,
    );
    const abandonedStepThree = hoisted.track.mock.calls.filter(
      ([event, payload]) => event === "onboarding_abandoned" && payload.step === 3,
    );
    expect(completedStepTwo).toHaveLength(0);
    expect(abandonedStepThree).toHaveLength(1);
  });

  it("seeds interests from /me and requires discard before dirty Back", async () => {
    hoisted.meData = { ...hoisted.meData, categories: ["美容"] };
    renderWizard();
    const beauty = screen.getByRole("button", { name: dict.zh["app.category.beauty"] });
    expect(beauty).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: dict.zh["app.category.tech"] }));
    fireEvent.click(screen.getByRole("button", { name: dict.zh["common.back"] }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: dict.zh["common.cancel"] }));
    expect(screen.getByRole("heading", { name: dict.zh["app.onboarding.categoriesTitle"] })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: dict.zh["common.back"] }));
    fireEvent.click(screen.getByRole("button", { name: dict.zh["app.onboarding.discardConfirm"] }));
    expect(await screen.findByRole("heading", { name: dict.zh["app.onboarding.primerTitle"] })).toBeInTheDocument();
  });

  it("renders visible social labels, preserves values, and retries only failed work", async () => {
    hoisted.onboardingStep = 3;
    hoisted.connectSocial
      .mockResolvedValueOnce({ social_handles: [] })
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({ social_handles: [] });
    renderWizard();

    const instagramLabel = dict.zh["common.platformHandleLabel"].replace("{platform}", "Instagram");
    const tiktokLabel = dict.zh["common.platformHandleLabel"].replace("{platform}", "TikTok");
    expect(screen.getByText(instagramLabel, { selector: "label" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(instagramLabel), { target: { value: "creator.ig" } });
    fireEvent.change(screen.getByLabelText(tiktokLabel), { target: { value: "creator.tt" } });
    fireEvent.click(screen.getByRole("button", { name: dict.zh["app.onboarding.next"] }));

    expect(await screen.findByRole("alert")).toHaveTextContent(dict.zh["common.saveError"]);
    expect(screen.getByLabelText(tiktokLabel)).toHaveValue("creator.tt");
    fireEvent.click(screen.getByRole("button", { name: dict.zh["app.onboarding.next"] }));

    await waitFor(() => expect(hoisted.saveProfile).toHaveBeenCalledWith({ step: 4 }));
    expect(hoisted.connectSocial.mock.calls.filter(([body]) => body.platform === "Instagram")).toHaveLength(1);
    expect(hoisted.connectSocial.mock.calls.filter(([body]) => body.platform === "TikTok")).toHaveLength(2);
  });

  it("keeps a case-normalized seeded handle editable", () => {
    hoisted.onboardingStep = 3;
    hoisted.meData = {
      ...hoisted.meData,
      social_handles: [{ platform: "instagram", handle: "old.handle" }],
    };
    renderWizard();

    const label = dict.zh["common.platformHandleLabel"].replace("{platform}", "Instagram");
    const input = screen.getByLabelText(label);
    expect(input).toHaveValue("old.handle");
    fireEvent.change(input, { target: { value: "new.handle" } });
    expect(input).toHaveValue("new.handle");
  });

  it("omits empty social handles and records a skipped step without PII", async () => {
    hoisted.onboardingStep = 3;
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: dict.zh["app.onboarding.skip"] }));

    await waitFor(() => expect(hoisted.saveProfile).toHaveBeenCalledWith({ step: 4 }));
    expect(hoisted.connectSocial).not.toHaveBeenCalled();
    expect(hoisted.track).toHaveBeenCalledWith("onboarding_step_completed", { locale: "zh", step: 3, status: "skipped" });
    expect(JSON.stringify(hoisted.track.mock.calls)).not.toContain("handle");
  });

  it("renders recommendation loading, recovery, empty fallbacks, and only real missions", async () => {
    hoisted.onboardingStep = 4;
    hoisted.recommendedLoading = true;
    const view = renderWizard();
    expect(screen.getByText(dict.zh["app.onboarding.recommendationsLoading"]).closest('[role="status"]')).toBeInTheDocument();

    hoisted.recommendedLoading = false;
    hoisted.recommendedError = new Error("offline");
    view.rerender(<QueryClientProvider client={view.queryClient}>{(() => { const Wizard = Route.options.component as React.ComponentType; return <Wizard />; })()}</QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: dict.zh["common.retry"] }));
    expect(hoisted.recommendedRefetch).toHaveBeenCalledOnce();

    hoisted.recommendedError = null;
    hoisted.recommendedData = [];
    view.rerender(<QueryClientProvider client={view.queryClient}>{(() => { const Wizard = Route.options.component as React.ComponentType; return <Wizard />; })()}</QueryClientProvider>);
    expect(await screen.findByText(dict.zh["app.onboarding.recommendationsEmptyTitle"])).toBeInTheDocument();
    expect(screen.getByRole("link", { name: dict.zh["app.onboarding.preferencesAction"] })).toHaveAttribute("href", "/profile");
    expect(screen.getByRole("link", { name: dict.zh["app.onboarding.guideAction"] })).toHaveAttribute("href", "/guide");

    hoisted.recommendedData = [{ id: "real-1", slug: "real", title: "Real API mission", category: "美容", points_reward: 42 }];
    view.rerender(<QueryClientProvider client={view.queryClient}>{(() => { const Wizard = Route.options.component as React.ComponentType; return <Wizard />; })()}</QueryClientProvider>);
    expect(await screen.findByText("Real API mission")).toBeInTheDocument();
  });

  it("shows completion facts only after endpoint success and invalidates creator state", async () => {
    hoisted.onboardingStep = 5;
    const { invalidateSpy } = renderWizard();
    expect(screen.queryByText(dict.zh["app.onboarding.bonusPoints"])).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: dict.zh["app.onboarding.claimCta"] }));
    expect(await screen.findByText("ABCD1234")).toBeInTheDocument();
    expect(screen.getByText(dict.zh["app.onboarding.bonusPoints"])).toBeInTheDocument();
    expect(screen.getByText(/準備度/)).toBeInTheDocument();
    for (const queryKey of [["me"], ["balance"], ["onboarding-status"], ["recommended-missions"]]) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey });
    }
    expect(hoisted.track).toHaveBeenCalledWith("onboarding_completed", { locale: "zh", rewardType: "welcome_points" });
  });
});
