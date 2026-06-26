import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeBrand, seedMission, makeCreator, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;
const req = (path: string, jwt: string, init: RequestInit = {}) =>
  app.request(`/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

suite("brand portal", () => {
  let A: Awaited<ReturnType<typeof makeBrand>>;
  let B: Awaited<ReturnType<typeof makeBrand>>;
  let missionA: { id: string; slug: string };

  beforeAll(async () => {
    await cleanup();
    A = await makeBrand("brandA@test.local", undefined, "owner");
    B = await makeBrand("brandB@test.local", undefined, "owner");
    missionA = await seedMission(A.workspaceId, { slug: "test-a-mission", title: "A Mission", status: "draft" });
  });
  afterAll(cleanup);

  it("401 without a token", async () => {
    expect((await app.request("/api/brand/me")).status).toBe(401);
  });

  it("a brand sees only its own workspace missions", async () => {
    const res = await req("/brand/missions", A.jwt);
    expect(res.status).toBe(200);
    const { missions } = await res.json();
    expect(missions.some((m: { slug: string }) => m.slug === "test-a-mission")).toBe(true);
    const resB = await req("/brand/missions", B.jwt);
    const bodyB = await resB.json();
    expect(bodyB.missions.some((m: { slug: string }) => m.slug === "test-a-mission")).toBe(false);
  });

  it("a brand cannot edit another workspace's mission (RLS → 404)", async () => {
    const res = await req(`/brand/missions/${missionA.id}`, B.jwt, {
      method: "PUT", body: JSON.stringify({ title: "hacked" }),
    });
    expect(res.status).toBe(404);
  });

  it("a brand can create a draft in its own workspace, scoped away from others", async () => {
    const res = await req("/brand/missions", A.jwt, {
      method: "POST",
      body: JSON.stringify({ slug: "test-a-created", title: "Created", mission_type: "ugc" }),
    });
    expect(res.status).toBe(201);
    const resB = await req("/brand/missions", B.jwt);
    const bodyB = await resB.json();
    expect(bodyB.missions.some((m: { slug: string }) => m.slug === "test-a-created")).toBe(false);
  });

  it("accept without an invite returns 403", async () => {
    const stranger = await makeCreator("stranger@test.local", 0);
    const res = await app.request("/api/brand/accept", {
      method: "POST", headers: { Authorization: `Bearer ${stranger.jwt}` },
    });
    expect(res.status).toBe(403);
  });

  it("a revoked brand (active=false) is denied", async () => {
    await A.deactivate();
    expect((await req("/brand/me", A.jwt)).status).toBe(403);
  });

  it("creator mission reads still work after adding brand RLS policies", async () => {
    const koc = await makeCreator("koc@test.local", 0);
    const res = await req("/missions", koc.jwt);
    expect(res.status).toBe(200);
  });
});
