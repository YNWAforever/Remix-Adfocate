import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  approveSubmission,
  createMission,
  fetchAdminMissions,
  fetchEngagedUsers,
  fetchMissionShortlist,
  fetchSubmissions,
} from "./admin";
import { AdminAuthError, AdminRequestError, adminFetch } from "./adminTransport";
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
    expect(err).toMatchObject({ code: "validation", fields: { slug: "taken" } });
  });
  it("fetchAdminMissions builds the workspace+status query", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ missions: [] }) });
    vi.stubGlobal("fetch", f);
    await fetchAdminMissions("ws1", "draft");
    expect(f).toHaveBeenCalledWith(expect.stringContaining("/admin/missions?workspace=ws1&status=draft"), expect.anything());
  });
});
