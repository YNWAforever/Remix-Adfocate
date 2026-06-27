import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceForTests, makeCreator, makeMission, cleanup, DEMO_WS } from "./helpers.js";
import { campaignBonusRef } from "../lib/campaignAuthoring.js";

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
