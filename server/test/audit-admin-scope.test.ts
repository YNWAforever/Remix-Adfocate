import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const h = vi.hoisted(() => ({
  member: false, active: true, memberError: false, authError: null as { status: number } | null,
  client: null as unknown,
}));
vi.mock("../lib/supabase.js", () => ({
  serviceClient: () => h.client,
  makeUserClient: () => ({ auth: { getUser: async () => ({ data: {
    user: { id: "staff-a", email: "staff@example.test", email_confirmed_at: "2026-01-01" },
  }, error: h.authError }) } }),
}));
import { adminRoutes } from "../routes/admin";

function client() {
  return { rpc: vi.fn(async () => ({ data: { creatorIds: [], total: 0, page: 1, pageSize: 25 }, error: null })), from(table: string) {
    const filters: Record<string, unknown> = {};
    const row = () => table === "staff_users"
      ? { user_id: "staff-a", email: "staff@example.test", active: h.active }
      : table === "staff_workspace_roles" ? { user_id: "staff-a", workspace_id: "workspace-a", role: "operator", active: true, revision: 1 }
      : table === "brand_users" ? h.member ? {
        user_id: "staff-a", workspace_id: "workspace-a", active: true,
        workspaces: { id: "workspace-a", slug: "a", name: "A" },
      } : null : { id: "creator-b", workspace_id: "workspace-b" };
    const q = {
      select() { return q; }, eq(key: string, value: unknown) { filters[key] = value; return q; },
      in() { return q; }, order() { return q; }, ilike() { return q; }, limit() { return q; },
      maybeSingle: async () => ({ data: row(), error: table === "brand_users" && h.memberError ? { code: "08006" } : null }),
      single: async () => ({ data: row(), error: null }),
      then(resolve: (value: unknown) => unknown) { return Promise.resolve({
        data: table === "workspaces" ? [{ id: "workspace-a", slug: "a", name: "A" },
          ...(!filters.id ? [{ id: "workspace-b", slug: "b", name: "B" }] : [])] : [], error: null,
      }).then(resolve); },
    };
    return q;
  } };
}
const app = new Hono().route("/admin", adminRoutes);
const request = (path: string) => app.request(`/admin${path}`, { headers: { Authorization: "Bearer synthetic" } });

describe("staff workspace API boundary", () => {
  beforeEach(() => { h.member = false; h.active = true; h.memberError = false; h.authError = null; h.client = client(); });
  it("does not turn an Auth service outage into a new login requirement", async () => {
    h.authError = { status: 503 }; expect((await request("/workspaces")).status).toBe(503);
  });
  it("injects the verified workspace into an unfiltered legacy queue request", async () => {
    h.member = true; expect((await request("/creators/review")).status).toBe(200);
    expect((h.client as ReturnType<typeof client>).rpc).toHaveBeenCalledWith("list_creator_review_queue_page", expect.objectContaining({ p_workspace: "workspace-a", p_operator: "staff-a" }));
  });
  it("refuses an opaque creator ID from another workspace", async () => {
    h.member = true; expect((await request("/creators/creator-b")).status).toBe(404);
  });
  it("authenticated staff without membership cannot read the legacy queue", async () => {
    expect((await request("/creators/review")).status).toBe(403);
  });
  it("All workspaces contains only the active membership scope", async () => {
    h.member = true;
    const response = await request("/workspaces");
    expect(response.status).toBe(200);
    expect((await response.json()).workspaces.map((w: { id: string }) => w.id)).toEqual(["workspace-a"]);
  });
  it("does not accept another workspace as a query filter", async () => {
    h.member = true;
    expect((await request("/creators/review?workspace=workspace-b")).status).toBe(404);
  });
  it("membership storage failure is unavailable, independently of authentication", async () => {
    h.member = true; h.memberError = true;
    expect((await request("/creators/review")).status).toBe(503);
  });
  it("a disabled staff member is denied", async () => {
    h.member = true; h.active = false;
    expect((await request("/workspaces")).status).toBe(403);
  });
});
