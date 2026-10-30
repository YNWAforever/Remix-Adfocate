import { FIXTURE_WORKSPACE_SLUG } from "./helpers";
import { grantStaffFixture } from "./helpers";
import { fixtureName } from "./helpers";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceForTests, makeCreator, makeMission, makeStaff, cleanup, DEMO_WS, userForJwt } from "./helpers.js";
import { campaignBonusRef, campaignPrizeRef } from "../lib/campaignAuthoring.js";
import { createFixtureStaffApp as createApp } from "./fixtureStaffTransport";

const hasEnv = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_KEY;
const suite = hasEnv ? describe : describe.skip;

// Operator-route smoke test setup (must set ADMIN_SECRET before createApp()).
process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || "test-admin-secret";
const { app } = createApp();
const SECRET = process.env.ADMIN_SECRET;
function adminreq(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (!headers.has("Authorization")) headers.set("x-admin-secret", SECRET);
  return app.request(`/api${path}`, { ...init, headers });
}
function creatorReq(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, { ...init, headers: { Authorization: `Bearer ${jwt}`, "X-Workspace-Slug": FIXTURE_WORKSPACE_SLUG, "Content-Type": "application/json", ...(init.headers ?? {}) } });
}
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
              status: "submitted", content_urls: ["https://example.test/campaign-evidence"], submitted_at: opts.submitted_at }).select("id").single();
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
  beforeAll(async () => { await cleanup(); koc = await makeCreator(fixtureName("camp-bonus@test.local"), 0); });
  afterAll(cleanup);

  it("auto-enrolls, counts, and pays the bonus exactly once on goal crossing", async () => {
    const m1 = await makeMission({ slug: fixtureName("test-camp-m1") });
    const m2 = await makeMission({ slug: fixtureName("test-camp-m2") });
    const camp = await makeCampaign({ slug: fixtureName("test-camp-bonus"), goal_target: 2, bonus_points: 100, bonus_xp: 20 });
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
    const m = await makeMission({ slug: fixtureName("test-camp-grace-m") });
    const camp = await makeCampaign({ slug: fixtureName("test-camp-grace"), goal_target: 1, ends_at: "2026-06-30T00:00:00Z" });
    await attach(camp.id, m.id);
    // delivered before ends_at, reviewed AFTER ends_at (grace). Campaign still 'active' (not settled).
    await seedApprovedSub({ creator: koc.userId, mission: m.id,
      submitted_at: "2026-06-29T00:00:00Z", reviewed_at: "2026-07-03T00:00:00Z" });
    const p = await participant(camp.id, koc.userId);
    expect(p?.approved_count).toBe(1);
    expect(p?.goal_reached_at).not.toBeNull();
  });

  it("does NOT count a submission delivered after ends_at", async () => {
    const m = await makeMission({ slug: fixtureName("test-camp-late-m") });
    const camp = await makeCampaign({ slug: fixtureName("test-camp-late"), goal_target: 1, ends_at: "2026-06-30T00:00:00Z" });
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
    a = await makeCreator(fixtureName("camp-a@test.local"), 0);   // both home = DEMO_WS
    b = await makeCreator(fixtureName("camp-b@test.local"), 0);
  });
  afterAll(cleanup);

  it("ranks, pays the top tier in cash, and is idempotent on re-settle", async () => {
    // Use a dedicated campaign workspace (throwaway, slug "test-camp-ws1") so the budget
    // balance starts at 0 and is unaffected by other runs against DEMO_WS.
    const ws1 = await makeWorkspace(fixtureName("test-camp-ws1"));
    const m = await makeMission({ slug: fixtureName("test-settle-m") });
    // Move mission into ws1 so the campaign (in ws1) can attach it.
    await svc().from("missions").update({ workspace_id: ws1 }).eq("id", m.id);
    const camp = await makeCampaign({
      slug: fixtureName("test-settle"), workspace_id: ws1, goal_target: 1, bonus_points: 0, bonus_xp: 0,
      prize_tiers: [{ rank_from: 1, rank_to: 1, cash: 500, points: 0, xp: 0 }],
    });
    await attach(camp.id, m.id, ws1);
    // A: 2 approved, B: 1 approved → A ranks 1.
    // reviewed_at must be >= campaign_missions.added_at (which is now()) for rank_campaign join.
    await seedApprovedSub({ creator: a.userId, mission: m.id, workspace: ws1, submitted_at: "2026-06-05T00:00:00Z", reviewed_at: "2027-01-01T00:00:00Z" });
    // second approved for A needs a 2nd mission (one approved sub per (creator,mission) submission row).
    const m2 = await makeMission({ slug: fixtureName("test-settle-m2") });
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
    expect(rowA!.prize_rank).toBe(1);
    expect(rowA!.prize_granted_at).not.toBeNull();

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
    const ws2 = await makeWorkspace(fixtureName("test-camp-ws2"));
    const m = await makeMission({ slug: fixtureName("test-xws-m") });
    // Move this mission into ws2 so the campaign (in ws2) counts its submissions.
    await svc().from("missions").update({ workspace_id: ws2 }).eq("id", m.id);
    const camp = await makeCampaign({
      slug: fixtureName("test-xws"), workspace_id: ws2, goal_target: 1, bonus_points: 0, bonus_xp: 0,
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
    expect(et!.workspace_id).toBe(DEMO_WS);
    expect(Number(et!.amount)).toBe(300);
    // budget debited on the CAMPAIGN workspace (ws2).
    expect(Number((await budget(ws2))?.balance)).toBe(200);
  });
});

