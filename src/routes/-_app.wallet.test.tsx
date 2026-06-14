import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/useRealtimeBalance", () => ({ useRealtimeBalance: () => {} }));
vi.mock("@/lib/queries/kocmax", () => ({
  useMe: () => ({ data: { id: "u1" } }),
  useBalance: () => ({ data: { balance: 250, available_to: null }, isLoading: false, isError: false }),
  usePointHistory: () => ({ data: [], isLoading: false, isError: false }),
  useEarnings: () => ({ data: { available: 50, pending: 30 }, isLoading: false, isError: false }),
  useEarningsHistory: () => ({
    data: [{ id: "e1", type: "earn", amount: 50, balance_after: 50, description: "任務獎金", created_at: "2026-06-14T00:00:00Z" }],
    isLoading: false,
    isError: false,
  }),
}));

import { Route } from "./_app.wallet";

function renderWallet() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("Wallet earnings", () => {
  it("shows the available + pending earnings", () => {
    renderWallet();
    expect(screen.getByText("收益錢包")).toBeInTheDocument();
    expect(screen.getByText("HK$50.00")).toBeInTheDocument();
    expect(screen.getByText("HK$30.00")).toBeInTheDocument();
  });
});
