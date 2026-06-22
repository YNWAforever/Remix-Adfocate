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