suite("campaigns — insufficient budget", () => {
  let a: { userId: string }, b: { userId: string };
  beforeAll(async () => {
    await cleanup();
    // Reset DEMO_WS budget to 0 + enforcement off so balance assertions are deterministic.
    const cur = await budget(DEMO_WS);
    const curBal = cur ? Number(cur.balance) : 0;
    if (curBal > 0) {
      await svc().rpc("credit_workspace_budget", { p_workspace: DEMO_WS, p_delta: -curBal, p_type: "adjust" });
    }
    await svc().rpc("set_workspace_budget_enforcement", { p_workspace: DEMO_WS, p_enforced: false });
    a = await makeCreator(fixtureName("camp-ins-a@test.local"), 0);
    b = await makeCreator(fixtureName("camp-ins-b@test.local"), 0);
  });
  afterAll(async () => {
    // The test leaves DEMO_WS enforced with a zero balance; later suites (e.g. wallet approval)
    // share DEMO_WS and expect the unenforced default, so restore it.
    await svc().rpc("set_workspace_budget_enforcement", { p_workspace: DEMO_WS, p_enforced: false });
    await cleanup();
  });

  it("rolls back the entire settlement; top-up + re-settle pays only unpaid winners", async () => {
    const m1 = await makeMission({ slug: fixtureName("test-ins-m1") });
    const m2 = await makeMission({ slug: fixtureName("test-ins-m2") });
    const camp = await makeCampaign({
      slug: fixtureName("test-ins"), goal_target: 1, bonus_points: 0, bonus_xp: 0,
      prize_tiers: [{ rank_from: 1, rank_to: 2, cash: 400, points: 0, xp: 0 }],  // both A and B win 400
    });
    await attach(camp.id, m1.id);
    await attach(camp.id, m2.id);
    // A ranks 1 (2 approved), B ranks 2 (1 approved).
    // reviewed_at must be >= campaign_missions.added_at (now()) for rank_campaign join.
    await seedApprovedSub({ creator: a.userId, mission: m1.id, submitted_at: "2026-06-05T00:00:00Z", reviewed_at: "2027-01-01T00:00:00Z" });
    await seedApprovedSub({ creator: a.userId, mission: m2.id, submitted_at: "2026-06-06T00:00:00Z", reviewed_at: "2027-01-01T00:00:00Z" });
    await seedApprovedSub({ creator: b.userId, mission: m1.id, submitted_at: "2026-06-07T00:00:00Z", reviewed_at: "2027-01-01T00:00:00Z" });

    // Fund only 400 + enforce → can pay ONE 400 prize, not two.
    await svc().rpc("credit_workspace_budget", { p_workspace: DEMO_WS, p_delta: 400, p_type: "topup" });
    await svc().rpc("set_workspace_budget_enforcement", { p_workspace: DEMO_WS, p_enforced: true });
    await svc().rpc("close_campaign", { p_campaign: camp.id });

    const fail = await svc().rpc("settle_campaign", { p_campaign: camp.id });
    expect(fail.error).not.toBeNull();
    expect(String(fail.error?.message)).toContain("insufficient_budget");

    // Full rollback: no prize ledger rows, budget untouched, campaign still 'closed'.
    expect((await earnTxns(campaignPrizeRef(camp.id, a.userId))).length).toBe(0);
    expect((await earnTxns(campaignPrizeRef(camp.id, b.userId))).length).toBe(0);
    expect(Number((await budget(DEMO_WS))?.balance)).toBe(400);
    const { data: c1 } = await svc().from("campaigns").select("status, settled_at").eq("id", camp.id).single();
    expect(c1!.status).toBe("closed");
    expect(c1!.settled_at).toBeNull();

    // Top up to cover both, then re-settle.
    await svc().rpc("credit_workspace_budget", { p_workspace: DEMO_WS, p_delta: 400, p_type: "topup" });
    const ok = await svc().rpc("settle_campaign", { p_campaign: camp.id });
    expect(ok.error).toBeNull();
    expect((await earnTxns(campaignPrizeRef(camp.id, a.userId))).length).toBe(1);
    expect((await earnTxns(campaignPrizeRef(camp.id, b.userId))).length).toBe(1);
    expect(Number((await budget(DEMO_WS))?.balance)).toBe(0);   // 800 funded − 2×400
    const { data: c2 } = await svc().from("campaigns").select("status").eq("id", camp.id).single();
    expect(c2!.status).toBe("settled");
  });
});

