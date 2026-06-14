import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ProgressBar } from "@/components/ProgressBar";
import { FilterPillsMulti } from "@/components/FilterPills";
import { MissionCard } from "@/components/MissionCard";
import {
  useOnboardingStatus,
  useRecommendedMissions,
  useSaveProfile,
  useConnectSocial,
  useCompleteOnboarding,
} from "@/lib/queries/kocmax";

export const Route = createFileRoute("/_app/onboarding")({ component: Wizard });

const CATEGORIES = ["美容", "餐飲", "生活", "科技", "旅遊", "媽媽", "寵物"] as const;
const PLATFORMS = ["Instagram", "小紅書", "TikTok", "YouTube"] as const;

function Wizard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const status = useOnboardingStatus();
  const recommended = useRecommendedMissions();
  const saveProfile = useSaveProfile();
  const connectSocial = useConnectSocial();
  const complete = useCompleteOnboarding();

  // Resume at the persisted step; the wizard renders screens for steps 2–5.
  const [step, setStep] = useState<number>(() => Math.max(2, status.data?.onboarding_step ?? 2));
  const [categories, setCategories] = useState<string[]>([]);
  const [handles, setHandles] = useState<Record<string, string>>({});
  const [reward, setReward] = useState<{ referral_code: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function categoriesNext(selected: string[]) {
    setError(null);
    try {
      await saveProfile.mutateAsync({ categories: selected, step: 3 });
      setStep(3);
    } catch { setError("儲存失敗，請重試"); }
  }

  async function platformsNext() {
    setError(null);
    try {
      for (const [platform, handle] of Object.entries(handles)) {
        if (handle.trim()) await connectSocial.mutateAsync({ platform, handle: handle.trim() });
      }
      await saveProfile.mutateAsync({ step: 4 });
      setStep(4);
    } catch { setError("儲存失敗，請重試"); }
  }

  async function missionNext() {
    setError(null);
    try {
      await saveProfile.mutateAsync({ step: 5 });
      setStep(5);
    } catch { setError("儲存失敗，請重試"); }
  }

  async function claim() {
    setError(null);
    try {
      const res = await complete.mutateAsync();
      setReward({ referral_code: res.referral_code });
      // Refresh the gate's cached /me + the balance so home reflects the bonus.
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["balance"] });
    } catch { setError("領取失敗，請重試"); }
  }

  return (
    <div className="mx-auto max-w-sm space-y-5 p-6">
      <ProgressBar value={step - 1} max={5} />
      {error && <p className="text-sm text-[var(--color-magenta)]">{error}</p>}

      {step === 2 && (
        <section className="space-y-4">
          <h1 className="font-display text-2xl font-bold">你的範疇</h1>
          <p className="text-sm text-[var(--color-soft-ink)]">選擇你的內容範疇（可選 1–3 個），方便我們推薦任務。</p>
          <FilterPillsMulti options={CATEGORIES} value={categories} onChange={setCategories} />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => categoriesNext([])}
              className="flex-1 rounded-full border-2 border-[var(--color-ink)] bg-white py-3 font-heading font-bold"
            >
              略過
            </button>
            <button
              type="button"
              onClick={() => categoriesNext(categories)}
              className="btn-primary flex-1 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)]"
            >
              下一步
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4">
          <h1 className="font-display text-2xl font-bold">你的平台</h1>
          <p className="text-sm text-[var(--color-soft-ink)]">填寫你的社交帳號（可選），稍後可驗證。</p>
          <div className="space-y-2">
            {PLATFORMS.map((p) => (
              <input
                key={p}
                value={handles[p] ?? ""}
                onChange={(e) => setHandles((h) => ({ ...h, [p]: e.target.value }))}
                placeholder={`${p} 帳號`}
                aria-label={`${p} 帳號`}
                className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3"
              />
            ))}
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={platformsNext} className="flex-1 rounded-full border-2 border-[var(--color-ink)] bg-white py-3 font-heading font-bold">略過</button>
            <button type="button" onClick={platformsNext} className="btn-primary flex-1 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)]">下一步</button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section className="space-y-4">
          <h1 className="font-display text-2xl font-bold">你的第一個任務</h1>
          <p className="text-sm text-[var(--color-soft-ink)]">這些是為你推薦的任務。完成註冊後即可在任務頁面參加。</p>
          <div className="space-y-3">
            {(recommended.data ?? []).map((m) => (
              <MissionCard key={m.id} title={m.title} category={m.category} points={m.points_reward} deadline={m.deadline} />
            ))}
          </div>
          <button type="button" onClick={missionNext} className="btn-primary w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)]">下一步</button>
        </section>
      )}

      {step === 5 && (
        <section className="space-y-4 text-center">
          <h1 className="font-display text-2xl font-bold">迎新獎賞</h1>
          {reward ? (
            <div className="space-y-3">
              <p className="font-display text-4xl font-bold text-[var(--color-acid)]">+100 積分</p>
              <p className="text-sm text-[var(--color-soft-ink)]">你的邀請碼：</p>
              <p className="font-mono text-xl font-bold tracking-widest">{reward.referral_code}</p>
              <p className="text-sm text-[var(--color-soft-ink)]">邀請朋友，各得 200 分</p>
              <button
                type="button"
                onClick={() => navigate({ to: "/home" })}
                className="btn-primary w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)]"
              >
                開始賺取積分
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-[var(--color-soft-ink)]">完成註冊，領取你的迎新積分！</p>
              <button
                type="button"
                onClick={claim}
                disabled={complete.isPending}
                className="btn-primary w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)] disabled:opacity-50"
              >
                {complete.isPending ? "處理中…" : "領取 100 積分"}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
