import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export type SubmissionStatus = "joined" | "submitted" | "under_review" | "approved" | "rejected" | "expired";
export type Mission = {
  id: string; slug: string; title: string; description?: string;
  category?: string; mission_type: string; access_type?: string; points_reward: number;
  deadline?: string; quota: number; filled: number; status: string;
  my_status?: SubmissionStatus | null;
};
export type Gift = {
  id: string; name: string; category?: string; points_cost: number;
  stock_remaining: number; gift_type: string; image_url?: string; status: string;
};
export type Balance = { balance: number; available_to: string | null };
export type Txn = { id: string; type: string; delta: number; balance_after: number; description?: string; created_at: string };
export type SocialHandle = { platform: string; handle: string; followers?: number | null; verified?: boolean };
export type Me = {
  id: string;
  display_name?: string;
  avatar_url?: string | null;
  level: string;
  level_seen?: string;
  xp: number;
  phone?: string | null;
  categories?: string[];
  social_handles?: SocialHandle[];
  onboarding_step: number;
  onboarding_completed: boolean;
  referral_code?: string;
};
export type Passport = {
  level: string;
  xp: number;
  scores: { influence: number | null; reliability: number | null; content: number | null; brandSafety: number | null };
  badges: string[];
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
export type MissionMatch = {
  id: string; slug: string; title: string;
  category?: string | null; mission_type: string;
  required_level: string;
  points_reward: number; cash_reward?: number | null;
  deadline?: string | null; quota: number; filled: number;
  fit_score: number; reasons: string[]; rationale: string; locked: boolean;
};
export function useMissionMatch() {
  return useQuery({
    queryKey: ["mission-match"],
    queryFn: async () => (await apiFetch<{ matches: MissionMatch[] }>("/match")).matches,
    staleTime: 60_000, // recommendations are stable within a session; avoid refetch-on-focus re-hitting the LLM
  });
}
export type Hook = { angle: string; text: string };
export type HookResult = { hooks: Hook[]; source: "ai" | "template" };
export function useGenerateHooks() {
  return useMutation({
    mutationFn: (body: { mission_slug: string; platform: string }) =>
      apiFetch<HookResult>("/copilot/hook-generator", { method: "POST", body: JSON.stringify(body) }),
  });
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

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { display_name?: string; categories?: string[]; social_handles?: SocialHandle[] }) =>
      apiFetch<Me>("/me/profile", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}

export function useMarkLevelSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<Me>("/me/level-seen", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}

export function useMyPassport() {
  return useQuery({ queryKey: ["passport"], queryFn: () => apiFetch<Passport>("/me/passport") });
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

export type MyMission = {
  id: string;
  status: SubmissionStatus;
  content_urls: string[];
  points_awarded: number;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  missions: { slug: string; title: string; category?: string; points_reward: number; mission_type: string };
};

export function useMyMissions(status?: SubmissionStatus) {
  const qs = status ? `?status=${status}` : "";
  return useQuery({
    queryKey: ["my-missions", status ?? "all"],
    queryFn: async () => (await apiFetch<{ submissions: MyMission[] }>(`/missions/my${qs}`)).submissions,
  });
}

export function useJoinMission(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<MyMission>(`/missions/${slug}/join`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mission", slug] });
      qc.invalidateQueries({ queryKey: ["missions"] });
      qc.invalidateQueries({ queryKey: ["my-missions"] });
      qc.invalidateQueries({ queryKey: ["me"] }); // join awards +10 XP on creators.xp
    },
  });
}

export function useSubmitMission(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { content_urls: string[]; submission_data?: Record<string, unknown> }) =>
      apiFetch<MyMission>(`/missions/${slug}/submit`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mission", slug] });
      qc.invalidateQueries({ queryKey: ["missions"] }); // my_status badge flips joined→submitted
      qc.invalidateQueries({ queryKey: ["my-missions"] });
      qc.invalidateQueries({ queryKey: ["me"] }); // submit awards +25 XP on creators.xp
    },
  });
}

export function useApplyMission(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<MyMission>(`/missions/${slug}/apply`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mission", slug] });
      qc.invalidateQueries({ queryKey: ["missions"] }); // my_status badge → 審批中
      qc.invalidateQueries({ queryKey: ["my-missions"] });
    },
  });
}

/** The raw redeem_gift RPC result (the redemptions row, incl. the issued code). */
export type RedeemResult = {
  id: string;
  gift_id: string;
  code: string | null;
  points_spent: number;
  status: string;
  created_at: string;
};
/** A redemption history row (gift name embedded). */
export type RedemptionHistoryItem = {
  id: string;
  code: string | null;
  points_spent: number;
  status: string;
  created_at: string;
  redemption_gifts: { name: string } | null;
};

export function useRedeemGift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (giftId: string) =>
      apiFetch<RedeemResult>("/redemption/redeem", { method: "POST", body: JSON.stringify({ gift_id: giftId }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gifts"] });
      qc.invalidateQueries({ queryKey: ["balance"] });
      qc.invalidateQueries({ queryKey: ["redemptions"] });
      qc.invalidateQueries({ queryKey: ["history"] }); // points ledger gains a 'redeem' row
    },
  });
}

export function useRedemptions() {
  return useQuery({
    queryKey: ["redemptions"],
    queryFn: async () => (await apiFetch<{ redemptions: RedemptionHistoryItem[] }>("/redemption/history")).redemptions,
  });
}

export type Earnings = { available: number; pending: number };
export type EarningsTxn = {
  id: string;
  type: string;
  amount: number;
  balance_after: number;
  description?: string;
  created_at: string;
};

export function useEarnings() {
  return useQuery({ queryKey: ["earnings"], queryFn: () => apiFetch<Earnings>("/wallet/earnings") });
}
export function useEarningsHistory() {
  return useQuery({
    queryKey: ["earnings-history"],
    queryFn: async () => (await apiFetch<{ transactions: EarningsTxn[] }>("/wallet/earnings/history")).transactions,
  });
}
