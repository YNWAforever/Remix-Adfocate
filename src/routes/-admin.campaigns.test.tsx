// src/routes/-admin.campaigns.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  fetchCampaigns: vi.fn(), publishCampaign: vi.fn(), closeCampaign: vi.fn(), settleCampaign: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (i) => ({
  ...(await i<object>()),
  createFileRoute: () => (o: unknown) => o,
  useNavigate: () => h.navigate,
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => <a href={to}>{children}</a>,
}));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ authed: true, staff: { userId: "u1", email: "a@x" }, reportAuthError: vi.fn() }) }));
vi.mock("@/components/admin/AdminWorkspaceContext", () => ({ useAdminWorkspace: () => ({ workspace: "", setWorkspace: vi.fn() }) }));
vi.mock("@/lib/admin", () => ({
  fetchCampaigns: h.fetchCampaigns,
  publishCampaign: h.publishCampaign, closeCampaign: h.closeCampaign, settleCampaign: h.settleCampaign,
  adminKeys: { campaigns: (a: string, b: string) => ["c", a, b], campaignDetail: (id: string) => ["cd", id] },
  AdminAuthError: class extends Error {}, AdminRequestError: class extends Error {},
}));

import { Route } from "./admin.campaigns.index";

function r() {
  const C = (Route as unknown as { component: React.ComponentType }).component;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("admin campaigns list", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists campaigns and shows a Publish action on drafts", async () => {
    h.fetchCampaigns.mockResolvedValue({
      campaigns: [{ id: "c1", title: "夏季挑戰", slug: "summer", status: "draft", goal_target: 3, prize_tiers: [], ends_at: "2026-08-01T00:00:00Z" }],
    });
    h.publishCampaign.mockResolvedValue({});
    r();
    await screen.findByText("夏季挑戰");
    expect(screen.getByText("草稿")).toBeInTheDocument();
    fireEvent.click(screen.getByText("發佈"));
    await waitFor(() => expect(h.publishCampaign).toHaveBeenCalledWith("c1"));
  });

  it("shows a Settle action on closed campaigns", async () => {
    h.fetchCampaigns.mockResolvedValue({
      campaigns: [{ id: "c2", title: "已結束挑戰", slug: "done", status: "closed", goal_target: 5, prize_tiers: [{ rank_from: 1, rank_to: 1, cash: 100, points: 0, xp: 0 }], ends_at: "2026-07-01T00:00:00Z" }],
    });
    h.settleCampaign.mockResolvedValue({});
    vi.spyOn(window, "confirm").mockReturnValue(true);
    r();
    await screen.findByText("已結束挑戰");
    fireEvent.click(screen.getByText("結算"));
    await waitFor(() => expect(h.settleCampaign).toHaveBeenCalledWith("c2"));
  });
});
