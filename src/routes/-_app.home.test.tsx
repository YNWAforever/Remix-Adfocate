import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode } & Record<string, unknown>) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
  };
});

vi.mock("@/lib/queries/kocmax", () => ({
  useMe: () => ({ data: { id: "u1", display_name: "阿明", avatar_url: null, level: "L1" }, isLoading: false }),
  useBalance: () => ({ data: { balance: 0, available_to: null }, isLoading: false, isError: false }),
  useMissions: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock("@/lib/useRealtimeBalance", () => ({ useRealtimeBalance: vi.fn() }));

import { Route } from "./_app.home";
vi.spyOn(Route, "useParams").mockReturnValue({ slug: "demo" } as never);

function renderHome() {
  const C = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <C />
    </QueryClientProvider>,
  );
}

describe("Home", () => {
  it("shows an avatar button linking to /profile", () => {
    renderHome();
    const link = screen.getByLabelText("個人檔案");
    expect(link).toHaveAttribute("href", "/profile");
  });

  it("shows a level chip with the current level", () => {
    renderHome();
    expect(screen.getByText("🌟 L1")).toBeInTheDocument();
  });

  it("links the level chip to the creator passport", () => {
    renderHome();
    expect(screen.getByLabelText("創作者護照")).toHaveAttribute("href", "/passport");
  });
});
