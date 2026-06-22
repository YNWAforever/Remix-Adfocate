import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  fetchCreatorDetail: vi.fn(),
  postCreatorNote: vi.fn(),
  postCreatorReview: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<object>("@tanstack/react-router");
  return {
    ...actual,
    Link: ({ children }: { children?: React.ReactNode }) => <a href="/">{children}</a>,
  };
});

vi.mock("@/lib/admin", async () => ({
  ...(await vi.importActual<object>("@/lib/admin")),
  fetchCreatorDetail: hoisted.fetchCreatorDetail,
  postCreatorNote: hoisted.postCreatorNote,
  postCreatorReview: hoisted.postCreatorReview,
  AdminAuthError: class AdminAuthError extends Error {},
}));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ authed: true, staff: { userId: "u1", email: "a@x" }, reportAuthError: vi.fn() }) }));

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
    vi.spyOn(Route, "useParams").mockReturnValue({ creatorId: "creator-1" } as never);
    hoisted.fetchCreatorDetail.mockResolvedValue({
      creator: {
        id: "creator-1",
        workspace_id: "workspace-1",
        display_name: "Amy Chan",
        avatar_url: "https://cdn.example.com/creator-avatar.jpg",
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
        status: "approved",
        riskLevel: "low",
        summary: "Strong fit for skincare launch.",
        reviewedBy: "operator@adfocate.test",
        lastReviewedAt: "2026-06-18T05:00:00.000Z",
        updatedAt: "2026-06-18T05:30:00.000Z",
      },
      profileMedia: {
        avatarUrl: "https://cdn.example.com/reviewed-avatar.jpg",
        portfolioLinks: [
          {
            id: "portfolio-1",
            creatorId: "creator-1",
            workspaceId: "workspace-1",
            url: "https://example.com/operator-portfolio",
            title: "Operator-visible work",
            platformType: "website",
            caption: "Private review caption",
            sortOrder: 1,
            publicHighlight: true,
            createdAt: "2026-06-18T01:00:00.000Z",
            updatedAt: "2026-06-18T01:00:00.000Z",
          },
        ],
        publicHighlights: [
          {
            url: "https://example.com/operator-portfolio",
            title: "Operator-visible work",
            platform_type: "website",
            caption: "Private review caption",
            sort_order: 1,
          },
        ],
        published: { avatarUrl: null, highlights: [], publishedAt: null },
        completeness: {
          score: 71,
          items: [
            { key: "avatar", label: "Avatar selected", complete: true },
            { key: "portfolio", label: "Portfolio link added", complete: true },
          ],
        },
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

  it("renders profile, review metadata, social metrics, notes, mission history, and audit", async () => {
    renderRoute();
    expect(await screen.findByText("Amy Chan")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Selected profile avatar" })).toHaveAttribute(
      "src",
      "https://cdn.example.com/reviewed-avatar.jpg",
    );
    expect(screen.getByRole("img", { name: "Unselected social avatar from instagram" })).toHaveAttribute(
      "src",
      "https://cdn.example.com/social-avatar.jpg",
    );
    expect(screen.getByRole("heading", { name: "Review status" })).toBeInTheDocument();
    expect(screen.getByText("Strong fit for skincare launch.", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("operator@adfocate.test")).toBeInTheDocument();
    expect(screen.getAllByText("approved").length).toBeGreaterThan(0);
    expect(screen.getAllByText("risk: low").length).toBeGreaterThan(0);
    expect(screen.getByText("45,000 followers")).toBeInTheDocument();
    expect(screen.getByText("Ownership not verified")).toBeInTheDocument();
    expect(screen.getByText("Good samples.")).toBeInTheDocument();
    expect(screen.getByText("creator_review.updated")).toBeInTheDocument();
    expect(screen.getByText("夏日面膜")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Profile media" })).toBeInTheDocument();
    expect(screen.getByText("71% complete")).toBeInTheDocument();
    expect(screen.getByText("Operator-visible work")).toBeInTheDocument();
    expect(screen.getByText("Public highlight")).toBeInTheDocument();
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
