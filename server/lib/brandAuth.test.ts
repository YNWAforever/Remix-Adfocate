import { describe, it, expect } from "vitest";
import { resolveBrand, acceptBrandInvite, type BrandRow } from "./brandAuth";

// Minimal fake of the supabase query builder used by resolveBrand.
function fakeClient(row: BrandRow | null, error: unknown = null) {
  return {
    from() { return this; },
    select() { return this; },
    eq() { return this; },
    maybeSingle() { return Promise.resolve({ data: row, error }); },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("resolveBrand", () => {
  it("returns the active brand membership row", async () => {
    const row: BrandRow = { user_id: "u1", workspace_id: "w1", email: "a@b.co", role: "owner", active: true };
    expect(await resolveBrand(fakeClient(row), "u1")).toEqual(row);
  });
  it("returns null for a deactivated membership (durable revocation)", async () => {
    const row: BrandRow = { user_id: "u1", workspace_id: "w1", email: "a@b.co", role: "member", active: false };
    expect(await resolveBrand(fakeClient(row), "u1")).toBeNull();
  });
  it("returns null when there is no membership row (no auto-promotion)", async () => {
    expect(await resolveBrand(fakeClient(null), "u1")).toBeNull();
  });
  it("throws on a DB error so the caller can surface 500", async () => {
    await expect(resolveBrand(fakeClient(null, { message: "boom" }), "u1")).rejects.toBeTruthy();
  });
});

// Fake builder capturing brand_invites lookup + brand_users upsert + invite update.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function acceptFakes(opts: { invite: any | null; existing: any | null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calls: any = { upserted: null, accepted: null };
  const client = {
    _t: "",
    from(table: string) { this._t = table; return this; },
    select() { return this; },
    eq() { return this; },
    is() { return this; },
    gt() { return this; },
    order() { return this; },
    limit() { return this; },
    maybeSingle() {
      if (this._t === "brand_users") return Promise.resolve({ data: opts.existing, error: null });
      return Promise.resolve({ data: opts.invite, error: null }); // brand_invites
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    upsert(v: any) { calls.upserted = v; return { select() { return { single: () => Promise.resolve({ data: v, error: null }) }; } }; },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update(v: any) { calls.accepted = v; return { eq: () => Promise.resolve({ error: null }) }; },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { client, calls };
}

describe("acceptBrandInvite", () => {
  const NOW = "2026-06-27T00:00:00.000Z";
  it("links a new brand from a valid invite and stamps accepted_at", async () => {
    const invite = { id: "i1", email: "brand@x.co", workspace_id: "w1", role: "owner" };
    const { client, calls } = acceptFakes({ invite, existing: null });
    const res = await acceptBrandInvite(client, { userId: "u1", email: "brand@x.co", now: NOW });
    expect(res).toEqual({ userId: "u1", email: "brand@x.co", workspaceId: "w1", role: "owner" });
    expect(calls.upserted).toMatchObject({ user_id: "u1", workspace_id: "w1", role: "owner", active: true });
    expect(calls.accepted).toMatchObject({ accepted_at: NOW });
  });
  it("returns the existing membership for a returning brand (no invite needed)", async () => {
    const existing = { user_id: "u1", workspace_id: "w9", email: "brand@x.co", role: "member", active: true };
    const { client } = acceptFakes({ invite: null, existing });
    const res = await acceptBrandInvite(client, { userId: "u1", email: "brand@x.co", now: NOW });
    expect(res).toEqual({ userId: "u1", email: "brand@x.co", workspaceId: "w9", role: "member" });
  });
  it("returns null when there is neither an invite nor a membership", async () => {
    const { client } = acceptFakes({ invite: null, existing: null });
    expect(await acceptBrandInvite(client, { userId: "u1", email: "brand@x.co", now: NOW })).toBeNull();
  });
});
