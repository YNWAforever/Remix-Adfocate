import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type {
  RewardHandoffListFilters,
  RewardHandoffQueueItem,
} from "@/lib/adminRewardHandoff";
import { useI18n } from "@/lib/i18n";
import { useStaffAccess } from "./StaffAccessContext";

export type RewardHandoffUiFilters = Pick<
  RewardHandoffListFilters,
  "due" | "component" | "status"
>;

type Props = {
  workspaceKey: string;
  items: RewardHandoffQueueItem[];
  filters: RewardHandoffUiFilters;
  processingWindowDays: number | null;
  onFiltersChange: (filters: RewardHandoffUiFilters) => void;
  onSaveProcessingWindow: (days: number | null) => Promise<void>;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => Promise<void>;
};

const FIELD =
  "h-10 min-w-0 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-3 text-sm";
const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function validDate(value: string | null): value is string {
  if (!value) return false;
  const match = RFC3339.exec(value);
  if (!match) return false;
  const [, y, m, d, h, min, sec, offset] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]!) return false;
  if (Number(h) > 23 || Number(min) > 59 || Number(sec) > 59) return false;
  if (offset !== "Z" && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59)) {
    return false;
  }
  return Number.isFinite(new Date(value).getTime());
}

function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function formatCash(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  } catch {
    return new Intl.NumberFormat(locale).format(amount) + " " + currency;
  }
}

function normalizedFilters(filters: RewardHandoffUiFilters): RewardHandoffUiFilters {
  return {
    ...(filters.due ? { due: filters.due } : {}),
    ...(filters.component ? { component: filters.component } : {}),
    status: filters.status || "pending",
  };
}

export function RewardHandoffQueue(props: Props) {
  return <RewardHandoffQueueWorkspace key={props.workspaceKey} {...props} />;
}

