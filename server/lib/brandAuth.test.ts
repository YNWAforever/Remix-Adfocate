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

// In-memory stand-in for brand_users (keyed by user_id) + a single brand_invites row, enough to
// model the two filters the accept path relies on: the pending-invite lookup and the conditional
// claim (update ... is accepted_at null), which only stamps a still-unclaimed invite.
// `staleRead` makes the lookup see a pending invite that the claim then finds already stamped —
// the read/claim race. `concurrentWinner` materializes a membership after the first read.
function acceptFakes(opts: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invite: any | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  existing: any | null;
  staleRead?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  concurrentWinner?: any;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store: any = {
    users: opts.existing ? { [opts.existing.user_id]: { ...opts.existing } } : {},
    invite: opts.invite ? { accepted_at: null, ...opts.invite } : null,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calls: any = { upserted: null, accepted: null, userReads: 0 };
  const client = {
    _t: "",
    _uid: "",
    from(table: string) { this._t = table; return this; },
    select() { return this; },
    eq(col: string, val: string) { if (col === "user_id") this._uid = val; return this; },
    is() { return this; },
    gt() { return this; },
    order() { return this; },
    limit() { return this; },
    maybeSingle() {
      if (this._t === "brand_users") {
        calls.userReads += 1;
        if (calls.userReads > 1 && opts.concurrentWinner) store.users[opts.concurrentWinner.user_id] = { ...opts.concurrentWinner };
        return Promise.resolve({ data: store.users[this._uid] ?? null, error: null });
      }
      const inv = store.invite; // brand_invites
      return Promise.resolve({ data: inv && (opts.staleRead || inv.accepted_at === null) ? inv : null, error: null });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    upsert(v: any) {
      calls.upserted = v;
      store.users[v.user_id] = { ...v };
      return { select() { return { single: () => Promise.resolve({ data: store.users[v.user_id], error: null }) }; } };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update(v: any) {
      const inv = store.invite;
      const claimed = inv && inv.accepted_at === null ? Object.assign(inv, v) : null;
      if (claimed) calls.accepted = v;
      const chain = {
        eq: () => chain,
        is: () => chain,
        select: () => chain,
        maybeSingle: () => Promise.resolve({ data: claimed, error: null }),
      };
      return chain;
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { client, calls, store };
}

describe("acceptBrandInvite", () => {
  const NOW = "2026-06-27T00:00:00.000Z";
  it("links a new brand from a valid invite and stamps accepted_at", async () => {
    const invite = { id: "i1", email: "brand@x.co", workspace_id: "w1", role: "owner" };
    const { client, calls, store } = acceptFakes({ invite, existing: null });
    const res = await acceptBrandInvite(client, { userId: "u1", email: "brand@x.co", now: NOW });
    expect(res).toEqual({ userId: "u1", email: "brand@x.co", workspaceId: "w1", role: "owner" });
    expect(calls.upserted).toMatchObject({ user_id: "u1", workspace_id: "w1", role: "owner", active: true });
    expect(calls.accepted).toMatchObject({ accepted_at: NOW });
    expect(store.invite.accepted_at).toBe(NOW);
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
  it("denies a deactivated brand user holding a valid pending invite, leaving the row inactive", async () => {
    const existing = { user_id: "u1", workspace_id: "w9", email: "brand@x.co", role: "member", active: false };
    const invite = { id: "i1", email: "brand@x.co", workspace_id: "w1", role: "owner" };
    const { client, calls, store } = acceptFakes({ invite, existing });
    expect(await acceptBrandInvite(client, { userId: "u1", email: "brand@x.co", now: NOW })).toBeNull();
    expect(calls.upserted).toBeNull();
    expect(calls.accepted).toBeNull();
    expect(store.users.u1).toMatchObject({ active: false, workspace_id: "w9", role: "member" });
    expect(store.invite.accepted_at).toBeNull();
  });
  it("cannot consume the same invite twice", async () => {
    const invite = { id: "i1", email: "brand@x.co", workspace_id: "w1", role: "owner" };
    const { client, calls } = acceptFakes({ invite, existing: null });
    await acceptBrandInvite(client, { userId: "u1", email: "brand@x.co", now: NOW });
    calls.upserted = null;
    expect(await acceptBrandInvite(client, { userId: "u2", email: "brand@x.co", now: NOW })).toBeNull();
    expect(calls.upserted).toBeNull();
  });
  it("does not claim an invite already stamped between the lookup and the claim", async () => {
    const invite = { id: "i1", email: "brand@x.co", workspace_id: "w1", role: "owner", accepted_at: NOW };
    const { client, calls } = acceptFakes({ invite, existing: null, staleRead: true });
    expect(await acceptBrandInvite(client, { userId: "u2", email: "brand@x.co", now: NOW })).toBeNull();
    expect(calls.upserted).toBeNull();
  });
  it("returns the membership created by the race winner instead of locking the user out", async () => {
    const invite = { id: "i1", email: "brand@x.co", workspace_id: "w1", role: "owner", accepted_at: NOW };
    const winner = { user_id: "u1", workspace_id: "w1", email: "brand@x.co", role: "owner", active: true };
    const { client, calls } = acceptFakes({ invite, existing: null, staleRead: true, concurrentWinner: winner });
    const res = await acceptBrandInvite(client, { userId: "u1", email: "brand@x.co", now: NOW });
    expect(res).toEqual({ userId: "u1", email: "brand@x.co", workspaceId: "w1", role: "owner" });
    expect(calls.upserted).toBeNull();
  });
});
