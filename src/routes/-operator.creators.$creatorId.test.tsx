import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  secret: "s" as string | null,
  fetchCreatorDetail: vi.fn(),
  postCreatorNote: vi.fn(),
  postCreatorReview: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<object>("@tanstack/react-router");
  return {
    ...actual,
    Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
  };
});

vi.mock("@/lib/admin", async () => ({
  ...(await vi.importActual<object>("@/lib/admin")),
  getAdminSecret: () => hoisted.secret,
  setAdminSecret: (s: string) => { hoisted.secret = s; },
  clearAdminSecret: () => { hoisted.secret = null; },
  fetchCreatorDetail: hoisted.fetchCreatorDetail,
  postCreatorNote: hoisted.postCreatorNote,
  postCreatorReview: hoisted.postCreatorReview,
  AdminAuthError: class AdminAuthError extends Error {},
}));

import { Route } from "./operator.creators.$creatorId";

function renderRoute() {
  const C = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <C />
    </QueryClientProvider>,
  );
}

describe("operator creator detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.secret = "s";
    vi.spyOn(Route, "useParams").mockReturnValue({ creatorId: "creator-1" } as never);
    hoisted.fetchCreatorDetail.mockResolvedValue({
      creator: {
        id: "creator-1",
        workspace_id: "workspace-1",
        display_name: "Amy Chan",
        avatar_url: "https://cdn.example.com/avatar.jpg",
        level: "L2",
        categories: ["beauty"],
        scores: { influence: 80, content: 90, reliability: 70, brandSafety: 100 },
        social_handles: null,
        created_at: "2026-06-18T01:00:00.000Z",
      },
      socialAccounts: [
        {
          id: "social-1",
          platform: "instagram",
          handle: "@amychan",
          sync_status: "synced",
          follower_count: 45000,
          engagement_rate: 3.2,
          api_synced_at: "2026-06-18T02:00:00.000Z",
          external_avatar_url: "https://cdn.example.com/social-avatar.jpg",
          bio: "Beauty creator",
          post_count: 120,
          following_count: 1500,
          avg_likes: 1400,
          avg_comments: 80,
          posting_frequency: 5,
          freshness_score: 92,
          content_themes: ["beauty", "skincare"],
        },
      ],
      social: {
        platforms: ["instagram"],
        syncStatus: "synced",
        followerCount: 45000,
        engagementRate: 3.2,
        apiSyncedAt: "2026-06-18T02:00:00.000Z",
        label: "API-synced",
        ownershipLabel: "Ownership not verified",
      },
      review: {
        status: "needs_review",
        riskLevel: "unknown",
        summary: null,
        reviewedBy: null,
        lastReviewedAt: null,
        updatedAt: null,
      },
      notes: [
        {
          id: "note-1",
          creator_id: "creator-1",
          workspace_id: "workspace-1",
          operator_id: "op",
          category: "quality",
          body: "Good samples.",
          created_at: "2026-06-18T03:00:00.000Z",
        },
      ],
      missionHistory: [{ id: "sub-1", status: "approved", missions: { title: "夏日面膜" } }],
      shortlists: [],
      audit: [{ id: "audit-1", event_type: "creator_review.updated", created_at: "2026-06-18T03:00:00.000Z" }],
    });
  });

  it("renders profile, social metrics, notes, mission history, and audit", async () => {
    renderRoute();
    expect(await screen.findByText("Amy Chan")).toBeInTheDocument();
    expect(screen.getByText("45,000 followers")).toBeInTheDocument();
    expect(screen.getByText("Ownership not verified")).toBeInTheDocument();
    expect(screen.getByText("Good samples.")).toBeInTheDocument();
    expect(screen.getByText("creator_review.updated")).toBeInTheDocument();
    expect(screen.getByText("夏日面膜")).toBeInTheDocument();
  });

  it("adds an internal note", async () => {
    hoisted.postCreatorNote.mockResolvedValue({
      note: {
        id: "note-2",
        category: "fit",
        body: "Great for launch.",
        created_at: "2026-06-18T04:00:00.000Z",
      },
    });
    renderRoute();
    await screen.findByText("Amy Chan");
    fireEvent.change(screen.getByLabelText("New internal note"), { target: { value: "Great for launch." } });
    fireEvent.click(screen.getByLabelText("Save internal note"));
    await waitFor(() =>
      expect(hoisted.postCreatorNote).toHaveBeenCalledWith("creator-1", {
        category: "other",
        body: "Great for launch.",
      }),
    );
  });

  it("requires a note before saving a flagged review", async () => {
    renderRoute();
    await screen.findByText("Amy Chan");
    fireEvent.change(screen.getByLabelText("Review status"), { target: { value: "flagged" } });
    fireEvent.click(screen.getByLabelText("Save review action"));
    expect(screen.getByText("Flagged reviews require a note")).toBeInTheDocument();
    expect(hoisted.postCreatorReview).not.toHaveBeenCalled();
  });
});
