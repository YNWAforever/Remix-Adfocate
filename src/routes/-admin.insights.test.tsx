// src/routes/-admin.insights.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ fetchInsights: vi.fn(), reportAuthError: vi.fn() }));
vi.mock("@/components/admin/AdminAuthContext", () => ({
  useAdminAuth: () => ({ authed: true, staff: { userId: "u1", email: "a@x" }, reportAuthError: h.reportAuthError }),
}));
vi.mock("@/components/admin/AdminWorkspaceContext", () => ({
  useAdminWorkspace: () => ({ workspace: "", setWorkspace: vi.fn() }),
}));
vi.mock("@/lib/admin", () => ({
  fetchInsights: h.fetchInsights,
  adminKeys: { insights: (ws: string, w: number) => ["admin-insights", ws, w] },
  AdminAuthError: class extends Error {},
}));

import { Route } from "./admin.insights";
import { AdminAuthError } from "@/lib/admin";

function r() {
  const C = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <C />
    </QueryClientProvider>,
  );
}

const payload = {
  insights: {
    window: { days: 30, from: "2026-05-31T00:00:00.000Z", to: "2026-06-30T00:00:00.000Z" },
    kpis: {
      activeCreators: { value: 12, prev: 8, deltaPct: 50 },
      submitToApprove: { value: 66.7, prev: 70, deltaPct: -4.7 },
      pointsIssued: { value: 3400, prev: 3400, deltaPct: 0 },
      cashPaid: { value: 1280.5, prev: 0, deltaPct: null },
      missionFillRate: { value: 25, prev: 0, deltaPct: null },
      completions: { value: 9, prev: 5, deltaPct: 80 },
    },
    funnel: { joined: 20, submitted: 11, approved: 8, joinToSubmit: 60, submitToApprove: 66.7 },
    levels: [
      { level: "L0", count: 5 },
      { level: "L1", count: 3 },
      { level: "L2", count: 0 },
      { level: "L3", count: 0 },
      { level: "L4", count: 0 },
      { level: "L5", count: 0 },
      { level: "L6", count: 0 },
    ],
    trend: [
      { bucket: "2026-06-29", joined: 2, submitted: 1, approved: 1 },
      { bucket: "2026-06-30", joined: 3, submitted: 2, approved: 1 },
    ],
  },
};

describe("admin insights page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("lang", "zh");
  });

  it("shows a loading skeleton before data resolves", () => {
    h.fetchInsights.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = r();
    expect(container.querySelector(".skeleton-acid")).not.toBeNull();
  });

  it("renders KPI values and the active-creators delta", async () => {
    h.fetchInsights.mockResolvedValue(payload);
    r();
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument()); // active creators
    expect(screen.getByText("活躍創作者")).toBeInTheDocument();
    expect(screen.getByText("+50%")).toBeInTheDocument(); // delta badge
    // null delta renders the em dash, not "0%"
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("reports auth errors through reportAuthError", async () => {
    h.fetchInsights.mockRejectedValue(new AdminAuthError("unauthorized"));
    r();
    await waitFor(() => expect(h.reportAuthError).toHaveBeenCalled());
  });
});
