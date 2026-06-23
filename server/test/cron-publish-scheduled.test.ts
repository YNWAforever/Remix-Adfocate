import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { serviceForTests, cleanup, hasSupabaseEnv } from "./helpers";

process.env.CRON_SECRET = process.env.CRON_SECRET || "test-cron-secret";
const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

suite("cron publish-scheduled", () => {
  beforeAll(async () => {
    await cleanup();
    await serviceForTests().from("content_items").insert({
      kind: "announcement", slug: "c1-overdue", status: "scheduled", title_zh: "到期",
      body_zh: "x", scheduled_for: new Date(Date.now() - 60_000).toISOString(),
    });
  });
  afterAll(cleanup);

  it("401s without the secret", async () => {
    expect((await app.request("/api/cron/publish-scheduled")).status).toBe(401);
  });

  it("flips overdue scheduled rows to published", async () => {
    const res = await app.request("/api/cron/publish-scheduled", { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect(res.status).toBe(200);
    const { data } = await serviceForTests().from("content_items").select("status").eq("slug", "c1-overdue").single();
    expect(data!.status).toBe("published");
  });
});
