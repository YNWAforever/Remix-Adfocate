import { FIXTURE_WORKSPACE_SLUG } from "./helpers";
import { fixtureName } from "./helpers";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createFixtureStaffApp as createApp } from "./fixtureStaffTransport";
import { makeCreator, makeMission, cleanup, hasSupabaseEnv } from "./helpers";

process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || "test-admin-secret";
const ADMIN_SECRET = process.env.ADMIN_SECRET;

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function req(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "X-Workspace-Slug": FIXTURE_WORKSPACE_SLUG,
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

suite("earnings wallet", () => {
  let koc: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator(fixtureName("earn@test.local"), 0);
  });
  afterAll(cleanup);

  it("starts at zero available + zero pending", async () => {
    const res = await req("/wallet/earnings", koc.jwt);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(0);
    expect(body.pending).toBe(0);
  });

  it("counts a submitted cash mission as pending (not yet available)", async () => {
    await makeMission({ slug: fixtureName("test-earn-pending"), points_reward: 100, cash_reward: 50, quota: 5 });
    await req(fixtureName("/missions/test-earn-pending/join"), koc.jwt, { method: "POST" });
    await req(fixtureName("/missions/test-earn-pending/submit"), koc.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://x"] }),
    });
    const body = await (await req("/wallet/earnings", koc.jwt)).json();
    expect(body.pending).toBe(50);
    expect(body.available).toBe(0);
  });

  it("moves cash to available on approval + records an earnings transaction", async () => {
    const subs = await (await adminreq("/admin/submissions?status=submitted")).json();
    const sub = subs.submissions.find((s: { missions: { slug: string } }) => s.missions.slug === fixtureName("test-earn-pending"));
    const res = await adminreq(`/admin/submissions/${sub.id}/approve`, {
      method: "POST",
      body: JSON.stringify({ notes: "ok" }),
    });
    expect(res.status).toBe(200);

    const body = await (await req("/wallet/earnings", koc.jwt)).json();
    expect(body.available).toBe(50);
    expect(body.pending).toBe(0);

    const { transactions } = await (await req("/wallet/earnings/history", koc.jwt)).json();
    expect(transactions).toHaveLength(1);
    expect(transactions[0].type).toBe("earn");
    expect(transactions[0].amount).toBe(50);
  });

  it("a non-cash mission credits no earnings", async () => {
    const koc2 = await makeCreator(fixtureName("earn2@test.local"), 0);
    await makeMission({ slug: fixtureName("test-earn-nocash"), points_reward: 100, quota: 5 }); // cash_reward null
    await req(fixtureName("/missions/test-earn-nocash/join"), koc2.jwt, { method: "POST" });
    await req(fixtureName("/missions/test-earn-nocash/submit"), koc2.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://y"] }),
    });
    const subs = await (await adminreq("/admin/submissions?status=submitted")).json();
    const sub = subs.submissions.find((s: { missions: { slug: string } }) => s.missions.slug === fixtureName("test-earn-nocash"));
    await adminreq(`/admin/submissions/${sub.id}/approve`, { method: "POST" });
    const body = await (await req("/wallet/earnings", koc2.jwt)).json();
    expect(body.available).toBe(0);
  });
});
