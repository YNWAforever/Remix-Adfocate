import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, makeMission, setXp, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function req(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "X-Workspace-Slug": "demo",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

suite("leveling engine", () => {
  let c: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    c = await makeCreator("leveling@test.local", 0);
  });
  afterAll(cleanup);

  it("recomputes level from xp at the thresholds", async () => {
    const cases: [number, string][] = [
      [0, "L0"], [499, "L0"], [500, "L1"], [2000, "L2"], [100000, "L6"],
    ];
    for (const [xp, level] of cases) {
      await setXp(c.userId, xp);
      const me = await (await req("/me", c.jwt)).json();
      expect(me.xp).toBe(xp);
      expect(me.level).toBe(level);
    }
  });

  it("activates the mission level-gate once xp crosses the threshold", async () => {
    // Uses an L1 mission so this exercises the pure XP gate (L0/L1 = XP-only).
    // The L2 gate additionally requires a verified handle (Slice 1) — that
    // XP-AND-verification path is covered in verificationGate.test.ts.
    const g = await makeCreator("leveling-gate@test.local", 0);
    const m = await makeMission({ slug: "test-l1-gate", required_level: "L1" });

    const locked = await req(`/missions/${m.slug}/join`, g.jwt, { method: "POST" });
    expect(locked.status).toBe(409); // level_locked → RPC_409

    await setXp(g.userId, 500); // → L1
    const ok = await req(`/missions/${m.slug}/join`, g.jwt, { method: "POST" });
    expect(ok.status).toBe(200);
  });

  it("tracks level_seen and clears the pending celebration on acknowledge", async () => {
    const d = await makeCreator("leveling-seen@test.local", 0);

    // Fresh creator: level L0, level_seen L0 → nothing pending.
    let me = await (await req("/me", d.jwt)).json();
    expect(me.level).toBe("L0");
    expect(me.level_seen).toBe("L0");

    // Cross to L1: level advances, level_seen lags → pending.
    await setXp(d.userId, 500);
    me = await (await req("/me", d.jwt)).json();
    expect(me.level).toBe("L1");
    expect(me.level_seen).toBe("L0");

    // Acknowledge: level_seen catches up to the current level.
    const ack = await req("/me/level-seen", d.jwt, { method: "POST" });
    expect(ack.status).toBe(200);
    expect((await ack.json()).level_seen).toBe("L1");

    // Idempotent: a second acknowledge is a no-op.
    const ack2 = await req("/me/level-seen", d.jwt, { method: "POST" });
    expect((await ack2.json()).level_seen).toBe("L1");
  });
});
