import { Clock, Star } from "lucide-react";
import { BadgePill } from "./BadgePill";
import { formatCreatorCurrency, formatCreatorDate } from "@/lib/creatorFormatting";
import { useI18n } from "@/lib/i18n";

type MissionCardProps = {
  title: string;
  category?: string;
  points: number;
  deadline?: string | null;
  imageUrl?: string;
  cashReward?: number | null;
  missionType?: string;
  accessType?: string;
  platform?: string;
  effort?: string;
  matchRationale?: string;
  matchScore?: number;
  status?: string;
};

export function MissionCard({
  title,
  category,
  points,
  deadline,
  imageUrl,
  cashReward,
  missionType,
  accessType,
  platform,
  effort,
  matchRationale,
  matchScore,
  status,
}: MissionCardProps) {
  const { t, lang } = useI18n();
  const formattedDeadline = formatCreatorDate(deadline, lang);
  const facts = [
    cashReward == null
      ? null
      : {
          label: t("app.mission.cardCashReward"),
          value: formatCreatorCurrency(cashReward, lang),
        },
    missionType
      ? { label: t("app.mission.cardMissionType"), value: missionType }
      : null,
    accessType
      ? { label: t("app.mission.cardAccessType"), value: accessType }
      : null,
    platform
      ? { label: t("app.mission.cardPlatform"), value: platform }
      : null,
    effort ? { label: t("app.mission.cardEffort"), value: effort } : null,
    matchRationale
      ? {
          label: t("app.mission.cardMatchRationale"),
          value: matchRationale,
        }
      : null,
    matchScore == null
      ? null
      : {
          label: t("app.mission.cardMatchScore"),
          value: `${Math.round(matchScore <= 1 ? matchScore * 100 : matchScore)}%`,
        },
    status ? { label: t("app.mission.cardStatus"), value: status } : null,
  ].filter((fact): fact is { label: string; value: string } => fact !== null);

  return (
    <article className="pastel-card flex gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border-2 border-[var(--color-ink)] bg-[var(--color-muted,#E4E4E4)]">
        {imageUrl ? (
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        {category ? <BadgePill>{category}</BadgePill> : null}
        <h3 className="mt-1 line-clamp-2 font-heading font-semibold">{title}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--color-soft-ink)]">
          <span className="flex items-center gap-1">
            <Star size={14} aria-hidden="true" />
            {t("app.mission.cardPoints", { n: points })}
          </span>
          {formattedDeadline ? (
            <span className="flex items-center gap-1">
              <Clock size={14} aria-hidden="true" />
              {formattedDeadline}
            </span>
          ) : null}
        </div>
        {facts.length ? (
          <dl className="mt-3 grid gap-1 text-xs">
            {facts.map((fact) => (
              <div key={fact.label} className="grid grid-cols-[auto_1fr] gap-2">
                <dt className="font-semibold text-[var(--color-soft-ink)]">
                  {fact.label}
                </dt>
                <dd className="min-w-0">{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </article>
  );
}
