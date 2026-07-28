import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Outlet: () => <div>Nested mission workspace</div>,
    Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
  };
});

vi.mock("@/lib/queries/kocmax", () => ({
  useMyMissions: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

import { Route } from "./_app.my";

describe("my missions route layout", () => {
  it("renders the nested mission workspace outlet", () => {
    const Component = Route.options.component as React.ComponentType;
    render(<Component />);

    expect(screen.getByText("Nested mission workspace")).toBeInTheDocument();
  });
});
