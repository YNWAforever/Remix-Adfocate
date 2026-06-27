import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ fetchBrandBudget: vi.fn(), reportAuthError: vi.fn() }));

vi.mock("@/lib/brand", () => ({
  fetchBrandBudget: h.fetchBrandBudget,
  brandKeys: { budget: () => ["brand-budget"] },
  BrandAuthError: class extends Error {},
}));
vi.mock("@/components/brand/BrandAuthContext", () => ({
  useBrandAuth: () => ({ brand: { workspaceId: "w1" }, reportAuthError: h.reportAuthError }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { signOut: vi.fn() } } }));

import { Route } from "./brand.budget";

function r() {
  const C = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <C />
    </QueryClientProvider>,
  );
}

describe("brand budget page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("lang", "zh");
  });

  it("renders the balance and a ledger row", async () => {
    h.fetchBrandBudget.mockResolvedValue({
      budget: { balance: 120, enforced: true },
      transactions: [{ id: "t1", type: "topup", delta: 120, balance_after: 120, source_ref: null, description: "初始增值", created_at: "2026-06-27" }],
    });
    r();
    await waitFor(() => expect(screen.getByText("HK$120")).toBeInTheDocument());
    expect(screen.getByText(/初始增值/)).toBeInTheDocument();
  });

  it("shows the empty-ledger copy when there are no transactions", async () => {
    h.fetchBrandBudget.mockResolvedValue({ budget: { balance: 0, enforced: false }, transactions: [] });
    r();
    await waitFor(() => expect(screen.getByText("暫無預算紀錄。")).toBeInTheDocument());
  });
});
