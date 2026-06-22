import { describe, expect, it } from "vitest";
import { parseAllowlist, resolveStaff, type StaffUser } from "../lib/staffAuth";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("parseAllowlist", () => {
  it("returns an empty set for undefined/empty/whitespace", () => {
    expect(parseAllowlist(undefined).size).toBe(0);
    expect(parseAllowlist("").size).toBe(0);
    expect(parseAllowlist("   ").size).toBe(0);
    expect(parseAllowlist(" , ,").size).toBe(0);
  });

  it("splits on commas, trims, lowercases, drops blanks", () => {
    const set = parseAllowlist("  Alice@Fimmick.com , bob@fimmick.com ,, ");
    expect(set.has("alice@fimmick.com")).toBe(true);
    expect(set.has("bob@fimmick.com")).toBe(true);
    expect(set.size).toBe(2);
  });
});

// Minimal chainable stub: one builder serves both
// .from().select().eq().eq().maybeSingle() and .from().upsert().select().single().
function stubClient(opts: {
  existing?: StaffUser | null;
  upsertResult?: StaffUser;
  calls?: { upserted?: unknown };
}): SupabaseClient {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data: opts.existing ?? null, error: null }),
    upsert: (row: unknown) => {
      if (opts.calls) opts.calls.upserted = row;
      return builder;
    },
    single: () => Promise.resolve({ data: opts.upsertResult ?? null, error: null }),
  });
  return { from: () => builder } as unknown as SupabaseClient;
}

const ROW: StaffUser = { user_id: "u1", email: "a@fimmick.com", active: true, created_at: "2026-01-01T00:00:00Z" };

describe("resolveStaff", () => {
  const ALLOW = "STAFF_EMAIL_ALLOWLIST";
  it("returns the existing active staff row", async () => {
    const out = await resolveStaff(stubClient({ existing: ROW }), "u1", "a@fimmick.com");
    expect(out).toEqual(ROW);
  });

  it("returns null when no row and email not allow-listed", async () => {
    delete process.env[ALLOW];
    const out = await resolveStaff(stubClient({ existing: null }), "u9", "stranger@gmail.com");
    expect(out).toBeNull();
  });

  it("auto-promotes an allow-listed email with no row (upsert)", async () => {
    process.env[ALLOW] = "new@fimmick.com";
    const calls: { upserted?: unknown } = {};
    const promoted: StaffUser = { user_id: "u2", email: "new@fimmick.com", active: true, created_at: "x" };
    const out = await resolveStaff(stubClient({ existing: null, upsertResult: promoted, calls }), "u2", "New@Fimmick.com");
    expect(out).toEqual(promoted);
    expect(calls.upserted).toMatchObject({ user_id: "u2", email: "new@fimmick.com", active: true });
    delete process.env[ALLOW];
  });

  it("returns null when email is null and no row", async () => {
    delete process.env[ALLOW];
    const out = await resolveStaff(stubClient({ existing: null }), "u3", null);
    expect(out).toBeNull();
  });

  it("does not auto-reactivate an explicitly deactivated row, even if allow-listed", async () => {
    process.env[ALLOW] = "a@fimmick.com";
    const out = await resolveStaff(stubClient({ existing: { ...ROW, active: false } }), "u1", "a@fimmick.com");
    expect(out).toBeNull();
    delete process.env[ALLOW];
  });
});
