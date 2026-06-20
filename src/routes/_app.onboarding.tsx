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
import { useI18n } from "@/lib/i18n";
import { categoryLabelKey, platformDisplayLabelKey } from "@/lib/labels";

export const Route = createFileRoute("/_app/onboarding")({ component: Wizard });

const CATEGORIES = ["美容", "餐飲", "生活", "科技", "旅遊", "媽媽", "寵物"] as const;
const PLATFORMS = ["Instagram", "小紅書", "TikTok", "YouTube"] as const;

function Wizard() {
  const { t } = useI18n();
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
    } catch { setError(t("common.saveError")); }
  }

  async function platformsNext() {
    setError(null);
    try {
      for (const [platform, handle] of Object.entries(handles)) {
        if (handle.trim()) await connectSocial.mutateAsync({ platform, handle: handle.trim() });
      }
      await saveProfile.mutateAsync({ step: 4 });
      setStep(4);
    } catch { setError(t("common.saveError")); }
  }

  async function missionNext() {
    setError(null);
    try {
      await saveProfile.mutateAsync({ step: 5 });
      setStep(5);
    } catch { setError(t("common.saveError")); }
  }

  async function claim() {
    setError(null);
    try {
      const res = await complete.mutateAsync();
      setReward({ referral_code: res.referral_code });
      // Refresh the gate's cached /me + the balance so home reflects the bonus.
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["balance"] });
    } catch { setError(t("app.onboarding.claimError")); }
  }

  return (
    <div className="mx-auto max-w-sm space-y-5 p-6">
      <ProgressBar value={step - 1} max={5} />
      {error && <p className="text-sm text-[var(--color-magenta)]">{error}</p>}

      {step === 2 && (
        <section className="space-y-4">
          <h1 className="font-display text-2xl font-bold">{t("app.onboarding.categoriesTitle")}</h1>
          <p className="text-sm text-[var(--color-soft-ink)]">{t("app.onboarding.categoriesHint")}</p>
          <FilterPillsMulti options={CATEGORIES} value={categories} onChange={setCategories} renderLabel={(v) => t(categoryLabelKey(v))} />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => categoriesNext([])}
              className="flex-1 rounded-full border-2 border-[var(--color-ink)] bg-white py-3 font-heading font-bold"
            >
              {t("app.onboarding.skip")}
            </button>
            <button
              type="button"
              onClick={() => categoriesNext(categories)}
              className="btn-primary flex-1 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)]"
            >
              {t("app.onboarding.next")}
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4">
          <h1 className="font-display text-2xl font-bold">{t("app.onboarding.platformsTitle")}</h1>
          <p className="text-sm text-[var(--color-soft-ink)]">{t("app.onboarding.platformsHint")}</p>
          <p className="text-xs text-[var(--color-soft-ink)]">{t("app.onboarding.verifyLater")}</p>
          <div className="space-y-2">
            {PLATFORMS.map((p) => (
              <input
                key={p}
                value={handles[p] ?? ""}
                onChange={(e) => setHandles((h) => ({ ...h, [p]: e.target.value }))}
                placeholder={t("common.platformHandleLabel", { platform: t(platformDisplayLabelKey(p)) })}
                aria-label={t("common.platformHandleLabel", { platform: t(platformDisplayLabelKey(p)) })}
                className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3"
              />
            ))}
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={platformsNext} className="flex-1 rounded-full border-2 border-[var(--color-ink)] bg-white py-3 font-heading font-bold">{t("app.onboarding.skip")}</button>
            <button type="button" onClick={platformsNext} className="btn-primary flex-1 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)]">{t("app.onboarding.next")}</button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section className="space-y-4">
          <h1 className="font-display text-2xl font-bold">{t("app.onboarding.missionsTitle")}</h1>
          <p className="text-sm text-[var(--color-soft-ink)]">{t("app.onboarding.missionsHint")}</p>
          <div className="space-y-3">
            {(recommended.data ?? []).map((m) => (
              <MissionCard key={m.id} title={m.title} category={m.category} points={m.points_reward} deadline={m.deadline} />
            ))}
          </div>
          <button type="button" onClick={missionNext} className="btn-primary w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)]">{t("app.onboarding.next")}</button>
        </section>
      )}

      {step === 5 && (
        <section className="space-y-4 text-center">
          <h1 className="font-display text-2xl font-bold">{t("app.onboarding.rewardTitle")}</h1>
          {reward ? (
            <div className="space-y-3">
              <p className="font-display text-4xl font-bold text-[var(--color-acid)]">{t("app.onboarding.bonusPoints")}</p>
              <p className="text-sm text-[var(--color-soft-ink)]">{t("app.onboarding.referralLabel")}</p>
              <p className="font-mono text-xl font-bold tracking-widest">{reward.referral_code}</p>
              <p className="text-sm text-[var(--color-soft-ink)]">{t("app.onboarding.referralNote")}</p>
              <button
                type="button"
                onClick={() => navigate({ to: "/home" })}
                className="btn-primary w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)]"
              >
                {t("app.onboarding.goHome")}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-[var(--color-soft-ink)]">{t("app.onboarding.claimHint")}</p>
              <button
                type="button"
                onClick={claim}
                disabled={complete.isPending}
                className="btn-primary w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)] disabled:opacity-50"
              >
                {complete.isPending ? t("common.processing") : t("app.onboarding.claimCta")}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
