import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const clients = vi.hoisted(() => ({ serviceClient: vi.fn(), makeUserClient: vi.fn() }));
vi.mock("../lib/supabase.js", () => clients);

import { brandRoutes } from "../routes/brand.js";

const USER_ID = "a0000000-0000-4000-8000-000000000021";
const WORKSPACE_ID = "a0000000-0000-4000-8000-000000000022";
const MISSION_ID = "a0000000-0000-4000-8000-000000000023";
const app = new Hono().route("/api/brand", brandRoutes);

function setOfflineMission(role: "owner" | "member", status: "draft" | "active") {
  let mission: { id: string; status: "draft" | "active"; workspaceId: string } | null = {
    id: MISSION_ID, status, workspaceId: WORKSPACE_ID,
  };
  const rowQuery = (row: unknown) => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
  });

  clients.serviceClient.mockReturnValue({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
    from(table: string) {
      if (table === "brand_users") return rowQuery({
        user_id: USER_ID, workspace_id: WORKSPACE_ID, email: "brand@example.invalid", role, active: true,
      });
      if (table === "staff_users") return rowQuery(null);
      if (table === "mission_submissions") return {
        select: () => ({ eq: async () => ({ count: 0, error: null }) }),
      };
      if (table === "missions") return {
        delete: () => {
          const filters: Record<string, string> = {};
          type DeleteQuery = {
            eq: (field: string, value: string) => DeleteQuery;
            select: (fields: string) => Promise<{ data: Array<{ id: string }>; error: null }>;
          };
          const query: DeleteQuery = {
            eq(field, value) { filters[field] = value; return query; },
            async select() {
              const current = mission;
              if (current && filters.id === current.id && filters.workspace_id === current.workspaceId && filters.status === current.status) {
                mission = null;
                return { data: [{ id: current.id }], error: null };
              }
              return { data: [], error: null };
            },
          };
          return query;
        },
      };
      throw new Error(`Unexpected service table: ${table}`);
    },
  });
  clients.makeUserClient.mockReturnValue({
    from(table: string) {
      if (table !== "missions") throw new Error(`Unexpected user table: ${table}`);
      return {
        select: () => ({ eq: (field: string, value: string) => ({
          maybeSingle: async () => ({
            data: field === "id" && mission?.id === value && mission.workspaceId === WORKSPACE_ID
              ? { id: mission.id, status: mission.status } : null,
            error: null,
          }),
        }) }),
      };
    },
  });
}

const request = (method: "DELETE" | "GET") => app.request(`/api/brand/missions/${MISSION_ID}`, {
  method, headers: { Authorization: "Bearer offline-brand-session" },
});

beforeEach(() => vi.clearAllMocks());

describe("brand mission DELETE permissions (offline Hono route)", () => {
  it("returns 403 for a member deleting a draft, leaving the mission readable", async () => {
    setOfflineMission("member", "draft");
    const response = await request("DELETE");
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "forbidden" });
    expect((await request("GET")).status).toBe(200);
  });

  it("lets an owner delete a draft", async () => {
    setOfflineMission("owner", "draft");
    const response = await request("DELETE");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect((await request("GET")).status).toBe(404);
  });

  it("returns 409 for an owner deleting an active mission, leaving it readable", async () => {
    setOfflineMission("owner", "active");
    const response = await request("DELETE");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "invalid_transition" });
    expect((await request("GET")).status).toBe(200);
  });
});
