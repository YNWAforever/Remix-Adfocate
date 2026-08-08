import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  fetchMissionShortlist: vi.fn(),
  fetchCreatorReviewQueue: vi.fn(),
  patchMissionShortlist: vi.fn(),
  workspace: "workspace-1",
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
  fetchMissionShortlist: hoisted.fetchMissionShortlist,
  patchMissionShortlist: hoisted.patchMissionShortlist,
  AdminAuthError: class AdminAuthError extends Error {},
}));
vi.mock("@/lib/creatorCase", () => ({ fetchCreatorReviewQueue: hoisted.fetchCreatorReviewQueue }));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ authed: true, staff: { userId: "u1", email: "a@x" }, reportAuthError: vi.fn() }) }));
vi.mock("@/components/admin/AdminWorkspaceContext", () => ({ useAdminWorkspace: () => ({ workspace: hoisted.workspace, setWorkspace: vi.fn() }) }));

import { Route } from "./operator.missions.$missionId";

function renderRoute() {
  const C = Route.options.component as React.ComponentType;
  const client = new QueryClient();
  const ui = () => <QueryClientProvider client={client}><C /></QueryClientProvider>;
  const view = render(ui());
  return { ...view, rerenderRoute: () => view.rerender(ui()) };
}

describe("operator mission shortlist page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.workspace = "workspace-1";
    vi.spyOn(Route, "useParams").mockReturnValue({ missionId: "mission-1" } as never);
    hoisted.fetchMissionShortlist.mockResolvedValue({
      mission: { id: "mission-1", slug: "test-mission", title: "夏日面膜" },
      shortlists: [
        {
          creator_id: "creator-1",
          status: "shortlisted",
          source: "manual",
          notes: "Good fit.",
          creators: { display_name: "Amy Chan" },
        },
      ],
    });
  });

  it("renders mission shortlist rows and invite action", async () => {
    hoisted.fetchCreatorReviewQueue.mockResolvedValue({ creators: [], page: 1, pageSize: 25, total: 0 });
    hoisted.patchMissionShortlist.mockResolvedValue({ shortlist: { creator_id: "creator-1", status: "invited" } });

    renderRoute();

    expect(await screen.findByText("夏日面膜")).toBeInTheDocument();
    expect(screen.getByText("Amy Chan")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Invite Amy Chan"));

    await waitFor(() =>
      expect(hoisted.patchMissionShortlist).toHaveBeenCalledWith("mission-1", "creator-1", { status: "invited" }),
    );
  });

  it("uses backend mission status filtering when flagged is selected", async () => {
    hoisted.fetchCreatorReviewQueue
      .mockResolvedValueOnce({
        creators: [
          {
            id: "approved-1",
            displayName: "Approved Ada",
            avatarUrl: null,
            level: "L3",
            categories: ["beauty"],
            scores: { influence: 90, content: 88, reliability: 86, brandSafety: 92 },
            social: {
              platforms: ["instagram"],
              syncStatus: "synced",
              followerCount: 50000,
              engagementRate: 4.2,
              apiSyncedAt: "2026-06-18T02:00:00.000Z",
              label: "API-synced",
              ownershipLabel: "Ownership not verified",
            },
            review: { status: "approved", riskLevel: "low", summary: null, reviewedBy: null, lastReviewedAt: null, updatedAt: null },
            shortlist: null,
            lastActivityAt: "2026-06-18T02:00:00.000Z",
          },
          {
            id: "needs-1",
            displayName: "Needs Nora",
            avatarUrl: null,
            level: "L2",
            categories: ["ugc"],
            scores: { influence: 72, content: 81, reliability: 75, brandSafety: 95 },
            social: {
              platforms: ["instagram"],
              syncStatus: "synced",
              followerCount: 22000,
              engagementRate: 3.6,
              apiSyncedAt: "2026-06-18T02:00:00.000Z",
              label: "API-synced",
              ownershipLabel: "Ownership not verified",
            },
            review: { status: "needs_review", riskLevel: "unknown", summary: null, reviewedBy: null, lastReviewedAt: null, updatedAt: null },
            shortlist: null,
            lastActivityAt: "2026-06-18T01:00:00.000Z",
          },
        ],
        page: 1,
        pageSize: 25,
        total: 2,
      })
      .mockResolvedValueOnce({
        creators: [
          {
            id: "flagged-1",
            displayName: "Flagged Finn",
            avatarUrl: null,
            level: "L1",
            categories: ["beauty"],
            scores: { influence: 40, content: 42, reliability: 35, brandSafety: 22 },
            social: {
              platforms: ["instagram"],
              syncStatus: "synced",
              followerCount: 9000,
              engagementRate: 1.1,
              apiSyncedAt: "2026-06-18T02:00:00.000Z",
              label: "API-synced",
              ownershipLabel: "Ownership not verified",
            },
            review: { status: "flagged", riskLevel: "high", summary: null, reviewedBy: null, lastReviewedAt: null, updatedAt: null },
            shortlist: null,
            lastActivityAt: "2026-06-18T03:00:00.000Z",
          },
        ],
        page: 1,
        pageSize: 25,
        total: 1,
      });

    renderRoute();

    expect(await screen.findByText("Approved Ada")).toBeInTheDocument();
    expect(screen.getByText("Needs Nora")).toBeInTheDocument();
    expect(screen.queryByText("Flagged Finn")).not.toBeInTheDocument();
    expect(hoisted.fetchCreatorReviewQueue).toHaveBeenNthCalledWith(1, "workspace-1", {
      missionId: "mission-1",
      page: 1,
      pageSize: 25,
      sort: "last_activity",
    });

    fireEvent.change(screen.getByLabelText("Status filter"), { target: { value: "flagged" } });

    await waitFor(() =>
      expect(hoisted.fetchCreatorReviewQueue).toHaveBeenNthCalledWith(2, "workspace-1", {
        missionId: "mission-1",
        status: "flagged",
        page: 1,
        pageSize: 25,
        sort: "last_activity",
      }),
    );
    expect(await screen.findByText("Flagged Finn")).toBeInTheDocument();
    expect(screen.queryByText("Approved Ada")).not.toBeInTheDocument();
  });

  it("does not fetch the Creator queue without a workspace", async () => {
    hoisted.workspace = "";
    renderRoute();

    await waitFor(() => expect(hoisted.fetchMissionShortlist).toHaveBeenCalledWith("mission-1"));
    expect(hoisted.fetchCreatorReviewQueue).not.toHaveBeenCalled();
  });

  it("uses a workspace-specific queue cache key when the workspace changes", async () => {
    hoisted.fetchCreatorReviewQueue
      .mockResolvedValueOnce({ creators: [{ id: "creator-1", displayName: "Workspace one", avatarUrl: null, level: "L1", categories: [], scores: {}, social: { platforms: [], syncStatus: null, followerCount: null, engagementRate: null, apiSyncedAt: null, label: "Not synced", ownershipLabel: "Ownership not verified" }, profileMedia: { avatarUrl: null, portfolioCount: 0, publicHighlightCount: 0, completenessScore: 0 }, review: { status: "needs_review", riskLevel: "unknown", summary: null, reviewedBy: null, lastReviewedAt: null, updatedAt: null }, enrichment: { social: { status: "available", value: { platforms: [], syncStatus: null, followerCount: null, engagementRate: null, apiSyncedAt: null, label: "Not synced", ownershipLabel: "Ownership not verified" } }, profile: { status: "available", value: { avatarUrl: null, portfolioCount: 0, publicHighlightCount: 0, completenessScore: 0 } } }, shortlist: null, lastActivityAt: null }], page: 1, pageSize: 25, total: 1 })
      .mockResolvedValueOnce({ creators: [{ id: "creator-2", displayName: "Workspace two", avatarUrl: null, level: "L1", categories: [], scores: {}, social: { platforms: [], syncStatus: null, followerCount: null, engagementRate: null, apiSyncedAt: null, label: "Not synced", ownershipLabel: "Ownership not verified" }, profileMedia: { avatarUrl: null, portfolioCount: 0, publicHighlightCount: 0, completenessScore: 0 }, review: { status: "needs_review", riskLevel: "unknown", summary: null, reviewedBy: null, lastReviewedAt: null, updatedAt: null }, enrichment: { social: { status: "available", value: { platforms: [], syncStatus: null, followerCount: null, engagementRate: null, apiSyncedAt: null, label: "Not synced", ownershipLabel: "Ownership not verified" } }, profile: { status: "available", value: { avatarUrl: null, portfolioCount: 0, publicHighlightCount: 0, completenessScore: 0 } } }, shortlist: null, lastActivityAt: null }], page: 1, pageSize: 25, total: 1 });

    const view = renderRoute();
    expect(await screen.findByText("Workspace one")).toBeInTheDocument();
    hoisted.workspace = "workspace-2";
    view.rerenderRoute();

    expect(await screen.findByText("Workspace two")).toBeInTheDocument();
    expect(screen.queryByText("Workspace one")).not.toBeInTheDocument();
    expect(hoisted.fetchCreatorReviewQueue).toHaveBeenNthCalledWith(1, "workspace-1", expect.any(Object));
    expect(hoisted.fetchCreatorReviewQueue).toHaveBeenNthCalledWith(2, "workspace-2", expect.any(Object));
  });
});
