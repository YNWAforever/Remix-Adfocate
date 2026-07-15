import { useId } from "react";
import type {
  ActivationMilestone,
  CreatorActivationSnapshot,
} from "../lib/creatorActivation";
import { useI18n } from "../lib/i18n";

const STATE_KEY: Record<ActivationMilestone["state"], string> = {
  complete: "app.activation.state.complete",
  recommended: "app.activation.state.recommended",
  blocked: "app.activation.state.blocked",
  not_applicable: "app.activation.state.notApplicable",
};

export function ActivationProgressCard({
  snapshot,
  compact = false,
}: {
  snapshot: CreatorActivationSnapshot;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const headingId = useId();
  const readinessMilestones = snapshot.milestones.filter(
    ({ countsTowardReadiness }) => countsTowardReadiness,
  );
  const completed = readinessMilestones.filter(
    ({ state }) => state === "complete",
  ).length;
  const percent = Math.max(0, Math.min(100, snapshot.readinessPercent));
  const summary = t("app.activation.progress.summary", {
    completed,
    total: readinessMilestones.length,
  });
  const shownMilestones = compact ? readinessMilestones : snapshot.milestones;

  return (
    <section
      aria-labelledby={headingId}
      className="pastel-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-5"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 id={headingId} className="font-heading text-lg font-bold">
          {t("app.activation.progress.heading")}
        </h2>
        <span className="font-mono text-sm font-bold">{percent}%</span>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-[var(--color-soft-ink)]">
        {t("app.activation.progress.explanation")}
      </p>
      <div
        className="mt-3 h-3 overflow-hidden rounded-full border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)]"
        role="progressbar"
        aria-label={t("app.activation.progress.heading")}
        aria-valuemin={0}
        aria-valuemax={snapshot.totalReadinessWeight}
        aria-valuenow={snapshot.completedReadinessWeight}
        aria-valuetext={summary}
      >
        <div
          className="h-full bg-[var(--color-acid)]"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-[var(--color-soft-ink)]">{summary}</p>
      <ul className="mt-4 space-y-3">
        {shownMilestones.map((milestone) => (
          <li
            key={milestone.id}
            className="rounded-xl border border-[var(--color-ink)] p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="font-heading text-sm font-semibold">
                {t(milestone.labelKey)}
              </p>
              <span className="shrink-0 rounded-full border border-[var(--color-ink)] px-2 py-0.5 font-mono text-[10px] uppercase">
                {t(STATE_KEY[milestone.state])}
              </span>
            </div>
            {!compact ? (
              <p className="mt-1 text-xs leading-relaxed text-[var(--color-soft-ink)]">
                {t(milestone.benefitKey)}
              </p>
            ) : null}
            {!compact && milestone.action ? (
              <a
                href={milestone.action.to}
                className="mt-2 inline-flex min-h-11 items-center rounded-lg px-1 text-sm font-bold underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {t(milestone.action.labelKey)}
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
