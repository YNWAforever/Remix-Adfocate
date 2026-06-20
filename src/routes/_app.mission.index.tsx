import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMissions } from "@/lib/queries/kocmax";
import { FilterPills } from "@/components/FilterPills";
import { MissionCard } from "@/components/MissionCard";
import { SkeletonCard } from "@/components/SkeletonCard";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/mission/")({ component: Missions });

// Category values are sent to the API as-is; "全部" is the UI-only sentinel for "no filter".
const CATEGORIES = ["全部", "社交", "美容", "餐飲", "生活"] as const;

function Missions() {
  const [category, setCategory] = useState<string>("全部");
  const missions = useMissions(category === "全部" ? undefined : category);
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 lg:max-w-5xl">
      <h1 className="font-display text-2xl font-bold">{t("app.mission.pageTitle")}</h1>
      <FilterPills options={CATEGORIES} value={category} onChange={setCategory} />
      {missions.isLoading && (
        <div className="grid gap-2 lg:grid-cols-2">
          <SkeletonCard className="h-24" />
          <SkeletonCard className="h-24" />
        </div>
      )}
      {missions.isError && <p className="text-sm text-[var(--color-magenta)]">{t("app.mission.loadFailed")}</p>}
      {!missions.isLoading && !missions.isError && missions.data?.length === 0 && (
        <p className="text-sm text-[var(--color-soft-ink)]">{t("app.mission.emptyCategory")}</p>
      )}
      <div className="grid gap-2 lg:grid-cols-2">
        {missions.data?.map((m) => (
          <Link key={m.id} to="/mission/$missionSlug" params={{ missionSlug: m.slug }}>
            <MissionCard title={m.title} category={m.category} points={m.points_reward} deadline={m.deadline} />
          </Link>
        ))}
      </div>
    </div>
  );
}
