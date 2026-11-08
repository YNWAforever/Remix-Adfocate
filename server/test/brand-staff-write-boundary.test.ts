import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const USER = "a0000000-0000-4000-8000-000000000011";
const WS = "a0000000-0000-4000-8000-000000000012";
const h = vi.hoisted(() => ({
  staff: true, staffActive: true, role: "finance_viewer", roleActive: true,
  roleWorkspace: "", lookupError: false, userClients: 0,
}));
vi.mock("../lib/supabase", () => ({
  makeUserClient: () => { h.userClients++; throw new Error("UNEXPECTED_MISSION_WRITE_PATH"); },
  serviceClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) },
    from: (table: string) => {
      const row = table === "brand_users"
        ? { user_id: USER, workspace_id: WS, email: "boundary@example.invalid", role: "member", active: true }
        : table === "staff_users" ? (h.staff ? { user_id: USER, active: h.staffActive } : null)
        : { user_id: USER, workspace_id: h.roleWorkspace || WS, role: h.role, active: h.roleActive };
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({
        data: row, error: h.lookupError && table === "staff_users" ? { code: "XX000" } : null,
      }) };
      return q;
    },
  }),
}));

import { brandRoutes } from "../routes/brand";
const app = new Hono().route("/api/brand", brandRoutes);
const request = (path = "/missions", method = "POST") => app.request(`/api/brand${path}`, {
  method, headers: { Authorization: "Bearer offline-transport-only", "Content-Type": "application/json" },
  body: JSON.stringify({}),
});
beforeEach(() => {
  Object.assign(h, { staff: true, staffActive: true, role: "finance_viewer", roleActive: true, roleWorkspace: "", lookupError: false, userClients: 0 });
});

describe("brand mission writes cannot bypass staff capabilities (mock transport)", () => {
  for (const role of ["finance_viewer", "reviewer", "operator"]) {
    it(`denies ${role} before any privileged lifecycle or user-client write`, async () => {
      h.role = role;
      for (const [path, method] of [
        ["/missions", "POST"], ["/missions/owned", "PUT"],
        ["/missions/owned/publish", "POST"], ["/missions/owned/close", "POST"],
        ["/missions/owned", "DELETE"],
      ]) {
        const response = await request(path, method);
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: "STAFF_CAPABILITY_REQUIRED" });
      }
      expect(h.userClients).toBe(0);
    });
  }
  it("preserves brand-only authoring and its validation errors", async () => {
    h.staff = false;
    const response = await request();
    expect(response.status).toBe(422);
  });
  it("preserves workspace-admin authoring and its validation errors", async () => {
    h.role = "workspace_admin";
    expect((await request()).status).toBe(422);
  });
  it("does not restore brand-only writes after a staff role is revoked", async () => {
    h.role = "workspace_admin"; h.roleActive = false;
    expect((await request()).status).toBe(403);
  });
  it("requires the grant's workspace to match the active brand membership", async () => {
    h.role = "workspace_admin"; h.roleWorkspace = "a0000000-0000-4000-8000-000000000099";
    expect((await request()).status).toBe(403);
  });
  it("denies deactivated staff and fails closed on lookup errors", async () => {
    h.staffActive = false;
    expect((await request()).status).toBe(403);
    h.lookupError = true;
    expect((await request()).status).toBe(503);
  });
});
