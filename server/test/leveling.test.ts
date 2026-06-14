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
    const g = await makeCreator("leveling-gate@test.local", 0);
    const m = await makeMission({ slug: "test-l2-only", required_level: "L2" });

    const locked = await req(`/missions/${m.slug}/join`, g.jwt, { method: "POST" });
    expect(locked.status).toBe(409); // level_locked → RPC_409

    await setXp(g.userId, 2000); // → L2
    const ok = await req(`/missions/${m.slug}/join`, g.jwt, { method: "POST" });
    expect(ok.status).toBe(200);
  });
});
