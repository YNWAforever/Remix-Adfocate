import { FilterPillsMulti } from "@/components/FilterPills";
import { MissionCard, missionCardDecisionProps } from "@/components/MissionCard";
import { SkeletonCard } from "@/components/SkeletonCard";
import { useI18n } from "@/lib/i18n";
import { categoryLabelKey, platformDisplayLabelKey } from "@/lib/labels";
import type { Me, RecommendedMission } from "@/lib/queries/kocmax";

const CATEGORIES = ["美容", "餐飲", "生活", "科技", "旅遊", "媽媽", "寵物"] as const;
const PLATFORMS = ["Instagram", "小紅書", "TikTok", "YouTube"] as const;

function Actions({ onSkip, onContinue, saving }: { onSkip: () => void; onContinue: () => void; saving: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex gap-3">
      <button type="button" disabled={saving} onClick={onSkip} className="btn-ink min-h-11 flex-1 rounded-full border-2 border-[var(--color-ink)] bg-white py-3 font-heading font-bold disabled:opacity-50">
        {t("app.onboarding.skip")}
      </button>
      <button type="button" disabled={saving} onClick={onContinue} className="btn-primary min-h-11 flex-1 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold disabled:opacity-50">
        {saving ? t("common.processing") : t("app.onboarding.next")}
      </button>
    </div>
  );
}

export function OnboardingValueStep({ onContinue, saving }: { onContinue: () => void; saving: boolean }) {
  const { t } = useI18n();
  return (
    <div className="space-y-5">
      <p className="text-sm text-[var(--color-soft-ink)]">{t("app.onboarding.primerBody")}</p>
      <ul className="space-y-2 rounded-xl border-2 border-[var(--color-ink)] bg-[var(--color-lemon)] p-4 text-sm">
        <li>{t("app.onboarding.primerRewards")}</li>
        <li>{t("app.onboarding.primerSocial")}</li>
        <li>{t("app.onboarding.primerTime")}</li>
      </ul>
      <p className="text-sm font-medium text-[var(--color-ink)]">{t("app.onboarding.primerLadder")}</p>
      <button type="button" disabled={saving} onClick={onContinue} className="btn-primary min-h-11 w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold disabled:opacity-50">
        {saving ? t("common.processing") : t("app.onboarding.primerCta")}
      </button>
      <a href="/guide" className="block text-center text-sm underline">{t("app.onboarding.primerVisitGuide")}</a>
    </div>
  );
}

export function OnboardingInterestsStep({
  categories,
  onChange,
  onContinue,
  onSkip,
  saving,
}: {
  categories: string[];
  onChange: (categories: string[]) => void;
  onContinue: () => void;
  onSkip: () => void;
  saving: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-soft-ink)]">{t("app.onboarding.categoriesHint")}</p>
      <FilterPillsMulti options={CATEGORIES} value={categories} onChange={onChange} renderLabel={(value) => t(categoryLabelKey(value))} />
      <Actions onSkip={onSkip} onContinue={onContinue} saving={saving} />
    </div>
  );
}

export function OnboardingSocialStep({
  handles,
  onChange,
  onContinue,
  onSkip,
  saving,
  errorId,
}: {
  handles: Record<string, string>;
  onChange: (platform: string, value: string) => void;
  onContinue: () => void;
  onSkip: () => void;
  saving: boolean;
  errorId?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-soft-ink)]">{t("app.onboarding.platformsHint")}</p>
      <p className="text-xs text-[var(--color-soft-ink)]">{t("app.onboarding.verifyLater")}</p>
      <div className="space-y-3">
        {PLATFORMS.map((platform, index) => {
          const id = `onboarding-handle-${index}`;
          const label = t("common.platformHandleLabel", { platform: t(platformDisplayLabelKey(platform)) });
          const storedKey = platform in handles
            ? platform
            : Object.keys(handles).find((key) => key.toLowerCase() === platform.toLowerCase()) ?? platform;
          return (
            <div key={platform} className="space-y-1">
              <label htmlFor={id} className="block text-sm font-semibold">{label}</label>
              <input
                id={id}
                name={`social-${platform.toLowerCase()}`}
                value={handles[storedKey] ?? ""}
                onChange={(event) => onChange(platform, event.target.value)}
                aria-describedby={errorId}
                autoComplete="off"
                className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3"
              />
            </div>
          );
        })}
      </div>
      <Actions onSkip={onSkip} onContinue={onContinue} saving={saving} />
    </div>
  );
}

