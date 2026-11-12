/** Staff MFA policy and JWT helpers. Pure functions so the rule is testable offline. */

export function staffMfaRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STAFF_MFA_REQUIRED === "true";
}

export type StaffJwtClaims = {
  aal?: string;
  amr?: Array<{ method?: string }>;
};

/** The JWT has already been signature-verified by Supabase; this only reads its claims. */
export function decodeJwtClaims(token: string): StaffJwtClaims {
  try {
    const part = token.split(".")[1];
    if (!part) return {};
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as StaffJwtClaims) : {};
  } catch {
    return {};
  }
}

export function isAal2(claims: StaffJwtClaims): boolean {
  if (claims.aal === "aal2") return true;
  return Array.isArray(claims.amr) && claims.amr.some((entry) => entry?.method === "totp" || entry?.method === "mfa");
}

/** Break-glass identities (no real user) cannot enrol a factor; they stay exempt. */
export function staffMfaPending(
  staff: { userId: string | null; viaSecret?: boolean } | null,
  token: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!staffMfaRequired(env) || staff?.viaSecret || !staff?.userId) return false;
  return !isAal2(decodeJwtClaims(token));
}
