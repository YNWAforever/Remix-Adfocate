import type { SupabaseClient } from "@supabase/supabase-js";

/** Mirrors private.creator_is_trusted (migration 0017). Keep this constant in sync.
 *  SQL: select xp >= 2000 and exists (owner_verified handle) */
export const TRUSTED_XP_THRESHOLD = 2000;

const LEVEL_IDS = ["L0", "L1", "L2", "L3", "L4", "L5", "L6"];

function ordinal(level: string | null | undefined): number {
  const i = LEVEL_IDS.indexOf(level ?? "L0");
  return i < 0 ? 0 : i;
}

/** Cap the displayed/gating level at L1 until the creator is trusted.
 *  Mirrors: trusted ? raw_level : min(raw_level, L1) */
export function effectiveLevel(rawLevel: string | null | undefined, trusted: boolean): string {
  const idx = ordinal(rawLevel);
  return trusted ? LEVEL_IDS[idx] : LEVEL_IDS[Math.min(idx, 1)];
}

/** XP >= threshold AND >= 1 owner_verified handle.
 *  Uses whatever client is passed (user client is fine — RLS self-select exposes
 *  the caller's own creator_social_accounts rows). */
export async function isTrusted(
  supabase: SupabaseClient,
  creatorId: string,
  xp: number | null | undefined,
): Promise<boolean> {
  if ((xp ?? 0) < TRUSTED_XP_THRESHOLD) return false;
  const { count, error } = await supabase
    .from("creator_social_accounts")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", creatorId)
    .eq("owner_verified", true);
  if (error) throw error;
  return (count ?? 0) >= 1;
}
