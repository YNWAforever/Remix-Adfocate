import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, makeMission, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function req(path: string, jwt: string, init: RequestInit = {}) {
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

suite("mission join", () => {
  let koc: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("join@test.local", 0);
  });
  afterAll(cleanup);

  it("joins an open mission: row created, status joined, +10 XP", async () => {
    await makeMission({ slug: "test-join-ok", points_reward: 100, quota: 5 });
    const res = await req("/missions/test-join-ok/join", koc.jwt, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("joined");
    expect(body.xp_awarded).toBe(10);

    const me = await req("/me", koc.jwt);
    expect((await me.json()).xp).toBe(10);
  });

  it("rejects a second join with already_joined", async () => {
    const res = await req("/missions/test-join-ok/join", koc.jwt, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("already_joined");
  });

  it("rejects join when the mission is full", async () => {
    await makeMission({ slug: "test-join-full", quota: 1, filled: 1 });
    const res = await req("/missions/test-join-full/join", koc.jwt, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("mission_full");
  });

  it("rejects join on a non-open (application) mission", async () => {
    await makeMission({ slug: "test-join-gated", access_type: "application" });
    const res = await req("/missions/test-join-gated/join", koc.jwt, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("not_open");
  });

  it("rejects join on a closed mission with 404 (status guard fires before RPC)", async () => {
    await makeMission({ slug: "test-join-closed", status: "closed" });
    const res = await req("/missions/test-join-closed/join", koc.jwt, { method: "POST" });
    // B1 guard: join lookup filters .eq("status","active"), so closed missions are
    // not_found at the DB level — consistent with GET /:slug and missionAuthoring tests.
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("not_found");
  });

  it("404s an unknown mission slug", async () => {
    const res = await req("/missions/test-does-not-exist/join", koc.jwt, { method: "POST" });
    expect(res.status).toBe(404);
  });
});

suite("mission submit", () => {
  let koc: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("submit@test.local", 0);
    await makeMission({ slug: "test-submit-ok", points_reward: 100, quota: 5 });
    await req("/missions/test-submit-ok/join", koc.jwt, { method: "POST" });
  });
  afterAll(cleanup);

  it("submits content: status submitted, +25 XP (total 35)", async () => {
    const res = await req("/missions/test-submit-ok/submit", koc.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://ig.com/p/abc"] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("submitted");
    expect(body.content_urls).toEqual(["https://ig.com/p/abc"]);
    expect(body.submitted_at).toBeTruthy();
    expect(body.xp_awarded).toBe(35);
  });

  it("rejects an empty content_urls array", async () => {
    await makeMission({ slug: "test-submit-empty", quota: 5 });
    await req("/missions/test-submit-empty/join", koc.jwt, { method: "POST" });
    const res = await req("/missions/test-submit-empty/submit", koc.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: [] }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("empty_urls");
  });

  it("rejects submit before join (wrong_state)", async () => {
    await makeMission({ slug: "test-submit-nojoin", quota: 5 });
    const res = await req("/missions/test-submit-nojoin/submit", koc.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://x"] }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("wrong_state");
  });
});

suite("mission list + my + apply", () => {
  let koc: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("list@test.local", 0);
    await makeMission({ slug: "test-list-joined", quota: 5 });
    await req("/missions/test-list-joined/join", koc.jwt, { method: "POST" });
  });
  afterAll(cleanup);

  it("GET / annotates joined missions with my_status", async () => {
    const res = await req("/missions", koc.jwt);
    expect(res.status).toBe(200);
    const { missions } = await res.json();
    const joined = missions.find((m: { slug: string }) => m.slug === "test-list-joined");
    expect(joined.my_status).toBe("joined");
    // a seed mission the koc never joined stays null
    const other = missions.find((m: { slug: string }) => m.slug === "ugc-cafe");
    expect(other.my_status).toBeNull();
  });

  it("GET /my returns the caller's submissions", async () => {
    const res = await req("/missions/my", koc.jwt);
    expect(res.status).toBe(200);
    const { submissions } = await res.json();
    expect(submissions).toHaveLength(1);
    expect(submissions[0].status).toBe("joined");
    expect(submissions[0].missions.slug).toBe("test-list-joined");
  });

  it("GET /my?status=approved filters to none here", async () => {
    const res = await req("/missions/my?status=approved", koc.jwt);
    expect((await res.json()).submissions).toHaveLength(0);
  });

  it("POST /:slug/apply applies to an application mission (→ applied)", async () => {
    await makeMission({ slug: "test-apply-gated", access_type: "application" });
    const res = await req("/missions/test-apply-gated/apply", koc.jwt, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("applied");
  });

  it("GET /:slug returns the brief fields + brand", async () => {
    await makeMission({ slug: "test-brief-fields", access_type: "open" });
    const res = await req("/missions/test-brief-fields", koc.jwt);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.brand).toBe("Demo Brand");          // joined from workspaces.name
    expect(Array.isArray(body.deliverables)).toBe(true);
    expect(Array.isArray(body.requirements)).toBe(true);
    expect(Array.isArray(body.platforms)).toBe(true);
    expect(body).not.toHaveProperty("workspaces");   // nested join flattened away
  });

  it("does not leak another creator's submissions via /my (RLS isolation)", async () => {
    // koc joined test-list-joined above; a different creator must see none of it.
    const other = await makeCreator("list-other@test.local", 0);
    const res = await req("/missions/my", other.jwt);
    expect(res.status).toBe(200);
    expect((await res.json()).submissions).toHaveLength(0);
  });
});
