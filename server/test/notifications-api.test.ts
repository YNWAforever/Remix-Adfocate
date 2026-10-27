import { FIXTURE_WORKSPACE_SLUG } from "./helpers";
import { fixtureName } from "./helpers";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { hasSupabaseEnv, serviceForTests, makeCreator, cleanup, DEMO_WS } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function req(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, "X-Workspace-Slug": FIXTURE_WORKSPACE_SLUG, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

async function seedNotif(userId: string, type: string, read = false) {
  const { data, error } = await serviceForTests().from("notifications")
    .insert({ user_id: userId, workspace_id: DEMO_WS, type, data: { mission_title: "X", mission_slug: "x" }, read_at: read ? new Date().toISOString() : null })
    .select("id").single();
  if (error) throw error;
  return data!.id as string;
}

suite("notifications API", () => {
  let koc: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator(fixtureName("notif-api@test.local"), 0);
    await seedNotif(koc.userId, "level_up");
    await seedNotif(koc.userId, "submission_approved");
    await seedNotif(koc.userId, "submission_rejected", true);
  });
  afterAll(cleanup);

  it("lists notifications newest-first with an unread_count", async () => {
    const body = await (await req("/notifications", koc.jwt)).json();
    expect(body.items.length).toBe(3);
    expect(body.unread_count).toBe(2);
  });

  it("unread-count endpoint returns the count", async () => {
    const body = await (await req("/notifications/unread-count", koc.jwt)).json();
    expect(body.count).toBe(2);
  });

  it("marks specific ids read", async () => {
    const id = await seedNotif(koc.userId, "redemption_ready");
    const res = await req("/notifications/read", koc.jwt, { method: "POST", body: JSON.stringify({ ids: [id] }) });
    expect(res.status).toBe(200);
    const after = await (await req("/notifications/unread-count", koc.jwt)).json();
    expect(after.count).toBe(2); // back to 2 (the new unread one is now read)
  });

  it("marks all read", async () => {
    await req("/notifications/read-all", koc.jwt, { method: "POST" });
    const after = await (await req("/notifications/unread-count", koc.jwt)).json();
    expect(after.count).toBe(0);
  });

  it("does not leak another creator's notifications", async () => {
    const other = await makeCreator(fixtureName("notif-api-other@test.local"), 0);
    const body = await (await req("/notifications", other.jwt)).json();
    expect(body.items.length).toBe(0);
  });
});
