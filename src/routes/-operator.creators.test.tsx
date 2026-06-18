import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAuthError } from "@/lib/admin";

const hoisted = vi.hoisted(() => ({
  secret: "s" as string | null,
  fetchCreatorReviewQueue: vi.fn(),
  postCreatorReview: vi.fn(),
  postMissionShortlist: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<object>("@tanstack/react-router");
  return {
    ...actual,
    Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
  };
});

vi.mock("@/lib/admin", async () => ({
  ...(await vi.importActual<object>("@/lib/admin")),
  getAdminSecret: () => hoisted.secret,
  setAdminSecret: (s: string) => { hoisted.secret = s; },
  clearAdminSecret: () => { hoisted.secret = null; },
  fetchCreatorReviewQueue: hoisted.fetchCreatorReviewQueue,
  postCreatorReview: hoisted.postCreatorReview,
  postMissionShortlist: hoisted.postMissionShortlist,
  AdminAuthError: class AdminAuthError extends Error {},
}));

import { Route } from "./operator.creators";

function renderRoute() {
  const C = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
}

describe("operator creator review queue", () => {
  const queueResponse = {
    creators: [
      {
        id: "creator-1",
        displayName: "Amy Chan",
        avatarUrl: null,
        level: "L2",
        categories: ["beauty", "ugc"],
        scores: { influence: 80, content: 90, reliability: 70, brandSafety: 100 },
        social: {
          platforms: ["instagram"],
          syncStatus: "synced",
          followerCount: 45000,
          engagementRate: 3.2,
          apiSyncedAt: "2026-06-18T02:00:00.000Z",
          label: "API-synced",
          ownershipLabel: "Ownership not verified",
        },
        review: { status: "needs_review", riskLevel: "unknown", summary: null, reviewedBy: null, lastReviewedAt: null, updatedAt: null },
        shortlist: null,
        lastActivityAt: "2026-06-18T02:00:00.000Z",
      },
    ],
    page: 1,
    pageSize: 25,
    total: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.secret = "s";
    vi.spyOn(Route, "useSearch").mockReturnValue({} as never);
    hoisted.fetchCreatorReviewQueue.mockResolvedValue(queueResponse);
  });

  it("renders filters, social labels, and creator rows", async () => {
    renderRoute();
    expect(await screen.findByText("Amy Chan")).toBeInTheDocument();
    expect(screen.getByLabelText("Search creators")).toBeInTheDocument();
    expect(screen.getByText("API-synced")).toBeInTheDocument();
    expect(screen.getByText("Ownership not verified")).toBeInTheDocument();
    expect(screen.getByText("needs_review")).toBeInTheDocument();
  });

  it("does not render a selected-avatar thumbnail when the queue row has no avatarUrl", async () => {
    renderRoute();
    await screen.findByText("Amy Chan");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("quick-approves a creator with the queue payload", async () => {
    hoisted.postCreatorReview.mockResolvedValue({ review: { status: "approved", riskLevel: "low" } });
    hoisted.fetchCreatorReviewQueue.mockReset();
    hoisted.fetchCreatorReviewQueue
      .mockResolvedValueOnce(queueResponse)
      .mockResolvedValueOnce({
      creators: [],
      page: 1,
      pageSize: 25,
      total: 0,
      });
    renderRoute();
    await screen.findByText("Amy Chan");
    fireEvent.click(screen.getByLabelText("Approve Amy Chan"));
    await waitFor(() =>
      expect(hoisted.postCreatorReview).toHaveBeenCalledWith("creator-1", {
        status: "approved",
        riskLevel: "low",
        summary: "Approved from creator review queue.",
      }),
    );
  });

  it("quick-flags a creator with a review note", async () => {
    hoisted.postCreatorReview.mockResolvedValue({ review: { status: "flagged", riskLevel: "high" } });
    renderRoute();
    await screen.findByText("Amy Chan");
    fireEvent.click(screen.getByLabelText("Flag Amy Chan"));
    await waitFor(() =>
      expect(hoisted.postCreatorReview).toHaveBeenCalledWith(
        "creator-1",
        expect.objectContaining({
          status: "flagged",
          riskLevel: "high",
          note: expect.any(String),
        }),
      ),
    );
    const payload = hoisted.postCreatorReview.mock.calls[0]?.[1];
    expect(payload.note).not.toHaveLength(0);
  });

  it("adds a creator to a mission shortlist from the review queue", async () => {
    vi.spyOn(Route, "useSearch").mockReturnValue({ mission_id: "mission-1" } as never);
    hoisted.postMissionShortlist.mockResolvedValue({ shortlist: { creator_id: "creator-1", status: "shortlisted" } });

    renderRoute();
    await screen.findByText("Amy Chan");
    fireEvent.click(screen.getByLabelText("Shortlist Amy Chan"));

    await waitFor(() =>
      expect(hoisted.postMissionShortlist).toHaveBeenCalledWith("mission-1", {
        creatorId: "creator-1",
        source: "review_queue",
        notes: undefined,
      }),
    );
  });

  it("shows a shortlist note error for flagged creators without clearing the active filters", async () => {
    vi.spyOn(Route, "useSearch").mockReturnValue({ mission_id: "mission-1" } as never);
    hoisted.fetchCreatorReviewQueue.mockResolvedValue({
      creators: [
        {
          ...queueResponse.creators[0],
          review: { status: "flagged", riskLevel: "high", summary: null, reviewedBy: null, lastReviewedAt: null, updatedAt: null },
        },
      ],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    hoisted.postMissionShortlist.mockRejectedValue(new Error("flagged_note_required"));

    renderRoute();
    await screen.findByText("Amy Chan");
    fireEvent.change(screen.getByLabelText("Search creators"), { target: { value: "amy" } });
    fireEvent.change(screen.getByLabelText("Status filter"), { target: { value: "flagged" } });
    await screen.findByLabelText("Shortlist Amy Chan");
    fireEvent.click(screen.getByLabelText("Shortlist Amy Chan"));
    fireEvent.click(await screen.findByLabelText("Save shortlist Amy Chan"));

    expect(await screen.findByText("Flagged creators need a shortlist note")).toBeInTheDocument();
    expect(screen.getByLabelText("Search creators")).toHaveValue("amy");
    expect(screen.getByLabelText("Status filter")).toHaveValue("flagged");
  });

  it("clears the stored secret and returns to the auth prompt on auth error", async () => {
    hoisted.fetchCreatorReviewQueue.mockRejectedValueOnce(new AdminAuthError("unauthorized"));
    renderRoute();
    await waitFor(() => expect(hoisted.secret).toBeNull());
    expect(await screen.findByPlaceholderText("ADMIN_SECRET")).toBeInTheDocument();
  });
});
