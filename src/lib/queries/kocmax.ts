import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export type SubmissionStatus = "joined" | "submitted" | "under_review" | "approved" | "rejected" | "expired";
export type Mission = {
  id: string; slug: string; title: string; description?: string;
  category?: string; mission_type: string; access_type?: string; points_reward: number;
  cash_reward?: number | null; required_level?: string;
  deliverables?: string[]; requirements?: string[]; platforms?: string[];
  effort?: "low" | "medium" | "high" | null; brand?: string | null;
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
  is_trusted?: boolean;
  effective_level?: string;
};
export type SocialPlatform = "instagram" | "threads";
export type SocialSyncStatus = "pending" | "synced" | "stale" | "failed" | "rate_limited";
export type SocialAccount = {
  id: string;
  platform: SocialPlatform;
  handle: string;
  profile_url?: string | null;
  owner_verified: boolean;
  api_synced_at?: string | null;
  sync_status: SocialSyncStatus;
  follower_count?: number | null;
  following_count?: number | null;
  post_count?: number | null;
  bio?: string | null;
  external_avatar_url?: string | null;
  engagement_rate?: number | null;
  avg_likes?: number | null;
  avg_comments?: number | null;
  posting_frequency?: number | null;
  freshness_score?: number | null;
  content_themes?: string[];
  last_error_code?: string | null;
  last_error_message?: string | null;
};
export type SocialTrust = {
  accounts: Array<{
    id: string;
    platform: SocialPlatform;
    handle: string;
    followerCount: number | null;
    engagementRate: number | null;
    avgLikes: number | null;
    avgComments: number | null;
    freshnessScore: number | null;
    apiSyncedAt: string | null;
    ownerVerified: boolean;
    labels: string[];
  }>;
  badges: string[];
};
export type Passport = {
  level: string;
  xp: number;
  scores: { influence: number | null; reliability: number | null; content: number | null; brandSafety: number | null };
  badges: string[];
  socialTrust?: SocialTrust;
};
export type PassportShare = { token: string; publicUrl: string };
export type PublicProfileHighlight = {
  url: string;
  title: string;
  platform_type: string;
  caption: string | null;
  sort_order: number;
};
export type PortfolioPlatformType = "instagram" | "threads" | "tiktok" | "youtube" | "website" | "case_study" | "other";
export type ProfileMediaLink = {
  id: string;
  creatorId: string;
  workspaceId: string;
  url: string;
  title: string;
  platformType: PortfolioPlatformType;
  caption: string | null;
  sortOrder: number;
  publicHighlight: boolean;
  createdAt: string;
  updatedAt: string;
};
export type ProfileCompleteness = {
  score: number;
  items: Array<{ key: string; label: string; complete: boolean }>;
};
export type CreatorProfileMedia = {
  avatarUrl: string | null;
  portfolioLinks: ProfileMediaLink[];
  publicHighlights: PublicProfileHighlight[];
  published: { avatarUrl: string | null; highlights: PublicProfileHighlight[]; publishedAt: string | null };
  completeness: ProfileCompleteness;
};
export type AvatarUploadMetadata = {
  bucket: "creator-avatars";
  path: string;
  publicUrl: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  maxSizeBytes: number;
};
export type PublicPassport = {
  creator: { displayName: string; avatarUrl: string | null; level: string; xp: number };
  scores: Passport["scores"];
  badges: string[];
  socialTrustBadges: string[];
  profileMedia: {
    highlights: PublicProfileHighlight[];
    publishedAt: string | null;
  };
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

export function useSocialAccounts() {
  return useQuery({
    queryKey: ["social-accounts"],
    queryFn: async () => (await apiFetch<{ accounts: SocialAccount[] }>("/social/accounts")).accounts,
  });
}

export function useAddSocialAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { platform: SocialPlatform; handle: string }) =>
      apiFetch<SocialAccount>("/social/accounts", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["social-accounts"] }),
  });
}

export function useScanSocialAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ account: SocialAccount; labels: string[] }>(`/social/accounts/${id}/scan`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["social-accounts"] });
      qc.invalidateQueries({ queryKey: ["passport"] });
    },
  });
}

export function useUseSocialAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) =>
      apiFetch<Me>("/me/avatar/from-social", { method: "POST", body: JSON.stringify({ accountId }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["passport"] });
    },
  });
}

export function useCreatePassportShare() {
  return useMutation({
    mutationFn: () => apiFetch<PassportShare>("/me/passport/share", { method: "POST" }),
  });
}

export function useRevokePassportShare() {
  return useMutation({
    mutationFn: () => apiFetch<{ revoked: boolean }>("/me/passport/share", { method: "DELETE" }),
  });
}

export function usePublicPassport(token: string) {
  return useQuery({
    queryKey: ["public-passport", token],
    queryFn: () => apiFetch<PublicPassport>(`/public/passports/${token}`),
    enabled: Boolean(token),
  });
}

export function useProfileMedia() {
  return useQuery({ queryKey: ["profile-media"], queryFn: () => apiFetch<CreatorProfileMedia>("/me/profile-media") });
}

export function useCreateAvatarUpload() {
  return useMutation({
    mutationFn: (body: { fileName: string; contentType: string; sizeBytes: number }) =>
      apiFetch<AvatarUploadMetadata>("/me/profile-media/avatar-upload", { method: "POST", body: JSON.stringify(body) }),
  });
}

export function useSelectUploadedAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (storagePath: string) =>
      apiFetch<{ avatarUrl: string }>("/me/profile-media/avatar-select", {
        method: "POST",
        body: JSON.stringify({ storagePath }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["profile-media"] });
      qc.invalidateQueries({ queryKey: ["passport"] });
    },
  });
}

export function useCreatePortfolioLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      url: string;
      title: string;
      platform_type: PortfolioPlatformType;
      caption?: string;
      sort_order?: number;
      public_highlight?: boolean;
    }) => apiFetch<{ link: ProfileMediaLink }>("/me/profile-media/portfolio", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile-media"] }),
  });
}

export function useUpdatePortfolioLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      apiFetch<{ link: ProfileMediaLink }>(`/me/profile-media/portfolio/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile-media"] }),
  });
}

export function useDeletePortfolioLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ deleted: boolean }>(`/me/profile-media/portfolio/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile-media"] }),
  });
}

export function usePublishProfileMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ published: CreatorProfileMedia["published"] }>("/me/profile-media/publish", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile-media"] });
      qc.invalidateQueries({ queryKey: ["public-passport"] });
    },
  });
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

export type AssistantCitation = { title: string; sourceType: string; sourceRef: string };
export type AssistantReply = { conversation_id: string; answer: string; citations: AssistantCitation[] };

export function useAssistantChat() {
  return useMutation({
    mutationFn: (body: { message: string; conversation_id?: string; locale?: string }) =>
      apiFetch<AssistantReply>("/assistant/chat", { method: "POST", body: JSON.stringify(body) }),
  });
}
