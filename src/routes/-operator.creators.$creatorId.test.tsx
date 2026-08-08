import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatorCaseDetail } from "@/lib/creatorCase";

const hoisted = vi.hoisted(() => ({
  fetchCreatorDetail: vi.fn(),
  postCreatorNote: vi.fn(),
  postCreatorReview: vi.fn(),
  workspace: "workspace-1",
}));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<object>("@tanstack/react-router");
  return { ...actual, Link: ({ children }: { children?: React.ReactNode }) => <a href="/">{children}</a> };
});

vi.mock("@/lib/creatorCase", () => ({
  fetchCreatorDetail: hoisted.fetchCreatorDetail,
  postCreatorNote: hoisted.postCreatorNote,
  postCreatorReview: hoisted.postCreatorReview,
}));
vi.mock("@/lib/adminTransport", () => ({ AdminAuthError: class AdminAuthError extends Error {} }));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ authed: true, staff: { userId: "u1", email: "a@x" }, reportAuthError: vi.fn() }) }));
vi.mock("@/components/admin/AdminWorkspaceContext", () => ({ useAdminWorkspace: () => ({ workspace: hoisted.workspace, setWorkspace: vi.fn() }) }));

import { Route } from "./operator.creators.$creatorId";

function response(): CreatorCaseDetail {
  return {
    creator: {
      id: "creator-1", workspaceId: "workspace-1", displayName: "Amy Chan", avatarUrl: "https://cdn.example.com/creator-avatar.jpg",
      level: "L2", categories: ["beauty"], scores: { influence: 80, content: 90, reliability: 70, brandSafety: 100 },
      socialHandles: null, createdAt: "2026-06-18T01:00:00.000Z",
    },
    social: {
      status: "available" as const,
      value: {
        accounts: [{
          id: "social-1", platform: "instagram", handle: "@amychan", sync_status: "synced", follower_count: 45000, engagement_rate: 3.2,
          api_synced_at: "2026-06-18T02:00:00.000Z", external_avatar_url: "https://cdn.example.com/social-avatar.jpg", bio: "Beauty creator",
          post_count: 120, following_count: 1500, avg_likes: 1400, avg_comments: 80, posting_frequency: 5, freshness_score: 92,
          content_themes: ["beauty", "skincare"],
        }],
        summary: { platforms: ["instagram"], syncStatus: "synced", followerCount: 45000, engagementRate: 3.2, apiSyncedAt: "2026-06-18T02:00:00.000Z", label: "API-synced" as const, ownershipLabel: "Ownership not verified" as const },
      },
    },
    profile: {
      status: "available" as const,
      value: {
        avatarUrl: "https://cdn.example.com/reviewed-avatar.jpg",
        portfolioLinks: [{ id: "portfolio-1", url: "https://example.com/operator-portfolio", title: "Operator-visible work", platformType: "website", caption: "Private review caption", publicHighlight: true }],
        publicHighlights: [], published: { avatarUrl: null, highlights: [], publishedAt: null },
        completeness: { score: 71, items: [{ key: "avatar", label: "Avatar selected", complete: true }] },
      },
    },
    review: { status: "approved" as const, riskLevel: "low" as const, summary: "Strong fit for skincare launch.", reviewedBy: "operator@adfocate.test", lastReviewedAt: "2026-06-18T05:00:00.000Z", updatedAt: "2026-06-18T05:30:00.000Z" },
    notes: [{ id: "note-1", creatorId: "creator-1", workspaceId: "workspace-1", operatorId: "op", category: "quality" as const, body: "Good samples.", createdAt: "2026-06-18T03:00:00.000Z" }],
    missionHistory: { status: "available" as const, value: [{ id: "sub-1", status: "approved", missions: { title: "Creator launch" } }] },
    shortlists: [],
    audit: [{ id: "audit-1", eventType: "creator_review.updated", createdAt: "2026-06-18T03:00:00.000Z", metadata: {} }],
  };
}

