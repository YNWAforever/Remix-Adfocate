vi.mock("@/components/admin/AdminWorkspaceContext", () => ({ useAdminWorkspace: () => ({ workspace: hoisted.workspace, workspaceSlug: "a", setWorkspace: vi.fn() }) }));
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  workspace: "workspace-1",
  fetchCreatorDetail: vi.fn(),
  fetchCreatorPublicationProofs: vi.fn(),
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
  fetchCreatorPublicationProofs: hoisted.fetchCreatorPublicationProofs,
  postCreatorNote: hoisted.postCreatorNote,
  postCreatorReview: hoisted.postCreatorReview,
  AdminAuthError: class AdminAuthError extends Error {},
}));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ authed: true, staff: { userId: "u1", email: "a@x" }, reportAuthError: vi.fn() }) }));

import { Route } from "./operator.creators.$creatorId";
import { AdminRequestError } from "@/lib/admin";

const savedProof = {
  attemptId: "attempt-1", workspaceId: "workspace-1", isCurrentAttempt: true,
  workflowId: "workflow-1", workItemId: "item-1", workItemTitle: "IG Reel",
  platform: "instagram", missionTitle: "Summer launch", missionSlug: "summer-launch",
  attemptNumber: 1, primaryUrl: "https://example.com/post", submittedAt: "2026-08-01T00:00:00.000Z",
  submittedLate: false, metadataStatus: "available", reviewState: "in_review",
  reviewSummary: "Private proof review", reviewedAt: null,
};

