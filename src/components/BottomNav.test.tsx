import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createRouter, createRootRoute, createRoute, createMemoryHistory } from "@tanstack/react-router";
import { BottomNav } from "./BottomNav";

function renderNav() {
  const root = createRootRoute({ component: () => <BottomNav /> });
  const index = createRoute({ getParentRoute: () => root, path: "/", component: () => null });
  const router = createRouter({ routeTree: root.addChildren([index]), history: createMemoryHistory({ initialEntries: ["/"] }) });
  return render(<RouterProvider router={router as never} />);
}

describe("BottomNav", () => {
  it("renders all five member tabs", async () => {
    renderNav();
    for (const label of ["主頁", "任務", "積分兌換", "錢包", "探索"]) {
      await waitFor(() => expect(screen.getByText(label)).toBeInTheDocument());
    }
  });
});
