import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ fetchBrandInsights: vi.fn(), reportAuthError: vi.fn() }));

vi.mock("@/lib/brand", () => ({
  fetchBrandInsights: h.fetchBrandInsights,
  brandKeys: { insights: (w: number) => ["brand-insights", w] },
  BrandAuthError: class extends Error {},
}));
vi.mock("@/components/brand/BrandAuthContext", () => ({
  useBrandAuth: () => ({ brand: { workspaceId: "w1" }, reportAuthError: h.reportAuthError }),
}));
vi.mock("@/components/admin/TrendChart", () => ({ TrendChart: () => <div data-testid="trend" /> }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { signOut: vi.fn() } } }));

import { Route } from "./brand.insights";

const M = (value: number) => ({ value, prev: 0, deltaPct: null });
function r() {
  const C = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <C />
    </QueryClientProvider>,
  );
}

describe("brand insights page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("lang", "zh");
  });

  it("renders a KPI value and a top-creator row", async () => {
    h.fetchBrandInsights.mockResolvedValue({
      insights: {
        window: { days: 30, from: "", to: "" },
        kpis: {
          liveMissions: M(3),
          missionFillRate: M(50),
          submissionsReceived: M(8),
          approvalRate: M(75),
          completions: M(6),
          cashPaid: M(120),
          costPerDeliverable: M(20),
          pointsDistributed: M(600),
        },
        topCreators: [{ creatorId: "a", name: "Alice", approved: 4, avgQuality: 4.5 }],
        trend: [],
      },
    });
    r();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    expect(screen.getByText("HK$120.00")).toBeInTheDocument();
  });

  it("shows the empty top-creators copy when there are none", async () => {
    h.fetchBrandInsights.mockResolvedValue({
      insights: {
        window: { days: 30, from: "", to: "" },
        kpis: {
          liveMissions: M(0),
          missionFillRate: M(0),
          submissionsReceived: M(0),
          approvalRate: M(0),
          completions: M(0),
          cashPaid: M(0),
          costPerDeliverable: M(0),
          pointsDistributed: M(0),
        },
        topCreators: [],
        trend: [],
      },
    });
    r();
    await waitFor(() => expect(screen.getByText("此區間暫無獲批創作者。")).toBeInTheDocument());
  });
});
