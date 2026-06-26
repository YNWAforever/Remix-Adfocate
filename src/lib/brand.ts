import { supabase } from "@/lib/supabase";

export class BrandAuthError extends Error {}
export type BrandMe = { email: string; workspaceId: string; workspaceName: string; role: "owner" | "member" };
export type BrandMission = {
  id: string; slug: string; title: string; status: string; mission_type: string;
  points_reward: number; cash_reward: number | null; filled: number; quota: number; deadline: string | null;
};

export const brandKeys = {
  me: () => ["brand-me"] as const,
  missions: (status: string) => ["brand-missions", status] as const,
};

async function brandFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`/api/brand${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401 || res.status === 403) throw new BrandAuthError(String(res.status));
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json() as Promise<T>;
}

export const fetchBrandMe = () => brandFetch<{ brand: BrandMe }>("/me");
export const acceptBrand = () => brandFetch<{ brand: BrandMe }>("/accept", { method: "POST" });
export const fetchBrandMissions = (status = "") =>
  brandFetch<{ missions: BrandMission[] }>(`/missions${status ? `?status=${status}` : ""}`);
export const publishBrandMission = (id: string) => brandFetch(`/missions/${id}/publish`, { method: "POST" });
export const closeBrandMission = (id: string) => brandFetch(`/missions/${id}/close`, { method: "POST" });
export const deleteBrandMission = (id: string) => brandFetch(`/missions/${id}`, { method: "DELETE" });
