import { apiFetch } from "@/lib/api";
import { adminFetch } from "@/lib/admin";

export type ContentKind = "article" | "announcement";
export type ContentStatus = "draft" | "scheduled" | "published" | "archived";

export type AdminContentRow = {
  id: string; kind: ContentKind; slug: string; status: ContentStatus;
  title_zh: string; title_en: string | null; excerpt_zh: string | null; excerpt_en: string | null;
  body_zh: string; body_en: string | null; cover_image_url: string | null; category_id: string | null;
  pinned: boolean; pinned_rank: number | null; views: number; scheduled_for: string | null;
  published_at: string | null; updated_at: string;
};
export type ContentCategory = { id: string; slug: string; label_zh: string; label_en: string | null; sort: number };

export type NewsItem = {
  id: string; slug: string; kind: ContentKind; title: string; excerpt: string | null;
  body?: string; coverImageUrl: string | null; category: { slug: string; label: string } | null;
  tags: string[]; publishedAt: string | null; pinned: boolean; views: number;
};

export const contentKeys = {
  adminList: (f: Record<string, string>) => ["admin", "content", f] as const,
  adminItem: (id: string) => ["admin", "content", id] as const,
  categories: () => ["admin", "content-categories"] as const,
  news: (f: Record<string, string>) => ["news", f] as const,
  newsItem: (slug: string, lang: string) => ["news", slug, lang] as const,
};

// ---- admin ----
export const listAdminContent = (f: { kind?: string; status?: string; category?: string; q?: string; page?: number } = {}) => {
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
  return adminFetch<{ items: AdminContentRow[]; page: number; pageSize: number; total: number }>(`/admin/content?${qs}`);
};
export const getAdminContent = (id: string) => adminFetch<{ item: AdminContentRow }>(`/admin/content/${id}`);
export const createContent = (body: Partial<AdminContentRow>) => adminFetch<{ item: AdminContentRow }>(`/admin/content`, { method: "POST", body: JSON.stringify(body) });
export const updateContent = (id: string, patch: Partial<AdminContentRow> & { updated_at?: string }) => adminFetch<{ item: AdminContentRow }>(`/admin/content/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
export const contentAction = (id: string, action: "publish" | "unpublish" | "archive") => adminFetch<{ item: AdminContentRow }>(`/admin/content/${id}/${action}`, { method: "POST", body: "{}" });
export const scheduleContent = (id: string, scheduled_for: string) => adminFetch<{ item: AdminContentRow }>(`/admin/content/${id}/schedule`, { method: "POST", body: JSON.stringify({ scheduled_for }) });
export const deleteContent = (id: string) => adminFetch<{ ok: true }>(`/admin/content/${id}`, { method: "DELETE" });
export const listCategories = () => adminFetch<{ categories: ContentCategory[] }>(`/admin/content-categories`);
export async function uploadContentImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const { url } = await adminFetch<{ url: string }>(`/admin/content/media`, { method: "POST", body: fd, headers: {} });
  return url;
}

// ---- creator ----
export const fetchNews = (f: { kind?: string; category?: string; page?: number; lang: string }) => {
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
  return apiFetch<{ items: NewsItem[]; page: number; pageSize: number; total: number }>(`/content?${qs}`);
};
export const fetchNewsItem = (slug: string, lang: string) => apiFetch<{ item: NewsItem; related: NewsItem[] }>(`/content/${slug}?lang=${lang}`);
