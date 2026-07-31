import { useEffect, useRef, useSyncExternalStore } from "react";
import type { CreatorPendingReward as PendingReward } from "@/lib/activeMission";
import {
  getActivationAnalyticsSinkVersion,
  getDeviceCategory,
  subscribeActivationAnalyticsSink,
  trackActivationEvent,
} from "@/lib/activationAnalytics";
import { useI18n } from "@/lib/i18n";
import { creatorRewardHandoffKind } from "@/lib/rewardHandoff";

type RewardPendingCardProps = {
  missionTitle: string;
  pendingReward: PendingReward;
  supportHref: string;
};

const viewedProjectionIdentities = new Set<string>();
const focusedProjectionIdentities = new Set<string>();
const MAX_REMEMBERED_PROJECTIONS = 100;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function remember(identities: Set<string>, identity: string): void {
  identities.add(identity);
  if (identities.size > MAX_REMEMBERED_PROJECTIONS) {
    const oldest = identities.values().next().value;
    if (oldest) identities.delete(oldest);
  }
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

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function validTarget(value: string | null): value is string {
  if (value === null) return false;
  const match = RFC3339.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offset] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const monthDays = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]!) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (offset !== "Z") {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  return Number.isFinite(new Date(value).getTime());
}

function formatTarget(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function formatCash(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  } catch {
    return `${new Intl.NumberFormat(locale).format(amount)} ${currency}`;
  }
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function validProcessingWindow(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && Number.isInteger(value) && value >= 0 && value <= 365;
}

export function RewardPendingCard({
  missionTitle,
  pendingReward,
  supportHref,
}: RewardPendingCardProps) {
  const { lang, localeReady, t } = useI18n();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sinkVersion = useSyncExternalStore(
    subscribeActivationAnalyticsSink,
    getActivationAnalyticsSinkVersion,
    () => 0,
  );
  const locale = lang === "zh" ? "zh-HK" : "en-US";
  const handoffKind = creatorRewardHandoffKind(pendingReward);
  const reassessment = handoffKind === "reward_reassessment";
  const identity = projectionIdentity(pendingReward, supportHref);
  const deviceCategory = getDeviceCategory();
  const workflowState = reassessment ? "proof_verified" as const : "reward_pending" as const;
  const hasPoints = isPositiveFinite(pendingReward.reward.pointsAmount);
  const hasCash = isPositiveFinite(pendingReward.reward.cashAmount);
  const hasXp = isPositiveFinite(pendingReward.reward.xpAmount);

  useEffect(() => {
    if (!localeReady || reassessment || viewedProjectionIdentities.has(identity)) return;
    const delivered = trackActivationEvent("mission_reward_pending_viewed", {
      locale: lang, deviceCategory, workflowState, hasPoints, hasCash, hasXp,
    });
    if (delivered) remember(viewedProjectionIdentities, identity);
  }, [
    deviceCategory,
    hasCash,
    hasPoints,
    hasXp,
    identity,
    lang,
    localeReady,
    reassessment,
    sinkVersion,
    workflowState,
  ]);

  useEffect(() => {
    if (!localeReady || focusedProjectionIdentities.has(identity)) return;
    const heading = headingRef.current;
    if (!heading) return;
    heading.focus();
    remember(focusedProjectionIdentities, identity);
  }, [identity, localeReady]);

  function trackSupportSelection() {
    trackActivationEvent("mission_reward_support_selected", {
      locale: lang, deviceCategory, workflowState, hasPoints, hasCash, hasXp,
    });
  }

  const targetAt = validTarget(pendingReward.targetAt) ? pendingReward.targetAt : null;
  const processingWindowDays = validProcessingWindow(pendingReward.processingWindowDays)
    ? pendingReward.processingWindowDays
    : null;

  return (
    <section
      aria-label={t("app.activeMission.rewardPending.ariaLabel", { missionTitle })}
      className="min-w-0 max-w-full overflow-hidden rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)] sm:p-6"
    >
      {localeReady ? (
        <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {t(reassessment
            ? "app.activeMission.rewardPending.cancelledAnnouncement"
            : "app.activeMission.rewardPending.announcement")}
        </p>
      ) : null}
      <p className="font-mono text-xs font-bold uppercase tracking-wider text-[var(--color-soft-ink)]">
        {t(reassessment
          ? "app.activeMission.rewardPending.cancelledStatus"
          : "app.activeMission.rewardPending.status")}
      </p>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="mt-2 break-words font-heading text-2xl font-black text-pretty focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {t(reassessment
          ? "app.activeMission.rewardPending.cancelledTitle"
          : "app.activeMission.rewardPending.title")}
      </h2>
      <p className="mt-3 break-words text-sm leading-6 text-[var(--color-soft-ink)]">
        {t(reassessment
          ? "app.activeMission.rewardPending.cancelledBody"
          : "app.activeMission.rewardPending.body")}
      </p>

      {!reassessment ? (
        <>
          <dl className="mt-5 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
            {hasPoints ? (
              <div className="min-w-0 rounded-xl bg-[var(--color-paper)] p-3">
                <dt className="text-xs font-bold uppercase tracking-wide text-[var(--color-soft-ink)]">{t("app.activeMission.rewardPending.points")}</dt>
                <dd className="mt-1 break-words font-heading text-xl font-black">{new Intl.NumberFormat(locale).format(pendingReward.reward.pointsAmount)}</dd>
              </div>
            ) : null}
            {hasCash ? (
              <div className="min-w-0 rounded-xl bg-[var(--color-paper)] p-3">
                <dt className="text-xs font-bold uppercase tracking-wide text-[var(--color-soft-ink)]">{t("app.activeMission.rewardPending.cash")}</dt>
                <dd className="mt-1 break-words font-heading text-xl font-black">{formatCash(pendingReward.reward.cashAmount, pendingReward.reward.currency, locale)}</dd>
              </div>
            ) : null}
            {hasXp ? (
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
            {processingWindowDays !== null ? (
              <p className="mt-2 break-words text-[var(--color-soft-ink)]">
                {t("app.activeMission.rewardPending.processingWindow", { days: processingWindowDays })}
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      <a
        href={supportHref}
        onClick={trackSupportSelection}
        className="mt-5 inline-flex min-h-11 max-w-full touch-manipulation items-center break-words rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-ink)] px-5 py-2.5 text-center font-heading font-bold text-white hover:bg-[var(--color-acid)] hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {t("app.activeMission.rewardPending.support")}
      </a>
    </section>
  );
}
