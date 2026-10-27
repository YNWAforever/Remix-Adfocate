import { fixtureName } from "./helpers";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceForTests, makeCreator, makeMission, cleanup, DEMO_WS, hasSupabaseEnv, setCreatorProfile } from "./helpers.js";
import { notifyCampaignStarted } from "../lib/notifyCampaignStarted.js";

const suite = hasSupabaseEnv ? describe : describe.skip;
const svc = () => serviceForTests();

// ---- local fixture helpers (mirrors campaigns.test.ts — not exported from there) ----

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

// ---- Block 1: close_due_campaigns ----------------------------------------------------------

suite("close_due_campaigns", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("closes past-deadline active only, idempotent", async () => {
    // Arrange: past+active, future+active, past+draft
    // starts_at must be < ends_at (DB check constraint), so past campaigns need old starts_at too.
    const past = await makeCampaign({ slug: fixtureName("test-s2-close-past"), status: "active", starts_at: "1999-01-01T00:00:00Z", ends_at: "2000-01-01T00:00:00Z" });
    const future = await makeCampaign({ slug: fixtureName("test-s2-close-future"), status: "active", ends_at: "2999-01-01T00:00:00Z" });
    const draft = await makeCampaign({ slug: fixtureName("test-s2-close-draft"), status: "draft", starts_at: "1999-01-01T00:00:00Z", ends_at: "2000-01-01T00:00:00Z" });

    // Act: first call
    const { data: n1, error: err1 } = await svc().rpc("close_due_campaigns");
    expect(err1).toBeNull();
    expect(typeof n1).toBe("number");
    expect((n1 as number)).toBeGreaterThanOrEqual(1);

    // Assert: past+active → closed
    const { data: r1 } = await svc().from("campaigns").select("status").eq("id", past.id).single();
    expect(r1!.status).toBe("closed");

    // Assert: future+active stays active
    const { data: r2 } = await svc().from("campaigns").select("status").eq("id", future.id).single();
    expect(r2!.status).toBe("active");

    // Assert: past+draft stays draft
    const { data: r3 } = await svc().from("campaigns").select("status").eq("id", draft.id).single();
    expect(r3!.status).toBe("draft");

    // Act: second call (idempotent)
    const { data: n2, error: err2 } = await svc().rpc("close_due_campaigns");
    expect(err2).toBeNull();
    expect(typeof n2).toBe("number");

    // Assert: past one is STILL closed
    const { data: r4 } = await svc().from("campaigns").select("status").eq("id", past.id).single();
    expect(r4!.status).toBe("closed");
  });
});

// ---- Block 2: snapshot_campaign_leaderboards -----------------------------------------------

suite("snapshot_campaign_leaderboards", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("captures active-campaign ranks", async () => {
    const creator = await makeCreator(fixtureName("s2-snap@test.local"), 0);
    const mission = await makeMission({ slug: fixtureName("test-s2-snap-m") });
    const camp = await makeCampaign({
      slug: fixtureName("test-s2-snap"),
      status: "active",
      starts_at: "2026-01-01T00:00:00Z",
      ends_at: "2999-01-01T00:00:00Z",
    });
    await attach(camp.id, mission.id);

    // CRITICAL timing: submitted_at within window; reviewed_at >= campaign_missions.added_at (now())
    await seedApprovedSub({
      creator: creator.userId,
      mission: mission.id,
      submitted_at: "2026-06-10T00:00:00Z",
      reviewed_at: "2027-01-01T00:00:00Z",
    });

    // Get the live ranking first
    const { data: live, error: rankErr } = await svc().rpc("rank_campaign", { p_campaign: camp.id });
    expect(rankErr).toBeNull();
    expect(Array.isArray(live)).toBe(true);
    expect((live as unknown[]).length).toBeGreaterThanOrEqual(1);

    // Snapshot
    const { data: n, error: snapErr } = await svc().rpc("snapshot_campaign_leaderboards");
    expect(snapErr).toBeNull();
    expect(typeof n).toBe("number");
    expect((n as number)).toBeGreaterThanOrEqual((live as unknown[]).length);

    // Read back the snapshots for this campaign
    const { data: snapshots, error: readErr } = await svc()
      .from("campaign_rank_snapshots")
      .select("creator_id, rank, approved")
      .eq("campaign_id", camp.id)
      .order("rank", { ascending: true });
    expect(readErr).toBeNull();
    expect((snapshots ?? []).length).toBe((live as unknown[]).length);

    // Each snapshot row's rank must match the live ranker's rank for that creator_id
    for (const snap of snapshots ?? []) {
      const liveRow = (live as Array<{ creator_id: string; rank: number }>)
        .find((r) => r.creator_id === snap.creator_id);
      expect(liveRow).toBeDefined();
      expect(snap.rank).toBe(liveRow!.rank);
    }
  });
});

