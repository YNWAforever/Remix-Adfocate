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

export function validateMission(
  input: MissionInput,
  mode: "draft" | "publish",
  today?: string,
): ValidationResult {
  const errors: Record<string, string> = {};

  // Required in BOTH modes (mission_type is NOT NULL with no default in the DB).
  if (!nonEmpty(input.workspace_id)) errors.workspace_id = "請選擇品牌 workspace";
  if (!nonEmpty(input.title)) errors.title = "請輸入任務標題";
  if (!isValidSlug(input.slug)) errors.slug = "Slug 須為小寫英數字與連字號（a-z0-9-）";
  if (!input.mission_type || !MISSION_TYPES.includes(input.mission_type as MissionType)) {
    errors.mission_type = "請選擇任務類型";
  }

  if (mode === "publish") {
    if (!nonEmpty(input.description)) errors.description = "發佈前請輸入任務簡介";
    if (!nonEmpty(input.category)) errors.category = "請選擇任務分類";
    if (!input.access_type || !ACCESS_TYPES.includes(input.access_type as (typeof ACCESS_TYPES)[number])) {
      errors.access_type = "請選擇參與方式";
    }
    if (!input.required_level || !MISSION_LEVELS.includes(input.required_level as (typeof MISSION_LEVELS)[number])) {
      errors.required_level = "請選擇等級要求";
    }
    if (!Number.isInteger(input.quota) || num(input.quota) < 1) errors.quota = "名額須為 1 或以上";
    if (!today) errors.deadline = "缺少截止日期基準";
    else if (!input.deadline || input.deadline < today) errors.deadline = "截止日期須為今天或之後";

    // Reward-by-type. Only performance_cpm differs; the rest are "points and/or cash".
    if (input.mission_type === "performance_cpm") {
      if (!(num(input.cpm_rate) > 0 && num(input.cpm_budget_pool) > 0)) {
        errors.cpm_rate = "CPM 任務須設定 CPM 單價與預算池（均大於 0）";
      }
    } else if (!errors.mission_type) {
      if (!(num(input.points_reward) > 0 || num(input.cash_reward) > 0)) {
        errors.points_reward = "請設定積分或現金獎勵（至少一項大於 0）";
      }
    }
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

const LOCKED_ON_ENGAGEMENT = [
  "points_reward", "cash_reward", "cpm_rate", "cpm_budget_pool", "access_type", "required_level",
] as const;

export function validateEdit(
  existing: MissionRecord,
  patch: MissionInput,
  hasEngagement: boolean,
): ValidationResult {
  const errors: Record<string, string> = {};
  const has = (k: keyof MissionInput) => Object.prototype.hasOwnProperty.call(patch, k);

  // Format checks — apply to any status.
  if (has("slug") && !isValidSlug(patch.slug)) errors.slug = "Slug 須為小寫英數字與連字號（a-z0-9-）";
  if (has("mission_type") && !MISSION_TYPES.includes(patch.mission_type as MissionType)) {
    errors.mission_type = "任務類型無效";
  }
  if (has("required_level") && !MISSION_LEVELS.includes(patch.required_level as (typeof MISSION_LEVELS)[number])) {
    errors.required_level = "等級要求無效";
  }
  if (has("access_type") && !ACCESS_TYPES.includes(patch.access_type as (typeof ACCESS_TYPES)[number])) {
    errors.access_type = "參與方式無效";
  }
  if (has("effort") && patch.effort != null && !EFFORTS.includes(patch.effort as (typeof EFFORTS)[number])) {
    errors.effort = "投入程度無效";
  }
  if (has("quota") && (!Number.isInteger(patch.quota) || num(patch.quota) < 1)) {
    errors.quota = "名額須為 1 或以上";
  }

  // Frozen at publish (independent of engagement).
  if (existing.status !== "draft") {
    if (has("slug") && patch.slug !== existing.slug) errors.slug = "已發佈：Slug 不可更改";
    if (has("mission_type") && patch.mission_type !== existing.mission_type) {
      errors.mission_type = "已發佈：任務類型不可更改";
    }
  }

  // Locked / constrained on engagement.
  if (hasEngagement) {
    for (const f of LOCKED_ON_ENGAGEMENT) {
      if (has(f) && !sameNullable(patch[f], existing[f])) errors[f] = "已有創作者參與：此欄位已鎖定";
    }
    if (has("quota") && !errors.quota) {
      const floor = Math.max(num(existing.quota), num(existing.filled));
      if (num(patch.quota) < floor) errors.quota = `名額不可低於 ${floor}（現有名額／已參與人數）`;
    }
    if (has("deadline") && patch.deadline != null && existing.deadline != null && patch.deadline < existing.deadline) {
      errors.deadline = "已有創作者參與：截止日期只可延後";
    }
  }

  return { ok: Object.keys(errors).length === 0, errors };
}
