import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMe, useMissions, type SubmissionStatus } from "@/lib/queries/kocmax";
import { FilterPills } from "@/components/FilterPills";
import { MissionCard, missionCardDecisionProps } from "@/components/MissionCard";
import { SkeletonCard } from "@/components/SkeletonCard";
import { canShowPreviousData, RequestFeedback } from "@/components/RequestFeedback";
import { useI18n } from "@/lib/i18n";
import { categoryLabelKey } from "@/lib/labels";
import { canonicalMissionCategory, missionCategoryOptions, ALL_CATEGORY } from "@/lib/missionCategories";

export const Route = createFileRoute("/_app/mission/")({ component: Missions });

const STATUS_LABEL_KEY: Record<SubmissionStatus, string> = {
  applied: "app.mission.statusApplied",
  joined: "app.mission.statusJoined",
  submitted: "app.mission.statusApplied",
  under_review: "app.mission.statusApplied",
  approved: "app.mission.statusApproved",
  rejected: "app.mission.statusRejected",
  declined: "app.mission.statusDeclined",
  expired: "app.mission.statusExpired",
};

function statusLabelKey(status: SubmissionStatus): string {
  return STATUS_LABEL_KEY[status];
}

function Missions() {
  const [category, setCategory] = useState<string>(ALL_CATEGORY);
  const missions = useMissions();
  const me = useMe();
  const { t } = useI18n();
  // One list DTO supplies cards and filter options, including unknown historic values.
  const data = canShowPreviousData(missions.error) ? missions.data : undefined;
  const categories = [ALL_CATEGORY, ...missionCategoryOptions([...(data?.map((mission) => mission.category) ?? []), ...(category !== ALL_CATEGORY ? [category] : [])])];
  const visible = data?.filter((mission) => category === ALL_CATEGORY || canonicalMissionCategory(mission.category ?? "") === category);
  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 lg:max-w-5xl">
      <h1 className="font-display text-2xl font-bold">{t("app.mission.pageTitle")}</h1>
      <FilterPills options={categories} value={category} onChange={setCategory} renderLabel={(value) => t(categoryLabelKey(value))} />
      {missions.isLoading ? (
        <div role="status" aria-label={t("app.mission.loading")} className="grid gap-2 lg:grid-cols-2">
          <span className="sr-only">{t("app.mission.loading")}</span>
          <SkeletonCard className="h-24" />
          <SkeletonCard className="h-24" />
        </div>
      ) : null}
      {missions.isError ? <RequestFeedback error={missions.error ?? new Error("mission-list-unavailable")}
        summary={t("app.mission.loadFailed")} stale={Boolean(data?.length)} retry={() => void missions.refetch()} /> : null}
      {!missions.isLoading && !missions.isError && visible?.length === 0 ? (
        <p className="text-sm text-[var(--color-soft-ink)]">{t("app.mission.emptyCategory")}</p>
      ) : null}
      <h2 className="sr-only">{t("app.mission.resultsHeading")}</h2>
      <div className="grid gap-2 lg:grid-cols-2">
        {visible?.map((mission) => (
          <Link key={mission.id} to="/mission/$missionSlug" params={{ missionSlug: mission.slug }}>
            <MissionCard
              title={mission.title}
              {...missionCardDecisionProps(mission, me.data)}
              category={mission.category}
              points={mission.points_reward}
              cashReward={mission.cash_reward}
              deadline={mission.deadline}
              status={mission.my_status ? t(statusLabelKey(mission.my_status)) : undefined}
            />
          </Link>
        ))}
      </div>
    </div>
  );
}
