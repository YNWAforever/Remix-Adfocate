import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ fetchCreatorReviewQueue: vi.fn() }));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ authed: true, staff: { userId: "u1", email: "a@x" }, reportAuthError: vi.fn() }) }));
vi.mock("@/components/admin/AdminWorkspaceContext", () => ({ useAdminWorkspace: () => ({ workspace: "workspace-1", setWorkspace: vi.fn() }) }));
vi.mock("@/lib/adminTransport", () => ({ AdminAuthError: class AdminAuthError extends Error {} }));
vi.mock("@/lib/creatorCase", () => ({ fetchCreatorReviewQueue: h.fetchCreatorReviewQueue }));
vi.mock("@/components/operator/CreatorReviewRow", () => ({
  CreatorReviewRow: ({ creator }: { creator: { displayName: string } }) => <div>{creator.displayName}</div>,
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
    h.fetchCreatorReviewQueue.mockResolvedValue({ creators: [{ id: "c1", displayName: "Amy" }], page: 1, pageSize: 25, total: 1 });
    r();
    await screen.findByText("Amy");
    expect(screen.getByText("Amy")).toBeInTheDocument();
  });
});
