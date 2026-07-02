/** Pure Academy authoring rules — no DB, no I/O, no `new Date()`. Mirrors contentAuthoring.ts.
 *  LEVEL_IDS mirrors LEVELS in src/lib/levels.ts; required_level MUST be a canonical id because
 *  levelIndex() fails OPEN (unknown id → 0 → ungated), so a bad value silently unlocks a gate. */

export const ACADEMY_KINDS = ["guide_doc", "track", "playbook", "resource"] as const;
export type AcademyKind = (typeof ACADEMY_KINDS)[number];

export const ACADEMY_STATUSES = ["draft", "published", "archived"] as const;
export type AcademyStatus = (typeof ACADEMY_STATUSES)[number];

export const LEVEL_IDS = ["L0", "L1", "L2", "L3", "L4", "L5", "L6"] as const;

export const MAX_TITLE = 200;
export const MAX_EXCERPT = 500;
export const MAX_BODY = 50_000;

export type AcademyInput = {
  kind: AcademyKind;
  slug?: string;
  title_zh: string;
  title_en?: string | null;
  excerpt_zh?: string | null;
  excerpt_en?: string | null;
  body_zh?: string | null;
  body_en?: string | null;
  category?: string | null;
  required_level?: string | null;
  emoji?: string | null;
  color?: string | null;
  sort?: number | null;
  metadata?: Record<string, unknown> | null;
};
export type AcademyEditInput = Partial<AcademyInput>;

function lenErr(v: unknown, max: number, label: string): string | null {
  if (typeof v !== "string") return null;
  return v.length > max ? `${label}不可超過 ${max} 字` : null;
}

function levelErr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return (LEVEL_IDS as readonly string[]).includes(v as string) ? null : "請選擇有效的等級";
}

export function validateAcademyInput(input: AcademyInput): { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!(ACADEMY_KINDS as readonly string[]).includes(input.kind)) errors.kind = "請選擇有效的內容類型";
  if (!input.title_zh || !input.title_zh.trim()) errors.title_zh = "請輸入中文標題";
  const te = lenErr(input.title_zh, MAX_TITLE, "標題"); if (te) errors.title_zh = te;
  const xe = lenErr(input.excerpt_zh, MAX_EXCERPT, "摘要"); if (xe) errors.excerpt_zh = xe;
  const be = lenErr(input.body_zh, MAX_BODY, "內文"); if (be) errors.body_zh = be;
  const le = levelErr(input.required_level); if (le) errors.required_level = le;
  return { errors };
}

export function validateAcademyEdit(input: AcademyEditInput): { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const has = (k: keyof AcademyEditInput) => Object.prototype.hasOwnProperty.call(input, k);
  if (has("kind") && !(ACADEMY_KINDS as readonly string[]).includes(input.kind as string)) errors.kind = "請選擇有效的內容類型";
  if (has("title_zh") && (!input.title_zh || !input.title_zh.trim())) errors.title_zh = "請輸入中文標題";
  if (has("title_zh")) { const e = lenErr(input.title_zh, MAX_TITLE, "標題"); if (e) errors.title_zh = e; }
  if (has("excerpt_zh")) { const e = lenErr(input.excerpt_zh, MAX_EXCERPT, "摘要"); if (e) errors.excerpt_zh = e; }
  if (has("body_zh")) { const e = lenErr(input.body_zh, MAX_BODY, "內文"); if (e) errors.body_zh = e; }
  if (has("required_level")) { const e = levelErr(input.required_level); if (e) errors.required_level = e; }
  return { errors };
}
