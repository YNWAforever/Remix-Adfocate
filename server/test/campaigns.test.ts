import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceForTests, makeCreator, makeMission, cleanup, DEMO_WS } from "./helpers.js";
import { campaignBonusRef, campaignPrizeRef } from "../lib/campaignAuthoring.js";

const hasEnv = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_KEY;
const suite = hasEnv ? describe : describe.skip;
const svc = () => serviceForTests();

// ---- fixtures -------------------------------------------------------------------------------
async function makeCampaign(opts: {
  slug: string; goal_target?: number; bonus_points?: number; bonus_xp?: number;
  prize_tiers?: unknown[]; starts_at?: string; ends_at?: string; status?: string; workspace_id?: string;
}) {
  const { data, error } = await svc().from("campaigns").insert({
    workspace_id: opts.workspace_id ?? DEMO_WS,
    slug: opts.slug, title: opts.slug,
    status: opts.status ?? "active",
    starts_at: opts.starts_at ?? "2026-06-01T00:00:00Z",
    ends_at: opts.ends_at ?? "2026-06-30T00:00:00Z",
    goal_target: opts.goal_target ?? 2,
    completion_bonus_points: opts.bonus_points ?? 100,
    completion_bonus_xp: opts.bonus_xp ?? 20,
    prize_tiers: opts.prize_tiers ?? [],
    published_at: "2026-06-01T00:00:00Z",
  }).select("*").single();
  if (error) throw error;
  return data as { id: string; slug: string; workspace_id: string };
}
async function attach(campaignId: string, missionId: string, workspaceId = DEMO_WS) {
  const { error } = await svc().from("campaign_missions")
    .insert({ campaign_id: campaignId, mission_id: missionId, workspace_id: workspaceId });
  if (error) throw error;
}
// Insert a submission then flip it to approved (fires the trigger). submitted_at = delivery time,
// reviewed_at = approval time (as-of-approval mission-set key).
async function seedApprovedSub(opts: {
  creator: string; mission: string; workspace?: string;
  submitted_at: string; reviewed_at?: string; quality_rating?: number | null;
}) {
  const ws = opts.workspace ?? DEMO_WS;
  const { data: ins, error: e1 } = await svc().from("mission_submissions")
    .insert({ creator_id: opts.creator, workspace_id: ws, mission_id: opts.mission,
              status: "submitted", submitted_at: opts.submitted_at }).select("id").single();
  if (e1) throw e1;
  const id = (ins as { id: string }).id;
  const { error: e2 } = await svc().from("mission_submissions")
    .update({ status: "approved", reviewed_at: opts.reviewed_at ?? "2026-06-15T00:00:00Z",
              quality_rating: opts.quality_rating ?? null })
    .eq("id", id);
  if (e2) throw e2;
  return id;
}
async function participant(campaignId: string, creatorId: string) {
  const { data } = await svc().from("campaign_participants").select("*")
    .eq("campaign_id", campaignId).eq("creator_id", creatorId).maybeSingle();
  return data as null | { approved_count: number; goal_reached_at: string | null; bonus_granted_at: string | null };
}
async function pointTxns(ref: string) {
  const { data } = await svc().from("point_transactions").select("*").eq("source_ref", ref);
  return data ?? [];
}