suite("campaigns — constraints & RLS", () => {
  let koc: { userId: string; jwt: string };
  let other: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator(fixtureName("camp-rls-a@test.local"), 0);
    other = await makeCreator(fixtureName("camp-rls-b@test.local"), 0);
  });
  afterAll(cleanup);

  it("rejects attaching a mission already active in another campaign (one-active index)", async () => {
    const m = await makeMission({ slug: fixtureName("test-excl-m") });
    const c1 = await makeCampaign({ slug: fixtureName("test-excl-1") });
    const c2 = await makeCampaign({ slug: fixtureName("test-excl-2") });
    await attach(c1.id, m.id);
    const { error } = await svc().from("campaign_missions")
      .insert({ campaign_id: c2.id, mission_id: m.id, workspace_id: DEMO_WS });
    expect(error?.code).toBe("23505");                  // partial-unique on (mission_id) where removed_at is null
  });

  it("mission removed mid-campaign keeps approvals earned while attached (as-of-approval)", async () => {
    const m = await makeMission({ slug: fixtureName("test-rm-m") });
    const camp = await makeCampaign({ slug: fixtureName("test-rm"), goal_target: 5 });
    await attach(camp.id, m.id);
    await seedApprovedSub({ creator: koc.userId, mission: m.id,
      submitted_at: "2026-06-05T00:00:00Z", reviewed_at: "2027-01-01T00:00:00Z" });
    // Remove the mission AFTER that approval (removed_at must be > reviewed_at).
    await svc().from("campaign_missions").update({ removed_at: "2027-06-01T00:00:00Z" })
      .eq("campaign_id", camp.id).eq("mission_id", m.id);
    const { data: ranked } = await svc().rpc("rank_campaign", { p_campaign: camp.id });
    const mine = (ranked ?? []).find((r: { creator_id: string }) => r.creator_id === koc.userId);
    expect(Number(mine?.approved)).toBe(1);             // not retroactively erased
  });

  it("reject_submission on an approved row raises wrong_state (monotonic invariant)", async () => {
    const m = await makeMission({ slug: fixtureName("test-term-m") });
    const camp = await makeCampaign({ slug: fixtureName("test-term"), goal_target: 1 });
    await attach(camp.id, m.id);
    const id = await seedApprovedSub({ creator: koc.userId, mission: m.id, submitted_at: "2026-06-05T00:00:00Z" });
    const { error } = await svc().rpc("reject_submission", { p_submission: id, p_notes: "x" });
    expect(String(error?.message)).toContain("wrong_state");
  });

  it("creator may read only their own participant row; not another creator's", async () => {
    const m = await makeMission({ slug: fixtureName("test-self-m") });
    const camp = await makeCampaign({ slug: fixtureName("test-self"), goal_target: 1 });
    await attach(camp.id, m.id);
    await seedApprovedSub({ creator: koc.userId, mission: m.id, submitted_at: "2026-06-05T00:00:00Z" });

    const mine = await userForJwt(koc.jwt).from("campaign_participants").select("creator_id").eq("campaign_id", camp.id);
    expect((mine.data ?? []).map((r) => r.creator_id)).toEqual([koc.userId]);

    const theirs = await userForJwt(other.jwt).from("campaign_participants").select("creator_id").eq("campaign_id", camp.id);
    expect(theirs.data ?? []).toEqual([]);              // RLS: only self-read
  });
});