function renderRoute() {
  const Component = Route.options.component as React.ComponentType;
  return render(<QueryClientProvider client={new QueryClient()}><Component /></QueryClientProvider>);
}

describe("operator creator detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.workspace = "workspace-1";
    vi.spyOn(Route, "useParams").mockReturnValue({ creatorId: "creator-1" } as never);
    hoisted.fetchCreatorDetail.mockResolvedValue(response());
  });

  it("loads the strict creator case with the selected workspace", async () => {
    renderRoute();
    expect(await screen.findByText("Amy Chan")).toBeInTheDocument();
    expect(hoisted.fetchCreatorDetail).toHaveBeenCalledWith("workspace-1", "creator-1");
    expect(screen.getByRole("img", { name: "Selected profile avatar" })).toHaveAttribute("src", "https://cdn.example.com/reviewed-avatar.jpg");
    expect(screen.getByText("Creator launch")).toBeInTheDocument();
  });

  it("adds an internal note with the selected workspace", async () => {
    hoisted.postCreatorNote.mockResolvedValue({ note: { id: "note-2", category: "fit", body: "Great for launch.", createdAt: "2026-06-18T04:00:00.000Z" } });
    renderRoute();
    await screen.findByText("Amy Chan");
    fireEvent.change(screen.getByLabelText("New internal note"), { target: { value: "Great for launch." } });
    fireEvent.click(screen.getByLabelText("Save internal note"));
    await waitFor(() => expect(hoisted.postCreatorNote).toHaveBeenCalledWith("workspace-1", "creator-1", { category: "other", body: "Great for launch." }, expect.any(String)));
  });

  it("reuses the note command id when a submission is retried", async () => {
    hoisted.postCreatorNote.mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValueOnce({ note: {} });
    renderRoute();
    await screen.findByText("Amy Chan");
    fireEvent.change(screen.getByLabelText("New internal note"), { target: { value: "Retry this note." } });
    fireEvent.click(screen.getByLabelText("Save internal note"));
    await waitFor(() => expect(hoisted.postCreatorNote).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByLabelText("Save internal note"));
    await waitFor(() => expect(hoisted.postCreatorNote).toHaveBeenCalledTimes(2));
    expect(hoisted.postCreatorNote.mock.calls[0][3]).toEqual(hoisted.postCreatorNote.mock.calls[1][3]);
  });

  it("reuses the review command id when a submission is retried", async () => {
    hoisted.postCreatorReview.mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValueOnce({ review: {} });
    renderRoute();
    await screen.findByText("Amy Chan");
    fireEvent.click(screen.getByLabelText("Save review action"));
    await waitFor(() => expect(hoisted.postCreatorReview).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByLabelText("Save review action"));
    await waitFor(() => expect(hoisted.postCreatorReview).toHaveBeenCalledTimes(2));
    expect(hoisted.postCreatorReview.mock.calls[0][3]).toEqual(hoisted.postCreatorReview.mock.calls[1][3]);
  });

  it("does not request a case before a workspace is selected", () => {
    hoisted.workspace = "";
    renderRoute();
    expect(screen.getByText("Select a workspace to view this creator case.")).toBeInTheDocument();
    expect(hoisted.fetchCreatorDetail).not.toHaveBeenCalled();
  });

  it("keeps the strict core visible when optional sources are unavailable", async () => {
    const unavailable = response();
    unavailable.social = { status: "unavailable", reason: "source_error" };
    unavailable.profile = { status: "unavailable", reason: "source_error" };
    unavailable.missionHistory = { status: "unavailable", reason: "source_error" };
    hoisted.fetchCreatorDetail.mockResolvedValue(unavailable);
    renderRoute();
    expect(await screen.findByText("Amy Chan")).toBeInTheDocument();
    expect(screen.getByText("Social data is currently unavailable.")).toBeInTheDocument();
    expect(screen.getByText("Profile media is currently unavailable.")).toBeInTheDocument();
    expect(screen.getByText("Mission history is currently unavailable.")).toBeInTheDocument();
  });
});
