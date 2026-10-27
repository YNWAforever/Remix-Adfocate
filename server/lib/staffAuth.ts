import type { SupabaseClient } from "@supabase/supabase-js";

/** Authenticated admin identity set on the Hono context by requireStaff.
 *  viaSecret === true means the break-glass shared secret was used (no real user). */
export type StaffIdentity = { userId: string | null; email: string; viaSecret?: boolean; active?: boolean };

/** Hono Env for the admin sub-apps (separate from the creator Env in server/app.ts). */
export type AdminEnv = { Variables: { staff: StaffIdentity; authorizedWorkspace: import("./staffWorkspace.js").AuthorizedWorkspace } };

export type StaffUser = { user_id: string; email: string; active: boolean; created_at: string };

/** Default staff domain — Fimmick's Google Workspace. Any *verified* @fimmick.com user is
 *  auto-promoted to staff with no per-email config. Override/extend via STAFF_EMAIL_DOMAINS. */
const DEFAULT_STAFF_DOMAINS = "fimmick.com";

/** Parse STAFF_EMAIL_ALLOWLIST (comma-separated emails) into a lowercased Set. Pure. */
export function parseAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Parse STAFF_EMAIL_DOMAINS (comma-separated bare domains) into a lowercased Set, tolerating
 *  a leading "@". Falls back to DEFAULT_STAFF_DOMAINS when unset/blank so staff work with zero
 *  config. Pure. */
export function parseDomains(raw: string | undefined): Set<string> {
  const src = raw && raw.trim() ? raw : DEFAULT_STAFF_DOMAINS;
  return new Set(
    src
      .split(",")
      .map((s) => s.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean),
  );
}

/** Lowercased domain part of an email ("Ada@Fimmick.com" → "fimmick.com"), or "" if the
 *  address has no local part or no domain part. Pure. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at > 0 && at < email.length - 1 ? email.slice(at + 1).toLowerCase() : "";
}

/** Whether a *verified* email qualifies for staff auto-promotion: explicitly allow-listed
 *  (STAFF_EMAIL_ALLOWLIST) OR its domain is a staff domain (STAFF_EMAIL_DOMAINS, default
 *  @fimmick.com). An unverified email never qualifies — a session carrying an unconfirmed
 *  @fimmick.com address (e.g. an unconfirmed password signup) must NOT yield admin. Pure. */
export function isStaffEmail(email: string | null, emailVerified: boolean): boolean {
  const lower = email?.toLowerCase() ?? "";
  if (!lower || !emailVerified) return false;
  return (
    parseAllowlist(process.env.STAFF_EMAIL_ALLOWLIST).has(lower) ||
    parseDomains(process.env.STAFF_EMAIL_DOMAINS).has(emailDomain(lower))
  );
}

/**
 * Resolve a Supabase user to a staff identity:
 *  1. existing row → active row returns it; a deactivated (active=false) row returns null
 *     (durable revocation — never auto-reactivated, even if still allow-listed/in-domain);
 *  2. else (no row) a verified email that is allow-listed OR on a staff domain (default
 *     @fimmick.com) → upsert + return (first-login auto-promotion);
 *  3. else null.
 * `emailVerified` should be `!!user.email_confirmed_at` — required so domain-wide access can
 * only be granted to addresses the user has actually proven they control.
 * Thin DB glue; throws on a DB error so the caller can surface 500.
 */
export async function resolveStaff(
  svc: SupabaseClient,
  userId: string,
  email: string | null,
  emailVerified = false,
): Promise<StaffUser | null> {
  const { data: existing, error } = await svc
    .from("staff_users")
    .select("user_id, email, active, created_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  // A row that exists is authoritative: an explicitly deactivated (active=false) row is a
  // durable revocation and must NOT be auto-reactivated, even if the email is still allowed.
  // Only a brand-new user (no row at all) is auto-promoted below.
  if (existing) return (existing as StaffUser).active ? (existing as StaffUser) : null;

  if (isStaffEmail(email, emailVerified)) {
    const lower = (email as string).toLowerCase();
    const { data: upserted, error: upErr } = await svc
      .from("staff_users")
      .upsert({ user_id: userId, email: lower, active: true }, { onConflict: "user_id" })
      .select("user_id, email, active, created_at")
      .single();
    if (upErr) throw upErr;
    return upserted as StaffUser;
  }
  return null;
}