// ---------------------------------------------------------------------------
// Operator-route smoke tests: drive adminCampaignRoutes via Hono app
// ---------------------------------------------------------------------------
suite("campaigns — operator routes (adminCampaignRoutes)", () => {
  let koc: { userId: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator(fixtureName("camp-route@test.local"), 0);
  });
  afterAll(cleanup);

  it("create draft → 201", async () => {
    // starts_at, ends_at, goal_target are NOT NULL at the DB level even for drafts.
    const res = await adminreq("/admin/campaigns", {
      method: "POST",
      body: JSON.stringify({
        workspace_id: DEMO_WS, slug: fixtureName("test-r-1"), title: "x",
        starts_at: "2027-01-01T00:00:00Z", ends_at: "2027-01-31T00:00:00Z",
        goal_target: 1,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { campaign: { slug: string; status: string } };
    expect(body.campaign.slug).toBe(fixtureName("test-r-1"));
    expect(body.campaign.status).toBe("draft");
  });

  it("attach mission already active in another campaign → 409", async () => {
    const m = await makeMission({ slug: fixtureName("test-r-excl-m") });
    // Campaign 1: create + attach mission (direct DB insert since status is active).
    const { data: c1, error: ce1 } = await serviceForTests().from("campaigns").insert({
      workspace_id: DEMO_WS, slug: fixtureName("test-r-excl-1"), title: "excl1", status: "active",
      starts_at: "2026-06-01T00:00:00Z", ends_at: "2026-06-30T00:00:00Z",
      goal_target: 1, completion_bonus_points: 10, completion_bonus_xp: 5,
      prize_tiers: [], published_at: "2026-06-01T00:00:00Z",
    }).select("id").single();
    if (ce1) throw ce1;
    await serviceForTests().from("campaign_missions").insert({
      campaign_id: (c1 as { id: string }).id, mission_id: m.id, workspace_id: DEMO_WS,
    });

    // Campaign 2: create draft via route (starts_at/ends_at/goal_target required by NOT NULL).
    const c2res = await adminreq("/admin/campaigns", {
      method: "POST",
      body: JSON.stringify({
        workspace_id: DEMO_WS, slug: fixtureName("test-r-excl-2"), title: "excl2",
        starts_at: "2027-01-01T00:00:00Z", ends_at: "2027-01-31T00:00:00Z",
        goal_target: 1,
      }),
    });
    expect(c2res.status).toBe(201);
    const c2id = ((await c2res.json()) as { campaign: { id: string } }).campaign.id;

    // Try to attach the same mission → 409.
    const attachRes = await adminreq(`/admin/campaigns/${c2id}/missions`, {
      method: "POST",
      body: JSON.stringify({ mission_id: m.id }),
    });
    expect(attachRes.status).toBe(409);
  });

  it("publish a draft missing window/goal/reward → 422", async () => {
    // Create a valid draft (dates + goal_target required by DB) but with NO reward
    // (completion_bonus_points=0, xp=0, no prize_tiers) → publish should reject with 422.
    const createRes = await adminreq("/admin/campaigns", {
      method: "POST",
      body: JSON.stringify({
        workspace_id: DEMO_WS, slug: fixtureName("test-r-nowin"), title: "no reward",
        starts_at: "2027-01-01T00:00:00Z", ends_at: "2027-01-31T00:00:00Z",
        goal_target: 1,
        completion_bonus_points: 0, completion_bonus_xp: 0, prize_tiers: [],
      }),
    });
    expect(createRes.status).toBe(201);
    const id = ((await createRes.json()) as { campaign: { id: string } }).campaign.id;

    // Publish with no reward → 422 (至少需要完成獎勵或名次獎品).
    const publishRes = await adminreq(`/admin/campaigns/${id}/publish`, { method: "POST" });
    expect(publishRes.status).toBe(422);
    const pb = await publishRes.json() as { code: string; fields: Record<string, string> };
    expect(pb.code).toBe("validation");
    // The "reward" field error should be present.
    expect(pb.fields).toHaveProperty("reward");
  });

  it("settle on an enforced-but-unfunded campaign with a cash prize winner → 402", async () => {
    // Set up a throwaway workspace with 0 balance + enforcement.
    const { data: ws, error: wsErr } = await serviceForTests().from("workspaces")
      .insert({ slug: fixtureName("test-camp-route-ws"), name: "route-ws" }).select("id").single();
    if (wsErr) throw wsErr;
    const wsId = (ws as { id: string }).id;

    // This operator belongs only to the campaign's workspace (single-workspace PK).
    const operator = await makeStaff(fixtureName("campaign-route-operator@test.local"), wsId);
    await grantStaffFixture(operator.userId,wsId,"workspace_admin");
    const operatorHeaders = { Authorization: `Bearer ${operator.jwt}`, "X-Workspace-Slug": fixtureName("test-camp-route-ws") };

    // Mission in that workspace.
    const { data: msn, error: msnErr } = await serviceForTests().from("missions").insert({
      workspace_id: wsId, slug: fixtureName("test-r-settle-m"), title: "settle-m",
      mission_type: "ugc", access_type: "open", points_reward: 50, cash_reward: null,
      quota: 10, filled: 0, status: "active", required_level: "L0", deadline: null, category: "美容",
    }).select("id").single();
    if (msnErr) throw msnErr;
    const missionId = (msn as { id: string }).id;

    // Campaign with cash prize tier (1 winner → 500 HKD).
    const { data: camp, error: campErr } = await serviceForTests().from("campaigns").insert({
      workspace_id: wsId, slug: fixtureName("test-r-settle"), title: "settle",
      status: "active", starts_at: "2026-06-01T00:00:00Z", ends_at: "2026-06-30T00:00:00Z",
      goal_target: 1, completion_bonus_points: 0, completion_bonus_xp: 0,
      prize_tiers: [{ rank_from: 1, rank_to: 1, cash: 500, points: 0, xp: 0 }],
      published_at: "2026-06-01T00:00:00Z",
    }).select("id").single();
    if (campErr) throw campErr;
    const campaignId = (camp as { id: string }).id;

    // Attach mission + seed an approved sub so rank_campaign produces a winner.
    await serviceForTests().from("campaign_missions").insert({
      campaign_id: campaignId, mission_id: missionId, workspace_id: wsId,
    });
    // reviewed_at must be >= campaign_missions.added_at (now()) for rank_campaign join.
    const { data: sub, error: subErr } = await serviceForTests().from("mission_submissions").insert({
      creator_id: koc.userId, workspace_id: wsId, mission_id: missionId,
      status: "submitted", content_urls: ["https://example.test/campaign-evidence"], submitted_at: "2026-06-05T00:00:00Z",
    }).select("id").single();
    if (subErr) throw subErr;
    await serviceForTests().from("mission_submissions").update({
      status: "approved", reviewed_at: "2027-01-01T00:00:00Z", quality_rating: null,
    }).eq("id", (sub as { id: string }).id);

    // Enforce budget with 0 balance.
    await serviceForTests().rpc("set_workspace_budget_enforcement", { p_workspace: wsId, p_enforced: true });

    // Close via route.
    const closeRes = await adminreq(`/admin/campaigns/${campaignId}/close`, { method: "POST", headers: operatorHeaders });
    expect(closeRes.status).toBe(200);

    // Settle via route → 402 (insufficient_budget).
    const settleRes = await adminreq(`/admin/campaigns/${campaignId}/settle`, { method: "POST", headers: operatorHeaders });
    expect(settleRes.status).toBe(402);
    const sb = await settleRes.json() as { code: string };
    expect(sb.code).toBe("insufficient_budget");

    // Cleanup throwaway workspace (cascade).
    await serviceForTests().from("campaigns").delete().eq("id", campaignId);
    await serviceForTests().from("missions").delete().eq("id", missionId);
    await serviceForTests().from("workspaces").delete().eq("id", wsId);
  });

  it("close an active campaign twice → second close returns 409", async () => {
    // Create + publish a minimal campaign directly.
    const { data: camp, error: campErr } = await serviceForTests().from("campaigns").insert({
      workspace_id: DEMO_WS, slug: fixtureName("test-r-close2x"), title: "close2x",
      status: "active", starts_at: "2026-06-01T00:00:00Z", ends_at: "2026-06-30T00:00:00Z",
      goal_target: 1, completion_bonus_points: 50, completion_bonus_xp: 10,
      prize_tiers: [], published_at: "2026-06-01T00:00:00Z",
    }).select("id").single();
    if (campErr) throw campErr;
    const campaignId = (camp as { id: string }).id;

    // First close → 200.
    const close1 = await adminreq(`/admin/campaigns/${campaignId}/close`, { method: "POST" });
    expect(close1.status).toBe(200);

    // Second close → 409.
    const close2 = await adminreq(`/admin/campaigns/${campaignId}/close`, { method: "POST" });
    expect(close2.status).toBe(409);
    const b2 = await close2.json() as { code: string };
    expect(b2.code).toBe("conflict");
  });
});

// ---------------------------------------------------------------------------
// Creator read route smoke tests: drive campaignRoutes via Hono app
// ---------------------------------------------------------------------------
suite("campaigns — creator read routes", () => {
  let creator: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    creator = await makeCreator(fixtureName("camp-cr-read@test.local"), 0);
  });
  afterAll(cleanup);

  it("GET /campaigns → 200, active campaign in creator's workspace appears in list", async () => {
    await makeCampaign({ slug: fixtureName("test-cr-active") });
    const res = await creatorReq("/campaigns", creator.jwt);
    expect(res.status).toBe(200);
    const body = await res.json() as { campaigns: Array<{ slug: string; status: string }> };
    expect(Array.isArray(body.campaigns)).toBe(true);
    const found = body.campaigns.find((c) => c.slug === fixtureName("test-cr-active"));
    expect(found).toBeTruthy();
    expect(found?.status).toBe("active");
  });

  it("GET /campaigns/:slug → 200 with my_progress object after seeding approved sub", async () => {
    const m = await makeMission({ slug: fixtureName("test-cr-detail-m") });
    const camp = await makeCampaign({ slug: fixtureName("test-cr-detail"), goal_target: 2 });
    await attach(camp.id, m.id);
    // Seed an approved submission so the trigger enrolls the creator and increments approved_count.
    // submitted_at is in-window; reviewed_at in-window (trigger uses submitted_at for enrollment).
    await seedApprovedSub({
      creator: creator.userId, mission: m.id,
      submitted_at: "2026-06-10T00:00:00Z", reviewed_at: "2027-01-01T00:00:00Z",
    });
    const res = await creatorReq(`/campaigns/${camp.slug}`, creator.jwt);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      campaign: { slug: string };
      missions: unknown[];
      my_progress: { approved: number; goal_reached: boolean; bonus_granted: boolean; prize_rank: unknown; rank: unknown };
    };
    expect(body.campaign.slug).toBe(fixtureName("test-cr-detail"));
    expect(Array.isArray(body.missions)).toBe(true);
    expect(body.my_progress).toBeDefined();
    expect(typeof body.my_progress.approved).toBe("number");
    expect(body.my_progress.approved).toBeGreaterThanOrEqual(1);
  });

  it("GET /campaigns/:slug/leaderboard → 200 with leaderboard array", async () => {
    const m = await makeMission({ slug: fixtureName("test-cr-lb-m") });
    const camp = await makeCampaign({ slug: fixtureName("test-cr-lb"), goal_target: 1 });
    await attach(camp.id, m.id);
    await seedApprovedSub({
      creator: creator.userId, mission: m.id,
      submitted_at: "2026-06-10T00:00:00Z", reviewed_at: "2027-01-01T00:00:00Z",
    });
    const res = await creatorReq(`/campaigns/${camp.slug}/leaderboard`, creator.jwt);
    expect(res.status).toBe(200);
    const body = await res.json() as { leaderboard: Array<{ creator_id: string; rank: number }> };
    expect(Array.isArray(body.leaderboard)).toBe(true);
    expect(body.leaderboard.length).toBeGreaterThanOrEqual(1);
    const mine = body.leaderboard.find((e) => e.creator_id === creator.userId);
    expect(mine).toBeTruthy();
    expect(typeof mine?.rank).toBe("number");
  });

  it("GET /campaigns/:slug for a draft campaign → 404", async () => {
    await makeCampaign({ slug: fixtureName("test-cr-draft"), status: "draft" });
    const res = await creatorReq(fixtureName("/campaigns/test-cr-draft"), creator.jwt);
    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("not_found");
  });
});

