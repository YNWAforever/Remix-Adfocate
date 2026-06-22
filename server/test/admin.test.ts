import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, makeMission, getCreatorScores, cleanup, hasSupabaseEnv } from "./helpers";

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

  it("rejects admin calls with an empty secret header", async () => {
    const res = await adminreq(`/admin/submissions/${submissionId}/approve`, { method: "POST" }, "");
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("no_admin");
  });

  it("rejects admin calls with no secret header at all", async () => {
    const res = await app.request("/api/admin/submissions?status=submitted", {
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("no_admin");
  });

  it("lists pending submissions", async () => {
    const res = await adminreq("/admin/submissions?status=submitted");
    expect(res.status).toBe(200);
    const { submissions } = await res.json();
    const row = submissions.find((s: { id: string }) => s.id === submissionId);
    expect(row).toBeTruthy();
    expect(row.creator_review).toEqual({ status: "needs_review", risk_level: "unknown" });
    expect(row.mission_shortlist).toBeNull();
  });

  it("lists pending applications with creator review and shortlist metadata", async () => {
    const applicant = await makeCreator("admin-app-meta@test.local", 0);
    await makeMission({ slug: "test-admin-app-meta", access_type: "application", points_reward: 100, quota: 5 });
    await koreq("/missions/test-admin-app-meta/apply", applicant.jwt, { method: "POST" });

    const res = await adminreq("/admin/applications");
    expect(res.status).toBe(200);
    const { applications } = await res.json();
    const row = applications.find((item: { creator_id: string }) => item.creator_id === applicant.userId);
    expect(row.mission_id).toMatch(/[0-9a-f-]{36}/);
    expect(row.creator_review).toEqual({ status: "needs_review", risk_level: "unknown" });
    expect(row.mission_shortlist).toBeNull();
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

  it("approves with a 5★ rating: stores the rating, awards +50 bonus XP, snapshots scores", async () => {
    const koc3 = await makeCreator("admin-rate@test.local", 0);
    await makeMission({ slug: "test-admin-rate", points_reward: 100, quota: 5 });
    await koreq("/missions/test-admin-rate/join", koc3.jwt, { method: "POST" });
    const sub = await koreq("/missions/test-admin-rate/submit", koc3.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://ig.com/p/rate"] }),
    });
    const id = (await sub.json()).id;

    const res = await adminreq(`/admin/submissions/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ notes: "great", quality_rating: 5 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quality_rating).toBe(5);

    // 10 join + 25 submit + 100 approve + 50 bonus = 185.
    const me = await koreq("/me", koc3.jwt);
    expect((await me.json()).xp).toBe(185);

    // persistScores wrote the snapshot: 1 approved + rated 5 → content 100, brand safety 100.
    const scores = await getCreatorScores(koc3.userId);
    expect(scores.content).toBe(100);
    expect(scores.brandSafety).toBe(100);
    expect(scores.reliability).toBe(100);
  });

  it("rejects an out-of-range rating with 400 bad_rating", async () => {
    const koc4 = await makeCreator("admin-badrate@test.local", 0);
    await makeMission({ slug: "test-admin-badrate", points_reward: 100, quota: 5 });
    await koreq("/missions/test-admin-badrate/join", koc4.jwt, { method: "POST" });
    const sub = await koreq("/missions/test-admin-badrate/submit", koc4.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://ig.com/p/bad"] }),
    });
    const id = (await sub.json()).id;
    const res = await adminreq(`/admin/submissions/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ quality_rating: 7 }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("bad_rating");
    const resLow = await adminreq(`/admin/submissions/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ quality_rating: 0 }),
    });
    expect(resLow.status).toBe(400);
    expect((await resLow.json()).code).toBe("bad_rating");
  });

  it("rejection snapshots scores (brand safety reflects the rejection)", async () => {
    const koc5 = await makeCreator("admin-rej-snap@test.local", 0);
    await makeMission({ slug: "test-admin-rej-snap", points_reward: 100, quota: 5 });
    await koreq("/missions/test-admin-rej-snap/join", koc5.jwt, { method: "POST" });
    const sub = await koreq("/missions/test-admin-rej-snap/submit", koc5.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://ig.com/p/rej"] }),
    });
    const id = (await sub.json()).id;
    await adminreq(`/admin/submissions/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ notes: "off-brief" }),
    });
    const scores = await getCreatorScores(koc5.userId);
    expect(scores.brandSafety).toBe(0); // 0 approved / 1 reviewed
    expect(scores.reliability).toBe(0);
    // influence/content move from the DB default 0 to null → proves persistScores wrote the snapshot.
    expect(scores.influence).toBeNull();
    expect(scores.content).toBeNull();
  });
});

