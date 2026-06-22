import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ fetchApplications: vi.fn(), acceptApplication: vi.fn(), declineApplication: vi.fn() }));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ secret: "s", reportAuthError: vi.fn() }) }));
vi.mock("@/components/admin/AdminWorkspaceContext", () => ({ useAdminWorkspace: () => ({ workspace: "", setWorkspace: vi.fn() }) }));
vi.mock("@/lib/admin", () => ({
  fetchApplications: h.fetchApplications,
  acceptApplication: h.acceptApplication,
  declineApplication: h.declineApplication,
  adminKeys: { applications: (ws: string) => ["admin-applications", ws] },
  AdminAuthError: class extends Error {},
}));
vi.mock("@/components/operator/OperatorBadges", () => ({
  ReviewBadge: ({ status }: { status: string }) => <span>{status}</span>,
  ShortlistBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

import { Route } from "./admin.applications";

function r() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("admin applications tab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists applications and accepts one", async () => {
    h.fetchApplications.mockResolvedValue({
      applications: [{
        id: "a1", mission_id: "m1", creator_id: "c1",
        creator_review: { status: "needs_review", risk_level: "unknown" },
        mission_shortlist: null,
        creators: { display_name: "Amy" },
        missions: { slug: "m1", title: "夏日面膜", points_reward: 100 },
      }],
    });
    h.acceptApplication.mockResolvedValue({});
    r();
    await screen.findByText("Amy");
    expect(screen.getByText("needs_review")).toBeInTheDocument();
    expect(screen.getByText("not shortlisted")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("接受"));
    await waitFor(() => expect(h.acceptApplication).toHaveBeenCalledWith("a1"));
  });
});
