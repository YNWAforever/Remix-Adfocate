/** Pure content-authoring rules — no DB, no I/O, no `new Date()`. Mirrors the
 *  pure-module pattern of lib/missionAuthoring.ts. The routes own the clock + DB. */

export const CONTENT_KINDS = ["article", "announcement"] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

export const CONTENT_STATUSES = ["draft", "scheduled", "published", "archived"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const CONTENT_AUDIENCES = ["creator", "brand"] as const;
export type ContentAudience = (typeof CONTENT_AUDIENCES)[number];

export const MAX_TITLE = 200;
export const MAX_EXCERPT = 500;
export const MAX_BODY = 50_000;

export type ContentInput = {
  kind: ContentKind;
  audience?: ContentAudience;
  slug?: string;
  title_zh: string;
  title_en?: string | null;
  excerpt_zh?: string | null;
  excerpt_en?: string | null;
  body_zh: string;
  body_en?: string | null;
  cover_image_url?: string | null;
  category_id?: string | null;
  pinned?: boolean;
  pinned_rank?: number | null;
};
export type ContentEditInput = Partial<ContentInput>;

/** URL-safe slug. ASCII fallback keeps non-Latin titles from collapsing to "". */
export function slugify(input: string): string {
  const base = (input ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `post-${(input ?? "").length}`;
}

export function uniqueSlug(base: string, existing: string[]): string {
  const used = new Set(existing);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

function lenErr(v: unknown, max: number, label: string): string | null {
  if (typeof v !== "string") return null;
  return v.length > max ? `${label}不可超過 ${max} 字` : null;
}

export function validateContentInput(input: ContentInput): { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!CONTENT_KINDS.includes(input.kind as ContentKind)) errors.kind = "請選擇有效的內容類型";
  if (input.audience !== undefined && !CONTENT_AUDIENCES.includes(input.audience as ContentAudience))
    errors.audience = "請選擇有效的受眾對象";
  if (!input.title_zh || !input.title_zh.trim()) errors.title_zh = "請輸入中文標題";
  const titleErr = lenErr(input.title_zh, MAX_TITLE, "標題");
  if (titleErr) errors.title_zh = titleErr;
  const e1 = lenErr(input.excerpt_zh, MAX_EXCERPT, "摘要"); if (e1) errors.excerpt_zh = e1;
  const b1 = lenErr(input.body_zh, MAX_BODY, "內文"); if (b1) errors.body_zh = b1;
  const b2 = lenErr(input.body_en, MAX_BODY, "內文"); if (b2) errors.body_en = b2;
  return { errors };
}

/** Edit validation only errors on fields actually PRESENT in the patch. */
export function validateContentEdit(input: ContentEditInput): { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const has = (k: keyof ContentEditInput) => Object.prototype.hasOwnProperty.call(input, k);
  if (has("kind") && !CONTENT_KINDS.includes(input.kind as ContentKind)) errors.kind = "請選擇有效的內容類型";
  if (has("audience") && !CONTENT_AUDIENCES.includes(input.audience as ContentAudience)) errors.audience = "請選擇有效的受眾對象";
  if (has("title_zh") && (!input.title_zh || !input.title_zh.trim())) errors.title_zh = "請輸入中文標題";
  if (has("title_zh")) { const e = lenErr(input.title_zh, MAX_TITLE, "標題"); if (e) errors.title_zh = e; }
  if (has("excerpt_zh")) { const e = lenErr(input.excerpt_zh, MAX_EXCERPT, "摘要"); if (e) errors.excerpt_zh = e; }
  if (has("body_zh")) { const e = lenErr(input.body_zh, MAX_BODY, "內文"); if (e) errors.body_zh = e; }
  if (has("body_en")) { const e = lenErr(input.body_en, MAX_BODY, "內文"); if (e) errors.body_en = e; }
  return { errors };
}

export const STATUS_TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  draft: ["scheduled", "published", "archived"],
  scheduled: ["draft", "published", "archived"],
  published: ["draft", "archived"],
  archived: ["draft"],
};

export function canTransition(from: ContentStatus, to: ContentStatus): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isPublishable(row: { title_zh: string; body_zh: string }): boolean {
  return Boolean(row.title_zh && row.title_zh.trim() && row.body_zh && row.body_zh.trim());
}

/** https + exact-hostname match against the allowlist (never endsWith). */
export function isAllowedImageUrl(url: string, allowedHosts: string[]): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:") return false;
  return allowedHosts.includes(u.hostname);
}
