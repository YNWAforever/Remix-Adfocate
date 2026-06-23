import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  hasSupabaseEnv, serviceForTests, userForJwt, makeCreator, makeMission,
  makeGift, addCodes, setXp, cleanup, DEMO_WS,
} from "./helpers";

const suite = hasSupabaseEnv ? describe : describe.skip;

/** Seed a submission row directly (service) in a given status; returns its id. */
async function seedSub(creatorId: string, status: string, slug: string) {
  const m = await makeMission({ slug });
  const { data, error } = await serviceForTests()
    .from("mission_submissions")
    .insert({ mission_id: m.id, creator_id: creatorId, workspace_id: DEMO_WS, status })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

/** All notifications visible to a creator (RLS-scoped via their JWT). */
async function notifsFor(jwt: string) {
  const { data, error } = await userForJwt(jwt)
    .from("notifications").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data as Array<{ type: string; data: Record<string, unknown>; user_id: string }>;
}

suite("notification triggers", () => {
  let koc: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("notif-trig@test.local", 1000);
  });
  afterAll(cleanup);

  it("submission_approved carries points + xp deltas", async () => {
    const id = await seedSub(koc.userId, "submitted", "test-notif-approve");
    await serviceForTests().rpc("approve_submission", { p_submission: id, p_notes: "good" });
    const n = (await notifsFor(koc.jwt)).find((x) => x.type === "submission_approved");
    expect(n).toBeTruthy();
    expect(n!.data.points).toBeGreaterThan(0);
    expect(n!.data.xp).toBe(100);
  });

  it("submission_rejected carries the reason", async () => {
    const id = await seedSub(koc.userId, "submitted", "test-notif-reject");
    await serviceForTests().rpc("reject_submission", { p_submission: id, p_notes: "off-brief" });
    const n = (await notifsFor(koc.jwt)).find((x) => x.type === "submission_rejected");
    expect(n?.data.reason).toBe("off-brief");
  });

  it("application_accepted and application_declined fire", async () => {
    const a = await seedSub(koc.userId, "applied", "test-notif-accept");
    await serviceForTests().rpc("accept_application", { p_submission: a });
    const d = await seedSub(koc.userId, "applied", "test-notif-decline");
    await serviceForTests().rpc("decline_application", { p_submission: d, p_notes: "later" });
    const types = (await notifsFor(koc.jwt)).map((x) => x.type);
    expect(types).toContain("application_accepted");
    expect(types).toContain("application_declined");
  });

  it("level_up fires when xp crosses a threshold", async () => {
    await setXp(koc.userId, 500); // L0 -> L1
    const n = (await notifsFor(koc.jwt)).find((x) => x.type === "level_up");
    expect(n?.data.level).toBe("L1");
  });

  it("redemption_ready carries the gift name", async () => {
    const g = await makeGift({ name: "test-notif-gift", points_cost: 100 });
    await addCodes(g.id, ["TEST-CODE-1"]);
    await userForJwt(koc.jwt).rpc("redeem_gift", { p_gift: g.id });
    const n = (await notifsFor(koc.jwt)).find((x) => x.type === "redemption_ready");
    expect(n?.data.gift_name).toBe("test-notif-gift");
  });

  it("RLS isolates notifications between creators", async () => {
    const other = await makeCreator("notif-other@test.local", 0);
    const mine = await notifsFor(koc.jwt);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((n) => n.user_id === koc.userId)).toBe(true);
    const theirs = await notifsFor(other.jwt);
    expect(theirs.length).toBe(0);
  });
});
