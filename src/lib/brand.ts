import { supabase } from "@/lib/supabase";
import { AdminRequestError } from "@/lib/admin";
import type { AdminMission, MissionDraftInput, MissionPatch, Application, Submission, EngagedCreator } from "@/lib/admin";

export class BrandAuthError extends Error {}
export type BrandMe = { email: string; workspaceId: string; workspaceName: string; role: "owner" | "member" };
export type BrandMission = {
  id: string; slug: string; title: string; status: string; mission_type: string;
  points_reward: number; cash_reward: number | null; filled: number; quota: number; deadline: string | null;
};

export const brandKeys = {
  me: () => ["brand-me"] as const,
  missions: (status: string) => ["brand-missions", status] as const,
  mission: (id: string) => ["brand-mission", id] as const,
  submissions: (status: string) => ["brand-submissions", status] as const,
  applications: () => ["brand-applications"] as const,
  engaged: () => ["brand-engaged"] as const,
  budget: () => ["brand-budget"] as const,
  insights: (window: number) => ["brand-insights", window] as const,
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
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new AdminRequestError(body.error ?? res.statusText, body.code, body.fields);
  }
  return res.json() as Promise<T>;
}

export const fetchBrandMe = () => brandFetch<{ brand: BrandMe }>("/me");
export const acceptBrand = () => brandFetch<{ brand: BrandMe }>("/accept", { method: "POST" });
export const fetchBrandMissions = (status = "") =>
  brandFetch<{ missions: BrandMission[] }>(`/missions${status ? `?status=${status}` : ""}`);
export const publishBrandMission = (id: string) => brandFetch(`/missions/${id}/publish`, { method: "POST" });
export const closeBrandMission = (id: string) => brandFetch(`/missions/${id}/close`, { method: "POST" });
export const deleteBrandMission = (id: string) => brandFetch(`/missions/${id}`, { method: "DELETE" });
export const fetchBrandMission = (id: string) => brandFetch<{ mission: AdminMission }>(`/missions/${id}`);
export const createBrandMission = (body: MissionDraftInput) =>
  brandFetch<{ mission: AdminMission }>("/missions", { method: "POST", body: JSON.stringify(body) });
export const updateBrandMission = (id: string, patch: MissionPatch) =>
  brandFetch<{ mission: AdminMission }>(`/missions/${id}`, { method: "PUT", body: JSON.stringify(patch) });

// --- Slice 2: review + payout ----------------------------------------------------------------
export const fetchBrandSubmissions = (status = "submitted") =>
  brandFetch<{ submissions: Submission[] }>(`/review/submissions?status=${encodeURIComponent(status)}`);
export const fetchBrandApplications = () =>
  brandFetch<{ applications: Application[] }>("/review/applications");
export const fetchBrandEngaged = () =>
  brandFetch<{ creators: EngagedCreator[] }>("/review/engaged");

export const approveBrandSubmission = (id: string, body: { notes?: string; rating?: number }) =>
  brandFetch(`/review/submissions/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ notes: body.notes, quality_rating: body.rating }),
  });
export const rejectBrandSubmission = (id: string, notes?: string) =>
  brandFetch(`/review/submissions/${id}/reject`, { method: "POST", body: JSON.stringify(notes ? { notes } : {}) });
export const acceptBrandApplication = (id: string) =>
  brandFetch(`/review/applications/${id}/accept`, { method: "POST", body: JSON.stringify({}) });
export const declineBrandApplication = (id: string, notes?: string) =>
  brandFetch(`/review/applications/${id}/decline`, { method: "POST", body: JSON.stringify(notes ? { notes } : {}) });

// --- Slice 3: budget (read-only) -------------------------------------------------------------
export type BudgetTxn = {
  id: string; type: "topup" | "debit" | "adjust"; delta: number; balance_after: number;
  source_ref: string | null; description: string | null; created_at: string;
};
export type BrandBudget = { balance: number; enforced: boolean };
export const fetchBrandBudget = () =>
  brandFetch<{ budget: BrandBudget; transactions: BudgetTxn[] }>("/budget");

// --- Slice 4: insights (read-only) -----------------------------------------------------------
export type BrandMetric = { value: number; prev: number; deltaPct: number | null };
export type BrandTopCreator = { creatorId: string; name: string; approved: number; avgQuality: number };
export type BrandInsights = {
  window: { days: 7 | 30 | 90; from: string; to: string };
  kpis: {
    liveMissions: BrandMetric;
    missionFillRate: BrandMetric;
    submissionsReceived: BrandMetric;
    approvalRate: BrandMetric;
    completions: BrandMetric;
    cashPaid: BrandMetric;
    costPerDeliverable: BrandMetric;
    pointsDistributed: BrandMetric;
  };
  topCreators: BrandTopCreator[];
  trend: Array<{ bucket: string; joined: number; submitted: number; approved: number }>;
};
export const fetchBrandInsights = (window: number) =>
  brandFetch<{ insights: BrandInsights }>(`/insights?window=${window}`);