suite("campaigns — completion bonus", () => {
  let koc: { userId: string };
  beforeAll(async () => { await cleanup(); koc = await makeCreator("camp-bonus@test.local", 0); });
  afterAll(cleanup);

  it("auto-enrolls, counts, and pays the bonus exactly once on goal crossing", async () => {
    const m1 = await makeMission({ slug: "test-camp-m1" });
    const m2 = await makeMission({ slug: "test-camp-m2" });
    const camp = await makeCampaign({ slug: "test-camp-bonus", goal_target: 2, bonus_points: 100, bonus_xp: 20 });
    await attach(camp.id, m1.id);
    await attach(camp.id, m2.id);

    await seedApprovedSub({ creator: koc.userId, mission: m1.id, submitted_at: "2026-06-10T00:00:00Z" });
    let p = await participant(camp.id, koc.userId);
    expect(p?.approved_count).toBe(1);
    expect(p?.goal_reached_at).toBeNull();

    await seedApprovedSub({ creator: koc.userId, mission: m2.id, submitted_at: "2026-06-11T00:00:00Z" });
    p = await participant(camp.id, koc.userId);
    expect(p?.approved_count).toBe(2);
    expect(p?.goal_reached_at).not.toBeNull();
    expect(p?.bonus_granted_at).not.toBeNull();

    const ref = campaignBonusRef(camp.id, koc.userId);
    expect((await pointTxns(ref)).length).toBe(1);             // exactly one bonus ledger row
  });

  it("counts a submission delivered in-window but reviewed during the grace window", async () => {
    const m = await makeMission({ slug: "test-camp-grace-m" });
    const camp = await makeCampaign({ slug: "test-camp-grace", goal_target: 1, ends_at: "2026-06-30T00:00:00Z" });
    await attach(camp.id, m.id);
    // delivered before ends_at, reviewed AFTER ends_at (grace). Campaign still 'active' (not settled).
    await seedApprovedSub({ creator: koc.userId, mission: m.id,
      submitted_at: "2026-06-29T00:00:00Z", reviewed_at: "2026-07-03T00:00:00Z" });
    const p = await participant(camp.id, koc.userId);
    expect(p?.approved_count).toBe(1);
    expect(p?.goal_reached_at).not.toBeNull();
  });

  it("does NOT count a submission delivered after ends_at", async () => {
    const m = await makeMission({ slug: "test-camp-late-m" });
    const camp = await makeCampaign({ slug: "test-camp-late", goal_target: 1, ends_at: "2026-06-30T00:00:00Z" });
    await attach(camp.id, m.id);
    await seedApprovedSub({ creator: koc.userId, mission: m.id, submitted_at: "2026-07-05T00:00:00Z" });
    const p = await participant(camp.id, koc.userId);
    expect(p ?? { approved_count: 0 }).toMatchObject({ approved_count: 0 }); // not enrolled / not counted
  });
});

async function makeWorkspace(slug: string) {
  const { data, error } = await svc().from("workspaces")
    .insert({ slug, name: slug }).select("id").single();
  if (error) throw error;
  return (data as { id: string }).id;
}
async function budget(ws: string) {
  // workspace_budgets has no service_role SELECT grant; read balance via the security-definer RPC
  // by applying a zero-delta adjust (idempotent: returns current balance, no sign change possible).
  const { data, error } = await svc().rpc("credit_workspace_budget", { p_workspace: ws, p_delta: 0, p_type: "adjust" });
  if (error) return null;
  return { balance: data as number, enforced: true };
}
async function earnTxns(ref: string) {
  const { data } = await svc().from("earnings_transactions").select("*").eq("source_ref", ref);
  return data ?? [];
}

