import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/queries/kocmax", () => ({ useUnreadCount: () => ({ data: 0 }) }));
import { RouterProvider, createRouter, createRootRoute, createRoute, createMemoryHistory } from "@tanstack/react-router";
import { I18nProvider } from "@/lib/i18n";
import { BottomNav } from "./BottomNav";

// Force zh locale so labels match the zh dict values regardless of jsdom navigator.language
beforeEach(() => {
  localStorage.setItem("lang", "zh");
});

function renderNav() {
  const root = createRootRoute({ component: () => <BottomNav /> });
  const index = createRoute({ getParentRoute: () => root, path: "/", component: () => null });
  const router = createRouter({ routeTree: root.addChildren([index]), history: createMemoryHistory({ initialEntries: ["/"] }) });
  return render(<I18nProvider><RouterProvider router={router as never} /></I18nProvider>);
}

describe("BottomNav", () => {
  it("renders exactly five primary mobile tabs", async () => {
    renderNav();
    for (const label of ["主頁", "找任務", "我的任務", "錢包", "更多"]) {
      await waitFor(() => expect(screen.getByText(label)).toBeInTheDocument());
    }
    expect(screen.getAllByRole("link")).toHaveLength(5);
  });

  it("renders correct hrefs for each tab", async () => {
    renderNav();
    const expected = [
      { label: "主頁", href: "/home" },
      { label: "找任務", href: "/mission" },
      { label: "我的任務", href: "/my" },
      { label: "錢包", href: "/wallet" },
      { label: "更多", href: "/more" },
    ];
    for (const { label, href } of expected) {
      await waitFor(() => {
        const link = screen.getByText(label).closest("a");
        expect(link).not.toBeNull();
        expect(link!.getAttribute("href")).toBe(href);
      });
    }
  });
});
