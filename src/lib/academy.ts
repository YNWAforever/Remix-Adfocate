import { apiFetch } from "@/lib/api";
import { adminFetch } from "@/lib/admin";

export type GuideCategory = "start" | "missions" | "rewards" | "account";
export type AcademyKind = "guide_doc" | "track" | "playbook" | "resource";
export type AcademyStatus = "draft" | "published" | "archived";

/** Localized read shape returned by the creator API (meta already flattened to the active lang). */
export type AcademyDoc = {
  id: string; kind: AcademyKind; slug: string; title: string; excerpt: string | null; body?: string;
  category: GuideCategory | null; emoji: string | null; sort: number;
};
export type AcademyTrack = {
  id: string; kind: AcademyKind; slug: string; title: string; excerpt: string | null; body?: string;
  requiredLevel: string | null; emoji: string | null; color: string | null; sort: number;
  meta: { duration?: string; levelLabel?: string; teaser_zh?: string; teaser_en?: string };
};
export type AcademyPlaybook = {
  id: string; kind: AcademyKind; slug: string; title: string; emoji: string | null; color: string | null; sort: number;
  meta: { levels?: string[]; creatorAngle?: string; ideas?: string[]; measurementFocus?: string };
};
export type AcademyResource = {
  id: string; kind: AcademyKind; slug: string; title: string; emoji: string | null; sort: number;
  meta: { type?: string; fileUrl?: string | null };
};
export type AcademyBundle = {
  docs: AcademyDoc[]; tracks: AcademyTrack[]; playbooks: AcademyPlaybook[]; resources: AcademyResource[];
};

/** Raw admin row (all languages + status), for the /admin editor. */
export type AdminAcademyRow = {
  id: string; kind: AcademyKind; slug: string; status: AcademyStatus;
  title_zh: string; title_en: string | null; excerpt_zh: string | null; excerpt_en: string | null;
  body_zh: string; body_en: string | null; category: string | null; required_level: string | null;
  emoji: string | null; color: string | null; sort: number; metadata: Record<string, unknown>;
  published_at: string | null; archived_at: string | null; created_at: string; updated_at: string;
};

export const academyKeys = {
  bundle: (lang: string) => ["academy", "bundle", lang] as const,
  doc: (slug: string, lang: string) => ["academy", "doc", slug, lang] as const,
  track: (slug: string, lang: string) => ["academy", "track", slug, lang] as const,
  adminList: (kind: string) => ["admin", "academy", kind] as const,
  adminItem: (id: string) => ["admin", "academy", id] as const,
};

// ---- creator ----
export const fetchAcademy = (lang: string) => apiFetch<AcademyBundle>(`/academy?lang=${lang}`);
export const fetchAcademyDoc = (slug: string, lang: string) => apiFetch<{ item: AcademyDoc }>(`/academy/doc/${slug}?lang=${lang}`);
export const fetchAcademyTrack = (slug: string, lang: string) => apiFetch<{ item: AcademyTrack }>(`/academy/track/${slug}?lang=${lang}`);

// ---- admin ----
export const listAdminAcademy = (kind = "") =>
  adminFetch<{ items: AdminAcademyRow[] }>(`/admin/academy${kind ? `?kind=${kind}` : ""}`);
export const getAdminAcademy = (id: string) => adminFetch<{ item: AdminAcademyRow }>(`/admin/academy/${id}`);
export const createAcademy = (body: Partial<AdminAcademyRow>) =>
  adminFetch<{ item: AdminAcademyRow }>(`/admin/academy`, { method: "POST", body: JSON.stringify(body) });
export const updateAcademy = (id: string, patch: Partial<AdminAcademyRow> & { updated_at?: string }) =>
  adminFetch<{ item: AdminAcademyRow }>(`/admin/academy/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
export const academyAction = (id: string, action: "publish" | "unpublish" | "archive") =>
  adminFetch<{ item: AdminAcademyRow }>(`/admin/academy/${id}/${action}`, { method: "POST", body: "{}" });
export const deleteAcademy = (id: string) => adminFetch<{ ok: true }>(`/admin/academy/${id}`, { method: "DELETE" });
