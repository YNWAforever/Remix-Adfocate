import { describe, it, expect, vi, beforeEach } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("../lib/supabase.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/supabase.js")>();
  return { ...actual, serviceClient: () => ({ rpc: rpcMock }) };
});

process.env.CRON_SECRET = process.env.CRON_SECRET || "test-cron-secret";
const { createApp } = await import("../app");   // import AFTER the mock is registered
const { app } = createApp();
const SECRET = process.env.CRON_SECRET;
const authed = () => app.request("/api/cron/daily", { headers: { Authorization: `Bearer ${SECRET}` } });

describe("cron /daily", () => {
  beforeEach(() => rpcMock.mockReset());

  it("401s without the secret", async () => {
    expect((await app.request("/api/cron/daily")).status).toBe(401);
  });
  it("401s with a wrong secret", async () => {
    expect((await app.request("/api/cron/daily", { headers: { Authorization: "Bearer nope" } })).status).toBe(401);
  });
  it("runs all three tasks and returns their counts with no errors", async () => {
    rpcMock.mockImplementation((name: string) => Promise.resolve({
      data: name === "content_publish_scheduled" ? 3 : name === "snapshot_campaign_leaderboards" ? 5 : 2,
      error: null,
    }));
    const res = await authed();
    expect(res.status).toBe(200);
    const body = await res.json() as { published: number; snapshotted: number; campaignsClosed: number; errors: string[] };
    expect(body).toEqual({ published: 3, snapshotted: 5, campaignsClosed: 2, errors: [] });
    // snapshot must be called before close (capture final pre-close ranks)
    const order = rpcMock.mock.calls.map((c) => c[0]);
    expect(order.indexOf("snapshot_campaign_leaderboards")).toBeLessThan(order.indexOf("close_due_campaigns"));
  });
  it("isolates a failing task: close fails, publish + snapshot still succeed (HTTP 200)", async () => {
    rpcMock.mockImplementation((name: string) =>
      name === "close_due_campaigns"
        ? Promise.resolve({ data: null, error: { message: "boom" } })
        : Promise.resolve({ data: 1, error: null }));
    const res = await authed();
    expect(res.status).toBe(200);
    const body = await res.json() as { published: number | null; snapshotted: number | null; campaignsClosed: number | null; errors: string[] };
    expect(body.published).toBe(1);
    expect(body.snapshotted).toBe(1);
    expect(body.campaignsClosed).toBeNull();
    expect(body.errors.some((e) => e.startsWith("close:"))).toBe(true);
  });
});