export function OnboardingRecommendationsStep({
  creator,
  missions,
  loading,
  error,
  onRetry,
  onContinue,
  saving,
  readinessTo,
}: {
  creator?: Pick<Me, "level" | "is_trusted">;
  missions: RecommendedMission[];
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  onContinue: () => void;
  saving: boolean;
  readinessTo: string;
}) {
  const { t } = useI18n();
  if (loading) {
    return (
      <div className="space-y-3" role="status">
        <p className="text-sm text-[var(--color-soft-ink)]">{t("app.onboarding.recommendationsLoading")}</p>
        <SkeletonCard className="h-24" />
        <SkeletonCard className="h-24" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-3" role="alert">
        <p>{t("app.onboarding.recommendationsError")}</p>
        <button type="button" onClick={onRetry} className="btn-primary">{t("common.retry")}</button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-soft-ink)]">{t("app.onboarding.missionsHint")}</p>
      {missions.length ? (
        <div className="space-y-3">
          {missions.map((mission) => (
            <MissionCard {...missionCardDecisionProps(mission, creator)} key={mission.id} title={mission.title} category={mission.category} points={mission.points_reward} cashReward={mission.cash_reward} deadline={mission.deadline} />
          ))}
        </div>
      ) : (
        <div className="space-y-3 rounded-xl border-2 border-[var(--color-ink)] bg-[var(--color-paper)] p-4">
          <h2 className="font-heading font-bold">{t("app.onboarding.recommendationsEmptyTitle")}</h2>
          <p className="text-sm text-[var(--color-soft-ink)]">{t("app.onboarding.recommendationsEmptyBody")}</p>
          <div className="flex flex-wrap gap-3 text-sm font-semibold underline">
            <a href="/profile">{t("app.onboarding.preferencesAction")}</a>
            <a href="/guide">{t("app.onboarding.guideAction")}</a>
            <a href={readinessTo}>{t("app.onboarding.readinessAction")}</a>
          </div>
        </div>
      )}
      <button type="button" disabled={saving} onClick={onContinue} className="btn-primary min-h-11 w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold disabled:opacity-50">
        {saving ? t("common.processing") : t("app.onboarding.next")}
      </button>
    </div>
  );
}

export function OnboardingCompletionStep({
  reward,
  readinessPercent,
  remainingImprovements,
  nextAction,
  onComplete,
  completing,
}: {
  reward: { referral_code: string } | null;
  readinessPercent: number;
  remainingImprovements: string[];
  nextAction: { to: string; label: string };
  onComplete: () => void;
  completing: boolean;
}) {
  const { t } = useI18n();
  if (!reward) {
    return (
      <div className="space-y-3 text-center">
        <p className="text-sm text-[var(--color-soft-ink)]">{t("app.onboarding.claimHint")}</p>
        <button type="button" disabled={completing} onClick={onComplete} className="btn-primary min-h-11 w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold disabled:opacity-50">
          {completing ? t("common.processing") : t("app.onboarding.claimCta")}
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-3 text-center">
      <p className="text-outline-ink font-display text-5xl font-bold">{t("app.onboarding.bonusPoints")}</p>
      <p className="text-sm font-semibold">{t("app.onboarding.completionReadiness", { n: readinessPercent })}</p>
      {remainingImprovements.length ? (
        <div className="text-left text-sm">
          <p className="font-semibold">{t("app.onboarding.completionRemaining")}</p>
          <ul className="mt-1 list-disc pl-5">{remainingImprovements.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      ) : <p className="text-sm">{t("app.onboarding.completionReady")}</p>}
      <p className="text-sm text-[var(--color-soft-ink)]">{t("app.onboarding.referralLabel")}</p>
      <div className="rounded-xl border-2 border-[var(--color-ink)] bg-white p-4 shadow-[6px_6px_0_0_var(--color-violet)]">
        <p className="font-mono text-xl font-bold tracking-widest">{reward.referral_code}</p>
      </div>
      <p className="text-sm text-[var(--color-soft-ink)]">{t("app.onboarding.referralNote")}</p>
      <p className="text-sm font-semibold">{t("app.onboarding.completionNext")}</p>
      <a href={nextAction.to} className="btn-primary inline-flex min-h-11 w-full items-center justify-center rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-4 py-3 font-heading font-bold no-underline">{nextAction.label}</a>
    </div>
  );
}
