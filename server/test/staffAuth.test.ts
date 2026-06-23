import { describe, expect, it } from "vitest";
import { emailDomain, isStaffEmail, parseAllowlist, parseDomains, resolveStaff, type StaffUser } from "../lib/staffAuth";
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

describe("parseDomains", () => {
  it("defaults to fimmick.com when unset/blank", () => {
    expect(parseDomains(undefined).has("fimmick.com")).toBe(true);
    expect(parseDomains("").has("fimmick.com")).toBe(true);
    expect(parseDomains("   ").has("fimmick.com")).toBe(true);
    expect(parseDomains(undefined).size).toBe(1);
  });

  it("splits on commas, trims, lowercases, strips a leading @, drops blanks", () => {
    const set = parseDomains("  @Fimmick.com , kocmax.io ,, ");
    expect(set.has("fimmick.com")).toBe(true);
    expect(set.has("kocmax.io")).toBe(true);
    expect(set.size).toBe(2);
  });
});

describe("emailDomain", () => {
  it("returns the lowercased domain part", () => {
    expect(emailDomain("Alice@Fimmick.com")).toBe("fimmick.com");
  });
  it("returns '' for malformed addresses (no @, trailing @, leading @)", () => {
    expect(emailDomain("nope")).toBe("");
    expect(emailDomain("trailing@")).toBe("");
    expect(emailDomain("@leading.com")).toBe("");
  });
});

describe("isStaffEmail", () => {
  const ALLOW = "STAFF_EMAIL_ALLOWLIST";
  const DOM = "STAFF_EMAIL_DOMAINS";
  it("matches any verified email on the default fimmick.com domain", () => {
    delete process.env[ALLOW];
    delete process.env[DOM];
    expect(isStaffEmail("anyone@fimmick.com", true)).toBe(true);
    expect(isStaffEmail("Anyone@Fimmick.com", true)).toBe(true);
  });
  it("rejects an unverified email even on a staff domain", () => {
    delete process.env[ALLOW];
    delete process.env[DOM];
    expect(isStaffEmail("anyone@fimmick.com", false)).toBe(false);
  });
  it("rejects a verified email on a non-staff domain unless allow-listed", () => {
    delete process.env[ALLOW];
    delete process.env[DOM];
    expect(isStaffEmail("stranger@gmail.com", true)).toBe(false);
    process.env[ALLOW] = "stranger@gmail.com";
    expect(isStaffEmail("Stranger@gmail.com", true)).toBe(true);
    delete process.env[ALLOW];
  });
  it("rejects null/empty email", () => {
    expect(isStaffEmail(null, true)).toBe(false);
    expect(isStaffEmail("", true)).toBe(false);
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
  const DOM = "STAFF_EMAIL_DOMAINS";
  it("returns the existing active staff row", async () => {
    const out = await resolveStaff(stubClient({ existing: ROW }), "u1", "a@fimmick.com");
    expect(out).toEqual(ROW);
  });

  it("returns null when no row and email neither allow-listed nor on a staff domain", async () => {
    delete process.env[ALLOW];
    delete process.env[DOM];
    const out = await resolveStaff(stubClient({ existing: null }), "u9", "stranger@gmail.com", true);
    expect(out).toBeNull();
  });

  it("auto-promotes an allow-listed email with no row (upsert)", async () => {
    delete process.env[DOM];
    process.env[ALLOW] = "new@example.com";
    const calls: { upserted?: unknown } = {};
    const promoted: StaffUser = { user_id: "u2", email: "new@example.com", active: true, created_at: "x" };
    const out = await resolveStaff(stubClient({ existing: null, upsertResult: promoted, calls }), "u2", "New@Example.com", true);
    expect(out).toEqual(promoted);
    expect(calls.upserted).toMatchObject({ user_id: "u2", email: "new@example.com", active: true });
    delete process.env[ALLOW];
  });

  it("auto-promotes any verified @fimmick.com email by domain (no allowlist needed)", async () => {
    delete process.env[ALLOW];
    delete process.env[DOM];
    const calls: { upserted?: unknown } = {};
    const promoted: StaffUser = { user_id: "u4", email: "ada@fimmick.com", active: true, created_at: "x" };
    const out = await resolveStaff(stubClient({ existing: null, upsertResult: promoted, calls }), "u4", "Ada@Fimmick.com", true);
    expect(out).toEqual(promoted);
    expect(calls.upserted).toMatchObject({ user_id: "u4", email: "ada@fimmick.com", active: true });
  });

  it("does NOT promote a domain match when the email is unverified (no upsert)", async () => {
    delete process.env[ALLOW];
    delete process.env[DOM];
    const calls: { upserted?: unknown } = {};
    const out = await resolveStaff(stubClient({ existing: null, calls }), "u5", "spoofed@fimmick.com", false);
    expect(out).toBeNull();
    expect(calls.upserted).toBeUndefined();
  });

  it("returns null when email is null and no row", async () => {
    delete process.env[ALLOW];
    delete process.env[DOM];
    const out = await resolveStaff(stubClient({ existing: null }), "u3", null, true);
    expect(out).toBeNull();
  });

  it("does not auto-reactivate an explicitly deactivated row, even if on a staff domain", async () => {
    delete process.env[ALLOW];
    delete process.env[DOM];
    const out = await resolveStaff(stubClient({ existing: { ...ROW, active: false } }), "u1", "a@fimmick.com", true);
    expect(out).toBeNull();
  });
});
