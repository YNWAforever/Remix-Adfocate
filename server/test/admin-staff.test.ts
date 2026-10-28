import { grantStaffFixture } from "./helpers";
import { fixtureName } from "./helpers";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { cleanup, DEMO_WS, hasSupabaseEnv, makeCreator, makeStaff, makeUser, serviceForTests } from "./helpers";

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
    delete process.env.STAFF_EMAIL_DOMAINS;
    await cleanup();
  });

  it("401 when no token and no secret", async () => {
    const res = await meReq({});
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("no_admin");
  });

  it("200 for a valid staff JWT", async () => {
    const staff = await makeStaff(fixtureName("staff-gate@test.local"));
    const res = await meReq({ Authorization: `Bearer ${staff.jwt}` });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.staff.userId).toBe(staff.userId);
    expect(body.staff.email).toBe(fixtureName("staff-gate@test.local"));
  });

  it("403 not_staff for a valid non-staff JWT", async () => {
    const user = await makeUser({ email: fixtureName("not-staff@test.local") });
    const res = await meReq({ Authorization: `Bearer ${user.jwt}` });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("not_staff");
    await serviceForTests().auth.admin.deleteUser(user.userId);
  });

  it("does not auto-promote an allow-listed email", async () => {
    const user = await makeUser({ email: fixtureName("promote-me@test.local") });
    process.env.STAFF_EMAIL_ALLOWLIST = fixtureName("promote-me@test.local");
    const res = await meReq({ Authorization: `Bearer ${user.jwt}` });
    expect(res.status).toBe(403);
    const row = await serviceForTests()
      .from("staff_users").select("user_id, active").eq("user_id", user.userId).maybeSingle();
    expect(row.data).toBeNull();
    delete process.env.STAFF_EMAIL_ALLOWLIST;
    await serviceForTests().from("staff_users").delete().eq("user_id", user.userId);
    await serviceForTests().auth.admin.deleteUser(user.userId);
  });

  it("does not auto-promote a staff-domain email", async () => {
    // Use test.local as the staff domain so the created user is removable by cleanup().
    const user = await makeUser({ email: fixtureName("domain-promote@test.local") });
    process.env.STAFF_EMAIL_DOMAINS = "test.local";
    const res = await meReq({ Authorization: `Bearer ${user.jwt}` });
    expect(res.status).toBe(403);
    const row = await serviceForTests()
      .from("staff_users").select("user_id, active").eq("user_id", user.userId).maybeSingle();
    expect(row.data).toBeNull();
    delete process.env.STAFF_EMAIL_DOMAINS;
    await serviceForTests().from("staff_users").delete().eq("user_id", user.userId);
    await serviceForTests().auth.admin.deleteUser(user.userId);
  });

  it("rejects a shared secret for interactive staff identity", async () => {
    const res = await meReq({ "x-admin-secret": ADMIN_SECRET });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("staff_session_required");
    expect(body.staff).toBeUndefined();
  });

  it("audit attribution uses the staff identity, not client headers", async () => {
    const staff = await makeStaff(`staff-audit-${randomUUID()}@test.local`, DEMO_WS);
    await grantStaffFixture(staff.userId,DEMO_WS,"operator");
    const creator = await makeCreator(fixtureName("audit-target@test.local"));
    // A CRM action (review) as the staff JWT — also send spoofed operator headers.
    const res = await app.request(`/api/admin/creators/${creator.userId}/review`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${staff.jwt}`,
        "x-operator-id": "SPOOFED",
        "x-operator-label": "Spoofed",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ request_id: randomUUID(), expected_revision: 0, status: "approved", risk_level: "low" }),
    });
    expect(res.status).toBe(200);
    const audit = await serviceForTests()
      .from("operator_audit_events")
      .select("operator_id, actor_label")
      .eq("creator_id", creator.userId)
      .limit(1)
      .maybeSingle();
    expect(audit.data?.operator_id).toBe(staff.userId);
    expect(audit.data?.actor_label).toBe(staff.email);
  });
});
