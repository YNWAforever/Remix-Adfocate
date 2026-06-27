import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import {
  makeBrand,
  makeCreator,
  seedMission,
  seedBrandSubmission,
  serviceForTests,
  cleanup,
  hasSupabaseEnv,
} from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

const req = (path: string, jwt: string, init: RequestInit = {}) =>
  app.request(`/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

async function pointBalance(creatorId: string, workspaceId: string) {
  const { data } = await serviceForTests()
    .from("point_balances")
    .select("balance")
    .eq("creator_id", creatorId)
    .eq("workspace_id", workspaceId)
    .single();
  return data?.balance as number;
}

suite("brand review + payout", () => {
  let A: Awaited<ReturnType<typeof makeBrand>>;
  let B: Awaited<ReturnType<typeof makeBrand>>;
  let koc: Awaited<ReturnType<typeof makeCreator>>;

  beforeAll(async () => {
    await cleanup();
    A = await makeBrand("brand-rev-a@test.local");
    B = await makeBrand("brand-rev-b@test.local");
    koc = await makeCreator("brand-rev-koc@test.local", 0);
  });
  afterAll(cleanup);

  it("a brand sees only its own workspace's submissions; another brand sees none", async () => {
    const m = await seedMission(A.workspaceId, { slug: "test-rev-sub-iso", title: "Iso", status: "active", points_reward: 100 });
    const subId = await seedBrandSubmission({ creatorId: koc.userId, workspaceId: A.workspaceId, missionId: m.id, status: "submitted" });

    const resA = await req("/brand/review/submissions", A.jwt);
    expect(resA.status).toBe(200);
    expect((await resA.json()).submissions.some((s: { id: string }) => s.id === subId)).toBe(true);

    const resB = await req("/brand/review/submissions", B.jwt);
    expect((await resB.json()).submissions.some((s: { id: string }) => s.id === subId)).toBe(false);
  });

  it("a brand cannot approve another workspace's submission (→ 404), and no payout occurs", async () => {
    const m = await seedMission(A.workspaceId, { slug: "test-rev-xws-approve", title: "XWS", status: "active", points_reward: 100 });
    const subId = await seedBrandSubmission({ creatorId: koc.userId, workspaceId: A.workspaceId, missionId: m.id, status: "submitted" });

    const res = await req(`/brand/review/submissions/${subId}/approve`, B.jwt, { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(404);
    expect(await pointBalance(koc.userId, A.workspaceId)).toBe(0);
  });

  it("the owning brand approves with a 5-star rating: 200 + the creator is paid the mission's points", async () => {
    const m = await seedMission(A.workspaceId, { slug: "test-rev-payout", title: "Payout", status: "active", points_reward: 100 });
    const subId = await seedBrandSubmission({ creatorId: koc.userId, workspaceId: A.workspaceId, missionId: m.id, status: "submitted" });
    expect(await pointBalance(koc.userId, A.workspaceId)).toBe(0);

    const res = await req(`/brand/review/submissions/${subId}/approve`, A.jwt, {
      method: "POST",
      body: JSON.stringify({ quality_rating: 5, notes: "great" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("approved");
    expect(await pointBalance(koc.userId, A.workspaceId)).toBe(100);
  });

  it("rejects an out-of-range quality_rating with 400 bad_rating before touching the RPC", async () => {
    const m = await seedMission(A.workspaceId, { slug: "test-rev-badrate", title: "BadRate", status: "active", points_reward: 100 });
    const subId = await seedBrandSubmission({ creatorId: koc.userId, workspaceId: A.workspaceId, missionId: m.id, status: "submitted" });

    const res = await req(`/brand/review/submissions/${subId}/approve`, A.jwt, {
      method: "POST",
      body: JSON.stringify({ quality_rating: 7 }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("bad_rating");
  });

  it("applications are workspace-scoped, and a non-owning brand cannot accept (→ 404)", async () => {
    const m = await seedMission(A.workspaceId, { slug: "test-rev-appl", title: "Appl", status: "active", points_reward: 0 });
    const appId = await seedBrandSubmission({ creatorId: koc.userId, workspaceId: A.workspaceId, missionId: m.id, status: "applied" });

    const resA = await req("/brand/review/applications", A.jwt);
    expect((await resA.json()).applications.some((a: { id: string }) => a.id === appId)).toBe(true);
    const resB = await req("/brand/review/applications", B.jwt);
    expect((await resB.json()).applications.some((a: { id: string }) => a.id === appId)).toBe(false);

    const xws = await req(`/brand/review/applications/${appId}/accept`, B.jwt, { method: "POST", body: JSON.stringify({}) });
    expect(xws.status).toBe(404);

    const ok = await req(`/brand/review/applications/${appId}/accept`, A.jwt, { method: "POST", body: JSON.stringify({}) });
    expect(ok.status).toBe(200);
  });

  it("the engaged roster is scoped to the brand's workspace", async () => {
    const m = await seedMission(A.workspaceId, { slug: "test-rev-engaged", title: "Engaged", status: "active", points_reward: 0 });
    await seedBrandSubmission({ creatorId: koc.userId, workspaceId: A.workspaceId, missionId: m.id, status: "submitted" });

    const resA = await req("/brand/review/engaged", A.jwt);
    expect(resA.status).toBe(200);
    expect((await resA.json()).creators.some((cr: { id: string }) => cr.id === koc.userId)).toBe(true);

    const resB = await req("/brand/review/engaged", B.jwt);
    expect((await resB.json()).creators.length).toBe(0);
  });
});
