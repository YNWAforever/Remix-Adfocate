import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: hoisted.getSession } },
}));

import {
  fetchCreatorDetail,
  fetchCreatorReviewQueue,
  postCreatorNote,
  postCreatorPublicationProofReview,
  postCreatorReview,
} from "./creatorCase";

describe("creator case client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.getSession.mockResolvedValue({ data: { session: { access_token: "staff-token" } } });
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("sends workspace and command id with a review command", async () => {
    await postCreatorReview(
      "workspace-1",
      "creator-1",
      { status: "approved", riskLevel: "low", summary: "Approved", note: "Reviewed" },
      "command-1",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/creators/creator-1/review?workspace=workspace-1",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          command_id: "command-1",
          status: "approved",
          risk_level: "low",
          summary: "Approved",
          note: "Reviewed",
        }),
      }),
    );
  });

  it("sends the complete workspace-scoped publication-proof review command", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ publicationProof: null }),
    });

    const result = await postCreatorPublicationProofReview(
      "workspace-1",
      "creator-1",
      {
        submissionId: "submission-1",
        workItemId: "work-item-1",
        attemptId: "attempt-1",
        decision: "changes_requested",
        message: "Use the public campaign post URL.",
      },
      "proof-command-1",
    );

    expect(result).toEqual({ publicationProof: null });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/creators/creator-1/publication-proof/review?workspace=workspace-1",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          command_id: "proof-command-1",
          submission_id: "submission-1",
          work_item_id: "work-item-1",
          attempt_id: "attempt-1",
          decision: "changes_requested",
          message: "Use the public campaign post URL.",
        }),
      }),
    );
  });

  it("adds workspace and review filters to the focused queue URL", async () => {
    await fetchCreatorReviewQueue("workspace-1", {
      status: "approved",
      riskLevel: "low",
      missionId: "mission-1",
      q: "amy",
      page: 2,
      pageSize: 10,
      sort: "trust_score",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/creators/review?workspace=workspace-1&status=approved&risk_level=low&mission_id=mission-1&q=amy&page=2&page_size=10&sort=trust_score",
      expect.any(Object),
    );
  });

  it("reads workspace-scoped creator case detail from the focused client", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        creator: { id: "creator-1", workspaceId: "workspace-1", displayName: "Ada", avatarUrl: null, level: "L2", categories: [], scores: {}, socialHandles: null, createdAt: "2026-01-01T00:00:00.000Z" },
        review: { status: "approved", riskLevel: "low", summary: null, reviewedBy: null, lastReviewedAt: null, updatedAt: null },
        notes: [], audit: [], social: { status: "unavailable", reason: "not_configured" }, profile: { status: "unavailable", reason: "not_configured" }, missionHistory: { status: "unavailable", reason: "not_configured" }, shortlists: [],
      }),
    });

    const detail = await fetchCreatorDetail("workspace-1", "creator-1");

    expect(detail.creator).toMatchObject({ workspaceId: "workspace-1", displayName: "Ada" });
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/creators/creator-1?workspace=workspace-1", expect.any(Object));
  });

  it.each([
    ["queue", () => fetchCreatorReviewQueue("", {})],
    ["detail", () => fetchCreatorDetail("", "creator-1")],
    ["review", () => postCreatorReview("", "creator-1", { status: "approved", riskLevel: "low" }, "command-1")],
    ["note", () => postCreatorNote("", "creator-1", { category: "other", body: "Reviewed" }, "command-1")],
  ])("rejects an empty workspace before fetching %s", async (_operation, invoke) => {
    await expect(invoke()).rejects.toThrow("workspace_required");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
