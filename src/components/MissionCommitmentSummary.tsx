import type { ReactNode } from "react";
import { formatCreatorDate, formatMissionReward } from "@/lib/creatorFormatting";
import { useI18n } from "@/lib/i18n";
import { effortLabelKey, platformLabelKey } from "@/lib/missionMeta";
import type { Mission } from "@/lib/queries/kocmax";

type MissionCommitmentSummaryProps = {
  mission: Mission;
  locale: "en" | "zh";
};

function CommitmentFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-soft-ink)]">{label}</dt>
      <dd className="text-sm font-medium text-[var(--color-ink)]">{children}</dd>
    </div>
  );
}

export function MissionCommitmentSummary({
  mission,
  locale,
}: MissionCommitmentSummaryProps) {
  const { t } = useI18n();
  const deadline = formatCreatorDate(mission.deadline, locale);
  const effortKey = effortLabelKey(mission.effort);
  const platforms = mission.platforms?.filter(Boolean) ?? [];
  const deliverables = mission.deliverables?.filter(Boolean) ?? [];

  return (
    <section className="pastel-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
      <h3 className="font-heading text-lg font-bold">{t("app.mission.commitment.heading")}</h3>
      <dl className="mt-3 grid gap-4">
        <CommitmentFact label={t("app.mission.commitment.deliverables")}>
          {deliverables.length ? (
            <ul className="list-disc space-y-1 pl-5">
              {deliverables.map((deliverable) => <li key={deliverable}>{deliverable}</li>)}
            </ul>
          ) : (
            t("app.mission.commitment.deliverablesUnavailable")
          )}
        </CommitmentFact>
        {platforms.length ? (
          <CommitmentFact label={t("app.mission.commitment.platforms")}>
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              {platforms.map((platform) => <li key={platform}>{t(platformLabelKey(platform))}</li>)}
            </ul>
          </CommitmentFact>
        ) : null}
        {deadline ? (
          <CommitmentFact label={t("app.mission.commitment.deadline")}>{deadline}</CommitmentFact>
        ) : null}
        <CommitmentFact label={t("app.mission.commitment.reward")}>
          {formatMissionReward({ points: mission.points_reward, cash: mission.cash_reward }, locale)}
        </CommitmentFact>
        {effortKey ? (
          <CommitmentFact label={t("app.mission.commitment.effort")}>{t(effortKey)}</CommitmentFact>
        ) : null}
      </dl>
    </section>
  );
}
