import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createRouter, createRootRoute, createRoute, createMemoryHistory } from "@tanstack/react-router";
import { I18nProvider } from "@/lib/i18n";
import { BrandNav } from "./BrandNav";

beforeEach(() => {
  localStorage.setItem("lang", "zh");
});

function renderNav() {
  const root = createRootRoute({ component: () => <BrandNav /> });
  const index = createRoute({ getParentRoute: () => root, path: "/", component: () => null });
  const router = createRouter({ routeTree: root.addChildren([index]), history: createMemoryHistory({ initialEntries: ["/"] }) });
  return render(<I18nProvider><RouterProvider router={router as never} /></I18nProvider>);
}

describe("BrandNav", () => {
  it("renders a Resources item linking to /brand/resources", async () => {
    renderNav();
    await waitFor(() => {
      const links = screen.getAllByText("資源").map((el) => el.closest("a"));
      expect(links.some((a) => a?.getAttribute("href") === "/brand/resources")).toBe(true);
    });
  });

  it("still renders the existing Overview and Missions items", async () => {
    renderNav();
    await waitFor(() => expect(screen.getAllByText("概覽").length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getAllByText("任務").length).toBeGreaterThan(0));
  });
});
