import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Must be hoisted so vi.mock factory can reference them
const h = vi.hoisted(() => ({
  useCampaigns: vi.fn(),
  useCampaign: vi.fn(),
  useCampaignLeaderboard: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    createFileRoute: () => (o: unknown) => o,
    Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

vi.mock("@/lib/queries/kocmax", () => ({
  useCampaigns: h.useCampaigns,
  useCampaign: h.useCampaign,
  useCampaignLeaderboard: h.useCampaignLeaderboard,
}));

vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));

import { Route as ListRoute } from "./_app.campaigns.index";

function renderComponent(C: React.ComponentType) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <C />
    </QueryClientProvider>,
  );
}

describe("campaigns list route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders an active campaign as a link", () => {
    h.useCampaigns.mockReturnValue({
      data: [
        {
          id: "c1",
          slug: "summer-beauty",
          title: "進行中挑戰",
          description: null,
          status: "active",
          starts_at: "2000-01-01T00:00:00Z",
          ends_at: "2099-01-01T00:00:00Z",
          goal_target: 3,
          completion_bonus_points: 100,
          completion_bonus_xp: 50,
          prize_tiers: [],
        },
      ],
      isLoading: false,
    });

    renderComponent(
      (ListRoute as unknown as { component: React.ComponentType }).component,
    );

    expect(screen.getByText("進行中挑戰")).toBeInTheDocument();
    // Section heading key rendered (t returns the key)
    expect(screen.getByText("app.campaigns.active")).toBeInTheDocument();
    // Link points to detail route
    const link = screen.getByRole("link", { name: /進行中挑戰/ });
    expect(link).toHaveAttribute("href", "/campaigns/$slug");
  });

  it("renders upcoming section for future campaigns", () => {
    h.useCampaigns.mockReturnValue({
      data: [
        {
          id: "c2",
          slug: "winter-promo",
          title: "即將來臨",
          description: null,
          status: "draft",
          starts_at: "2099-06-01T00:00:00Z",
          ends_at: "2099-12-31T00:00:00Z",
          goal_target: 5,
          completion_bonus_points: 200,
          completion_bonus_xp: 100,
          prize_tiers: [],
        },
      ],
      isLoading: false,
    });

    renderComponent(
      (ListRoute as unknown as { component: React.ComponentType }).component,
    );

    expect(screen.getByText("即將來臨")).toBeInTheDocument();
    expect(screen.getByText("app.campaigns.upcoming")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    h.useCampaigns.mockReturnValue({ data: [], isLoading: true });

    renderComponent(
      (ListRoute as unknown as { component: React.ComponentType }).component,
    );

    expect(screen.getByText("…")).toBeInTheDocument();
  });
});
