import { useEffect, useState } from "react";
import type { ActiveMissionQueueItem, ActiveMissionRiskBucket, ActiveMissionReviewState } from "@/lib/admin";
import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { dueLabel as classifyDue, WORKSPACE_TIMEZONE } from "@/lib/workspaceCalendar";

export type ActiveMissionQueueUiFilters = {
  risk?: ActiveMissionRiskBucket;
  state?: ActiveMissionReviewState;
  reviewer?: string;
  mission?: string;
  proofState?: string;
  late?: boolean;
  metadataStatus?: string;
  platform?: string;
  publicationDeadline?: string;
};

type Props = {
  items: ActiveMissionQueueItem[];
  filters?: ActiveMissionQueueUiFilters;
  onFiltersChange?: (filters: ActiveMissionQueueUiFilters) => void;
  now?: Date;
};

const FIELD = "h-10 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-3 text-sm";
const EMPTY_FILTERS: ActiveMissionQueueUiFilters = {};

const RISK_KEYS: Record<ActiveMissionRiskBucket, string> = {
  overdue: "app.admin.activeMission.queue.risk.overdue",
  due_soon: "app.admin.activeMission.queue.risk.dueSoon",
  on_track: "app.admin.activeMission.queue.risk.onTrack",
  no_sla: "app.admin.activeMission.queue.risk.noSla",
};

type Translate = ReturnType<typeof useI18n>["t"];

function dueLabel(value: string | null, now: Date, t: Translate, locale: string) {
  const label = classifyDue(value, now);
  if (label === "unknown" || !value) return t("app.admin.activeMission.queue.noSlaDeadline");
  if (label === "overdue") return t("app.admin.activeMission.queue.risk.overdue");
  if (label === "today") return t("app.admin.activeMission.queue.dueToday");
  return t("app.admin.activeMission.queue.dueDate", { date: new Date(value).toLocaleDateString(locale, { timeZone: WORKSPACE_TIMEZONE }) });
}

function submittedLabel(value: string | null, now: Date, t: Translate) {
  if (!value || !Number.isFinite(Date.parse(value))) return t("app.admin.activeMission.queue.submissionUnavailable");
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
  const proofCopy = lang === "zh" ? {
    proofState: "證明狀態", allProofStates: "所有證明狀態", lateness: "提交時限",
    allLateness: "所有提交", late: "逾期", onTime: "準時",
    metadataStatus: "頁面資料狀態", allMetadata: "所有頁面資料狀態",
    available: "可用", unavailable: "不可用", unsafe: "不安全",
    platform: "平台", allPlatforms: "所有平台",
    publicationDeadline: "發佈截止時間", allDeadlines: "所有發佈截止時間",
    overdue: "已逾期", upcoming: "尚未到期", submittedLate: "逾期提交",
  } : {
    proofState: "Proof state", allProofStates: "All proof states", lateness: "Lateness",
    allLateness: "All submissions", late: "Late", onTime: "On time",
    metadataStatus: "Metadata status", allMetadata: "All metadata statuses",
    available: "Available", unavailable: "Unavailable", unsafe: "Unsafe",
    platform: "Platform", allPlatforms: "All platforms",
    publicationDeadline: "Publication deadline", allDeadlines: "All publication deadlines",
    overdue: "Overdue", upcoming: "Upcoming", submittedLate: "Submitted late",
  };
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
      if (next[key] === undefined || next[key] === "") delete next[key];
    }
    onFiltersChange?.(next);
  };

  return (
    <section aria-labelledby="active-mission-queue-heading" className="space-y-4">
      <div>
        <h2 id="active-mission-queue-heading" className="font-display text-2xl font-bold">{t("app.admin.activeMission.queue.title")}</h2>
        <p className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.activeMission.queue.subtitle")}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
        <label className="grid gap-1 text-sm font-bold">
          {proofCopy.proofState}
          <select className={FIELD} value={draftFilters.proofState ?? ""} onChange={(event) => setDraftFilters((current) => ({ ...current, proofState: event.target.value || undefined }))}>
            <option value="">{proofCopy.allProofStates}</option>
            <option value="approved_to_publish">approved_to_publish</option>
            <option value="proof_submitted">proof_submitted</option>
            <option value="proof_under_review">proof_under_review</option>
            <option value="proof_correction_requested">proof_correction_requested</option>
            <option value="proof_verified">proof_verified</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-bold">
          {proofCopy.lateness}
          <select className={FIELD} value={draftFilters.late === undefined ? "" : String(draftFilters.late)} onChange={(event) => setDraftFilters((current) => ({ ...current, late: event.target.value === "" ? undefined : event.target.value === "true" }))}>
            <option value="">{proofCopy.allLateness}</option>
            <option value="true">{proofCopy.late}</option>
            <option value="false">{proofCopy.onTime}</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-bold">
          {proofCopy.metadataStatus}
          <select className={FIELD} value={draftFilters.metadataStatus ?? ""} onChange={(event) => setDraftFilters((current) => ({ ...current, metadataStatus: event.target.value || undefined }))}>
            <option value="">{proofCopy.allMetadata}</option>
            <option value="available">{proofCopy.available}</option>
            <option value="unavailable">{proofCopy.unavailable}</option>
            <option value="unsafe">{proofCopy.unsafe}</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-bold">
          {proofCopy.platform}
          <select className={FIELD} value={draftFilters.platform ?? ""} onChange={(event) => setDraftFilters((current) => ({ ...current, platform: event.target.value || undefined }))}>
            <option value="">{proofCopy.allPlatforms}</option>
            <option value="instagram">Instagram</option>
            <option value="tiktok">TikTok</option>
            <option value="youtube">YouTube</option>
            <option value="facebook">Facebook</option>
            <option value="threads">Threads</option>
            <option value="linkedin">LinkedIn</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-bold">
          {proofCopy.publicationDeadline}
          <select className={FIELD} value={draftFilters.publicationDeadline ?? ""} onChange={(event) => setDraftFilters((current) => ({ ...current, publicationDeadline: event.target.value || undefined }))}>
            <option value="">{proofCopy.allDeadlines}</option>
            <option value="overdue">{proofCopy.overdue}</option>
            <option value="upcoming">{proofCopy.upcoming}</option>
          </select>
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
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-2 py-1 text-xs font-bold">{dueLabel(item.reviewDueAt, now, t, locale)}</span>
                  {"submittedLate" in item && item.submittedLate ? <span className="rounded-full border-2 border-amber-800 bg-amber-100 px-2 py-1 text-xs font-bold">{proofCopy.submittedLate}</span> : null}
                  {"metadataStatus" in item && item.metadataStatus ? <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-1 text-xs font-bold">{String(item.metadataStatus)}</span> : null}
                </div>
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
