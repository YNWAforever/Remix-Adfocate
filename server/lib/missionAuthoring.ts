/** Pure mission-authoring rules — no DB, no I/O, no `new Date()`. The route in
 *  routes/adminMissions.ts feeds it raw rows + an injected HK "today" string; this module
 *  owns slug validation, the publish-readiness matrix, and the edit-lock tiers. Mirrors the
 *  pure-module pattern of lib/missionMatch.ts / lib/hookGen.ts. */

import { normalizePortfolioUrl } from "./profileMedia/service.js";

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

export const MAX_BRIEF_ITEMS = 12;
export const MAX_BRIEF_ITEM_LEN = 200;
export const MAX_AUDIENCE_LEN = 500;
export const MAX_DELIVERABLE_PLATFORM_LEN = 64;

export type PublicationProofRequirementInput = {
  kind: "publication_url";
  allowedPlatforms: string[];
  evidence: "optional";
};

export type DeliverableSpecInput = {
  title: string;
  instructions: string;
  requirements: {
    caption: boolean;
    externalUrl: boolean;
    checklist: string[];
  };
  requiresAsset: boolean;
  proofRequirement: PublicationProofRequirementInput | null;
};

export function normBriefArray(items: string[] | null | undefined): string[] {
  return (items ?? [])
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .slice(0, MAX_BRIEF_ITEMS);
}

export function normAudience(v: string | null | undefined): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  return t === "" ? null : t;
}

export function normalizeBrief(input: MissionInput): {
  target_audience: string | null;
  dos: string[];
  donts: string[];
  key_messages: string[];
  reference_links: string[];
} {
  return {
    target_audience: normAudience(input.target_audience),
    dos: normBriefArray(input.dos),
    donts: normBriefArray(input.donts),
    key_messages: normBriefArray(input.key_messages),
    reference_links: normBriefArray(input.reference_links),
  };
}

// Errors only on PRESENT + invalid brief fields. Absent fields never error (they enrich, not gate).
function briefErrors(input: MissionInput): Record<string, string> {
  const errors: Record<string, string> = {};
  const has = (k: keyof MissionInput) => Object.prototype.hasOwnProperty.call(input, k);

  if (has("target_audience")) {
    const aud = normAudience(input.target_audience);
    if (aud && aud.length > MAX_AUDIENCE_LEN) errors.target_audience = `目標受眾不可超過 ${MAX_AUDIENCE_LEN} 字`;
  }
  for (const f of ["dos", "donts", "key_messages"] as const) {
    if (has(f)) {
      const items = normBriefArray(input[f]);
      if (items.some((x) => x.length > MAX_BRIEF_ITEM_LEN)) errors[f] = `每項不可超過 ${MAX_BRIEF_ITEM_LEN} 字`;
    }
  }
  if (has("reference_links")) {
    const items = normBriefArray(input.reference_links);
    for (const link of items) {
      if (link.length > MAX_BRIEF_ITEM_LEN) { errors.reference_links = `每項不可超過 ${MAX_BRIEF_ITEM_LEN} 字`; break; }
      try { normalizePortfolioUrl(link); } catch { errors.reference_links = "請輸入有效的網址（http 或 https）"; break; }
    }
  }
  return errors;
}