// ---- Block 3: broadcast_campaign_started (idempotency) -------------------------------------

suite("broadcast_campaign_started", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("inserts once, idempotent", async () => {
    const creator = await makeCreator(fixtureName("s2-bcast@test.local"), 0);
    const camp = await makeCampaign({ slug: fixtureName("test-s2-bcast"), status: "active" });

    // First call → should insert 1 notification
    const { data: n1, error: e1 } = await svc().rpc("broadcast_campaign_started", {
      p_campaign: camp.id,
      p_creator_ids: [creator.userId],
    });
    expect(e1).toBeNull();
    expect(n1).toBe(1);

    // Second call with same args → idempotent, should return 0
    const { data: n2, error: e2 } = await svc().rpc("broadcast_campaign_started", {
      p_campaign: camp.id,
      p_creator_ids: [creator.userId],
    });
    expect(e2).toBeNull();
    expect(n2).toBe(0);

    // Read notifications table — exactly 1 row for this creator + campaign
    const { data: notifs, error: readErr } = await svc()
      .from("notifications")
      .select("*")
      .eq("user_id", creator.userId)
      .eq("type", "campaign_started");
    expect(readErr).toBeNull();
    expect((notifs ?? []).length).toBe(1);
    const notif = notifs![0];
    expect(notif.entity_id).toBe(camp.id);
    expect(notif.data.campaign_slug).toBe(camp.slug);
  });
});

// ---- Block 4: notifyCampaignStarted policy --------------------------------------------------

suite("notifyCampaignStarted policy", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("notifies a matched creator but not an unmatched one", async () => {
    const camp = await makeCampaign({ slug: fixtureName("test-s2-notify"), status: "active" });
    const mission = await makeMission({ slug: fixtureName("test-s2-notify-m"), category: "beauty", required_level: "L1" });
    await attach(camp.id, mission.id);

    const match = await makeCreator(fixtureName("s2-match@test.local"), 0);
    await setCreatorProfile(match.userId, { categories: ["beauty"], level: "L2" });
    const noMatch = await makeCreator(fixtureName("s2-nomatch@test.local"), 0);
    await setCreatorProfile(noMatch.userId, { categories: ["food"], level: "L2" });

    await notifyCampaignStarted(camp.id);

    const { data: a } = await svc().from("notifications").select("id")
      .eq("user_id", match.userId).eq("type", "campaign_started").eq("entity_id", camp.id);
    const { data: b } = await svc().from("notifications").select("id")
      .eq("user_id", noMatch.userId).eq("type", "campaign_started").eq("entity_id", camp.id);
    expect((a ?? []).length).toBe(1);
    expect((b ?? []).length).toBe(0);
  });

  it("does NOT notify a matching creator in a DIFFERENT workspace (isolation)", async () => {
    // Campaign + beauty/L1 mission live in DEMO_WS.
    const camp = await makeCampaign({ slug: fixtureName("test-s2-notify-iso"), status: "active" });
    const mission = await makeMission({ slug: fixtureName("test-s2-notify-iso-m"), category: "beauty", required_level: "L1" });
    await attach(camp.id, mission.id);

    // A creator who WOULD match on niche+level, but lives in a different workspace.
    const { data: fwsRow, error: fwsErr } = await svc().from("workspaces")
      .insert({ slug: fixtureName("test-camp-s2-foreign"), name: "s2 foreign" }).select("id").single();
    if (fwsErr) throw fwsErr;
    const foreignWs = (fwsRow as { id: string }).id;
    const foreign = await makeCreator(fixtureName("s2-foreign@test.local"), 0);
    await svc().from("creators")
      .update({ workspace_id: foreignWs, categories: ["beauty"], level: "L2", status: "active" })
      .eq("id", foreign.userId);

    await notifyCampaignStarted(camp.id);

    const { data: n } = await svc().from("notifications").select("id")
      .eq("user_id", foreign.userId).eq("type", "campaign_started").eq("entity_id", camp.id);
    // Move the foreign creator home BEFORE asserting: cleanup() drops "test-camp-%" workspaces
    // before deleting creators, and creators.workspace_id has no ON DELETE cascade — so a creator
    // left in the throwaway ws (e.g. on a failed assertion) would block cleanup's workspace delete.
    await svc().from("creators").update({ workspace_id: DEMO_WS }).eq("id", foreign.userId);
    expect((n ?? []).length).toBe(0); // workspace-scoped: a foreign-workspace match is never notified
  });
});
