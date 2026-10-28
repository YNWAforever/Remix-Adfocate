import { Clock, Star } from "lucide-react";
import { BadgePill } from "./BadgePill";
import { formatCreatorCurrency, formatCreatorDate } from "@/lib/creatorFormatting";
import { useI18n } from "@/lib/i18n";
import {
  effortLabelKey,
  missionEligibility,
  missionTypeLabelKey,
  platformLabelKey,
  spotsLeft,
  type EffortLevel,
} from "@/lib/missionMeta";
import { categoryLabelKey } from "@/lib/labels";
import type { Me, Mission } from "@/lib/queries/kocmax";

type MissionCardProps = {
  title: string;
  category?: string | null;
  points: number;
  deadline?: string | null;
  imageUrl?: string;
  cashReward?: number | null;
  brand?: string | null;
  missionType?: string;
  accessType?: string;
  platform?: string;
  platforms?: string[] | null;
  deliverables?: string[] | null;
  effort?: string | null;
  quota?: number;
  filled?: number;
  requiredLevel?: string | null;
  creatorLevel?: string | null;
  isTrusted?: boolean;
  matchRationale?: string;
  matchScore?: number;
  status?: string;
};

type CardFact = { label: string; value: string };

/** All existing mission DTO consumers use the same decision-fact adaptation. */
export function missionCardDecisionProps(mission: Partial<Mission>, creator?: Pick<Me, "level" | "is_trusted">) {
  return { brand: mission.brand, missionType: mission.mission_type, accessType: mission.access_type,
    platforms: mission.platforms, deliverables: mission.deliverables, effort: mission.effort,
    quota: mission.quota, filled: mission.filled, requiredLevel: mission.required_level,
    creatorLevel: creator?.level, isTrusted: creator?.is_trusted };
}

function isEffortLevel(value: string): value is EffortLevel {
  return value === "low" || value === "medium" || value === "high";
}

export function MissionCard({
  title,
  category,
  points,
  deadline,
  imageUrl,
  cashReward,
  brand,
  missionType,
  accessType,
  platform,
  platforms,
  deliverables,
  effort,
  quota,
  filled,
  requiredLevel,
  creatorLevel,
  isTrusted,
  matchRationale,
  matchScore,
  status,
}: MissionCardProps) {
  const { t, lang } = useI18n();
  const formattedDeadline = formatCreatorDate(deadline, lang);
  const platformValues = [...new Set([...(platforms ?? []), ...(platform ? [platform] : [])])];
  const translatedPlatforms = platformValues.map((value) => t(platformLabelKey(value)));
  const translatedMissionType = missionType ? t(missionTypeLabelKey(missionType)) : null;
  const translatedAccessType = accessType
    ? accessType === "open"
      ? t("app.mission.access.open")
      : accessType === "application"
        ? t("app.mission.access.application")
        : accessType
    : null;
  const translatedEffort = effort
    ? isEffortLevel(effort)
      ? t(effortLabelKey(effort)!)
      : effort
    : null;
  const remainingSpots = quota == null || filled == null ? null : spotsLeft(quota, filled);
  const isFull = remainingSpots === 0;
  const availability = remainingSpots == null
    ? null
    : isFull
      ? t("app.mission.cardUnavailable")
      : t("app.mission.spotsLeft", { n: remainingSpots });
  const creatorEligibility = missionEligibility(requiredLevel, creatorLevel, isTrusted);
  const visibleEligibility = creatorEligibility && (!isFull || !creatorEligibility.qualified)
    ? creatorEligibility
    : null;

  const facts: Array<CardFact | null> = [
    { label: t("app.mission.cardCashReward"), value: cashReward == null ? t("app.mission.notProvided") : formatCreatorCurrency(cashReward, lang) },
    { label: t("app.mission.cardBrand"), value: brand || t("app.mission.notProvided") },
    translatedMissionType ? { label: t("app.mission.cardMissionType"), value: translatedMissionType } : null,
    translatedAccessType ? { label: t("app.mission.cardAccessType"), value: translatedAccessType } : null,
    { label: t("app.mission.cardPlatform"), value: translatedPlatforms.join(lang === "zh" ? "、" : ", ") || t("app.mission.notProvided") },
    { label: t("app.mission.cardDeliverables"), value: deliverables?.join(lang === "zh" ? "、" : ", ") || t("app.mission.notProvided") },
    { label: t("app.mission.cardEffort"), value: translatedEffort || t("app.mission.notProvided") },
    { label: t("app.mission.cardAvailability"), value: availability || t("app.mission.notProvided") },
    { label: t("app.mission.cardRequiredLevel"), value: requiredLevel || t("app.mission.notProvided") },
    formattedDeadline ? null : { label: t("app.mission.factDeadline"), value: t("app.mission.notProvided") },
    visibleEligibility ? { label: t("app.mission.factEligibility"), value: t(visibleEligibility.labelKey, visibleEligibility.params) } : null,
    matchRationale ? { label: t("app.mission.cardMatchRationale"), value: matchRationale } : null,
    matchScore == null ? null : { label: t("app.mission.cardMatchScore"), value: `${Math.round(matchScore <= 1 ? matchScore * 100 : matchScore)}%` },
    status ? { label: t("app.mission.cardStatus"), value: status } : null,
  ];
  const visibleFacts = facts.filter((fact): fact is CardFact => fact !== null);

  return (
    <article className="pastel-card flex gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border-2 border-[var(--color-ink)] bg-[var(--color-muted,#E4E4E4)]">
        {imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" /> : null}
      </div>
      <div className="min-w-0 flex-1">
        {category ? <BadgePill>{t(categoryLabelKey(category))}</BadgePill> : null}
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
        {visibleFacts.length ? (
          <dl className="mt-3 grid gap-1 text-xs">
            {visibleFacts.map((fact) => (
              <div key={fact.label} className="grid grid-cols-[auto_1fr] gap-2">
                <dt className="font-semibold text-[var(--color-soft-ink)]">{fact.label}</dt>
                <dd className="min-w-0 break-words">{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </article>
  );
}
