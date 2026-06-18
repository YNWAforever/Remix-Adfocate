import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdminAuthError,
  clearAdminSecret,
  fetchCreatorReviewQueue,
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
});
