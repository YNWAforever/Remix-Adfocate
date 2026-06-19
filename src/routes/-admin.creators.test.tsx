import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ fetchCreatorReviewQueue: vi.fn() }));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ secret: "s", reportAuthError: vi.fn() }) }));
vi.mock("@/lib/admin", () => ({ fetchCreatorReviewQueue: h.fetchCreatorReviewQueue, AdminAuthError: class AdminAuthError extends Error {} }));
vi.mock("@/components/operator/CreatorReviewRow", () => ({
  CreatorReviewRow: ({ creator }: { creator: { display_name: string } }) => <div>{creator.display_name}</div>,
}));

import { Route } from "./admin.creators";

function r() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("admin creators tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock useSearch so the component doesn't throw when rendered outside a router context
    vi.spyOn(Route, "useSearch").mockReturnValue({} as never);
  });

  it("renders the creator review queue rows", async () => {
    h.fetchCreatorReviewQueue.mockResolvedValue({ creators: [{ id: "c1", display_name: "Amy" }], page: 1, pageSize: 25, total: 1 });
    r();
    await screen.findByText("Amy");
    expect(screen.getByText("Amy")).toBeInTheDocument();
  });
});
