import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import {
  makeBrand,
  makeCreator,
  seedMission,
  seedBrandSubmission,
  seedWorkspaceBudget,
  serviceForTests,
  cleanup,
  hasSupabaseEnv,
} from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

const brandReq = (path: string, jwt: string, init: RequestInit = {}) =>
  app.request(`/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

const ADMIN = process.env.ADMIN_SECRET ?? "test-admin-secret";
const adminReq = (path: string, init: RequestInit = {}) =>
  app.request(`/api${path}`, {
    ...init,
    headers: { "X-Admin-Secret": ADMIN, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

async function points(creatorId: string, workspaceId: string) {
  const { data } = await serviceForTests()
    .from("point_balances").select("balance")
    .eq("creator_id", creatorId).eq("workspace_id", workspaceId).single();
  return data?.balance as number;
}
async function budget(workspaceId: string) {
  const { data } = await serviceForTests()
    .from("workspace_budgets").select("balance").eq("workspace_id", workspaceId).single();
  return data?.balance as number;
}

suite("brand budget + spend cap", () => {
  let A: Awaited<ReturnType<typeof makeBrand>>;
  let B: Awaited<ReturnType<typeof makeBrand>>;
  let koc: Awaited<ReturnType<typeof makeCreator>>;

  beforeAll(async () => {
    await cleanup();
    A = await makeBrand("budget-a@test.local");
    B = await makeBrand("budget-b@test.local");
    koc = await makeCreator("budget-koc@test.local", 0);
  });
  afterAll(cleanup);

  it("enforcement OFF: a cash approval still succeeds and never touches the wallet", async () => {
    const m = await seedMission(A.workspaceId, { slug: "test-bgt-off", status: "active", points_reward: 10, cash_reward: 50 });
    const sub = await seedBrandSubmission({ creatorId: koc.userId, workspaceId: A.workspaceId, missionId: m.id, status: "submitted" });
    const res = await brandReq(`/brand/review/submissions/${sub}/approve`, A.jwt, { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("approved");
  });

  it("enforced + sufficient: approve debits the wallet by cash_reward and pays the creator", async () => {
    await seedWorkspaceBudget({ workspaceId: A.workspaceId, balance: 100, enforced: true });
    const before = await points(koc.userId, A.workspaceId);
    const m = await seedMission(A.workspaceId, { slug: "test-bgt-pay", status: "active", points_reward: 10, cash_reward: 40 });
    const sub = await seedBrandSubmission({ creatorId: koc.userId, workspaceId: A.workspaceId, missionId: m.id, status: "submitted" });
    const res = await brandReq(`/brand/review/submissions/${sub}/approve`, A.jwt, { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(200);
    expect(await budget(A.workspaceId)).toBe(60);            // 100 − 40
    expect(await points(koc.userId, A.workspaceId)).toBe(before + 10);
  });

  it("enforced + insufficient: approve → 402 insufficient_budget, no payout, no debit", async () => {
    await seedWorkspaceBudget({ workspaceId: A.workspaceId, balance: 10, enforced: true });
    const beforePts = await points(koc.userId, A.workspaceId);
    const m = await seedMission(A.workspaceId, { slug: "test-bgt-block", status: "active", points_reward: 10, cash_reward: 40 });
    const sub = await seedBrandSubmission({ creatorId: koc.userId, workspaceId: A.workspaceId, missionId: m.id, status: "submitted" });
    const res = await brandReq(`/brand/review/submissions/${sub}/approve`, A.jwt, { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe("insufficient_budget");
    expect(await budget(A.workspaceId)).toBe(10);            // unchanged
    expect(await points(koc.userId, A.workspaceId)).toBe(beforePts); // not paid
  });

  it("the operator approve path is also bound by the cap (→ 402 when empty)", async () => {
    await seedWorkspaceBudget({ workspaceId: A.workspaceId, balance: 0, enforced: true });
    const m = await seedMission(A.workspaceId, { slug: "test-bgt-op", status: "active", points_reward: 10, cash_reward: 25 });
    const sub = await seedBrandSubmission({ creatorId: koc.userId, workspaceId: A.workspaceId, missionId: m.id, status: "submitted" });
    const res = await adminReq(`/admin/submissions/${sub}/approve`, { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe("insufficient_budget");
  });

  it("cash_reward 0 on an enforced+empty workspace still approves (no debit, no block)", async () => {
    await seedWorkspaceBudget({ workspaceId: A.workspaceId, balance: 0, enforced: true });
    const m = await seedMission(A.workspaceId, { slug: "test-bgt-zero", status: "active", points_reward: 10, cash_reward: 0 });
    const sub = await seedBrandSubmission({ creatorId: koc.userId, workspaceId: A.workspaceId, missionId: m.id, status: "submitted" });
    const res = await brandReq(`/brand/review/submissions/${sub}/approve`, A.jwt, { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(200);
  });

  it("operator top-up raises the balance and unblocks a previously-blocked approval", async () => {
    await seedWorkspaceBudget({ workspaceId: A.workspaceId, balance: 0, enforced: true });
    const top = await adminReq("/admin/budget/topup", { method: "POST", body: JSON.stringify({ workspace_id: A.workspaceId, amount: 80 }) });
    expect(top.status).toBe(200);
    expect(await budget(A.workspaceId)).toBe(80);
    const m = await seedMission(A.workspaceId, { slug: "test-bgt-unblock", status: "active", points_reward: 10, cash_reward: 30 });
    const sub = await seedBrandSubmission({ creatorId: koc.userId, workspaceId: A.workspaceId, missionId: m.id, status: "submitted" });
    const res = await brandReq(`/brand/review/submissions/${sub}/approve`, A.jwt, { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(200);
    expect(await budget(A.workspaceId)).toBe(50);            // 80 − 30
  });

  it("operator adjust cannot push the balance negative (→ 400 negative_balance)", async () => {
    await seedWorkspaceBudget({ workspaceId: A.workspaceId, balance: 20, enforced: true });
    const res = await adminReq("/admin/budget/adjust", { method: "POST", body: JSON.stringify({ workspace_id: A.workspaceId, delta: -50, description: "oops" }) });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("negative_balance");
    expect(await budget(A.workspaceId)).toBe(20);
  });

  it("a brand reads only its own wallet; another brand's GET sees a different (zero) balance", async () => {
    await seedWorkspaceBudget({ workspaceId: A.workspaceId, balance: 77, enforced: true });
    const resA = await brandReq("/brand/budget", A.jwt);
    expect(resA.status).toBe(200);
    expect((await resA.json()).budget.balance).toBe(77);
    const resB = await brandReq("/brand/budget", B.jwt);
    expect((await resB.json()).budget.balance).toBe(0);     // B has no row → zero
  });
});
