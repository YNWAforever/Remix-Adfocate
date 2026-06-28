import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app.js";
import { makeBrand, seedMission, cleanup, hasSupabaseEnv } from "./helpers.js";

const suite = hasSupabaseEnv ? describe : describe.skip;
const { app } = createApp();

// Brand request helper: brand auth is Bearer-JWT only (requireBrand resolves the workspace from the token).
function breq(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api/brand${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

suite("brand campaigns — lifecycle + RLS isolation", () => {
  // brandA + brandB live in DIFFERENT workspaces (makeBrand mints a throwaway workspace each).
  let A: { jwt: string; workspaceId: string };
  let B: { jwt: string; workspaceId: string };
  beforeAll(async () => {
    await cleanup();
    A = await makeBrand("brand-camp-a@test.local");
    B = await makeBrand("brand-camp-b@test.local");
  });
  afterAll(cleanup);

  it("a brand creates, publishes, lists, and closes its OWN campaign", async () => {
    // create draft
    const created = await breq("/campaigns", A.jwt, {
      method: "POST",
      body: JSON.stringify({ slug: "test-bc-1", title: "品牌挑戰", starts_at: "2026-06-01T00:00:00Z",
        ends_at: "2026-06-30T00:00:00Z", goal_target: 2, completion_bonus_points: 100, completion_bonus_xp: 20, prize_tiers: [] }),
    });
    expect(created.status).toBe(201);
    const { campaign } = await created.json() as { campaign: { id: string; workspace_id: string; status: string } };
    expect(campaign.workspace_id).toBe(A.workspaceId);   // forced from identity
    expect(campaign.status).toBe("draft");

    // attach a mission from the brand's own workspace
    const m = await seedMission(A.workspaceId, { slug: "test-bc-m1" });
    const attach = await breq(`/campaigns/${campaign.id}/missions`, A.jwt, {
      method: "POST", body: JSON.stringify({ mission_id: (m as { id: string }).id }),
    });
    expect(attach.status).toBe(201);

    // publish
    const pub = await breq(`/campaigns/${campaign.id}/publish`, A.jwt, { method: "POST", body: "{}" });
    expect(pub.status).toBe(200);

    // A can read its OWN leaderboard (positive control for the test-#2 404)
    const board = await breq(`/campaigns/${campaign.id}/leaderboard`, A.jwt);
    expect(board.status).toBe(200);

    // appears in its own list
    const list = await breq("/campaigns", A.jwt);
    const { campaigns } = await list.json() as { campaigns: { slug: string }[] };
    expect(campaigns.map((c) => c.slug)).toContain("test-bc-1");

    // close (RPC behind the ownership gate)
    const close = await breq(`/campaigns/${campaign.id}/close`, A.jwt, { method: "POST", body: "{}" });
    expect(close.status).toBe(200);
    const { campaign: closed } = await close.json() as { campaign: { status: string } };
    expect(closed.status).toBe("closed");
  });

  it("a brand CANNOT read, edit, close, or see another workspace's campaign (RLS)", async () => {
    const created = await breq("/campaigns", A.jwt, {
      method: "POST",
      body: JSON.stringify({ slug: "test-bc-foreign", title: "A 的挑戰", starts_at: "2026-06-01T00:00:00Z",
        ends_at: "2026-06-30T00:00:00Z", goal_target: 1, completion_bonus_points: 50, completion_bonus_xp: 10, prize_tiers: [] }),
    });
    const { campaign } = await created.json() as { campaign: { id: string } };

    // B cannot read A's campaign → 404
    expect((await breq(`/campaigns/${campaign.id}`, B.jwt)).status).toBe(404);
    // B cannot edit A's campaign → 404 (RLS read returns nothing)
    expect((await breq(`/campaigns/${campaign.id}`, B.jwt, { method: "PATCH", body: JSON.stringify({ title: "x" }) })).status).toBe(404);
    // B cannot close A's campaign → 404 (ownership gate)
    expect((await breq(`/campaigns/${campaign.id}/close`, B.jwt, { method: "POST", body: "{}" })).status).toBe(404);
    // B cannot read A's leaderboard → 404
    expect((await breq(`/campaigns/${campaign.id}/leaderboard`, B.jwt)).status).toBe(404);
    // A's campaign never appears in B's list
    const { campaigns } = await (await breq("/campaigns", B.jwt)).json() as { campaigns: { slug: string }[] };
    expect(campaigns.map((c) => c.slug)).not.toContain("test-bc-foreign");
  });

  it("there is NO brand settle endpoint (settle is operator-only)", async () => {
    const created = await breq("/campaigns", A.jwt, {
      method: "POST",
      body: JSON.stringify({ slug: "test-bc-nosettle", title: "X", starts_at: "2026-06-01T00:00:00Z",
        ends_at: "2026-06-30T00:00:00Z", goal_target: 1, completion_bonus_points: 10, completion_bonus_xp: 5, prize_tiers: [] }),
    });
    const { campaign } = await created.json() as { campaign: { id: string } };
    // POST /brand/campaigns/:id/settle is unregistered in the brand namespace.
    const res = await breq(`/campaigns/${campaign.id}/settle`, A.jwt, { method: "POST", body: "{}" });
    expect([400, 404]).toContain(res.status);   // 400 = workspaceAuth fallthrough; 404 = Hono not-found. Never a handled settle.
    // Directly prove no settlement executed: the campaign must still be "draft".
    const check = await breq(`/campaigns/${campaign.id}`, A.jwt);
    const { campaign: still } = await check.json() as { campaign: { status: string } };
    expect(still.status).toBe("draft");
  });
});
