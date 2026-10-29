import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  earnings: {} as { data?: { available: number; pending: number }; isLoading: boolean; isError: boolean },
  history: {} as { data?: unknown[]; isLoading: boolean; isError: boolean },
}));

vi.mock("@/lib/useRealtimeBalance", () => ({ useRealtimeBalance: () => {} }));
vi.mock("@/lib/queries/kocmax", () => ({
  useMe: () => ({ data: { id: "u1" } }),
  useBalance: () => ({ data: { balance: 250, available_to: null }, isLoading: false, isError: false }),
  usePointHistory: () => ({ data: [], isLoading: false, isError: false }),
  useEarnings: () => h.earnings,
  useEarningsHistory: () => h.history,
}));

import { Route } from "./_app.wallet";

function renderWallet() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("Wallet earnings", () => {
  beforeEach(() => {
    h.earnings = { data: { available: 50, pending: 30 }, isLoading: false, isError: false };
    h.history = {
      data: [{ id: "e1", type: "earn", amount: 50, balance_after: 50, description: "任務獎金", created_at: "2026-06-14T00:00:00Z" }],
      isLoading: false,
      isError: false,
    };
  });

  it("shows the available + pending earnings", () => {
    renderWallet();
    expect(screen.getByText("收益錢包")).toBeInTheDocument();
    expect(screen.getByText("HK$50.00")).toBeInTheDocument();
    expect(screen.getByText("HK$30.00")).toBeInTheDocument();
  });

  it("never shows HK$0.00 while earnings are loading or failed", () => {
    h.earnings = { data: undefined, isLoading: true, isError: false };
    const { unmount } = renderWallet();
    expect(screen.queryByText(/HK\$0\.00/)).not.toBeInTheDocument();
    unmount();
    h.earnings = { data: undefined, isLoading: false, isError: true };
    renderWallet();
    expect(screen.queryByText(/HK\$0\.00/)).not.toBeInTheDocument();
    expect(screen.getByText("收益載入失敗")).toBeInTheDocument();
  });

  it("shows loading, error and empty states for earnings history", () => {
    h.history = { data: undefined, isLoading: false, isError: true };
    const { unmount } = renderWallet();
    expect(screen.getByText("收益記錄載入失敗")).toBeInTheDocument();
    unmount();
    h.history = { data: [], isLoading: false, isError: false };
    renderWallet();
    expect(screen.getByText("暫未有現金獎賞記錄")).toBeInTheDocument();
  });

  it("signs a negative adjustment correctly", () => {
    h.history = {
      data: [{ id: "e2", type: "adjust", amount: -5, balance_after: 45, description: "更正", created_at: "2026-06-14T00:00:00Z" }],
      isLoading: false,
      isError: false,
    };
    renderWallet();
    expect(screen.getByText("-HK$5.00")).toBeInTheDocument();
    expect(screen.queryByText(/\+HK\$-/)).not.toBeInTheDocument();
  });
});
