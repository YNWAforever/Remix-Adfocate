import { FIXTURE_WORKSPACE_SLUG } from "./helpers";
import { fixtureName } from "./helpers";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createFixtureStaffApp as createApp } from "./fixtureStaffTransport";
import { makeCreator, makeGift, addCodes, cleanup, hasSupabaseEnv } from "./helpers";

process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || "test-admin-secret";
const ADMIN_SECRET = process.env.ADMIN_SECRET;

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function req(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "X-Workspace-Slug": FIXTURE_WORKSPACE_SLUG,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}
function adminreq(path: string, init: RequestInit = {}, secret = ADMIN_SECRET) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { "x-admin-secret": secret, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

suite("redemption", () => {
  let koc: { userId: string; jwt: string };
  let gift: { id: string; name: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator(fixtureName("redeem@test.local"), 500);
    gift = await makeGift({ name: fixtureName("test-gift-redeem"), points_cost: 200 });
    await addCodes(gift.id, ["CODE-A", "CODE-B"]);
  });
  afterAll(cleanup);

  it("redeems a gift: returns a code, deducts points, records a redemption", async () => {
    const res = await req("/redemption/redeem", koc.jwt, {
      method: "POST",
      body: JSON.stringify({ gift_id: gift.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(["CODE-A", "CODE-B"]).toContain(body.code);
    expect(body.points_spent).toBe(200);
    expect(body.status).toBe("fulfilled");

    const bal = await req("/wallet/points", koc.jwt);
    expect((await bal.json()).balance).toBe(300); // 500 - 200

    const hist = await req("/redemption/history", koc.jwt);
    const { redemptions } = await hist.json();
    expect(redemptions).toHaveLength(1);
    expect(redemptions[0].redemption_gifts.name).toBe(fixtureName("test-gift-redeem"));
  });

  it("a second redeem claims a DISTINCT code", async () => {
    const res = await req("/redemption/redeem", koc.jwt, {
      method: "POST",
      body: JSON.stringify({ gift_id: gift.id }),
    });
    expect(res.status).toBe(200);
    const hist = await req("/redemption/history", koc.jwt);
    const codes = (await hist.json()).redemptions.map((r: { code: string }) => r.code);
    expect(new Set(codes).size).toBe(2);
    expect(codes).toContain("CODE-A");
    expect(codes).toContain("CODE-B");
  });

  it("rejects redeem when the pool is empty (out_of_stock)", async () => {
    const res = await req("/redemption/redeem", koc.jwt, {
      method: "POST",
      body: JSON.stringify({ gift_id: gift.id }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("out_of_stock");
  });

  it("rejects redeem with insufficient points", async () => {
    const poor = await makeCreator(fixtureName("poor@test.local"), 50);
    const g2 = await makeGift({ name: fixtureName("test-gift-pricey"), points_cost: 1000 });
    await addCodes(g2.id, ["PRICEY-1"]);
    const res = await req("/redemption/redeem", poor.jwt, {
      method: "POST",
      body: JSON.stringify({ gift_id: g2.id }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("insufficient_points");
  });

  it("404s an unknown gift id", async () => {
    const res = await req("/redemption/redeem", koc.jwt, {
      method: "POST",
      body: JSON.stringify({ gift_id: "00000000-0000-0000-0000-0000000000ff" }),
    });
    expect(res.status).toBe(404);
  });
});

suite("admin add-codes", () => {
  let gift: { id: string; name: string };
  beforeAll(async () => {
    await cleanup();
    gift = await makeGift({ name: fixtureName("test-gift-pool"), points_cost: 100 });
  });
  afterAll(cleanup);

  it("loads a code pool and bumps stock so a KOC can redeem", async () => {
    const res = await adminreq(`/admin/gifts/${gift.id}/codes`, {
      method: "POST",
      body: JSON.stringify({ codes: ["X1", "X2", "X3"] }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).added).toBe(3);

    const koc = await makeCreator(fixtureName("pool@test.local"), 500);
    const r = await req("/redemption/redeem", koc.jwt, {
      method: "POST",
      body: JSON.stringify({ gift_id: gift.id }),
    });
    expect(r.status).toBe(200);
  });

  it("rejects loading a duplicate code into the same gift pool (409)", async () => {
    const g = await makeGift({ name: fixtureName("test-gift-dup"), points_cost: 100 });
    const first = await adminreq(`/admin/gifts/${g.id}/codes`, {
      method: "POST",
      body: JSON.stringify({ codes: ["DUP-1"] }),
    });
    expect(first.status).toBe(200);
    const second = await adminreq(`/admin/gifts/${g.id}/codes`, {
      method: "POST",
      body: JSON.stringify({ codes: ["DUP-1"] }),
    });
    expect(second.status).toBe(409);
    expect((await second.json()).code).toBe("duplicate_codes");
  });

  it("rejects add-codes without the admin secret", async () => {
    const res = await adminreq(`/admin/gifts/${gift.id}/codes`, {
      method: "POST",
      body: JSON.stringify({ codes: ["Y1"] }),
    }, "");
    expect(res.status).toBe(401);
  });
});
