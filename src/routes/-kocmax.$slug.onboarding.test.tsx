import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const hoisted = vi.hoisted(() => ({
  saveProfile: vi.fn(),
  connectSocial: vi.fn(),
  complete: vi.fn(),
}));
vi.mock("@/lib/queries/kocmax", () => ({
  useOnboardingStatus: () => ({ data: { onboarding_step: 2, onboarding_completed: false, completion_pct: 25 }, isLoading: false }),
  useRecommendedMissions: () => ({ data: [{ id: "1", slug: "m1", title: "美容試用", category: "美容", points_reward: 300 }], isLoading: false }),
  useSaveProfile: () => ({ mutateAsync: hoisted.saveProfile, isPending: false }),
  useConnectSocial: () => ({ mutateAsync: hoisted.connectSocial, isPending: false }),
  useCompleteOnboarding: () => ({ mutateAsync: hoisted.complete, isPending: false }),
}));

import { Route } from "./kocmax.$slug.onboarding";

vi.spyOn(Route, "useParams").mockReturnValue({ slug: "demo" } as never);

function renderWizard() {
  const Wizard = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Wizard />
    </QueryClientProvider>,
  );
}

describe("Onboarding wizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.saveProfile.mockResolvedValue({ onboarding_step: 3 });
    hoisted.connectSocial.mockResolvedValue({ social_handles: [] });
    hoisted.complete.mockResolvedValue({ referral_code: "ABCD1234", onboarding_completed: true, onboarding_step: 5 });
  });

  it("starts at the categories step (step 2)", () => {
    renderWizard();
    expect(screen.getByText("你的範疇")).toBeInTheDocument();
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
});
