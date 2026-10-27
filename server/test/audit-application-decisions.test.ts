// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const h = vi.hoisted(() => ({ rpc: vi.fn(), mode: "success" }));
const workspace = "00000000-0000-4000-8000-0000000000aa";
const actor = "00000000-0000-4000-8000-000000000011";
const submission = "00000000-0000-4000-8000-000000000031";
const request = "00000000-0000-4000-8000-000000000041";
const decision = { action: "accept", actorId: actor, actorLabel: "Test operator", decidedAt: "2026-10-25T10:00:00Z", revision: 1 };
vi.mock("../lib/supabase", () => ({
  makeUserClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: actor, email: "operator@example.test" } }, error: null }) } }),
  serviceClient: () => ({ rpc: h.rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { creator_workflow_mode: "legacy" }, error: null }) }) }) }) }),
}));
vi.mock("../lib/staffAuth", () => ({ resolveStaff: async () => ({ user_id: actor, email: "operator@example.test", active: true }) }));
vi.mock("../lib/staffWorkspace", async (original) => ({ ...await original<typeof import("../lib/staffWorkspace")>(),
  requireStaffWorkspace: async () => ({ workspaceId: workspace, workspaceSlug: "test-a", userId: actor }), assertStaffResource: async () => undefined,
}));
vi.mock("../lib/staffCapabilities", async (original) => ({ ...await original<typeof import("../lib/staffCapabilities")>(), requireCapability: async () => undefined }));
import { adminRoutes } from "../routes/admin";

const app = new Hono().route("/api/admin", adminRoutes);
const req = (action: string, body: object) => app.request(`/api/admin/applications/${submission}/${action}`, {
  method: "POST", headers: { Authorization: "Bearer offline-transport-only", "Content-Type": "application/json", "X-Workspace-Slug": "test-a" }, body: JSON.stringify(body),
});

describe("UC-A10 application decision transport (offline, not Auth/RLS evidence)", () => {
  beforeEach(() => {
    h.mode = "success";
    h.rpc.mockReset().mockImplementation(async (name: string) => {
      if (h.mode === "conflict") return name === "decide_mission_application"
        ? { data: { conflict: true, decision }, error: null }
        : { data: null, error: { message: "wrong_state", code: "P0001" } };
      return { data: { id: submission, status: name === "decline_application" ? "declined" : "joined", ...(name === "decide_mission_application" ? { decision } : {}) }, error: null };
    });
  });

  it("persists a decision with trusted actor and request identity in one command", async () => {
    const response = await req("accept", { request_id: request, expected_revision: 0, operator_id: "forged" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: submission, status: "joined", decision });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("decide_mission_application", expect.objectContaining({
      p_workspace: workspace, p_operator: actor, p_submission: submission, p_request: request, p_expected_revision: 0, p_decision: "accept",
    }));
  });

  it("shows the winning actor and time on a recoverable concurrent decision conflict", async () => {
    h.mode = "conflict";
    const response = await req("decline", { request_id: request, expected_revision: 0, notes: "Keep this reason" });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ code: "APPLICATION_DECIDED", current_decision: decision });
    expect(body.error).toContain("Test operator");
    expect(body.error).toMatch(/2026|25/);
  });

  it("rejects an empty decline reason before any business command", async () => {
    const response = await req("decline", { request_id: request, expected_revision: 0, notes: "  " });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "application_reason_required" });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("never reports an empty database result as a saved decision", async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    const response = await req("accept", {});
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "application_unavailable" });
  });

  it("keeps a stable logical receipt for older empty-body retries", async () => {
    expect((await req("accept", {})).status).toBe(200);
    expect((await req("accept", {})).status).toBe(200);
    expect(h.rpc.mock.calls[0]).toEqual(h.rpc.mock.calls[1]);
    expect(h.rpc.mock.calls[0][1].p_request).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("handles the installed SDK's rejecting PromiseLike without claiming a saved decision", async () => {
    h.rpc.mockReturnValue({ then: (_resolve: unknown, reject: (error: Error) => void) => reject(new Error("Offline transport outage")) });
    const response = await req("accept", {});
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "application_unavailable" });
  });

  it("preserves the original accept-without-a-body contract and the same retry identity as an empty object", async () => {
    const response = await app.request(`/api/admin/applications/${submission}/accept`, {
      method: "POST", headers: { Authorization: "Bearer offline-transport-only", "X-Workspace-Slug": "test-a" },
    });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ status: "joined", decision });
    await req("accept", {}); expect(h.rpc.mock.calls[0]).toEqual(h.rpc.mock.calls[1]);
  });
});
