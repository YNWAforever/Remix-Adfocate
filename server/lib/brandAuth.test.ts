import { describe, it, expect } from "vitest";
import { resolveBrand, type BrandRow } from "./brandAuth";

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
