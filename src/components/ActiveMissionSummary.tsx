import { useId } from "react";
import { useI18n } from "../lib/i18n";
import type { MyMission } from "../lib/queries/kocmax";

const ACTIVE_STATUSES = new Set<MyMission["status"]>([
  "joined",
  "submitted",
  "under_review",
]);

const STATUS_KEY: Partial<Record<MyMission["status"], string>> = {
  joined: "app.activation.missions.status.joined",
  submitted: "app.activation.missions.status.submitted",
  under_review: "app.activation.missions.status.underReview",
};

export function ActiveMissionSummary({
  missions,
  isLoading,
  isError,
  onRetry,
  getMissionHref,
}: {
  missions: MyMission[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  getMissionHref?: (mission: MyMission) => string;
}) {
  const { t } = useI18n();
  const headingId = useId();
  const activeMissions = missions.filter(({ status }) => ACTIVE_STATUSES.has(status));

  if (!isLoading && !isError && activeMissions.length === 0) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="pastel-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-5"
    >
      <h2 id={headingId} className="font-heading text-lg font-bold">
        {t("app.activation.missions.heading")}
      </h2>
      {isError ? (
        <div role="alert" className="mt-3 text-sm">
          <p>{t("app.activation.missions.error")}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 min-h-11 rounded-full border-2 border-[var(--color-ink)] px-4 py-2 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {t("app.activation.missions.retry")}
          </button>
        </div>
      ) : isLoading ? (
        <p role="status" className="mt-3 text-sm text-[var(--color-soft-ink)]">
          {t("app.activation.missions.loading")}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {activeMissions.map((mission) => (
            <li key={mission.id}>
              <a
                href={getMissionHref?.(mission) ?? `/mission/${mission.missions.slug}`}
                className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-[var(--color-ink)] p-3 no-underline transition hover:bg-[var(--color-paper)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <span className="min-w-0 font-heading text-sm font-semibold">
                  {mission.missions.title}
                </span>
                <span className="shrink-0 rounded-full border border-[var(--color-ink)] px-2 py-0.5 font-mono text-[10px] uppercase">
                  {t(STATUS_KEY[mission.status] ?? mission.status)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
