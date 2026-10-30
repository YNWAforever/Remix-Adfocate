// src/routes/-admin.campaigns.detail.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  fetchCampaign: vi.fn(), updateCampaign: vi.fn(), publishCampaign: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (i) => ({
  ...(await i<object>()),
  createFileRoute: () => (o: unknown) => o,
  useParams: () => ({ id: "c1" }),
}));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ authed: true, reportAuthError: vi.fn() }) }));
vi.mock("@/lib/admin", () => ({
  fetchCampaign: h.fetchCampaign, updateCampaign: h.updateCampaign, publishCampaign: h.publishCampaign,
  closeCampaign: vi.fn(), settleCampaign: vi.fn(), attachCampaignMission: vi.fn(), detachCampaignMission: vi.fn(),
  adminKeys: { campaignDetail: (id: string) => ["cd", id] },
  AdminAuthError: class extends Error {}, AdminRequestError: class extends Error {},
}));

import { Route } from "./admin.campaigns.$id";

const base = {
  id: "c1", workspace_id: "w1", slug: "summer", title: "夏季挑戰", description: null, status: "draft",
  starts_at: "2030-01-01T00:00:00Z", ends_at: "2030-02-01T00:00:00Z", goal_metric: "approved_submissions", goal_target: 3,
  completion_bonus_points: 0, completion_bonus_xp: 0, prize_tiers: [], published_at: null, closed_at: null, settled_at: null,
};
const detail = (updated_at: string, title = base.title) => ({ campaign: { ...base, title, updated_at }, missions: [], participants: 0 });

function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const C = (Route as unknown as { component: React.ComponentType }).component;
  render(<QueryClientProvider client={qc}><C /></QueryClientProvider>);
  return qc;
}

describe("campaign editor optimistic locking (F-022)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves against the version the form was loaded from, even after a background refetch", async () => {
    h.fetchCampaign.mockResolvedValueOnce(detail("v1")).mockResolvedValue(detail("v2", "Someone else's title"));
    h.updateCampaign.mockResolvedValue({ campaign: { ...base, updated_at: "v3" } });
    const qc = renderEditor();
    await screen.findByDisplayValue("夏季挑戰");
    await act(() => qc.refetchQueries({ queryKey: ["cd", "c1"] }));
    expect(h.fetchCampaign).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));
    await waitFor(() => expect(h.updateCampaign).toHaveBeenCalled());
    expect(h.updateCampaign.mock.calls[0][1].expected_updated_at).toBe("v1"); // server answers 409 STALE_EDIT
  });

  it("advances the version after its own save and its own publish", async () => {
    h.fetchCampaign.mockResolvedValueOnce(detail("v1")).mockResolvedValueOnce(detail("v2")).mockResolvedValue(detail("v4"));
    h.updateCampaign.mockResolvedValueOnce({ campaign: { ...base, updated_at: "v2" } }).mockResolvedValue({ campaign: { ...base, updated_at: "v5" } });
    h.publishCampaign.mockResolvedValue({});
    renderEditor();
    await screen.findByDisplayValue("夏季挑戰");
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));
    await waitFor(() => expect(h.fetchCampaign).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "發佈" }));
    await waitFor(() => expect(h.fetchCampaign).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));
    await waitFor(() => expect(h.updateCampaign).toHaveBeenCalledTimes(2));
    expect(h.updateCampaign.mock.calls.map((c) => c[1].expected_updated_at)).toEqual(["v1", "v4"]);
  });
});
