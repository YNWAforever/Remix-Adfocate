import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMe, useMissions, type SubmissionStatus } from "@/lib/queries/kocmax";
import { FilterPills } from "@/components/FilterPills";
import { MissionCard } from "@/components/MissionCard";
import { SkeletonCard } from "@/components/SkeletonCard";
import { useI18n } from "@/lib/i18n";
import { categoryLabelKey } from "@/lib/labels";
import { MISSION_CATEGORIES, ALL_CATEGORY } from "@/lib/missionCategories";

export const Route = createFileRoute("/_app/mission/")({ component: Missions });

const CATEGORIES = [ALL_CATEGORY, ...MISSION_CATEGORIES] as const;

function statusLabelKey(status: SubmissionStatus): string {
  if (status === "joined") return "app.mission.statusJoined";
  if (status === "submitted" || status === "under_review") return "app.mission.statusApplied";
  if (status === "approved") return "app.mission.statusApproved";
  if (status === "rejected") return "app.mission.statusRejected";
  return "app.mission.statusExpired";
}

function Missions() {
  const [category, setCategory] = useState<string>(ALL_CATEGORY);
  const missions = useMissions(category === ALL_CATEGORY ? undefined : category);
  const me = useMe();
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 lg:max-w-5xl">
      <h1 className="font-display text-2xl font-bold">{t("app.mission.pageTitle")}</h1>
      <FilterPills options={CATEGORIES} value={category} onChange={setCategory} renderLabel={(value) => t(categoryLabelKey(value))} />
      {missions.isLoading ? (
        <div role="status" aria-label={t("app.mission.loading")} className="grid gap-2 lg:grid-cols-2">
          <span className="sr-only">{t("app.mission.loading")}</span>
          <SkeletonCard className="h-24" />
          <SkeletonCard className="h-24" />
        </div>
      ) : null}
      {missions.isError ? <p role="alert" className="text-sm text-[var(--color-magenta)]">{t("app.mission.loadFailed")}</p> : null}
      {!missions.isLoading && !missions.isError && missions.data?.length === 0 ? (
        <p className="text-sm text-[var(--color-soft-ink)]">{t("app.mission.emptyCategory")}</p>
      ) : null}
      <h2 className="sr-only">{t("app.mission.resultsHeading")}</h2>
      <div className="grid gap-2 lg:grid-cols-2">
        {missions.data?.map((mission) => (
          <Link key={mission.id} to="/mission/$missionSlug" params={{ missionSlug: mission.slug }}>
            <MissionCard
              title={mission.title}
              brand={mission.brand}
              category={mission.category}
              points={mission.points_reward}
              cashReward={mission.cash_reward}
              deadline={mission.deadline}
              missionType={mission.mission_type}
              accessType={mission.access_type}
              platforms={mission.platforms}
              deliverables={mission.deliverables}
              effort={mission.effort}
              quota={mission.quota}
              filled={mission.filled}
              requiredLevel={mission.required_level}
              creatorLevel={me.data?.level}
              isTrusted={me.data?.is_trusted ?? true}
              status={mission.my_status ? t(statusLabelKey(mission.my_status)) : undefined}
            />
          </Link>
        ))}
      </div>
    </div>
  );
}
