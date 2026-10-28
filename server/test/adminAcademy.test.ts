import { fixtureName } from "./helpers";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createFixtureStaffApp as createApp } from "./fixtureStaffTransport";
import { serviceForTests, cleanup, hasSupabaseEnv } from "./helpers";

process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || "test-admin-secret";
const SECRET = process.env.ADMIN_SECRET!;
const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function adminreq(path: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { "x-admin-secret": SECRET, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

// academy_content has no cleanup() support yet (see helpers.ts), so this suite removes its own
// test rows by slug directly (same local-scoped pattern as campaigns.test.ts's serviceForTests()
// deletes) in addition to the shared cleanup() for parity with adminContent.test.ts.
async function cleanupAcademyTestRows() {
  await serviceForTests().from("academy_content").delete().in("slug", [fixtureName("t-bad"), fixtureName("r-test-1")]);
}

suite("admin academy CRUD", () => {
  beforeAll(async () => {
    await cleanup();
    await cleanupAcademyTestRows();
  });
  afterAll(async () => {
    await cleanupAcademyTestRows();
    await cleanup();
  });

  it("lists the seeded rows", async () => {
    const res = await adminreq("/admin/academy?kind=track");
    expect(res.status).toBe(200);
    const { items } = await res.json();
    expect(items.length).toBe(9);
  });

  it("rejects a bad required_level with 422", async () => {
    const res = await adminreq("/admin/academy", {
      method: "POST",
      body: JSON.stringify({ kind: "track", slug: "t-bad", title_zh: "x", required_level: "L2+" }),
    });
    expect(res.status).toBe(422);
    const b = await res.json();
    expect(b.fields.required_level).toBeTruthy();
  });

  it("creates → publishes → archives a draft", async () => {
    const create = await adminreq("/admin/academy", {
      method: "POST",
      body: JSON.stringify({ kind: "resource", slug: fixtureName("r-test-1"), title_zh: "測試資源" }),
    });
    expect(create.status).toBe(201);
    const { item } = await create.json();
    const pub = await adminreq(`/admin/academy/${item.id}/publish`, { method: "POST", body: "{}" });
    expect(pub.status).toBe(200);
    expect((await pub.json()).item.status).toBe("published");
    const arch = await adminreq(`/admin/academy/${item.id}/archive`, { method: "POST", body: "{}" });
    expect(arch.status).toBe(200);
  });

  it("409s a duplicate slug", async () => {
    const res = await adminreq("/admin/academy", {
      method: "POST",
      body: JSON.stringify({ kind: "resource", slug: "r1", title_zh: "dup" }),
    });
    expect(res.status).toBe(409);
  });

  it("401s without the secret/JWT", async () => {
    expect((await app.request("/api/admin/academy")).status).toBe(401);
  });
});
