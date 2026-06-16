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

  it("operator accept → joined (+10 xp, filled++), then the creator can submit", async () => {
    await makeMission({ slug: "test-app-accept", title: "申請接受", access_type: "application", quota: 1 });
    const applied = await (await req("/missions/test-app-accept/apply", koc.jwt, { method: "POST" })).json();

    const meBefore = await (await req("/me", koc.jwt)).json();

    const list = await (await adminReq("/admin/applications")).json();
    expect(list.applications.some((a: { id: string }) => a.id === applied.id)).toBe(true);

    const acc = await adminReq(`/admin/applications/${applied.id}/accept`, { method: "POST" });
    expect(acc.status).toBe(200);
    expect((await acc.json()).status).toBe("joined");

    const meAfter = await (await req("/me", koc.jwt)).json();
    expect(meAfter.xp - meBefore.xp).toBe(10);

    const mission = await (await req("/missions/test-app-accept", koc.jwt)).json();
    expect(mission.filled).toBe(1);

    const sub = await req("/missions/test-app-accept/submit", koc.jwt, {
      method: "PUT", body: JSON.stringify({ content_urls: ["https://ig.com/p/x"] }),
    });
    expect(sub.status).toBe(200);
    expect((await sub.json()).status).toBe("submitted");
  });

  it("accept fails with mission_full when the quota is reached", async () => {
    // test-app-accept (quota 1) is already filled by koc above; koc2 applies then accept fails.
    const applied = await (await req("/missions/test-app-accept/apply", koc2.jwt, { method: "POST" })).json();
    const res = await adminReq(`/admin/applications/${applied.id}/accept`, { method: "POST" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("mission_full");
  });

  it("operator can decline an application", async () => {
    await makeMission({ slug: "test-app-decline", title: "申請拒絕", access_type: "application", quota: 5 });
    const applied = await (await req("/missions/test-app-decline/apply", koc2.jwt, { method: "POST" })).json();
    const res = await adminReq(`/admin/applications/${applied.id}/decline`, {
      method: "POST", body: JSON.stringify({ notes: "唔啱" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("declined");
  });
});
