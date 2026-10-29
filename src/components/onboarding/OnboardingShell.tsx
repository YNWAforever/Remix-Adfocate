import { useEffect, useRef, useState, type ReactNode } from "react";
import { ProgressBar } from "@/components/ProgressBar";
import { useI18n } from "@/lib/i18n";

export type OnboardingSaveState = "idle" | "saving" | "saved" | "error";

export function OnboardingShell({
  step,
  totalSteps,
  title,
  saveState,
  canGoBack,
  hasUnsavedChanges,
  onBack,
  onDiscardAndBack,
  onCancelDiscard,
  onSignOut,
  children,
}: {
  step: number;
  totalSteps: 5;
  title: string;
  saveState: OnboardingSaveState;
  canGoBack: boolean;
  hasUnsavedChanges: boolean;
  onBack: () => void;
  onDiscardAndBack: () => void;
  onCancelDiscard: () => void;
  /** Onboarding hides the app navigation, so the shell offers the only way out. */
  onSignOut?: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const discardButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setConfirmDiscard(false), [step]);
  useEffect(() => {
    if (confirmDiscard) discardButtonRef.current?.focus();
  }, [confirmDiscard]);

  const saveText: Record<OnboardingSaveState, string> = {
    idle: t("app.onboarding.saveIdle"),
    saving: t("app.onboarding.saving"),
    saved: t("app.onboarding.saved"),
    error: t("common.saveError"),
  };

  function requestBack() {
    if (hasUnsavedChanges) setConfirmDiscard(true);
    else onBack();
  }

  function cancelDiscard() {
    setConfirmDiscard(false);
    onCancelDiscard();
    backButtonRef.current?.focus();
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-[var(--color-paper)] px-4 py-10">
      <div className="dot-pattern pointer-events-none absolute inset-0 -z-10 opacity-[0.18]" aria-hidden />
      <section aria-labelledby="onboarding-title" className="pastel-card w-full max-w-md rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-6">
        <header className="mb-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="font-display text-lg font-bold text-[var(--color-ink)]">
              Adfocate<span className="text-[var(--color-magenta)]">.</span>
            </span>
            <span className="flex items-center gap-3">
              <span className="tag-mono">{t("app.onboarding.stepLabel", { step, total: totalSteps })}</span>
              {onSignOut ? (
                <button type="button" onClick={onSignOut} className="text-xs font-semibold underline underline-offset-4">
                  {t("app.profile.signOut")}
                </button>
              ) : null}
            </span>
          </div>
          <ProgressBar value={step} max={totalSteps} />
          <div className="flex min-h-6 items-center justify-between gap-3">
            {canGoBack ? (
              <button ref={backButtonRef} type="button" onClick={requestBack} className="text-sm font-semibold underline underline-offset-4">
                {t("common.back")}
              </button>
            ) : <span />}
            <p role="status" aria-live="polite" className="text-xs text-[var(--color-soft-ink)]">{saveText[saveState]}</p>
          </div>
          <h1 id="onboarding-title" className="font-display text-2xl font-bold text-[var(--color-ink)]">{title}</h1>
        </header>

        {confirmDiscard ? (
          <div role="alertdialog" aria-labelledby="onboarding-discard-title" aria-describedby="onboarding-discard-body" className="mb-4 rounded-xl border-2 border-[var(--color-ink)] bg-[var(--color-lemon)] p-4">
            <h2 id="onboarding-discard-title" className="font-heading font-bold">{t("app.onboarding.discardTitle")}</h2>
            <p id="onboarding-discard-body" className="mt-1 text-sm text-[var(--color-soft-ink)]">{t("app.onboarding.discardBody")}</p>
            <div className="mt-3 flex gap-2">
              <button ref={discardButtonRef} type="button" className="btn-primary flex-1" onClick={() => { setConfirmDiscard(false); onDiscardAndBack(); }}>
                {t("app.onboarding.discardConfirm")}
              </button>
              <button type="button" className="btn-ink flex-1" onClick={cancelDiscard}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        ) : null}

        <div className="space-y-4">{children}</div>
      </section>
    </main>
  );
}
