import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, makeMission, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function req(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, "X-Workspace-Slug": "demo", "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}
function adminReq(path: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { "x-admin-secret": process.env.ADMIN_SECRET ?? "test-admin-secret", "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

suite("application-gated missions", () => {
  let koc: { userId: string; jwt: string };
  let koc2: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("applicant@test.local", 0);
    koc2 = await makeCreator("applicant2@test.local", 0);
  });
  afterAll(cleanup);

  it("applies to an application mission (→ applied), and a duplicate apply is rejected", async () => {
    await makeMission({ slug: "test-app-apply", title: "申請制任務", access_type: "application", quota: 5 });

    const res = await req("/missions/test-app-apply/apply", koc.jwt, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("applied");

    const dup = await req("/missions/test-app-apply/apply", koc.jwt, { method: "POST" });
    expect(dup.status).toBe(409);
    expect((await dup.json()).code).toBe("already_applied");
  });

  it("rejects applying to an open mission (not_application)", async () => {
    await makeMission({ slug: "test-open-apply", title: "公開任務", access_type: "open" });
    const res = await req("/missions/test-open-apply/apply", koc2.jwt, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("not_application");
  });

  it("requires authentication to apply", async () => {
    const res = await app.request("/api/missions/test-app-apply/apply", {
      method: "POST", headers: { "X-Workspace-Slug": "demo", "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });
});
