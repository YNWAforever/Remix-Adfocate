import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<object>("@tanstack/react-router");
  return {
    ...actual,
    Outlet: () => <div>outlet</div>,
    Link: ({ children }: { children?: React.ReactNode }) => <a href="/">{children}</a>,
    useLocation: () => ({ pathname: "/admin/insights" }),
  };
});

vi.mock("@/lib/admin", () => ({
  AdminAuthError: class AdminAuthError extends Error {},
  adminKeys: {
    applications: () => ["admin-applications"],
    submissions: () => ["admin-submissions", "submitted"],
    engaged: () => ["admin-engaged"],
  },
  adminMissionKeys: { workspaces: ["admin-workspaces"] },
  fetchApplications: vi.fn().mockResolvedValue({ applications: [] }),
  fetchSubmissions: vi.fn().mockResolvedValue({ submissions: [] }),
  fetchWorkspaces: vi.fn().mockResolvedValue({ workspaces: [] }),
}));

vi.mock("@/components/admin/StaffAuthGate", () => ({
  StaffAuthGate: ({ children }: { children: (s: unknown) => React.ReactNode }) =>
    <>{children({ userId: "u1", email: "a@x" })}</>,
}));

import { Route } from "./admin";

function renderLayout() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("admin layout", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("renders the sidebar shell + outlet when the gate yields children", () => {
    renderLayout();
    expect(screen.getByText("登出")).toBeInTheDocument();
    expect(screen.getByText("outlet")).toBeInTheDocument();
  });
});
