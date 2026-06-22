import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ fetchSubmissions: vi.fn(), approveSubmission: vi.fn(), rejectSubmission: vi.fn() }));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ authed: true, staff: { userId: "u1", email: "a@x" }, reportAuthError: vi.fn() }) }));
vi.mock("@/components/admin/AdminWorkspaceContext", () => ({ useAdminWorkspace: () => ({ workspace: "", setWorkspace: vi.fn() }) }));
vi.mock("@/lib/admin", () => ({
  fetchSubmissions: h.fetchSubmissions,
  approveSubmission: h.approveSubmission,
  rejectSubmission: h.rejectSubmission,
  adminKeys: { submissions: (status: string, ws: string) => ["admin-submissions", status, ws] },
  AdminAuthError: class extends Error {},
}));

import { Route } from "./admin.submissions";

function r() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("admin submissions tab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("approves a submission with a quality rating", async () => {
    h.fetchSubmissions.mockResolvedValue({
      submissions: [{
        id: "s1", creator_id: "c1", status: "submitted", content_urls: ["https://ig.com/p/x"], submitted_at: null,
        creators: { display_name: "Amy" }, missions: { slug: "m1", title: "夏日面膜", points_reward: 100 },
      }],
    });
    h.approveSubmission.mockResolvedValue({});
    r();
    await screen.findByText("Amy");
    fireEvent.change(screen.getByLabelText("品質評分"), { target: { value: "5" } });
    fireEvent.click(screen.getByLabelText("批准"));
    await waitFor(() => expect(h.approveSubmission).toHaveBeenCalledWith("s1", { notes: undefined, rating: 5 }));
  });
});
