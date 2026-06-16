import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const hoisted = vi.hoisted(() => ({
  secret: null as string | null,
  adminFetch: vi.fn(),
}));
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

  it("lists pending applications and accepts one", async () => {
    hoisted.secret = "s";
    hoisted.adminFetch.mockResolvedValueOnce({ applications: [
      { id: "a1", creators: { display_name: "Amy" }, missions: { slug: "m1", title: "夏日面膜", points_reward: 100 } },
    ] });
    renderOp();
    await screen.findByText("Amy");
    hoisted.adminFetch.mockResolvedValueOnce({});
    fireEvent.click(screen.getByLabelText("接受"));
    await waitFor(() => expect(hoisted.adminFetch).toHaveBeenCalledWith("/admin/applications/a1/accept", expect.objectContaining({ method: "POST" })));
  });
});
