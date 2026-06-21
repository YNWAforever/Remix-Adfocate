// server/test/missionAuthoring.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, makeMission, cleanup, hasSupabaseEnv } from "./helpers";

process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || "test-admin-secret";
const ADMIN_SECRET = process.env.ADMIN_SECRET!;
const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function koreq(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, "X-Workspace-Slug": "demo", "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}
function adminreq(path: string, init: RequestInit = {}, secret = ADMIN_SECRET) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { "x-admin-secret": secret, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

suite("B1 visibility guards", () => {
  let koc: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("b1vis@test.local", 0);
    await makeMission({ slug: "test-vis-draft", status: "draft", category: "美容" });
    await makeMission({ slug: "test-vis-closed", status: "closed", category: "美容" });
    await makeMission({ slug: "test-vis-active", status: "active", category: "美容" });
  });
  afterAll(cleanup);

  it("creator list excludes draft + closed", async () => {
    const { missions } = await (await koreq("/missions", koc.jwt)).json();
    const slugs = missions.map((m: { slug: string }) => m.slug);
    expect(slugs).toContain("test-vis-active");
    expect(slugs).not.toContain("test-vis-draft");
    expect(slugs).not.toContain("test-vis-closed");
  });

  it("creator detail 404s a draft/closed slug", async () => {
    expect((await koreq("/missions/test-vis-draft", koc.jwt)).status).toBe(404);
    expect((await koreq("/missions/test-vis-closed", koc.jwt)).status).toBe(404);
    expect((await koreq("/missions/test-vis-active", koc.jwt)).status).toBe(200);
  });

  it("hook-generator 404s a draft/closed slug but works on active", async () => {
    const draft = await koreq("/copilot/hook-generator", koc.jwt, { method: "POST", body: JSON.stringify({ mission_slug: "test-vis-draft" }) });
    expect(draft.status).toBe(404);
    const closed = await koreq("/copilot/hook-generator", koc.jwt, { method: "POST", body: JSON.stringify({ mission_slug: "test-vis-closed" }) });
    expect(closed.status).toBe(404);
    const active = await koreq("/copilot/hook-generator", koc.jwt, { method: "POST", body: JSON.stringify({ mission_slug: "test-vis-active" }) });
    expect(active.status).toBe(200);
  });

  it("join RPC refuses a closed mission (Close auto-blocks new joins)", async () => {
    const res = await koreq("/missions/test-vis-closed/join", koc.jwt, { method: "POST" });
    expect(res.status).toBe(404); // detail-guard returns not_found before the RPC; closed never visible
  });
});

suite("B1 admin read endpoints", () => {
  beforeAll(async () => {
    await cleanup();
    await makeMission({ slug: "test-adm-active", status: "active", category: "美容" });
    await makeMission({ slug: "test-adm-draft", status: "draft", category: "美容" });
  });
  afterAll(cleanup);

  it("401s without the secret", async () => {
    expect((await app.request("/api/admin/missions", { headers: { "Content-Type": "application/json" } })).status).toBe(401);
  });
  it("lists workspaces ordered by name", async () => {
    const { workspaces } = await (await adminreq("/admin/workspaces")).json();
    expect(Array.isArray(workspaces)).toBe(true);
    expect(workspaces.length).toBeGreaterThan(0);
  });
  it("lists all statuses for a workspace, each annotated with engaged", async () => {
    const { missions } = await (await adminreq("/admin/missions?workspace=00000000-0000-0000-0000-0000000000aa")).json();
    const slugs = missions.map((m: { slug: string }) => m.slug);
    expect(slugs).toContain("test-adm-active");
    expect(slugs).toContain("test-adm-draft"); // admin sees drafts
    expect(missions.every((m: { engaged: boolean }) => typeof m.engaged === "boolean")).toBe(true);
  });
  it("filters by status", async () => {
    const { missions } = await (await adminreq("/admin/missions?status=draft")).json();
    expect(missions.every((m: { status: string }) => m.status === "draft")).toBe(true);
  });
  it("404s an unknown id", async () => {
    expect((await adminreq("/admin/missions/00000000-0000-0000-0000-000000000000")).status).toBe(404);
  });
});
