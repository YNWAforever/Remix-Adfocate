import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ fetchApplications: vi.fn(), acceptApplication: vi.fn(), declineApplication: vi.fn() }));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ authed: true, staff: { userId: "u1", email: "a@x" }, reportAuthError: vi.fn() }) }));
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

  it("UC-C25 retains the decline reason and row after a failure and retries explicitly", async () => {
    h.fetchApplications.mockResolvedValue({ applications: [{ id: "a1", creators: { display_name: "Amy" }, missions: { title: "Test mission" } }] });
    h.declineApplication.mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue({});
    r(); await screen.findByText("Amy");
    const reason = screen.getByLabelText(/拒絕原因/);
    expect(screen.getByLabelText("拒絕")).toBeDisabled();
    fireEvent.change(reason, { target: { value: "Please improve the portfolio" } });
    fireEvent.click(screen.getByLabelText("拒絕")); await screen.findByRole("alert");
    expect(reason).toHaveValue("Please improve the portfolio"); expect(screen.getByText("Amy")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重試 / Retry" }));
    await waitFor(() => expect(h.declineApplication).toHaveBeenCalledTimes(2));
    expect(h.declineApplication.mock.calls).toEqual([["a1", "Please improve the portfolio"], ["a1", "Please improve the portfolio"]]);
  });

  it("UC-A10 shows who already processed the application and keeps local input on409", async () => {
    h.fetchApplications.mockResolvedValue({ applications: [{ id: "a1", creators: { display_name: "Amy" }, missions: { title: "Test mission" } }] });
    h.declineApplication.mockRejectedValue(Object.assign(new Error("Already processed by Test operator at 2026-10-25 18:00 HKT"), { status: 409, code: "APPLICATION_DECIDED" }));
    r(); await screen.findByText("Amy"); const reason = screen.getByLabelText(/拒絕原因/);
    fireEvent.change(reason, { target: { value: "My retained reason" } }); fireEvent.click(screen.getByLabelText("拒絕"));
    await screen.findByText(/Already processed by Test operator/); expect(reason).toHaveValue("My retained reason");
    expect(screen.getByText("Amy")).toBeInTheDocument(); expect(h.declineApplication).toHaveBeenCalledTimes(1);
  });
});
