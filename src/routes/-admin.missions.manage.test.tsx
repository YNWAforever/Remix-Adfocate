import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  fetchMissionActivity: vi.fn(),
  acceptApplication: vi.fn(),
  declineApplication: vi.fn(),
  approveSubmission: vi.fn(),
  rejectSubmission: vi.fn(),
}));
vi.mock("@/lib/admin", () => ({
  fetchMissionActivity: h.fetchMissionActivity,
  acceptApplication: h.acceptApplication,
  declineApplication: h.declineApplication,
  approveSubmission: h.approveSubmission,
  rejectSubmission: h.rejectSubmission,
  adminMissionKeys: { activity: (id: string) => ["admin-mission-activity", id], detail: (id: string) => ["admin-mission", id] },
  adminKeys: { applications: (w: string) => ["admin-applications", w], submissions: (s: string, w: string) => ["admin-submissions", s, w], engaged: (w: string) => ["admin-engaged", w] },
  AdminAuthError: class AdminAuthError extends Error {},
  AdminRequestError: class AdminRequestError extends Error {},
}));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ secret: "s", reportAuthError: vi.fn() }) }));
vi.mock("@/components/admin/AdminWorkspaceContext", () => ({ useAdminWorkspace: () => ({ workspace: "", setWorkspace: vi.fn() }) }));

import { MissionManage } from "@/components/admin/MissionManage";

function r() {
  return render(<QueryClientProvider client={new QueryClient()}><MissionManage missionId="m1" /></QueryClientProvider>);
}

describe("MissionManage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.fetchMissionActivity.mockResolvedValue({
      mission: { id: "m1", slug: "ugc-1", title: "M1", status: "active" },
      applicants: [{ id: "a1", status: "applied", creators: { display_name: "Amy" }, missions: { slug: "ugc-1", title: "M1", points_reward: 100 } }],
      submissions: [{ id: "s1", status: "submitted", content_urls: ["https://x"], submitted_at: null, creators: { display_name: "Bob" }, missions: { slug: "ugc-1", title: "M1", points_reward: 100 } }],
      engaged: [],
      fill: { filled: 1, quota: 5 },
    });
    h.acceptApplication.mockResolvedValue({});
    h.approveSubmission.mockResolvedValue({});
  });

  it("accepts an applicant in place", async () => {
    r();
    await screen.findByText("Amy");
    fireEvent.click(screen.getByRole("button", { name: /接受/ }));
    await waitFor(() => expect(h.acceptApplication).toHaveBeenCalledWith("a1"));
  });

  it("approves a submission in place", async () => {
    r();
    await screen.findByText("Bob");
    fireEvent.click(screen.getByRole("button", { name: /批准/ }));
    await waitFor(() => expect(h.approveSubmission).toHaveBeenCalledWith("s1", expect.any(Object)));
  });
});
