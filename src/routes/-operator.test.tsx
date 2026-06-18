import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const hoisted = vi.hoisted(() => ({
  secret: null as string | null,
  adminFetch: vi.fn(),
}));
vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<object>("@tanstack/react-router");
  return {
    ...actual,
    Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
  };
});
vi.mock("@/lib/admin", () => ({
  adminFetch: hoisted.adminFetch,
  getAdminSecret: () => hoisted.secret,
  setAdminSecret: (s: string) => { hoisted.secret = s; },
  clearAdminSecret: () => { hoisted.secret = null; },
  AdminAuthError: class AdminAuthError extends Error {},
}));

import { Route } from "./operator";

function renderOp() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("operator applications page", () => {
  beforeEach(() => { vi.clearAllMocks(); hoisted.secret = null; });

  it("prompts for the admin secret when none is stored", () => {
    renderOp();
    expect(screen.getByPlaceholderText("ADMIN_SECRET")).toBeInTheDocument();
  });

  it("shows review and shortlist metadata and accepts an application", async () => {
    hoisted.secret = "s";
    hoisted.adminFetch.mockResolvedValueOnce({ applications: [
      {
        id: "a1",
        mission_id: "m1",
        creator_id: "creator-1",
        creator_review: { status: "needs_review", risk_level: "unknown" },
        mission_shortlist: null,
        creators: { display_name: "Amy" },
        missions: { slug: "m1", title: "夏日面膜", points_reward: 100 },
      },
      {
        id: "a2",
        mission_id: "m2",
        creator_id: "creator-2",
        creator_review: { status: "approved", risk_level: "low" },
        mission_shortlist: { status: "shortlisted" },
        creators: { display_name: "Benny" },
        missions: { slug: "m2", title: "防曬精華", points_reward: 120 },
      },
    ] });
    renderOp();
    await screen.findByText("Amy");
    expect(screen.getByText("needs_review")).toBeInTheDocument();
    expect(screen.getByText("not shortlisted")).toBeInTheDocument();
    expect(screen.getByText("shortlisted")).toBeInTheDocument();
    hoisted.adminFetch.mockResolvedValueOnce({});
    hoisted.adminFetch.mockResolvedValueOnce({ applications: [] });
    fireEvent.click(screen.getAllByLabelText("接受")[0]!);
    await waitFor(() => expect(hoisted.adminFetch).toHaveBeenCalledWith("/admin/applications/a1/accept", expect.objectContaining({ method: "POST" })));
  });
});
