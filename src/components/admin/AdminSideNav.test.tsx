// src/components/admin/AdminSideNav.test.tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Stub the count hook so the sidebar renders without auth/workspace/query providers.
vi.mock("./useAdminQueueCounts", () => ({ useAdminQueueCounts: () => ({ applications: 7, submissions: 12 }) }));

import { RouterProvider, createRouter, createRootRoute, createRoute, createMemoryHistory } from "@tanstack/react-router";
import { I18nProvider } from "@/lib/i18n";
import { AdminSideNav } from "./AdminSideNav";

beforeEach(() => {
  localStorage.setItem("lang", "zh");
});

function renderNav(initial = "/admin/insights") {
  const root = createRootRoute({ component: () => <AdminSideNav /> });
  const index = createRoute({ getParentRoute: () => root, path: "/", component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: [initial] }),
  });
  return render(
    <I18nProvider>
      <RouterProvider router={router as never} />
    </I18nProvider>,
  );
}

describe("AdminSideNav", () => {
  it("renders the four group headers", async () => {
    renderNav();
    for (const label of ["分析", "審批佇列", "受眾", "資料庫"]) {
      await waitFor(() => expect(screen.getByText(label)).toBeInTheDocument());
    }
  });

  it("renders the Insights item as a link to /admin/insights", async () => {
    renderNav();
    await waitFor(() => {
      const link = screen.getByText("洞察").closest("a");
      expect(link).not.toBeNull();
      expect(link!.getAttribute("href")).toBe("/admin/insights");
    });
  });

  it("renders the locked Segments item as non-navigating (not an anchor)", async () => {
    renderNav();
    await waitFor(() => {
      const el = screen.getByText("分眾");
      expect(el.closest("a")).toBeNull();
    });
    expect(screen.getByText("即將推出")).toBeInTheDocument();
  });

  it("shows live count badges for Applications and Submissions", async () => {
    renderNav();
    await waitFor(() => expect(screen.getByText("7")).toBeInTheDocument());
    expect(screen.getByText("12")).toBeInTheDocument();
  });
});
