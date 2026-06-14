import { useQuery, useMutation } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export type Mission = {
  id: string; slug: string; title: string; description?: string;
  category?: string; mission_type: string; points_reward: number;
  deadline?: string; quota: number; filled: number; status: string;
};
export type Gift = {
  id: string; name: string; category?: string; points_cost: number;
  stock_remaining: number; gift_type: string; image_url?: string; status: string;
};
export type Balance = { balance: number; available_to: string | null };
export type Txn = { id: string; type: string; delta: number; balance_after: number; description?: string; created_at: string };
export type Me = {
  id: string;
  display_name?: string;
  level: string;
  xp: number;
  phone?: string | null;
  categories?: string[];
  onboarding_step: number;
  onboarding_completed: boolean;
  referral_code?: string;
};
export type OnboardingStatus = { onboarding_step: number; onboarding_completed: boolean; completion_pct: number };
export type RecommendedMission = { id: string; slug: string; title: string; category?: string; points_reward: number; deadline?: string };
export type CompleteResult = { referral_code: string; onboarding_completed: boolean; onboarding_step: number };

export function useMissions(category?: string) {
  const qs = category && category !== "全部" ? `?category=${encodeURIComponent(category)}` : "";
  return useQuery({
    queryKey: ["missions", category ?? "全部"],
    queryFn: async () => (await apiFetch<{ missions: Mission[] }>(`/missions${qs}`)).missions,
  });
}
export function useMission(slug: string) {
  return useQuery({ queryKey: ["mission", slug], queryFn: () => apiFetch<Mission>(`/missions/${slug}`) });
}
export function useGifts(category?: string) {
  const qs = category && category !== "全部" ? `?category=${encodeURIComponent(category)}` : "";
  return useQuery({
    queryKey: ["gifts", category ?? "全部"],
    queryFn: async () => (await apiFetch<{ gifts: Gift[] }>(`/redemption/gifts${qs}`)).gifts,
  });
}
export function useBalance() {
  return useQuery({ queryKey: ["balance"], queryFn: () => apiFetch<Balance>("/wallet/points") });
}
export function usePointHistory() {
  return useQuery({
    queryKey: ["history"],
    queryFn: async () => (await apiFetch<{ transactions: Txn[] }>("/wallet/points/history")).transactions,
  });
}
export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/me") });
}

export type Workspace = { slug: string; name: string; theme: Record<string, string> };
export function useWorkspace() {
  return useQuery({ queryKey: ["workspace"], queryFn: () => apiFetch<Workspace>("/workspace") });
}

export function useOnboardingStatus() {
  return useQuery({ queryKey: ["onboarding-status"], queryFn: () => apiFetch<OnboardingStatus>("/onboarding/status") });
}
export function useRecommendedMissions() {
  return useQuery({
    queryKey: ["recommended-missions"],
    queryFn: async () => (await apiFetch<{ missions: RecommendedMission[] }>("/onboarding/recommended-missions")).missions,
  });
}
export function useSaveProfile() {
  return useMutation({
    mutationFn: (body: { display_name?: string; categories?: string[]; step?: number }) =>
      apiFetch<{ onboarding_step: number }>("/onboarding/profile", { method: "PUT", body: JSON.stringify(body) }),
  });
}
export function useConnectSocial() {
  return useMutation({
    mutationFn: (body: { platform: string; handle: string; followers?: number }) =>
      apiFetch<{ social_handles: unknown[] }>("/onboarding/social/connect", { method: "POST", body: JSON.stringify(body) }),
  });
}
export function useCompleteOnboarding() {
  return useMutation({
    mutationFn: () => apiFetch<CompleteResult>("/onboarding/complete", { method: "POST" }),
  });
}
