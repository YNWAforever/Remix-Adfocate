import type { SupabaseClient } from "@supabase/supabase-js";

export type BrandRole = "owner" | "member";
export type BrandRow = { user_id: string; workspace_id: string; email: string; role: BrandRole; active: boolean };

/** Authenticated brand identity set on the Hono context by requireBrand. */
export type BrandIdentity = { userId: string; email: string; workspaceId: string; role: BrandRole };

/** Hono Env for the brand sub-app (separate from creator + admin). */
export type BrandEnv = { Variables: { brand: BrandIdentity } };

/** Resolve a Supabase user to an ACTIVE brand membership. Unlike resolveStaff there is NO
 *  auto-promotion — a brand exists only if invited (a brand_users row was created on accept).
 *  A deactivated (active=false) row is a durable revocation → null. Throws on DB error. */
export async function resolveBrand(svc: SupabaseClient, userId: string): Promise<BrandRow | null> {
  const { data, error } = await svc
    .from("brand_users")
    .select("user_id, workspace_id, email, role, active")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const row = data as BrandRow | null;
  return row && row.active ? row : null;
}
