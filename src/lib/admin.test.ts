import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AdminAuthError,
  AdminRequestError,
  adminFetch,
  approveActiveMissionVersion,
  approveSubmission,
  createMission,
  fetchAdminMissions,
  fetchActiveMissionQueue,
  fetchCreatorDetail,
  fetchCreatorPublicationProofs,
  fetchCreatorReviewQueue,
  fetchEngagedUsers,
  fetchMissionShortlist,
  fetchSubmissions,
  grantActiveMissionRevision,
  markActiveMissionShipped,
  postCreatorReview,
  postCreatorNote,
  requestActiveMissionRevision,
  startActiveMissionReview,
} from "./admin";
import { supabase } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

describe("admin client helpers", () => {
  beforeEach(() => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: "jwt-123" } },
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends Authorization: Bearer and no x-admin-secret", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await adminFetch("/admin/ping");
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer jwt-123");
    expect(headers["x-admin-secret"]).toBeUndefined();
  });

  it("throws AdminAuthError on 401 (no secret-clear side effect)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(adminFetch("/admin/ping")).rejects.toBeInstanceOf(AdminAuthError);
  });

  it("adds review queue filters to the admin URL", async () => {
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
        headers: expect.objectContaining({ Authorization: "Bearer jwt-123" }),
      }),
    );
  });

  it("posts creator review bodies with snake_case API keys", async () => {
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

  it("binds creator case reads, review and notes to the selected workspace", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const workspace = new Headers(init?.headers).get("X-Workspace-Slug");
      return workspace === "inaccessible"
        ? Response.json({ code: "NOT_FOUND", error: "Not found" }, { status: 404 })
        : Response.json({ creator: { id: "creator-1" } });
    });
    const calls = [
      () => fetchCreatorDetail("creator-1", "inaccessible"),
      () => fetchCreatorPublicationProofs("creator-1", "inaccessible"),
      () => postCreatorReview("creator-1", { status: "approved", riskLevel: "low" }, "inaccessible"),
      () => postCreatorNote("creator-1", { category: "other", body: "Retained note" }, "inaccessible"),
    ];
    for (const call of calls) await expect(call()).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("reads mission shortlist responses from the shortlists key", async () => {
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

  it("approveSubmission posts notes + quality_rating", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "approved" }), { status: 200 }),
    );
    await approveSubmission("sub-1", { notes: "great", rating: 5 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/submissions/sub-1/approve",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ notes: "great", quality_rating: 5 }),
      }),
    );
  });

  it("fetchSubmissions encodes the status query", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ submissions: [] }), { status: 200 }),
    );
    await fetchSubmissions("submitted");
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/submissions?status=submitted", expect.any(Object));
  });

  it("fetchEngagedUsers hits the engaged endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ creators: [] }), { status: 200 }),
    );
    await fetchEngagedUsers();
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/engaged", expect.any(Object));
  });

  it("uses the canonical active-mission queue query and workspace header", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );

    await fetchActiveMissionQueue({
      workspace: "demo",
      risk: "overdue",
      state: "under_review",
      reviewer: "reviewer-1",
      mission: "mission-1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/active-missions/queue?risk=overdue&state=under_review&reviewer=reviewer-1&mission=mission-1",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer jwt-123",
          "X-Workspace-Slug": "demo",
        }),
      }),
    );
  });

  it("sends exact active-mission transition paths and bodies", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const revision = {
      workspace: "demo",
      expectedState: "under_review",
      versionId: "version-2",
      deadline: "2099-07-21T10:00:00.000Z",
      items: [{ requirementId: null, category: "other" as const, text: "Update opening", required: true }],
    };

    await startActiveMissionReview("workflow-1", "item-1", { workspace: "demo", expectedState: "submitted" });
    await requestActiveMissionRevision("workflow-1", "item-1", revision);
    await grantActiveMissionRevision("workflow-1", "item-1", {
      workspace: "demo",
      reason: "Brief changed",
      grantedCount: 1,
    });
    await approveActiveMissionVersion("workflow-1", "item-1", {
      workspace: "demo",
      expectedState: "under_review",
      versionId: "version-2",
    });
    await markActiveMissionShipped("workflow-1", { workspace: "demo", note: "Tracking 123" });

    const request = (path: string, body: unknown) => [
      path,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-Workspace-Slug": "demo" }),
        body: JSON.stringify(body),
      }),
    ] as const;
    expect(fetchMock).toHaveBeenNthCalledWith(1, ...request(
      "/api/admin/active-missions/workflow-1/work-items/item-1/start-review",
      { expectedState: "submitted" },
    ));
    expect(fetchMock).toHaveBeenNthCalledWith(2, ...request(
      "/api/admin/active-missions/workflow-1/work-items/item-1/request-revision",
      {
        expectedState: "under_review",
        versionId: "version-2",
        deadline: "2099-07-21T10:00:00.000Z",
        items: revision.items,
      },
    ));
    expect(fetchMock).toHaveBeenNthCalledWith(3, ...request(
      "/api/admin/active-missions/workflow-1/work-items/item-1/grant-revision",
      { reason: "Brief changed", grantedCount: 1 },
    ));
    expect(fetchMock).toHaveBeenNthCalledWith(4, ...request(
      "/api/admin/active-missions/workflow-1/work-items/item-1/approve-to-publish",
      { expectedState: "under_review", versionId: "version-2" },
    ));
    expect(fetchMock).toHaveBeenNthCalledWith(5, ...request(
      "/api/admin/active-missions/workflow-1/fulfillment/shipped",
      { note: "Tracking 123" },
    ));
  });
});

describe("AdminRequestError surfaces code + fields", () => {
  beforeEach(() => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: "jwt-123" } },
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws AdminRequestError carrying fields on 422", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 422,
      json: async () => ({ error: "bad", code: "validation", fields: { slug: "taken" } }),
    }));
    const err = await createMission({ workspace_id: "w", slug: "x", title: "t", mission_type: "ugc" }).catch((e) => e);
    expect(err).toBeInstanceOf(AdminRequestError);
    expect(err).toMatchObject({ status: 422, code: "validation", fields: { slug: "taken" } });
  });
  it("fetchAdminMissions builds the workspace+status query", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ missions: [] }) });
    vi.stubGlobal("fetch", f);
    await fetchAdminMissions("ws1", "draft");
    expect(f).toHaveBeenCalledWith(expect.stringContaining("/admin/missions?workspace=ws1&status=draft"), expect.anything());
  });
});
