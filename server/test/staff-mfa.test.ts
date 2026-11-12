import { describe, expect, it } from "vitest";
import { decodeJwtClaims, isAal2, staffMfaPending, staffMfaRequired } from "../lib/staffMfa";

function token(claims: Record<string, unknown>) {
  return `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
}

describe("staff MFA policy", () => {
  it("is opt-in", () => {
    expect(staffMfaRequired({})).toBe(false);
    expect(staffMfaRequired({ STAFF_MFA_REQUIRED: "1" })).toBe(false);
    expect(staffMfaRequired({ STAFF_MFA_REQUIRED: "true" })).toBe(true);
  });

  it("reads the verified JWT claims without throwing on malformed tokens", () => {
    expect(decodeJwtClaims(token({ aal: "aal2" }))).toMatchObject({ aal: "aal2" });
    expect(decodeJwtClaims("not-a-jwt")).toEqual({});
    expect(decodeJwtClaims("a.!!!.c")).toEqual({});
  });

  it("treats aal2 or an MFA amr method as satisfied", () => {
    expect(isAal2({ aal: "aal2" })).toBe(true);
    expect(isAal2({ aal: "aal1", amr: [{ method: "totp" }] })).toBe(true);
    expect(isAal2({ aal: "aal1", amr: [{ method: "password" }] })).toBe(false);
    expect(isAal2({})).toBe(false);
  });

  it("only pends a real staff session when enforcement is on", () => {
    const staff = { userId: "staff-1" };
    const aal1 = token({ aal: "aal1" });
    const aal2 = token({ aal: "aal2" });
    expect(staffMfaPending(staff, aal1, {})).toBe(false);
    expect(staffMfaPending(staff, aal1, { STAFF_MFA_REQUIRED: "true" })).toBe(true);
    expect(staffMfaPending(staff, aal2, { STAFF_MFA_REQUIRED: "true" })).toBe(false);
    expect(staffMfaPending({ userId: "secret", viaSecret: true }, aal1, { STAFF_MFA_REQUIRED: "true" })).toBe(false);
    expect(staffMfaPending(null, aal1, { STAFF_MFA_REQUIRED: "true" })).toBe(false);
  });
});
