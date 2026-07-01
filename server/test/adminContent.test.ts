import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { cleanup, hasSupabaseEnv } from "./helpers";

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

suite("adminContent lifecycle", () => {
  let id = "";
  beforeAll(cleanup);
  afterAll(cleanup);

  it("create → draft with generated slug", async () => {
    const res = await adminreq("/admin/content", { method: "POST", body: JSON.stringify({ kind: "article", title_zh: "夏日防曬攻略", body_zh: "" }) });
    expect(res.status).toBe(201);
    const { item } = await res.json();
    id = item.id;
    expect(item.status).toBe("draft");
    expect(item.slug.length).toBeGreaterThan(0);
  });

  it("publish fails without a body, succeeds after editing one in", async () => {
    expect((await adminreq(`/admin/content/${id}/publish`, { method: "POST" })).status).toBe(422);
    await adminreq(`/admin/content/${id}`, { method: "PATCH", body: JSON.stringify({ body_zh: "內容" }) });
    const ok = await adminreq(`/admin/content/${id}/publish`, { method: "POST" });
    expect(ok.status).toBe(200);
    expect((await ok.json()).item.status).toBe("published");
  });

  it("rejects an illegal transition (published→scheduled)", async () => {
    const res = await adminreq(`/admin/content/${id}/schedule`, { method: "POST", body: JSON.stringify({ scheduled_for: new Date(Date.now() + 3600_000).toISOString() }) });
    expect(res.status).toBe(409);
  });

  it("blocks hard-delete of a published row", async () => {
    expect((await adminreq(`/admin/content/${id}`, { method: "DELETE" })).status).toBe(409);
  });

  it("401s without the secret/JWT", async () => {
    expect((await app.request("/api/admin/content")).status).toBe(401);
  });
});

suite("adminContent audience", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("defaults to 'creator' when omitted, and can be set + edited to 'brand'", async () => {
    const res = await adminreq("/admin/content", { method: "POST", body: JSON.stringify({ kind: "article", title_zh: "預設受眾", body_zh: "" }) });
    expect(res.status).toBe(201);
    const { item } = await res.json();
    expect(item.audience).toBe("creator");

    const patch = await adminreq(`/admin/content/${item.id}`, { method: "PATCH", body: JSON.stringify({ audience: "brand" }) });
    expect(patch.status).toBe(200);
    expect((await patch.json()).item.audience).toBe("brand");

    const created = await adminreq("/admin/content", { method: "POST", body: JSON.stringify({ kind: "article", title_zh: "品牌指南", body_zh: "", audience: "brand" }) });
    expect(created.status).toBe(201);
    expect((await created.json()).item.audience).toBe("brand");
  });
});
