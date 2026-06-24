// server/test/radar.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeStaff, makeCreator, seedSubmission, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function adminReq(path: string, jwt: string) {
  return app.request(`/api${path}`, { headers: { Authorization: `Bearer ${jwt}` } });
}

suite("admin radar", () => {
  let staff: { userId: string; jwt: string };

  beforeAll(async () => {
    await cleanup();
    staff = await makeStaff("radar-staff@test.local");
    // Seed a creator with a stale submission (so at-risk queue is non-empty)
    const creator = await makeCreator("radar-koc@test.local", 0);
    await seedSubmission(creator.userId, "approved", "test-radar-approved");
  });
  afterAll(cleanup);

  it("returns 422 for an unsupported days value", async () => {
    const res = await adminReq("/admin/radar?days=7", staff.jwt);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("validation");
  });

  it("requires staff auth (401 without a token)", async () => {
    const res = await app.request("/api/admin/radar?days=30");
    expect(res.status).toBe(401);
  });

  it("returns a well-formed radar payload for staff", async () => {
    const res = await adminReq("/admin/radar?days=30", staff.jwt);
    expect(res.status).toBe(200);
    const { radar } = await res.json();
    expect(radar.window.days).toBe(30);
    expect(typeof radar.window.from).toBe("string");
    expect(Array.isArray(radar.atRisk.items)).toBe(true);
    expect(typeof radar.atRisk.total).toBe("number");
    expect(Array.isArray(radar.slaBreaching.items)).toBe(true);
    expect(Array.isArray(radar.rising.items)).toBe(true);
    expect(Array.isArray(radar.newUnactivated.items)).toBe(true);
  });

  it("accepts a workspace filter without crashing", async () => {
    const res = await adminReq(
      "/admin/radar?days=30&workspace=00000000-0000-0000-0000-0000000000ff",
      staff.jwt,
    );
    expect(res.status).toBe(200);
    const { radar } = await res.json();
    expect(radar.window.days).toBe(30);
  });
});
