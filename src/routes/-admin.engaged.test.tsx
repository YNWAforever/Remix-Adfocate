import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ fetchEngagedUsers: vi.fn() }));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ authed: true, staff: { userId: "u1", email: "a@x" }, reportAuthError: vi.fn() }) }));
vi.mock("@/components/admin/AdminWorkspaceContext", () => ({ useAdminWorkspace: () => ({ workspace: "", setWorkspace: vi.fn() }) }));
vi.mock("@/lib/admin", () => ({
  fetchEngagedUsers: h.fetchEngagedUsers,
  adminKeys: { engaged: (ws: string) => ["admin-engaged", ws] },
  AdminAuthError: class extends Error {},
}));

import { Route } from "./admin.engaged";

function r() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("admin engaged tab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a roster row and expands to its active missions", async () => {
    h.fetchEngagedUsers.mockResolvedValue({
      creators: [{
        id: "c1", displayName: "Amy", avatarUrl: null, level: "L1", xp: 50,
        activeCount: 1, completedCount: 2, pointsEarned: 300, lastActivityAt: "2026-06-10T00:00:00Z",
        activeMissions: [{ submissionId: "s1", missionId: "m1", missionSlug: "m1", missionTitle: "夏日面膜", status: "submitted", joinedAt: "2026-06-01T00:00:00Z", submittedAt: null, reviewDeadline: null }],
      }],
    });
    r();
    await screen.findByText("Amy");
    expect(screen.queryByText("夏日面膜")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Amy"));
    expect(screen.getByText("夏日面膜")).toBeInTheDocument();
    expect(screen.getByText("已提交")).toBeInTheDocument();
  });
});