/** First free `<base>-copy`, `<base>-copy-2`, … given the slugs already used in the TARGET workspace. */
export function nextDuplicateSlug(base: string, existingSlugs: string[]): string {
  const used = new Set(existingSlugs);
  const first = `${base}-copy`;
  if (!used.has(first)) return first;
  for (let n = 2; ; n++) {
    const candidate = `${base}-copy-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

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
  deliverableSpecs?: DeliverableSpecInput[];
  requirements?: string[];
  platforms?: string[];
  effort?: string | null;
  target_audience?: string | null;
  dos?: string[];
  donts?: string[];
  key_messages?: string[];
  reference_links?: string[];
};

type DeliverableSpecSource = Pick<MissionInput, "deliverables" | "deliverableSpecs">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeChecklist(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.reduce<string[]>((items, entry) => {
    const item = trimString(entry);
    if (item && !seen.has(item)) {
      seen.add(item);
      items.push(item);
    }
    return items;
  }, []);
}

function normalizeProofRequirement(value: unknown): PublicationProofRequirementInput | null {
  if (!isRecord(value)) return null;
  const allowedPlatforms = Array.isArray(value.allowedPlatforms)
    ? value.allowedPlatforms
      .map((platform) => trimString(platform).toLowerCase())
      .filter(Boolean)
    : [];
  return {
    kind: trimString(value.kind) as PublicationProofRequirementInput["kind"],
    allowedPlatforms,
    evidence: trimString(value.evidence) as PublicationProofRequirementInput["evidence"],
  };
}

/** Normalizes legacy strings into their structured, proof-compatible equivalents. */
export function normalizeDeliverableSpecs(input: DeliverableSpecSource): DeliverableSpecInput[] {
  const source = input.deliverableSpecs ?? input.deliverables ?? [];
  if (!Array.isArray(source)) return [];
  return source.map((item) => {
    if (typeof item === "string") {
      return {
        title: item.trim(),
        instructions: "",
        requirements: { caption: false, externalUrl: false, checklist: [] },
        requiresAsset: false,
        proofRequirement: null,
      };
    }
    const value = isRecord(item) ? item : {};
    const requirements = isRecord(value.requirements) ? value.requirements : {};
    return {
      title: trimString(value.title),
      instructions: trimString(value.instructions),
      requirements: {
        caption: requirements.caption === true,
        externalUrl: requirements.externalUrl === true,
        checklist: normalizeChecklist(requirements.checklist),
      },
      requiresAsset: value.requiresAsset === true,
      proofRequirement: normalizeProofRequirement(value.proofRequirement),
    };
  });
}

/** Stable, database-free validation codes for structured authoring input. */
export function validateDeliverableSpecs(input: unknown): string[] {
  if (!Array.isArray(input)) return ["deliverable_specs.invalid"];
  const errors: string[] = [];
  input.forEach((item, index) => {
    const prefix = `deliverable_specs.${index}`;
    const value = isRecord(item) ? item : {};
    if (!trimString(value.title)) errors.push(`${prefix}.title_required`);
    const requirements = isRecord(value.requirements) ? value.requirements : {};
    if (Array.isArray(requirements.checklist) && requirements.checklist.some((entry) => !trimString(entry))) {
      errors.push(`${prefix}.requirements.checklist_entry_required`);
    }
    if (!Object.prototype.hasOwnProperty.call(value, "proofRequirement") || value.proofRequirement == null) return;
    const proof = isRecord(value.proofRequirement) ? value.proofRequirement : {};
    if (proof.kind !== "publication_url") errors.push(`${prefix}.proof_requirement.kind_invalid`);
    if (proof.evidence !== "optional") errors.push(`${prefix}.proof_requirement.evidence_invalid`);
    if (!Array.isArray(proof.allowedPlatforms) || proof.allowedPlatforms.length === 0 || proof.allowedPlatforms.every((platform) => !trimString(platform))) {
      errors.push(`${prefix}.proof_requirement.allowed_platforms_required`);
    } else if (proof.allowedPlatforms.some((platform) => trimString(platform).length > MAX_DELIVERABLE_PLATFORM_LEN)) {
      errors.push(`${prefix}.proof_requirement.platform_too_long`);
    }
  });
  return errors;
}

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

  Object.assign(errors, briefErrors(input));
  if (input.deliverables && input.deliverableSpecs && input.deliverables.length !== input.deliverableSpecs.length) {
    errors.deliverable_specs = "deliverable_specs.count_mismatch";
  } else if (input.deliverableSpecs) {
    const deliverableErrors = validateDeliverableSpecs(input.deliverableSpecs);
    if (deliverableErrors.length) errors.deliverable_specs = deliverableErrors.join(",");
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

  Object.assign(errors, briefErrors(patch));
  if (patch.deliverables && patch.deliverableSpecs && patch.deliverables.length !== patch.deliverableSpecs.length) {
    errors.deliverable_specs = "deliverable_specs.count_mismatch";
  } else if (patch.deliverableSpecs) {
    const deliverableErrors = validateDeliverableSpecs(patch.deliverableSpecs);
    if (deliverableErrors.length) errors.deliverable_specs = deliverableErrors.join(",");
  }

  return { ok: Object.keys(errors).length === 0, errors };
}
