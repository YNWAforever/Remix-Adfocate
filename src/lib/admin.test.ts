import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdminAuthError,
  clearAdminSecret,
  fetchCreatorDetail,
  fetchCreatorReviewQueue,
  fetchMissionShortlist,
  getAdminSecret,
  postCreatorReview,
  setAdminSecret,
} from "./admin";

describe("admin client helpers", () => {
  afterEach(() => {
    clearAdminSecret();
    vi.restoreAllMocks();
  });

  it("adds review queue filters to the admin URL", async () => {
    setAdminSecret("secret");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ creators: [], page: 2, pageSize: 10, total: 0 }), { status: 200 }),
    );

    await fetchCreatorReviewQueue({
      status: "approved",
      riskLevel: "low",
      missionId: "mission-1",
      q: "amy",
      page: 2,
      pageSize: 10,
      sort: "trust_score",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/creators/review?status=approved&risk_level=low&mission_id=mission-1&q=amy&page=2&page_size=10&sort=trust_score",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-admin-secret": "secret" }),
      }),
    );
  });

  it("posts creator review bodies with snake_case API keys", async () => {
    setAdminSecret("secret");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ review: { status: "approved", riskLevel: "low" } }), { status: 200 }),
    );

    await postCreatorReview("creator-1", {
      status: "approved",
      riskLevel: "low",
      summary: "Ready.",
      note: "Strong samples.",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/creators/creator-1/review",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          status: "approved",
          risk_level: "low",
          summary: "Ready.",
          note: "Strong samples.",
        }),
      }),
    );
  });

  it("clears a stale secret on 401", async () => {
    setAdminSecret("bad-secret");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "no_admin" }), { status: 401 }));

    await expect(fetchCreatorReviewQueue({ page: 1, pageSize: 25, sort: "last_activity" })).rejects.toBeInstanceOf(
      AdminAuthError,
    );
    expect(getAdminSecret()).toBeNull();
  });

  it("reads mission shortlist responses from the shortlists key", async () => {
    setAdminSecret("secret");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          mission: { id: "mission-1", slug: "mission-slug", title: "Mission Title" },
          shortlists: [{ creator_id: "creator-1", status: "shortlisted", source: "manual", notes: null }],
        }),
        { status: 200 },
      ),
    );

    const result = await fetchMissionShortlist("mission-1");

    expect(result.shortlists).toHaveLength(1);
    expect(result.shortlists[0]).toMatchObject({ creator_id: "creator-1", status: "shortlisted" });
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/missions/mission-1/shortlist", expect.any(Object));
  });

  it("preserves snake_case creator detail fields", async () => {
    setAdminSecret("secret");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          creator: {
            id: "creator-1",
            workspace_id: "workspace-1",
            display_name: "Ada",
            avatar_url: null,
            level: "L2",
            categories: ["fashion"],
            scores: { trust: 0.9 },
            social_handles: [{ platform: "instagram", handle: "@ada" }],
            created_at: "2025-01-01T00:00:00.000Z",
          },
          social: {
            platforms: ["instagram"],
            syncStatus: "synced",
            followerCount: 1000,
            engagementRate: 0.12,
            apiSyncedAt: "2025-01-01T00:00:00.000Z",
            label: "API-synced",
            ownershipLabel: "Ownership not verified",
          },
          socialAccounts: [
            {
              id: "social-1",
              platform: "instagram",
              handle: "@ada",
              sync_status: "synced",
              follower_count: 1000,
              engagement_rate: 0.12,
              api_synced_at: "2025-01-01T00:00:00.000Z",
              external_avatar_url: null,
              bio: "Creative director",
              post_count: 120,
              following_count: 80,
              avg_likes: 500,
              avg_comments: 12,
              posting_frequency: 4,
              freshness_score: 0.9,
              content_themes: ["fashion", "lifestyle"],
            },
          ],
          review: {
            status: "approved",
            riskLevel: "low",
            summary: null,
            reviewedBy: null,
            lastReviewedAt: null,
            updatedAt: null,
          },
          notes: [],
          shortlists: [],
          audit: [],
          missionHistory: [],
        }),
        { status: 200 },
      ),
    );

    const detail = await fetchCreatorDetail("creator-1");

    const creator: {
      id: string;
      workspace_id: string;
      display_name: string | null;
      avatar_url: string | null;
      level: string;
      categories: string[];
      scores: Record<string, number | null>;
      social_handles: unknown;
      created_at: string;
    } = detail.creator;

    expect(creator.workspace_id).toBe("workspace-1");
    expect(creator.display_name).toBe("Ada");
    expect(creator.social_handles).toEqual([{ platform: "instagram", handle: "@ada" }]);
    expect(detail.socialAccounts).toHaveLength(1);
    expect(detail.socialAccounts[0]).toMatchObject({
      id: "social-1",
      platform: "instagram",
      sync_status: "synced",
      external_avatar_url: null,
      content_themes: ["fashion", "lifestyle"],
    });
    expect(detail.shortlists).toEqual([]);
  });
});
