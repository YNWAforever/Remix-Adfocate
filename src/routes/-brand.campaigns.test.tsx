import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  fetchBrandCampaigns: vi.fn(), publishBrandCampaign: vi.fn(), closeBrandCampaign: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (i) => ({
  ...(await i<object>()),
  createFileRoute: () => (o: unknown) => o,
  useNavigate: () => h.navigate,
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => <a href={to}>{children}</a>,
}));
vi.mock("@/components/brand/BrandAuthContext", () => ({
  useBrandAuth: () => ({ brand: { email: "b@x", workspaceId: "w1", workspaceName: "Brand", role: "owner" }, reportAuthError: vi.fn() }),
}));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));
vi.mock("@/lib/brand", () => ({
  fetchBrandCampaigns: h.fetchBrandCampaigns,
  publishBrandCampaign: h.publishBrandCampaign, closeBrandCampaign: h.closeBrandCampaign,
  brandCampaignKeys: { list: (s: string) => ["brand-campaigns", s], detail: (id: string) => ["brand-campaign", id], leaderboard: (id: string) => ["brand-campaign-board", id] },
  BrandAuthError: class extends Error {},
}));
vi.mock("@/lib/admin", () => ({ AdminRequestError: class extends Error {} }));

import { Route } from "./brand.campaigns.index";

function r() {
  const C = (Route as unknown as { component: React.ComponentType }).component;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("brand campaigns list", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists campaigns and shows a Publish action on drafts", async () => {
    h.fetchBrandCampaigns.mockResolvedValue({
      campaigns: [{ id: "c1", title: "夏季挑戰", slug: "summer", status: "draft", goal_target: 3, prize_tiers: [], ends_at: "2026-08-01T00:00:00Z" }],
    });
    h.publishBrandCampaign.mockResolvedValue({});
    r();
    await screen.findByText("夏季挑戰");
    expect(screen.getByText("草稿")).toBeInTheDocument();
    fireEvent.click(screen.getByText("發佈"));
    await waitFor(() => expect(h.publishBrandCampaign).toHaveBeenCalledWith("c1"));
  });

  it("shows a Close action on active campaigns and no Settle control", async () => {
    h.fetchBrandCampaigns.mockResolvedValue({
      campaigns: [{ id: "c2", title: "進行中挑戰", slug: "live", status: "active", goal_target: 5, prize_tiers: [], ends_at: "2026-07-01T00:00:00Z" }],
    });
    h.closeBrandCampaign.mockResolvedValue({});
    vi.spyOn(window, "confirm").mockReturnValue(true);
    r();
    await screen.findByText("進行中挑戰");
    expect(screen.queryByText("結算")).toBeNull();
    fireEvent.click(screen.getByText("關閉"));
    await waitFor(() => expect(h.closeBrandCampaign).toHaveBeenCalledWith("c2"));
  });
});