suite("campaigns — cross-workspace isolation (creator route)", () => {
  let koc: { userId: string; jwt: string };
  let foreignWs: string;
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator(fixtureName("camp-iso@test.local"), 0);          // home = DEMO_WS ("demo")
    foreignWs = await makeWorkspace(fixtureName("test-camp-isob"));          // a different workspace
  });
  afterAll(cleanup);

  it("a creator cannot see / read a campaign in another workspace", async () => {
    // Active campaign in the FOREIGN workspace.
    const foreign = await makeCampaign({ slug: fixtureName("test-iso-foreign"), status: "active", workspace_id: foreignWs });
    // Also an active campaign in the creator's OWN workspace (happy-path guard against false-pass).
    const mine = await makeCampaign({ slug: fixtureName("test-iso-mine"), status: "active" });

    // List: only the creator's own workspace campaign appears; the foreign one does not.
    const listRes = await creatorReq("/campaigns", koc.jwt);
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json() as { campaigns: { slug: string }[] };
    const slugs = listBody.campaigns.map((c) => c.slug);
    expect(slugs).toContain(fixtureName("test-iso-mine"));
    expect(slugs).not.toContain(fixtureName("test-iso-foreign"));

    // Detail of the foreign campaign → 404 (no data leak).
    const detailRes = await creatorReq(`/campaigns/${foreign.slug}`, koc.jwt);
    expect(detailRes.status).toBe(404);

    // Leaderboard of the foreign campaign → 404 (ownership verified before rank_campaign).
    const lbRes = await creatorReq(`/campaigns/${foreign.slug}/leaderboard`, koc.jwt);
    expect(lbRes.status).toBe(404);

    // Sanity: the creator CAN read their own campaign's detail (so the 404s aren't a false pass).
    const okRes = await creatorReq(`/campaigns/${mine.slug}`, koc.jwt);
    expect(okRes.status).toBe(200);
  });
});
