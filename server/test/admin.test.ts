import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, makeMission, cleanup, hasSupabaseEnv } from "./helpers";

// Make the in-process admin middleware and the test agree on the secret.
process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || "test-admin-secret";
const ADMIN_SECRET = process.env.ADMIN_SECRET;

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function koreq(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "X-Workspace-Slug": "demo",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}
function adminreq(path: string, init: RequestInit = {}, secret = ADMIN_SECRET) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { "x-admin-secret": secret, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

suite("admin submission review", () => {
  let koc: { userId: string; jwt: string };
  let submissionId: string;
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("admin@test.local", 0);
    await makeMission({ slug: "test-admin-mission", points_reward: 250, quota: 5 });
    await koreq("/missions/test-admin-mission/join", koc.jwt, { method: "POST" });
    const sub = await koreq("/missions/test-admin-mission/submit", koc.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://ig.com/p/admin"] }),
    });
    submissionId = (await sub.json()).id;
  });
  afterAll(cleanup);

  it("rejects admin calls without the secret header", async () => {
    const res = await adminreq(`/admin/submissions/${submissionId}/approve`, { method: "POST" }, "");
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("no_admin");
  });

  it("lists pending submissions", async () => {
    const res = await adminreq("/admin/submissions?status=submitted");
    expect(res.status).toBe(200);
    const { submissions } = await res.json();
    expect(submissions.some((s: { id: string }) => s.id === submissionId)).toBe(true);
  });

  it("approves once: awards 250 points + 100 XP, and is idempotent", async () => {
    const res = await adminreq(`/admin/submissions/${submissionId}/approve`, {
      method: "POST",
      body: JSON.stringify({ notes: "looks good" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("approved");
    expect(body.points_awarded).toBe(250);

    const bal1 = await koreq("/wallet/points", koc.jwt);
    expect((await bal1.json()).balance).toBe(250);
    const me1 = await koreq("/me", koc.jwt);
    expect((await me1.json()).xp).toBe(135); // 10 join + 25 submit + 100 approve

    // Second approve must not double-award.
    await adminreq(`/admin/submissions/${submissionId}/approve`, { method: "POST" });
    const bal2 = await koreq("/wallet/points", koc.jwt);
    expect((await bal2.json()).balance).toBe(250);
  });

  it("rejects a submitted submission (no award)", async () => {
    const koc2 = await makeCreator("admin2@test.local", 0);
    await makeMission({ slug: "test-admin-reject", points_reward: 100, quota: 5 });
    await koreq("/missions/test-admin-reject/join", koc2.jwt, { method: "POST" });
    const sub = await koreq("/missions/test-admin-reject/submit", koc2.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://ig.com/p/x"] }),
    });
    const id = (await sub.json()).id;
    const res = await adminreq(`/admin/submissions/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ notes: "off-brief" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("rejected");
    const bal = await koreq("/wallet/points", koc2.jwt);
    expect((await bal.json()).balance).toBe(0);
  });
});