suite("campaigns — settlement", () => {
  let a: { userId: string }, b: { userId: string };
  beforeAll(async () => {
    await cleanup();
    a = await makeCreator("camp-a@test.local", 0);   // both home = DEMO_WS
    b = await makeCreator("camp-b@test.local", 0);
  });
  afterAll(cleanup);

  it("ranks, pays the top tier in cash, and is idempotent on re-settle", async () => {
    // Use a dedicated campaign workspace (throwaway, slug "test-camp-ws1") so the budget
    // balance starts at 0 and is unaffected by other runs against DEMO_WS.
    const ws1 = await makeWorkspace("test-camp-ws1");
    const m = await makeMission({ slug: "test-settle-m" });
    // Move mission into ws1 so the campaign (in ws1) can attach it.
    await svc().from("missions").update({ workspace_id: ws1 }).eq("id", m.id);
    const camp = await makeCampaign({
      slug: "test-settle", workspace_id: ws1, goal_target: 1, bonus_points: 0, bonus_xp: 0,
      prize_tiers: [{ rank_from: 1, rank_to: 1, cash: 500, points: 0, xp: 0 }],
    });
    await attach(camp.id, m.id, ws1);
    // A: 2 approved, B: 1 approved → A ranks 1.
    // reviewed_at must be >= campaign_missions.added_at (which is now()) for rank_campaign join.
    await seedApprovedSub({ creator: a.userId, mission: m.id, workspace: ws1, submitted_at: "2026-06-05T00:00:00Z", reviewed_at: "2027-01-01T00:00:00Z" });
    // second approved for A needs a 2nd mission (one approved sub per (creator,mission) submission row).
    const m2 = await makeMission({ slug: "test-settle-m2" });
    await svc().from("missions").update({ workspace_id: ws1 }).eq("id", m2.id);
    await attach(camp.id, m2.id, ws1);
    await seedApprovedSub({ creator: a.userId, mission: m2.id, workspace: ws1, submitted_at: "2026-06-06T00:00:00Z", reviewed_at: "2027-01-01T00:00:00Z" });
    await seedApprovedSub({ creator: b.userId, mission: m.id, workspace: ws1, submitted_at: "2026-06-07T00:00:00Z", reviewed_at: "2027-01-01T00:00:00Z" });

    // Fund + enforce the CAMPAIGN workspace budget.
    await svc().rpc("credit_workspace_budget", { p_workspace: ws1, p_delta: 1000, p_type: "topup" });
    await svc().rpc("set_workspace_budget_enforcement", { p_workspace: ws1, p_enforced: true });

    await svc().rpc("close_campaign", { p_campaign: camp.id });
    const settled = await svc().rpc("settle_campaign", { p_campaign: camp.id });
    expect(settled.error).toBeNull();

    const pa = await participant(camp.id, a.userId);
    expect(pa).toBeTruthy();
    const { data: rowA } = await svc().from("campaign_participants").select("prize_rank, prize_granted_at")
      .eq("campaign_id", camp.id).eq("creator_id", a.userId).single();
    expect(rowA.prize_rank).toBe(1);
    expect(rowA.prize_granted_at).not.toBeNull();

    const refA = campaignPrizeRef(camp.id, a.userId);
    expect((await earnTxns(refA)).length).toBe(1);
    expect(Number((await earnTxns(refA))[0].amount)).toBe(500);   // credited to A's HOME earnings
    const after = await budget(ws1);
    expect(Number(after?.balance)).toBe(500);                      // 1000 funded − 500 debited

    // B got rank 2, no prize tier covers it → no prize ledger row.
    expect((await earnTxns(campaignPrizeRef(camp.id, b.userId))).length).toBe(0);

    // Re-settle: idempotent (settled_at already set) — no second debit, no second credit.
    const again = await svc().rpc("settle_campaign", { p_campaign: camp.id });
    expect(again.error).toBeNull();
    expect((await earnTxns(refA)).length).toBe(1);
    expect(Number((await budget(ws1))?.balance)).toBe(500);
  });

  it("debits the CAMPAIGN workspace budget but credits the creator's HOME workspace earnings", async () => {
    const ws2 = await makeWorkspace("test-camp-ws2");
    const m = await makeMission({ slug: "test-xws-m" });
    // Move this mission into ws2 so the campaign (in ws2) counts its submissions.
    await svc().from("missions").update({ workspace_id: ws2 }).eq("id", m.id);
    const camp = await makeCampaign({
      slug: "test-xws", workspace_id: ws2, goal_target: 1, bonus_points: 0, bonus_xp: 0,
      prize_tiers: [{ rank_from: 1, rank_to: 1, cash: 300, points: 0, xp: 0 }],
    });
    await attach(camp.id, m.id, ws2);
    // a.userId home = DEMO_WS, but the approved submission lives in ws2 (the campaign workspace).
    // reviewed_at must be >= campaign_missions.added_at (which is now()) for rank_campaign join.
    await seedApprovedSub({ creator: a.userId, mission: m.id, workspace: ws2, submitted_at: "2026-06-08T00:00:00Z", reviewed_at: "2027-01-01T00:00:00Z" });

    await svc().rpc("credit_workspace_budget", { p_workspace: ws2, p_delta: 500, p_type: "topup" });
    await svc().rpc("set_workspace_budget_enforcement", { p_workspace: ws2, p_enforced: true });
    await svc().rpc("close_campaign", { p_campaign: camp.id });
    expect((await svc().rpc("settle_campaign", { p_campaign: camp.id })).error).toBeNull();

    const ref = campaignPrizeRef(camp.id, a.userId);
    // earnings credited on the HOME workspace (DEMO_WS), NOT ws2.
    const { data: et } = await svc().from("earnings_transactions").select("workspace_id, amount").eq("source_ref", ref).single();
    expect(et.workspace_id).toBe(DEMO_WS);
    expect(Number(et.amount)).toBe(300);
    // budget debited on the CAMPAIGN workspace (ws2).
    expect(Number((await budget(ws2))?.balance)).toBe(200);
  });
});
