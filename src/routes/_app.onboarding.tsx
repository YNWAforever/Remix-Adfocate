import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { OnboardingShell, type OnboardingSaveState } from "@/components/onboarding/OnboardingShell";
import {
  OnboardingCompletionStep,
  OnboardingInterestsStep,
  OnboardingRecommendationsStep,
  OnboardingSocialStep,
  OnboardingValueStep,
} from "@/components/onboarding/OnboardingSteps";
import {
  useCompleteOnboarding,
  useConnectSocial,
  useMe,
  useOnboardingStatus,
  useRecommendedMissions,
  useSaveProfile,
} from "@/lib/queries/kocmax";
import { deriveCreatorActivation } from "@/lib/creatorActivation";
import { trackActivationEvent } from "@/lib/activationAnalytics";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/onboarding")({ component: Wizard });

type Step = 1 | 2 | 3 | 4 | 5;
type Handles = Record<string, string>;

function clampStep(value: number | undefined): Step {
  return Math.min(5, Math.max(1, value ?? 1)) as Step;
}

function handleSignature(platform: string, handle: string): string {
  return `${platform.toLowerCase()}:${handle.trim().toLowerCase()}`;
}

function sameValues(left: string[] | Handles, right: string[] | Handles): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function Wizard() {
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const me = useMe();
  const status = useOnboardingStatus();
  const recommended = useRecommendedMissions();
  const saveProfile = useSaveProfile();
  const connectSocial = useConnectSocial();
  const complete = useCompleteOnboarding();

  const [step, setStep] = useState<Step>(1);
  const [serverConfirmedStep, setServerConfirmedStep] = useState<Step | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [handles, setHandles] = useState<Handles>({});
  const [reward, setReward] = useState<{ referral_code: string } | null>(null);
  const [saveState, setSaveState] = useState<OnboardingSaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  const categoriesEdited = useRef(false);
  const handlesEdited = useRef(false);
  const categoryBaseline = useRef<string[]>([]);
  const handleBaseline = useRef<Handles>({});
  const connectedHandles = useRef(new Set<string>());
  const viewedSteps = useRef(new Set<string>());
  const completedSteps = useRef(new Set<string>());
  const abandonedSteps = useRef(new Set<string>());

  useEffect(() => {
    if (!status.data) return;
    const persisted = clampStep(status.data.onboarding_step);
    if (serverConfirmedStep === null) {
      setServerConfirmedStep(persisted);
      setStep(persisted);
      return;
    }
    if (persisted <= serverConfirmedStep) return;
    setStep((current) => current === serverConfirmedStep ? persisted : current);
    setServerConfirmedStep(persisted);
  }, [serverConfirmedStep, status.data]);

  useEffect(() => {
    if (!me.data) return;

    if (!categoriesEdited.current) {
      const nextCategories = [...(me.data.categories ?? [])];
      categoryBaseline.current = nextCategories;
      setCategories(nextCategories);
    }

    if (!handlesEdited.current) {
      const nextHandles = Object.fromEntries(
        (me.data.social_handles ?? []).map(({ platform, handle }) => [platform, handle]),
      );
      handleBaseline.current = nextHandles;
      setHandles(nextHandles);
      connectedHandles.current = new Set(
        Object.entries(nextHandles).map(([platform, handle]) => handleSignature(platform, handle)),
      );
    }
  }, [me.data]);

  useEffect(() => {
    if (serverConfirmedStep === null) return;
    const key = `${lang}:${step}`;
    if (viewedSteps.current.has(key)) return;
    viewedSteps.current.add(key);
    trackActivationEvent("onboarding_step_viewed", { locale: lang, step });
  }, [lang, serverConfirmedStep, step]);

  const effectiveOnboarding = reward
    ? { onboarding_step: 5, onboarding_completed: true, completion_pct: 100 }
    : status.data;
  const activation = useMemo(
    () => deriveCreatorActivation({ me: me.data, onboarding: effectiveOnboarding }),
    [effectiveOnboarding, me.data],
  );
  const remainingImprovements = activation.milestones
    .filter(({ countsTowardReadiness, state }) => countsTowardReadiness && state !== "complete")
    .map(({ labelKey }) => t(labelKey));

  function cacheOnboardingProgress(nextStep: Step, completed = false) {
    queryClient.setQueryData(["onboarding-status"], (cached: typeof status.data) => {
      const source = cached ?? status.data;
      const confirmedStep = clampStep(Math.max(source?.onboarding_step ?? 1, nextStep));
      return {
        ...source,
        onboarding_step: confirmedStep,
        onboarding_completed: completed || (source?.onboarding_completed ?? false),
        completion_pct: completed ? 100 : (confirmedStep - 1) * 25,
      };
    });
  }

  async function persistStep(nextStep: Step, work: () => Promise<{ onboarding_step: number }>, completionStatus: "saved" | "skipped") {
    const completedStep = step;
    const previouslyConfirmed = serverConfirmedStep ?? 1;
    setError(null);
    setSaveState("saving");
    try {
      const result = await work();
      const confirmedStep = clampStep(Math.max(previouslyConfirmed, result.onboarding_step));
      cacheOnboardingProgress(confirmedStep);
      setServerConfirmedStep(confirmedStep);
      setStep(confirmedStep);
      setSaveState("saved");
      const eventKey = `${lang}:${completedStep}`;
      if (confirmedStep > previouslyConfirmed && !completedSteps.current.has(eventKey)) {
        completedSteps.current.add(eventKey);
        trackActivationEvent("onboarding_step_completed", {
          locale: lang,
          step: completedStep,
          status: completionStatus,
        });
      }
      return true;
    } catch {
      setError(t("common.saveError"));
      setSaveState("error");
      return false;
    }
  }

  function updateCategories(nextCategories: string[]) {
    categoriesEdited.current = true;
    setCategories(nextCategories);
    setSaveState("idle");
  }

  function updateHandle(platform: string, value: string) {
    handlesEdited.current = true;
    setHandles((current) => ({ ...current, [platform]: value }));
    setSaveState("idle");
  }

  async function primerNext() {
    await persistStep(2, () => saveProfile.mutateAsync({ step: 2 }), "saved");
  }

  async function categoriesNext(skipped: boolean) {
    const selected = skipped ? [] : categories;
    if (skipped) {
      categoriesEdited.current = true;
      setCategories([]);
    }
    const saved = await persistStep(
      3,
      () => saveProfile.mutateAsync({ categories: selected, step: 3 }),
      skipped ? "skipped" : "saved",
    );
    if (saved) categoryBaseline.current = [...selected];
  }

  async function socialNext(skipped: boolean) {
    const entries = skipped
      ? []
      : Object.entries(handles).filter(([, handle]) => handle.trim().length > 0);
    const saved = await persistStep(
      4,
      async () => {
        for (const [platform, handle] of entries) {
          const trimmed = handle.trim();
          const signature = handleSignature(platform, trimmed);
          if (connectedHandles.current.has(signature)) continue;
          await connectSocial.mutateAsync({ platform, handle: trimmed });
          connectedHandles.current.add(signature);
          trackActivationEvent("social_profile_added", { locale: lang, platform });
        }
        return saveProfile.mutateAsync({ step: 4 });
      },
      skipped || entries.length === 0 ? "skipped" : "saved",
    );
    if (saved) {
      if (skipped) setHandles(handleBaseline.current);
      else handleBaseline.current = { ...handles };
    }
  }

  async function recommendationsNext() {
    await persistStep(5, () => saveProfile.mutateAsync({ step: 5 }), "saved");
  }

  async function claimReward() {
    setError(null);
    setSaveState("saving");
    try {
      const result = await complete.mutateAsync();
      setReward({ referral_code: result.referral_code });
      setServerConfirmedStep(5);
      cacheOnboardingProgress(5, true);
      setSaveState("saved");
      for (const queryKey of [["me"], ["balance"], ["onboarding-status"], ["recommended-missions"]]) {
        queryClient.invalidateQueries({ queryKey });
      }
      trackActivationEvent("onboarding_completed", { locale: lang, rewardType: "welcome_points" });
    } catch {
      setError(t("app.onboarding.claimError"));
      setSaveState("error");
    }
  }

  function trackBack() {
    const eventKey = `${lang}:${step}`;
    if (abandonedSteps.current.has(eventKey)) return;
    abandonedSteps.current.add(eventKey);
    trackActivationEvent("onboarding_abandoned", { locale: lang, step });
  }

  function goBack() {
    trackBack();
    setError(null);
    setSaveState("idle");
    setStep((current) => Math.max(1, current - 1) as Step);
  }

  function discardAndBack() {
    if (step === 2) setCategories([...categoryBaseline.current]);
    if (step === 3) setHandles({ ...handleBaseline.current });
    goBack();
  }

  if (status.error && !status.data) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center p-4">
        <div className="w-full space-y-3 text-center" role="alert">
          <p>{t("common.loadError")}</p>
          <button type="button" className="btn-primary" onClick={() => void status.refetch()}>{t("common.retry")}</button>
        </div>
      </main>
    );
  }

  if (status.isLoading || serverConfirmedStep === null) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center p-4">
        <p className="w-full text-center text-sm text-[var(--color-soft-ink)]" role="status">{t("app.onboarding.loading")}</p>
      </main>
    );
  }

  const titles: Record<Step, string> = {
    1: t("app.onboarding.primerTitle"),
    2: t("app.onboarding.categoriesTitle"),
    3: t("app.onboarding.platformsTitle"),
    4: t("app.onboarding.missionsTitle"),
    5: t("app.onboarding.rewardTitle"),
  };
  const hasUnsavedChanges =
    (step === 2 && !sameValues(categories, categoryBaseline.current)) ||
    (step === 3 && !sameValues(handles, handleBaseline.current));

  return (
    <OnboardingShell
      step={step}
      totalSteps={5}
      title={titles[step]}
      saveState={saveState}
      canGoBack={step > 1 && !reward}
      hasUnsavedChanges={hasUnsavedChanges}
      onBack={goBack}
      onDiscardAndBack={discardAndBack}
      onCancelDiscard={() => undefined}
    >
      {error ? <p id="onboarding-save-error" role="alert" className="text-sm text-[var(--color-magenta)]">{error}</p> : null}

      {step === 1 ? <OnboardingValueStep onContinue={() => void primerNext()} saving={saveState === "saving"} /> : null}
      {step === 2 ? (
        <OnboardingInterestsStep
          categories={categories}
          onChange={updateCategories}
          onContinue={() => void categoriesNext(false)}
          onSkip={() => void categoriesNext(true)}
          saving={saveState === "saving"}
        />
      ) : null}
      {step === 3 ? (
        <OnboardingSocialStep
          handles={handles}
          onChange={updateHandle}
          onContinue={() => void socialNext(false)}
          onSkip={() => void socialNext(true)}
          saving={saveState === "saving"}
          errorId={error ? "onboarding-save-error" : undefined}
        />
      ) : null}
      {step === 4 ? (
        <OnboardingRecommendationsStep
          missions={recommended.data ?? []}
          loading={recommended.isLoading}
          error={recommended.error instanceof Error ? recommended.error : null}
          onRetry={() => void recommended.refetch()}
          onContinue={() => void recommendationsNext()}
          saving={saveState === "saving"}
          readinessTo={activation.nextAction.to}
        />
      ) : null}
      {step === 5 ? (
        <OnboardingCompletionStep
          reward={reward}
          readinessPercent={activation.readinessPercent}
          remainingImprovements={remainingImprovements}
          nextAction={{ to: activation.nextAction.to, label: t(activation.nextAction.ctaKey) }}
          onComplete={() => void claimReward()}
          completing={saveState === "saving"}
        />
      ) : null}
    </OnboardingShell>
  );
}
