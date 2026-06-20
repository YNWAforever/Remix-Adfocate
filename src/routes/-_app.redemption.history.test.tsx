import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, Link: (p: { children: React.ReactNode }) => <a href="/">{p.children}</a> };
});

vi.mock("@/lib/queries/kocmax", () => ({
  useRedemptions: () => ({
    data: [
      { id: "r1", code: "CODE-A", points_spent: 200, status: "fulfilled", created_at: "2026-06-14T00:00:00Z", redemption_gifts: { name: "咖啡券" } },
    ],
    isLoading: false,
    isError: false,
  }),
}));

import { Route } from "./_app.redemption.history";

function renderHistory() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("Redemption history", () => {
  it("lists past redemptions with their code", () => {
    renderHistory();
    expect(screen.getByText("咖啡券")).toBeInTheDocument();
    expect(screen.getByText("兌換碼：CODE-A")).toBeInTheDocument();
  });
});
