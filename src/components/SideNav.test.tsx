import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createRouter, createRootRoute, createRoute, createMemoryHistory } from "@tanstack/react-router";
import { SideNav } from "./SideNav";

function renderNav() {
  const root = createRootRoute({ component: () => <SideNav /> });
  const index = createRoute({ getParentRoute: () => root, path: "/", component: () => null });
  const router = createRouter({ routeTree: root.addChildren([index]), history: createMemoryHistory({ initialEntries: ["/"] }) });
  return render(<RouterProvider router={router as never} />);
}

describe("SideNav", () => {
  it("renders all five navigation destinations", async () => {
    renderNav();
    for (const label of ["主頁", "任務", "積分兌換", "錢包", "探索"]) {
      await waitFor(() => expect(screen.getByText(label)).toBeInTheDocument());
    }
  });

  it("renders correct hrefs for each nav item", async () => {
    renderNav();
    const expected = [
      { label: "主頁", href: "/home" },
      { label: "任務", href: "/mission" },
      { label: "積分兌換", href: "/redemption" },
      { label: "錢包", href: "/wallet" },
      { label: "探索", href: "/explore" },
    ];
    for (const { label, href } of expected) {
      await waitFor(() => {
        const el = screen.getByText(label);
        const link = el.closest("a");
        expect(link).not.toBeNull();
        expect(link!.getAttribute("href")).toBe(href);
      });
    }
  });
});