suite("admin engaged roster", () => {
  afterAll(cleanup);

  it("requires the admin secret", async () => {
    const res = await app.request("/api/admin/engaged", { headers: { "Content-Type": "application/json" } });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("no_admin");
  });

  it("lists creators with active participations and excludes fully-completed ones", async () => {
    await cleanup();
    const active = await makeCreator("engaged-active@test.local", 0);
    await makeMission({ slug: "test-engaged-active-mission", points_reward: 100, quota: 5 });
    await koreq("/missions/test-engaged-active-mission/join", active.jwt, { method: "POST" });

    const done = await makeCreator("engaged-done@test.local", 0);
    await makeMission({ slug: "test-engaged-done-mission", points_reward: 100, quota: 5 });
    await koreq("/missions/test-engaged-done-mission/join", done.jwt, { method: "POST" });
    const sub = await koreq("/missions/test-engaged-done-mission/submit", done.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://ig.com/p/done"] }),
    });
    await adminreq(`/admin/submissions/${(await sub.json()).id}/approve`, { method: "POST" });

    const res = await adminreq("/admin/engaged");
    expect(res.status).toBe(200);
    const { creators } = await res.json();

    const activeRow = creators.find((c: { id: string }) => c.id === active.userId);
    expect(activeRow).toBeTruthy();
    expect(activeRow.activeCount).toBe(1);
    expect(activeRow.completedCount).toBe(0);
    expect(activeRow.activeMissions[0].missionSlug).toBe("test-engaged-active-mission");
    expect(activeRow.activeMissions[0].status).toBe("joined");

    expect(creators.find((c: { id: string }) => c.id === done.userId)).toBeUndefined();
  });
});

suite("B2: workspace-scoped review", () => {
  const DEMO = "00000000-0000-0000-0000-0000000000aa";
  const OTHER = "00000000-0000-0000-0000-0000000000bb";
  afterAll(cleanup);

  it("filters applications by ?workspace= (demo returns the row, bogus returns none)", async () => {
    const koc = await makeCreator("ws-scope@test.local", 0);
    await makeMission({ slug: "test-ws-scope", points_reward: 100, quota: 5, access_type: "application" });
    await koreq("/missions/test-ws-scope/apply", koc.jwt, { method: "POST" });

    const scoped = await adminreq(`/admin/applications?workspace=${DEMO}`);
    expect(scoped.status).toBe(200);
    const rows = (await scoped.json()).applications as Array<{ missions: { slug: string } }>;
    expect(rows.some((r) => r.missions.slug === "test-ws-scope")).toBe(true);

    const none = await adminreq(`/admin/applications?workspace=${OTHER}`);
    expect(((await none.json()).applications as unknown[]).length).toBe(0);
  });

  it("filters submissions by ?workspace=", async () => {
    const none = await adminreq(`/admin/submissions?status=submitted&workspace=${OTHER}`);
    expect(((await none.json()).submissions as unknown[]).length).toBe(0);
    const ok = await adminreq(`/admin/submissions?status=submitted&workspace=${DEMO}`);
    expect(ok.status).toBe(200);
  });

  it("filters engaged by ?workspace=", async () => {
    const none = await adminreq(`/admin/engaged?workspace=${OTHER}`);
    expect(((await none.json()).creators as unknown[]).length).toBe(0);
    const ok = await adminreq(`/admin/engaged?workspace=${DEMO}`);
    expect(ok.status).toBe(200);
  });
});
