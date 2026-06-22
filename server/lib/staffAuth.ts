import type { SupabaseClient } from "@supabase/supabase-js";

/** Authenticated admin identity set on the Hono context by requireStaff.
 *  viaSecret === true means the break-glass shared secret was used (no real user). */
export type StaffIdentity = { userId: string | null; email: string; viaSecret?: boolean };

/** Hono Env for the admin sub-apps (separate from the creator Env in server/app.ts). */
export type AdminEnv = { Variables: { staff: StaffIdentity } };

export type StaffUser = { user_id: string; email: string; active: boolean; created_at: string };

/** Parse STAFF_EMAIL_ALLOWLIST (comma-separated) into a lowercased Set. Pure. */
export function parseAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Resolve a Supabase user to a staff identity:
 *  1. existing row → active row returns it; a deactivated (active=false) row returns null
 *     (durable revocation — never auto-reactivated, even if still allow-listed);
 *  2. else (no row) email ∈ STAFF_EMAIL_ALLOWLIST → upsert + return (first-login auto-promotion);
 *  3. else null.
 * Thin DB glue; throws on a DB error so the caller can surface 500.
 */
export async function resolveStaff(
  svc: SupabaseClient,
  userId: string,
  email: string | null,
): Promise<StaffUser | null> {
  const { data: existing, error } = await svc
    .from("staff_users")
    .select("user_id, email, active, created_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  // A row that exists is authoritative: an explicitly deactivated (active=false) row is a
  // durable revocation and must NOT be auto-reactivated, even if the email is still in the
  // allowlist. Only a brand-new user (no row at all) is auto-promoted below.
  if (existing) return (existing as StaffUser).active ? (existing as StaffUser) : null;

  const lower = email?.toLowerCase() ?? "";
  if (lower && parseAllowlist(process.env.STAFF_EMAIL_ALLOWLIST).has(lower)) {
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
