import { useEffect, useRef } from "react";
import type { CreatorPendingReward as PendingReward } from "@/lib/activeMission";
import { getDeviceCategory, trackActivationEvent } from "@/lib/activationAnalytics";
import { useI18n } from "@/lib/i18n";

type RewardPendingCardProps = {
  missionTitle: string;
  pendingReward: PendingReward;
  supportHref: string;
};

const viewedProjectionIdentities = new Set<string>();
const focusedProjectionIdentities = new Set<string>();
const MAX_REMEMBERED_PROJECTIONS = 100;

function rememberOnce(identities: Set<string>, identity: string): boolean {
  if (identities.has(identity)) return false;
  identities.add(identity);
  if (identities.size > MAX_REMEMBERED_PROJECTIONS) {
    const oldest = identities.values().next().value;
    if (oldest) identities.delete(oldest);
  }
  return true;
}

function projectionIdentity(pendingReward: PendingReward, supportHref: string): string {
  return [
    supportHref,
    pendingReward.status,
    pendingReward.createdAt,
    pendingReward.cancelledAt ?? "",
    pendingReward.decisionState.kind,
    pendingReward.decisionState.decidedAt,
  ].join("|");
}

function validTarget(value: string | null): value is string {
  return value !== null && !Number.isNaN(Date.parse(value));
}

function formatTarget(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatCash(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  } catch {
    return `${new Intl.NumberFormat(locale).format(amount)} ${currency}`;
  }
}

export function RewardPendingCard({
  missionTitle,
  pendingReward,
  supportHref,
}: RewardPendingCardProps) {
  const { lang, localeReady, t } = useI18n();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const locale = lang === "zh" ? "zh-HK" : "en-US";
  const cancelled = pendingReward.status === "cancelled"
    || pendingReward.decisionState.kind === "cancelled";
  const identity = projectionIdentity(pendingReward, supportHref);
  const deviceCategory = getDeviceCategory();
  const workflowState = cancelled ? "proof_verified" as const : "reward_pending" as const;
  const hasPoints = pendingReward.reward.pointsAmount > 0;
  const hasCash = pendingReward.reward.cashAmount > 0;
  const hasXp = pendingReward.reward.xpAmount > 0;

  useEffect(() => {
    if (!localeReady || cancelled || !rememberOnce(viewedProjectionIdentities, identity)) return;
    trackActivationEvent("mission_reward_pending_viewed", {
      locale: lang, deviceCategory, workflowState, hasPoints, hasCash, hasXp,
    });
  }, [
    cancelled,
    deviceCategory,
    hasCash,
    hasPoints,
    hasXp,
    identity,
    lang,
    localeReady,
    workflowState,
  ]);

  useEffect(() => {
    if (!rememberOnce(focusedProjectionIdentities, identity)) return;
    headingRef.current?.focus();
  }, [identity]);

  function trackSupportSelection() {
    trackActivationEvent("mission_reward_support_selected", {
      locale: lang, deviceCategory, workflowState, hasPoints, hasCash, hasXp,
    });
  }

  const targetAt = validTarget(pendingReward.targetAt) ? pendingReward.targetAt : null;

  return (
    <section
      aria-label={t("app.activeMission.rewardPending.ariaLabel", { missionTitle })}
      className="min-w-0 max-w-full overflow-hidden rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)] sm:p-6"
    >
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {t(cancelled
          ? "app.activeMission.rewardPending.cancelledAnnouncement"
          : "app.activeMission.rewardPending.announcement")}
      </p>
      <p className="font-mono text-xs font-bold uppercase tracking-wider text-[var(--color-soft-ink)]">
        {t(cancelled
          ? "app.activeMission.rewardPending.cancelledStatus"
          : "app.activeMission.rewardPending.status")}
      </p>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="mt-2 break-words font-heading text-2xl font-black text-pretty focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {t(cancelled
          ? "app.activeMission.rewardPending.cancelledTitle"
          : "app.activeMission.rewardPending.title")}
      </h2>
      <p className="mt-3 break-words text-sm leading-6 text-[var(--color-soft-ink)]">
        {t(cancelled
          ? "app.activeMission.rewardPending.cancelledBody"
          : "app.activeMission.rewardPending.body")}
      </p>

      {!cancelled ? (
        <>
          <dl className="mt-5 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
            {pendingReward.reward.pointsAmount > 0 ? (
              <div className="min-w-0 rounded-xl bg-[var(--color-paper)] p-3">
                <dt className="text-xs font-bold uppercase tracking-wide text-[var(--color-soft-ink)]">{t("app.activeMission.rewardPending.points")}</dt>
                <dd className="mt-1 break-words font-heading text-xl font-black">{new Intl.NumberFormat(locale).format(pendingReward.reward.pointsAmount)}</dd>
              </div>
            ) : null}
            {pendingReward.reward.cashAmount > 0 ? (
              <div className="min-w-0 rounded-xl bg-[var(--color-paper)] p-3">
                <dt className="text-xs font-bold uppercase tracking-wide text-[var(--color-soft-ink)]">{t("app.activeMission.rewardPending.cash")}</dt>
                <dd className="mt-1 break-words font-heading text-xl font-black">{formatCash(pendingReward.reward.cashAmount, pendingReward.reward.currency, locale)}</dd>
              </div>
            ) : null}
            {pendingReward.reward.xpAmount > 0 ? (
              <div className="min-w-0 rounded-xl bg-[var(--color-paper)] p-3">
                <dt className="text-xs font-bold uppercase tracking-wide text-[var(--color-soft-ink)]">{t("app.activeMission.rewardPending.xp")}</dt>
                <dd className="mt-1 break-words font-heading text-xl font-black">{new Intl.NumberFormat(locale).format(pendingReward.reward.xpAmount)}</dd>
              </div>
            ) : null}
          </dl>

          <div className="mt-5 min-w-0 rounded-xl border-2 border-[var(--color-ink)] p-4 text-sm">
            {targetAt ? (
              <p className="break-words">
                <span className="font-bold">{t("app.activeMission.rewardPending.target")}: </span>
                <time dateTime={targetAt}>{formatTarget(targetAt, locale)}</time>
              </p>
            ) : (
              <p className="break-words font-semibold">{t("app.activeMission.rewardPending.noTarget")}</p>
            )}
            {pendingReward.processingWindowDays ? (
              <p className="mt-2 break-words text-[var(--color-soft-ink)]">
                {t("app.activeMission.rewardPending.processingWindow", {
                  days: pendingReward.processingWindowDays,
                })}
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      <a
        href={supportHref}
        onClick={trackSupportSelection}
        className="mt-5 inline-flex min-h-11 max-w-full touch-manipulation items-center break-words rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-ink)] px-5 py-2.5 text-center font-heading font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {t("app.activeMission.rewardPending.support")}
      </a>
    </section>
  );
}
