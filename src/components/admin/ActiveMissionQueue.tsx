import { useEffect, useState } from "react";
import type { ActiveMissionQueueItem, ActiveMissionRiskBucket, ActiveMissionReviewState } from "@/lib/admin";
import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";

export type ActiveMissionQueueUiFilters = {
  risk?: ActiveMissionRiskBucket;
  state?: ActiveMissionReviewState;
  reviewer?: string;
  mission?: string;
};

type Props = {
  items: ActiveMissionQueueItem[];
  filters?: ActiveMissionQueueUiFilters;
  onFiltersChange?: (filters: ActiveMissionQueueUiFilters) => void;
  now?: Date;
};

const FIELD = "h-10 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-3 text-sm";
const EMPTY_FILTERS: ActiveMissionQueueUiFilters = {};

function isoDay(value: Date) {
  return value.toISOString().slice(0, 10);
}

const RISK_KEYS: Record<ActiveMissionRiskBucket, string> = {
  overdue: "app.admin.activeMission.queue.risk.overdue",
  due_soon: "app.admin.activeMission.queue.risk.dueSoon",
  on_track: "app.admin.activeMission.queue.risk.onTrack",
  no_sla: "app.admin.activeMission.queue.risk.noSla",
};

type Translate = ReturnType<typeof useI18n>["t"];

function dueLabel(value: string | null, now: Date, t: Translate, locale: string) {
  if (!value) return t("app.admin.activeMission.queue.noSlaDeadline");
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return t("app.admin.activeMission.queue.noSlaDeadline");
  if (isoDay(due) === isoDay(now)) return t("app.admin.activeMission.queue.dueToday");
  if (due.getTime() < now.getTime()) return t("app.admin.activeMission.queue.risk.overdue");
  return t("app.admin.activeMission.queue.dueDate", { date: due.toLocaleDateString(locale) });
}

function submittedLabel(value: string | null, now: Date, t: Translate) {
  if (!value) return t("app.admin.activeMission.queue.submissionUnavailable");
  const elapsed = Math.max(0, now.getTime() - new Date(value).getTime());
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 1) return t("app.admin.activeMission.queue.submittedLessHour");
  if (hours < 24) return t("app.admin.activeMission.queue.submittedHours", { count: hours });
  const days = Math.floor(hours / 24);
  return t("app.admin.activeMission.queue.submittedDays", { count: days });
}

export function ActiveMissionQueue({ items, filters = EMPTY_FILTERS, onFiltersChange, now = new Date() }: Props) {
  const { lang, t } = useI18n();
  const locale = lang === "zh" ? "zh-HK" : "en-US";
  const [draftFilters, setDraftFilters] = useState<ActiveMissionQueueUiFilters>(filters);
  useEffect(() => {
    setDraftFilters(filters);
  }, [filters]);

  const applyFilters = () => {
    const next = {
      ...draftFilters,
      reviewer: draftFilters.reviewer?.trim(),
      mission: draftFilters.mission?.trim(),
    };
    for (const key of Object.keys(next) as Array<keyof ActiveMissionQueueUiFilters>) {
      if (!next[key]) delete next[key];
    }
    onFiltersChange?.(next);
  };

  return (
    <section aria-labelledby="active-mission-queue-heading" className="space-y-4">
      <div>
        <h2 id="active-mission-queue-heading" className="font-display text-2xl font-bold">{t("app.admin.activeMission.queue.title")}</h2>
        <p className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.activeMission.queue.subtitle")}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <label className="grid gap-1 text-sm font-bold">
          {t("app.admin.activeMission.queue.risk")}
          <select className={FIELD} value={draftFilters.risk ?? ""} onChange={(event) => setDraftFilters((current) => ({ ...current, risk: event.target.value as ActiveMissionRiskBucket || undefined }))}>
            <option value="">{t("app.admin.activeMission.queue.allRisk")}</option>
            <option value="overdue">{t(RISK_KEYS.overdue)}</option>
            <option value="due_soon">{t(RISK_KEYS.due_soon)}</option>
            <option value="on_track">{t(RISK_KEYS.on_track)}</option>
            <option value="no_sla">{t(RISK_KEYS.no_sla)}</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-bold">
          {t("app.admin.activeMission.queue.state")}
          <select className={FIELD} value={draftFilters.state ?? ""} onChange={(event) => setDraftFilters((current) => ({ ...current, state: event.target.value as ActiveMissionReviewState || undefined }))}>
            <option value="">{t("app.admin.activeMission.queue.allStates")}</option>
            <option value="submitted">{t("app.admin.activeMission.queue.state.submitted")}</option>
            <option value="under_review">{t("app.admin.activeMission.queue.state.underReview")}</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-bold">
          {t("app.admin.activeMission.queue.reviewer")}
          <input className={FIELD} value={draftFilters.reviewer ?? ""} onChange={(event) => setDraftFilters((current) => ({ ...current, reviewer: event.target.value }))} placeholder={t("app.admin.activeMission.queue.reviewerId")} />
        </label>
        <label className="grid gap-1 text-sm font-bold">
          {t("app.admin.activeMission.queue.mission")}
          <input className={FIELD} value={draftFilters.mission ?? ""} onChange={(event) => setDraftFilters((current) => ({ ...current, mission: event.target.value }))} placeholder={t("app.admin.activeMission.queue.missionId")} />
        </label>
        <button
          type="button"
          onClick={applyFilters}
          className="h-10 self-end rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-4 font-heading text-sm font-bold"
        >{t("app.admin.activeMission.queue.apply")}</button>
      </div>

      {items.length === 0 ? (
        <p className="rounded-[var(--radius)] border-2 border-dashed border-[var(--color-ink)] p-6 text-sm">{t("app.admin.activeMission.queue.empty")}</p>
      ) : (
        <ol className="space-y-3">
          {items.map((item) => (
            <li key={item.workItemId} data-testid="queue-item" className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[3px_3px_0_var(--color-ink)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-heading text-lg font-bold">{item.deliverableTitle}</p>
                  <p className="text-sm text-[var(--color-soft-ink)]">
                    <span>{item.missionTitle}</span>
                    <span> · </span>
                    <span>{item.creatorDisplayName}</span>
                  </p>
                </div>
                <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-2 py-1 text-xs font-bold">{dueLabel(item.reviewDueAt, now, t, locale)}</span>
              </div>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="font-bold">{t("app.admin.activeMission.queue.sla")}</dt><dd>{t(RISK_KEYS[item.riskBucket])}</dd></div>
                <div><dt className="font-bold">{t("app.admin.activeMission.queue.submitted")}</dt><dd>{submittedLabel(item.submittedAt, now, t).replace(lang === "en" ? "Submitted " : "", "")}</dd></div>
                <div><dt className="font-bold">{t("app.admin.activeMission.queue.creatorDeadline")}</dt><dd>{item.creatorDeadline ? new Date(item.creatorDeadline).toLocaleString(locale) : t("app.admin.activeMission.queue.none")}</dd></div>
                <div><dt className="font-bold">{t("app.admin.activeMission.queue.reviewOwner")}</dt><dd>{item.reviewerId ?? t("app.admin.activeMission.queue.unassigned")}</dd></div>
              </dl>
              <p className="mt-2 text-sm font-medium">{submittedLabel(item.submittedAt, now, t)}</p>
              <Link to="/admin/active-missions/$workflowId" params={{ workflowId: item.workflowId }} search={{ workItemId: item.workItemId }} className="mt-3 inline-flex rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-sky)] px-4 py-2 font-heading text-sm font-bold">
                {t("app.admin.activeMission.queue.review")}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
