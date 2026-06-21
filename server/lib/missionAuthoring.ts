/** Pure mission-authoring rules — no DB, no I/O, no `new Date()`. The route in
 *  routes/adminMissions.ts feeds it raw rows + an injected HK "today" string; this module
 *  owns slug validation, the publish-readiness matrix, and the edit-lock tiers. Mirrors the
 *  pure-module pattern of lib/missionMatch.ts / lib/hookGen.ts. */

// Mirror of the DB CHECK (0001_init missions.mission_type). Keep in sync with that constraint.
export const MISSION_TYPES = [
  "koc_trial", "ugc", "clipping", "affiliate", "performance_cpm", "live_commerce", "brand_ambassador",
] as const;
export type MissionType = (typeof MISSION_TYPES)[number];

// Canonical level set. DUPLICATED from src/lib/levels.ts (canonical) — do NOT cross-import the
// frontend module into the server bundle (prior ESM cross-tree-import outage). Also the DB
// level_ordinal gate (0005) and server LEVEL_IDS (trust.ts/passport.ts) use exactly L0..L6.
export const MISSION_LEVELS = ["L0", "L1", "L2", "L3", "L4", "L5", "L6"] as const;
export const ACCESS_TYPES = ["open", "application"] as const;
export const EFFORTS = ["low", "medium", "high"] as const;

export type MissionInput = {
  workspace_id?: string | null;
  slug?: string | null;
  title?: string | null;
  mission_type?: string | null;
  description?: string | null;
  category?: string | null;
  access_type?: string | null;
  required_level?: string | null;
  points_reward?: number | null;
  cash_reward?: number | null;
  cpm_rate?: number | null;
  cpm_budget_pool?: number | null;
  deadline?: string | null;
  quota?: number | null;
  deliverables?: string[];
  requirements?: string[];
  platforms?: string[];
  effort?: string | null;
};

// The existing record for an edit, as read from the DB.
export type MissionRecord = MissionInput & {
  status: "draft" | "active" | "closed";
  filled?: number | null;
  quota?: number | null;
};

export type ValidationResult = { ok: boolean; errors: Record<string, string> };

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export function isValidSlug(slug: string | null | undefined): boolean {
  return typeof slug === "string" && SLUG_RE.test(slug);
}

export function suggestSlug(missionType: string): string {
  return missionType.replace(/_/g, "-");
}

// --- internal helpers ---
function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
function num(v: unknown): number {
  return typeof v === "number" && !Number.isNaN(v) ? v : 0;
}
function sameNullable(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return a === b;
}
