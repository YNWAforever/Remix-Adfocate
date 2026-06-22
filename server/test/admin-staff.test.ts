import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { cleanup, hasSupabaseEnv, makeCreator, makeStaff, makeUser, serviceForTests } from "./helpers";

process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || "test-admin-secret";
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function meReq(headers: Record<string, string>) {
  return app.request("/api/admin/me", { headers });
}

suite("requireStaff gate + GET /admin/me", () => {
  beforeAll(cleanup);
  afterAll(async () => {
    delete process.env.STAFF_EMAIL_ALLOWLIST;
    await cleanup();
  });

  it("401 when no token and no secret", async () => {
    const res = await meReq({});
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("no_admin");
  });

  it("200 for a valid staff JWT", async () => {
    const staff = await makeStaff("staff-gate@test.local");
    const res = await meReq({ Authorization: `Bearer ${staff.jwt}` });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.staff.userId).toBe(staff.userId);
    expect(body.staff.email).toBe("staff-gate@test.local");
  });

  it("403 not_staff for a valid non-staff JWT", async () => {
    const user = await makeUser({ email: "not-staff@test.local" });
    const res = await meReq({ Authorization: `Bearer ${user.jwt}` });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("not_staff");
    await serviceForTests().auth.admin.deleteUser(user.userId);
  });

  it("auto-promotes an allow-listed email on first login", async () => {
    const user = await makeUser({ email: "promote-me@test.local" });
    process.env.STAFF_EMAIL_ALLOWLIST = "promote-me@test.local";
    const res = await meReq({ Authorization: `Bearer ${user.jwt}` });
    expect(res.status).toBe(200);
    const row = await serviceForTests()
      .from("staff_users").select("user_id, active").eq("user_id", user.userId).maybeSingle();
    expect(row.data?.active).toBe(true);
    delete process.env.STAFF_EMAIL_ALLOWLIST;
    await serviceForTests().from("staff_users").delete().eq("user_id", user.userId);
    await serviceForTests().auth.admin.deleteUser(user.userId);
  });

  it("break-glass: x-admin-secret returns the shared-secret sentinel", async () => {
    const res = await meReq({ "x-admin-secret": ADMIN_SECRET });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.staff).toEqual({ userId: null, email: "shared-secret" });
  });

  it("audit attribution uses the staff identity, not client headers", async () => {
    const staff = await makeStaff("staff-audit@test.local");
    const creator = await makeCreator("audit-target@test.local");
    // A CRM action (review) as the staff JWT — also send spoofed operator headers.
    const res = await app.request(`/api/admin/creators/${creator.userId}/review`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${staff.jwt}`,
        "x-operator-id": "SPOOFED",
        "x-operator-label": "Spoofed",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "approved", risk_level: "low" }),
    });
    expect(res.status).toBe(200);
    const audit = await serviceForTests()
      .from("operator_audit_events")
      .select("operator_id, actor_label")
      .eq("creator_id", creator.userId)
      .limit(1)
      .maybeSingle();
    expect(audit.data?.operator_id).toBe(staff.userId);
    expect(audit.data?.actor_label).toBe("staff-audit@test.local");
  });
});
