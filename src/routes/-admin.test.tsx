import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const hoisted = vi.hoisted(() => ({ secret: null as string | null }));
vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<object>("@tanstack/react-router");
  return {
    ...actual,
    Outlet: () => <div>outlet</div>,
    Link: ({ children }: { children?: React.ReactNode }) => <a href="/">{children}</a>,
  };
});
vi.mock("@/lib/admin", () => ({
  getAdminSecret: () => hoisted.secret,
  setAdminSecret: (s: string) => { hoisted.secret = s; },
  clearAdminSecret: () => { hoisted.secret = null; },
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

import { Route } from "./admin";

function renderLayout() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("admin layout", () => {
  beforeEach(() => { hoisted.secret = null; });

  it("prompts for the admin secret when none is stored", () => {
    renderLayout();
    expect(screen.getByPlaceholderText("ADMIN_SECRET")).toBeInTheDocument();
  });

  it("renders the tab bar + outlet once authed", () => {
    hoisted.secret = "s";
    renderLayout();
    expect(screen.getByText("活躍創作者")).toBeInTheDocument();
    expect(screen.getByText("outlet")).toBeInTheDocument();
  });
});
