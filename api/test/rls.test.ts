import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, cleanup } from "./helpers";

const { app } = createApp();
let alice: { userId: string; jwt: string };
let bob: { userId: string; jwt: string };

function call(path: string, jwt: string) {
  return app.request(path, { headers: { Authorization: `Bearer ${jwt}`, "X-Workspace-Slug": "demo" } });
}

beforeAll(async () => {
  await cleanup();
  alice = await makeCreator("alice@test.local", 1250);
  bob = await makeCreator("bob@test.local", 99);
});
afterAll(cleanup);

describe("RLS isolation", () => {
  it("a creator reads only their own balance", async () => {
    const res = await call("/api/wallet/points", alice.jwt);
    expect(res.status).toBe(200);
    expect((await res.json()).balance).toBe(1250);
  });

  it("another creator sees their own balance, never the first's", async () => {
    const res = await call("/api/wallet/points", bob.jwt);
    expect((await res.json()).balance).toBe(99);
  });

  it("missions are readable for the workspace", async () => {
    const res = await call("/api/missions", alice.jwt);
    expect(res.status).toBe(200);
    expect((await res.json()).missions.length).toBe(6);
  });

  it("points history returns an array scoped to the creator", async () => {
    const res = await call("/api/wallet/points/history", alice.jwt);
    expect(res.status).toBe(200);
    expect(Array.isArray((await res.json()).transactions)).toBe(true);
  });
});