function RewardHandoffQueueWorkspace({
  items,
  filters,
  processingWindowDays,
  onFiltersChange,
  onSaveProcessingWindow,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: Props) {
  const { lang, localeReady, t } = useI18n();
  const access=useStaffAccess(),canEditSettings=!access||access.can("reward.settings");
  const canOpenTimeline=!access||["submission.review","proof.review","completion.approve"].some(cap=>access.can(cap as "submission.review"|"proof.review"|"completion.approve"));
  const locale = lang === "zh" ? "zh-HK" : "en-US";
  const [draftFilters, setDraftFilters] = useState<RewardHandoffUiFilters>(
    normalizedFilters(filters),
  );
  const [windowDraft, setWindowDraft] = useState(
    processingWindowDays === null ? "" : String(processingWindowDays),
  );
  const mountedRef = useRef(true);
  const [saveState, setSaveState] = useState<
    | { kind: "idle" | "saving" | "error" }
    | { kind: "saved"; days: number | null }
  >({ kind: "idle" });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setDraftFilters(normalizedFilters(filters));
  }, [filters]);

  useEffect(() => {
    setWindowDraft(processingWindowDays === null ? "" : String(processingWindowDays));
  }, [processingWindowDays]);

  const targeted = items.filter((handoff) => validDate(handoff.targetAt));
  const noTarget = items.filter((handoff) => !validDate(handoff.targetAt));

  async function saveWindow() {
    const trimmed = windowDraft.trim();
    const days = trimmed === "" ? null : Number(trimmed);
    if (
      days !== null
      && (!Number.isFinite(days) || !Number.isInteger(days) || days < 0 || days > 365)
    ) {
      setSaveState({ kind: "error" });
      return;
    }
    setSaveState({ kind: "saving" });
    try {
      await onSaveProcessingWindow(days);
      if (mountedRef.current) setSaveState({ kind: "saved", days });
    } catch {
      if (mountedRef.current) setSaveState({ kind: "error" });
    }
  }

  function renderReward(item: RewardHandoffQueueItem) {
    const rewards: string[] = [];
    if (positiveFinite(item.reward.pointsAmount)) {
      rewards.push(t("app.admin.rewardHandoff.points", { count: item.reward.pointsAmount }));
    }
    if (positiveFinite(item.reward.cashAmount)) {
      rewards.push(formatCash(item.reward.cashAmount, item.reward.currency, locale));
    }
    if (positiveFinite(item.reward.xpAmount)) {
      rewards.push(t("app.admin.rewardHandoff.xp", { count: item.reward.xpAmount }));
    }
    return rewards.length > 0
      ? rewards.join(" · ")
      : t("app.admin.rewardHandoff.noRewardComponents");
  }

  function target(item: RewardHandoffQueueItem) {
    return validDate(item.targetAt)
      ? formatDate(item.targetAt, locale)
      : t("app.admin.rewardHandoff.noTarget");
  }

  function decision(item: RewardHandoffQueueItem) {
    const decidedAt = item.completionDecision?.decidedAt ?? null;
    return validDate(decidedAt)
      ? formatDate(decidedAt, locale)
      : t("app.admin.rewardHandoff.notAvailable");
  }

  function evidence(item: RewardHandoffQueueItem) {
    return item.completionDecision?.evidenceAvailable
      ? t("app.admin.rewardHandoff.evidenceAvailable")
      : t("app.admin.rewardHandoff.evidenceUnavailable");
  }

  function status(item: RewardHandoffQueueItem) {
    return t(item.status === "cancelled"
      ? "app.admin.rewardHandoff.status.cancelled"
      : "app.admin.rewardHandoff.status.pending");
  }

  const groups = [
    { key: "target", title: t("app.admin.rewardHandoff.targetDates"), rows: targeted },
    { key: "none", title: t("app.admin.rewardHandoff.noTarget"), rows: noTarget },
  ].filter((group) => group.rows.length > 0);

  const savedMessage = saveState.kind === "saved" && localeReady
    ? saveState.days === null
      ? t("app.admin.rewardHandoff.sla.savedNull")
      : t("app.admin.rewardHandoff.sla.saved", { count: saveState.days })
    : "";

  return (
    <section
      aria-labelledby="reward-handoff-heading"
      data-testid="reward-handoff-responsive-shell"
      className="min-w-0 max-w-full space-y-5 overflow-hidden"
    >
      <div>
        <h2 id="reward-handoff-heading" className="font-display text-2xl font-bold">
          {t("app.admin.rewardHandoff.title")}
        </h2>
        <p className="text-sm text-[var(--color-soft-ink)]">
          {t("app.admin.rewardHandoff.subtitle")}
        </p>
      </div>

      <section
        aria-labelledby="reward-handoff-sla-heading"
        className="min-w-0 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4"
      >
        <h3 id="reward-handoff-sla-heading" className="font-heading text-lg font-bold">
          {t("app.admin.rewardHandoff.sla.title")}
        </h3>
        <p className="text-sm text-[var(--color-soft-ink)]">
          {t("app.admin.rewardHandoff.sla.help")}
        </p>
        {canEditSettings?<div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
          <label className="grid min-w-0 flex-1 gap-1 text-sm font-bold">
            {t("app.admin.rewardHandoff.sla.label")}
            <input
              className={FIELD}
              inputMode="numeric"
              aria-describedby="reward-processing-window-unit"
              value={windowDraft}
              onChange={(event) => {
                setWindowDraft(event.target.value);
                setSaveState({ kind: "idle" });
              }}
              disabled={saveState.kind === "saving"}
            />
          </label>
          <span id="reward-processing-window-unit" className="text-sm font-medium">
            {t("app.admin.rewardHandoff.sla.unit")}
          </span>
          <button
            type="button"
            onClick={() => void saveWindow()}
            disabled={saveState.kind === "saving"}
            className="h-10 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-4 font-heading text-sm font-bold hover:brightness-95 disabled:opacity-60"
          >
            {saveState.kind === "saving"
              ? t("app.admin.rewardHandoff.sla.saving")
              : t("app.admin.rewardHandoff.sla.save")}
          </button>
        </div>:<p className="mt-3 text-sm">Read only / 只供檢視 · {processingWindowDays===null?"No assigned window / 未設定時限":`${processingWindowDays} days / 日`}</p>}
        {canEditSettings && saveState.kind === "error" ? (
          <p role="alert" className="mt-2 text-sm font-bold text-red-700">
            {windowDraft.trim() !== ""
              && (!Number.isFinite(Number(windowDraft))
                || !Number.isInteger(Number(windowDraft))
                || Number(windowDraft) < 0
                || Number(windowDraft) > 365)
              ? t("app.admin.rewardHandoff.sla.invalid")
              : t("app.admin.rewardHandoff.sla.error")}
          </p>
        ) : null}
        <p role="status" aria-live="polite" aria-atomic="true" className="mt-2 text-sm font-bold">
          {savedMessage}
        </p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-sm font-bold">
          {t("app.admin.rewardHandoff.filter.due")}
          <select
            className={FIELD}
            value={draftFilters.due ?? ""}
            onChange={(event) => setDraftFilters((current) => ({
              ...current,
              due: event.target.value as RewardHandoffUiFilters["due"],
            }))}
          >
            <option value="">{t("app.admin.rewardHandoff.filter.allDue")}</option>
            <option value="overdue">{t("app.admin.rewardHandoff.filter.overdue")}</option>
            <option value="due_soon">{t("app.admin.rewardHandoff.filter.dueSoon")}</option>
            <option value="no_target">{t("app.admin.rewardHandoff.noTarget")}</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-bold">
          {t("app.admin.rewardHandoff.filter.component")}
          <select
            className={FIELD}
            value={draftFilters.component ?? ""}
            onChange={(event) => setDraftFilters((current) => ({
              ...current,
              component: event.target.value as RewardHandoffUiFilters["component"],
            }))}
          >
            <option value="">{t("app.admin.rewardHandoff.filter.allComponents")}</option>
            <option value="points">{t("app.admin.rewardHandoff.filter.points")}</option>
            <option value="cash">{t("app.admin.rewardHandoff.filter.cash")}</option>
            <option value="xp">{t("app.admin.rewardHandoff.filter.xp")}</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-bold">
          {t("app.admin.rewardHandoff.filter.status")}
          <select
            className={FIELD}
            value={draftFilters.status ?? "pending"}
            onChange={(event) => setDraftFilters((current) => ({
              ...current,
              status: event.target.value as RewardHandoffUiFilters["status"],
            }))}
          >
            <option value="pending">{t("app.admin.rewardHandoff.status.pending")}</option>
            <option value="cancelled">{t("app.admin.rewardHandoff.status.cancelled")}</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => onFiltersChange(normalizedFilters(draftFilters))}
          className="h-10 self-end rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-sky)] px-4 font-heading text-sm font-bold hover:brightness-95"
        >
          {t("app.admin.rewardHandoff.filter.apply")}
        </button>
      </div>

      {items.length === 0 ? (
        <p className="rounded-[var(--radius)] border-2 border-dashed border-[var(--color-ink)] p-6 text-sm">
          {t("app.admin.rewardHandoff.empty")}
        </p>
      ) : (
        <div className="min-w-0 space-y-6">
          {groups.map((group) => (
            <section key={group.key} aria-labelledby={"reward-group-" + group.key}>
              <h3 id={"reward-group-" + group.key} className="font-heading text-lg font-bold">
                {group.title}
              </h3>
              <div className="mt-2 grid min-w-0 gap-3 md:hidden">
                {group.rows.map((item) => (
                  <article
                    key={item.id}
                    data-testid="reward-handoff-row"
                    className="min-w-0 overflow-hidden rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[3px_3px_0_var(--color-ink)]"
                  >
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-words font-heading font-bold">
                          {item.creatorDisplayName ?? t("app.admin.rewardHandoff.unknownCreator")}
                        </p>
                        <p className="break-words text-sm text-[var(--color-soft-ink)]">
                          {item.missionTitle ?? t("app.admin.rewardHandoff.unknownMission")}
                        </p>
                      </div>
                      <span className="rounded-full border-2 border-[var(--color-ink)] px-2 py-1 text-xs font-bold">
                        {status(item)}
                      </span>
                    </div>
                    <dl className="mt-3 grid min-w-0 gap-2 text-sm">
                      <div><dt className="font-bold">{t("app.admin.rewardHandoff.reward")}</dt><dd className="break-words">{renderReward(item)}</dd></div>
                      <div><dt className="font-bold">{t("app.admin.rewardHandoff.target")}</dt><dd>{target(item)}</dd></div>
                      <div><dt className="font-bold">{t("app.admin.rewardHandoff.decision")}</dt><dd>{decision(item)}</dd></div>
                      <div><dt className="font-bold">{t("app.admin.rewardHandoff.evidence")}</dt><dd>{evidence(item)}</dd></div>
                    </dl>
                    {canOpenTimeline ? <Link
                      to="/admin/active-missions/$workflowId"
                      params={{ workflowId: item.workflowId }}
                      search={{ workItemId: undefined }}
                      className="mt-3 inline-flex rounded-full border-2 border-[var(--color-ink)] bg-white px-4 py-2 font-heading text-sm font-bold hover:bg-[var(--color-paper)]"
                    >
                      {t("app.admin.rewardHandoff.timeline")}
                    </Link> : null}
                  </article>
                ))}
              </div>
              <div className="mt-2 hidden max-w-full overflow-x-auto md:block">
                <table className="w-full min-w-[48rem] border-separate border-spacing-0 text-left text-sm">
                  <thead>
                    <tr>
                      {["creator", "mission", "reward", "target", "decision", "evidence", "status", "timeline"].map((key) => (
                        <th key={key} className="border-b-2 border-[var(--color-ink)] p-2 font-bold">
                          {t("app.admin.rewardHandoff." + key)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((item) => (
                      <tr key={item.id}>
                        <td className="max-w-48 break-words border-b p-2">{item.creatorDisplayName ?? t("app.admin.rewardHandoff.unknownCreator")}</td>
                        <td className="max-w-48 break-words border-b p-2">{item.missionTitle ?? t("app.admin.rewardHandoff.unknownMission")}</td>
                        <td className="border-b p-2">{renderReward(item)}</td>
                        <td className="border-b p-2">{target(item)}</td>
                        <td className="border-b p-2">{decision(item)}</td>
                        <td className="border-b p-2">{evidence(item)}</td>
                        <td className="border-b p-2">{status(item)}</td>
                        <td className="border-b p-2">
                          {canOpenTimeline ? <Link
                            to="/admin/active-missions/$workflowId"
                            params={{ workflowId: item.workflowId }}
                            search={{ workItemId: undefined }}
                            className="font-bold underline hover:text-[var(--color-soft-ink)]"
                          >
                            {t("app.admin.rewardHandoff.timeline")}
                          </Link> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
      {hasMore ? (
        <button
          type="button"
          disabled={loadingMore}
          onClick={() => void onLoadMore?.()}
          className="mx-auto block rounded-full border-2 border-[var(--color-ink)] bg-white px-5 py-2 font-heading text-sm font-bold hover:bg-[var(--color-paper)] disabled:opacity-60"
        >
          {loadingMore
            ? t("app.admin.rewardHandoff.loadingMore")
            : t("app.admin.rewardHandoff.loadMore")}
        </button>
      ) : null}
    </section>
  );
}