function renderRoute() {
  const C = Route.options.component as React.ComponentType;
  const queryClient = new QueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <C />
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

describe("operator creator detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.workspace = "workspace-1";
    hoisted.fetchCreatorDetail.mockReset(); hoisted.postCreatorNote.mockReset(); hoisted.postCreatorReview.mockReset();
    vi.spyOn(Route, "useSearch").mockReturnValue({ returnTo: "/admin/creators?ws=workspace-1" } as never);
    vi.spyOn(Route, "useParams").mockReturnValue({ creatorId: "creator-1" } as never);
    hoisted.fetchCreatorPublicationProofs.mockResolvedValue({ proofs: { status: "available", value: [] } });
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

  it("keeps denied proofs hidden through outages and remounts until a successful read", async () => {
    const result = { proofs: { status: "available", value: [savedProof] } };
    hoisted.fetchCreatorPublicationProofs.mockResolvedValue(result);
    const view = renderRoute();
    await screen.findByText(savedProof.reviewSummary);
    const refetch = async () => {
      await act(async () => { await view.queryClient.refetchQueries({ queryKey: ["admin-creator-proofs"] }); });
    };
    hoisted.fetchCreatorPublicationProofs.mockRejectedValue(new AdminRequestError("Offline", "unavailable", undefined, 503));
    await refetch();
    expect(screen.getByText(savedProof.reviewSummary)).toBeInTheDocument();
    expect(await screen.findByText(/Showing the previous saved data/)).toBeInTheDocument();

    hoisted.fetchCreatorPublicationProofs.mockRejectedValue(new AdminRequestError("Denied", "STAFF_CAPABILITY_REQUIRED", undefined, 403));
    await refetch();
    await waitFor(() => expect(screen.queryByText(savedProof.reviewSummary)).not.toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "Review proof" })).not.toBeInTheDocument();
    expect(screen.getByText("Amy Chan")).toBeInTheDocument();

    hoisted.fetchCreatorPublicationProofs.mockRejectedValue(new AdminRequestError("Offline", "unavailable", undefined, 503));
    await refetch();
    view.unmount();
    const C = Route.options.component as React.ComponentType;
    render(<QueryClientProvider client={view.queryClient}><C /></QueryClientProvider>);
    await screen.findByText("Amy Chan");
    expect(screen.queryByText(savedProof.reviewSummary)).not.toBeInTheDocument();

    hoisted.fetchCreatorPublicationProofs.mockResolvedValue(result);
    await refetch();
    expect(await screen.findByText(savedProof.reviewSummary)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review proof" })).toBeInTheDocument();
  });

  it("does not reuse another workspace's cached proofs when the scope changes", async () => {
    hoisted.fetchCreatorPublicationProofs.mockResolvedValue({ proofs: { status: "available", value: [savedProof] } });
    const view = renderRoute();
    await screen.findByText(savedProof.reviewSummary);
    const initial = await hoisted.fetchCreatorDetail.mock.results[0].value;
    hoisted.workspace = "workspace-2";
    hoisted.fetchCreatorDetail.mockResolvedValue({ ...initial, creator: { ...initial.creator, display_name: "Second workspace creator" } });
    hoisted.fetchCreatorPublicationProofs.mockRejectedValue(new AdminRequestError("Offline", "unavailable", undefined, 503));
    const C = Route.options.component as React.ComponentType;
    view.rerender(<QueryClientProvider client={view.queryClient}><C /></QueryClientProvider>);
    await screen.findByText("Second workspace creator");
    expect(screen.queryByText(savedProof.reviewSummary)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Review proof" })).not.toBeInTheDocument();
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
        requestId: expect.any(String),
        expectedRevision: 0,
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

  describe("CRM revision recovery", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("retains a stale note until the operator compares and acknowledges the latest revision", async () => {
    hoisted.postCreatorNote.mockRejectedValueOnce(new AdminRequestError("Changed", "CRM_STALE", undefined, 409)).mockResolvedValueOnce({ note: { id: "saved" } });
    renderRoute(); await screen.findByText("Amy Chan");
    const initial = await hoisted.fetchCreatorDetail.mock.results[0].value;
    hoisted.fetchCreatorDetail.mockResolvedValue({ ...initial, review: { ...initial.review, revision: 3, summary: "Concurrent operator review" } });
    fireEvent.change(screen.getByLabelText("New internal note"), { target: { value: "Retained note" } });
    fireEvent.click(screen.getByLabelText("Save internal note"));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("New internal note")).toHaveValue("Retained note");
    fireEvent.click(screen.getByRole("button", { name: "Compare latest note revision" }));
    await screen.findByText("Latest note revision 3");
    expect(hoisted.postCreatorNote).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Keep note on latest revision" }));
    await waitFor(() => expect(screen.getByLabelText("Save internal note")).toBeEnabled());
    fireEvent.click(screen.getByLabelText("Save internal note"));
    await waitFor(() => expect(hoisted.postCreatorNote).toHaveBeenCalledTimes(2));
    expect(hoisted.postCreatorNote.mock.calls[1][1]).toMatchObject({ body: "Retained note", expectedRevision: 3 });
    expect(hoisted.postCreatorNote.mock.calls[1][1].requestId).not.toBe(hoisted.postCreatorNote.mock.calls[0][1].requestId);
    await waitFor(() => expect(screen.getByLabelText("New internal note")).toHaveValue(""));
  });

  it("retries an unknown note outcome with the original command and retains its identity", async () => {
    hoisted.postCreatorNote.mockRejectedValueOnce(new TypeError("Lost response")).mockResolvedValueOnce({ note: { id: "saved" } });
    renderRoute(); await screen.findByText("Amy Chan");
    fireEvent.change(screen.getByLabelText("New internal note"), { target: { value: "One logical note" } });
    fireEvent.click(screen.getByLabelText("Save internal note"));
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Compare latest note revision" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("New internal note")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry same note request" }));
    await waitFor(() => expect(hoisted.postCreatorNote).toHaveBeenCalledTimes(2));
    expect(hoisted.postCreatorNote.mock.calls[1]).toEqual(hoisted.postCreatorNote.mock.calls[0]);
  });

  it("uses the shared revision after a successful note when review inputs are untouched", async () => {
    renderRoute(); await screen.findByText("Amy Chan");
    const initial = await hoisted.fetchCreatorDetail.mock.results[0].value;
    hoisted.postCreatorNote.mockImplementation(async () => {
      hoisted.fetchCreatorDetail.mockResolvedValue({ ...initial, review: { ...initial.review, revision: 1 } });
      return { note: { id: "saved" } };
    });
    hoisted.postCreatorReview.mockResolvedValue({ review: { ...initial.review, revision: 2 } });
    fireEvent.change(screen.getByLabelText("New internal note"), { target: { value: "A saved note" } });
    fireEvent.click(screen.getByLabelText("Save internal note"));
    await waitFor(() => expect(screen.getByLabelText("New internal note")).toHaveValue(""));
    fireEvent.click(screen.getByLabelText("Save review action"));
    await waitFor(() => expect(hoisted.postCreatorReview).toHaveBeenCalledWith("creator-1", expect.objectContaining({ expectedRevision: 1 })));
  });
});

  it("retains a stale review until the latest decision is compared and acknowledged", async () => {
    hoisted.postCreatorReview.mockRejectedValueOnce(new AdminRequestError("Changed", "CRM_STALE", undefined, 409)).mockResolvedValueOnce({ review: { revision: 4 } });
    renderRoute(); await screen.findByText("Amy Chan");
    const initial = await hoisted.fetchCreatorDetail.mock.results[0].value;
    hoisted.fetchCreatorDetail.mockResolvedValue({ ...initial, review: { ...initial.review, revision: 3, summary: "Concurrent decision" } });
    fireEvent.change(screen.getByLabelText("Review summary"), { target: { value: "Retained review" } });
    fireEvent.click(screen.getByLabelText("Save review action")); await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Compare latest review" }));
    await screen.findByText("Latest review revision 3");
    expect(screen.getByText("Concurrent decision")).toBeInTheDocument();
    expect(hoisted.postCreatorReview).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Keep review on latest revision" }));
    expect(screen.getByLabelText("Review summary")).toHaveValue("Retained review");
    fireEvent.click(screen.getByLabelText("Save review action"));
    await waitFor(() => expect(hoisted.postCreatorReview).toHaveBeenCalledTimes(2));
    expect(hoisted.postCreatorReview.mock.calls[1][1]).toMatchObject({ summary: "Retained review", expectedRevision: 3 });
    expect(hoisted.postCreatorReview.mock.calls[1][1].requestId).not.toBe(hoisted.postCreatorReview.mock.calls[0][1].requestId);
  });

  it("retries an unknown review outcome without rebasing its command identity", async () => {
    hoisted.postCreatorReview.mockRejectedValueOnce(new TypeError("Lost response")).mockResolvedValueOnce({ review: { revision: 1 } });
    renderRoute(); await screen.findByText("Amy Chan");
    fireEvent.change(screen.getByLabelText("Review summary"), { target: { value: "One logical review" } });
    fireEvent.click(screen.getByLabelText("Save review action")); await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Compare latest review" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Review summary")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry same review request" }));
    await waitFor(() => expect(hoisted.postCreatorReview).toHaveBeenCalledTimes(2));
    expect(hoisted.postCreatorReview.mock.calls[1]).toEqual(hoisted.postCreatorReview.mock.calls[0]);
  });

  it.each(["creator", "workspace"])("isolates an unknown note command when the %s scope changes", async change => {
    hoisted.postCreatorNote.mockRejectedValueOnce(new TypeError("Lost response"));
    const view = renderRoute(); await screen.findByText("Amy Chan");
    const initial = await hoisted.fetchCreatorDetail.mock.results[0].value;
    fireEvent.change(screen.getByLabelText("New internal note"), { target: { value: "Previous subject note" } });
    fireEvent.click(screen.getByLabelText("Save internal note")); await screen.findByRole("alert");
    if (change === "creator") vi.mocked(Route.useParams).mockReturnValue({ creatorId: "creator-2" } as never);
    else hoisted.workspace = "workspace-2";
    hoisted.fetchCreatorDetail.mockResolvedValue({ ...initial, creator: { ...initial.creator, id: change === "creator" ? "creator-2" : "creator-1", display_name: "Second scope creator" }, review: { ...initial.review, revision: 8 } });
    const C = Route.options.component as React.ComponentType;
    view.rerender(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
    await screen.findByText("Second scope creator");
    expect(screen.getByLabelText("New internal note")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Retry same note request" })).not.toBeInTheDocument();
    hoisted.postCreatorNote.mockResolvedValueOnce({ note: { id: "new-note" } });
    fireEvent.change(screen.getByLabelText("New internal note"), { target: { value: "New subject note" } });
    fireEvent.click(screen.getByLabelText("Save internal note"));
    await waitFor(() => expect(hoisted.postCreatorNote).toHaveBeenCalledTimes(2));
    expect(hoisted.postCreatorNote.mock.calls[1]).toEqual([change === "creator" ? "creator-2" : "creator-1", expect.objectContaining({ body: "New subject note", expectedRevision: 8 })]);
    expect(hoisted.postCreatorNote.mock.calls[1][1].requestId).not.toBe(hoisted.postCreatorNote.mock.calls[0][1].requestId);
  });

});
