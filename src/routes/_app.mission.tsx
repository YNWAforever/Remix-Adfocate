import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMissions } from "@/lib/queries/kocmax";
import { FilterPills } from "@/components/FilterPills";
import { MissionCard } from "@/components/MissionCard";
import { SkeletonCard } from "@/components/SkeletonCard";

export const Route = createFileRoute("/kocmax/$slug/mission")({ component: Missions });

const CATEGORIES = ["全部", "社交", "美容", "餐飲", "生活"] as const;

function Missions() {
  const { slug } = Route.useParams();
  const [category, setCategory] = useState<string>("全部");
  const missions = useMissions(category === "全部" ? undefined : category);
  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <h1 className="font-display text-2xl font-bold">限時任務</h1>
      <FilterPills options={CATEGORIES} value={category} onChange={setCategory} />
      {missions.isLoading && (
        <div className="space-y-2">
          <SkeletonCard className="h-24" />
          <SkeletonCard className="h-24" />
        </div>
      )}
      {missions.isError && <p className="text-sm text-[var(--color-magenta)]">載入失敗</p>}
      {!missions.isLoading && !missions.isError && missions.data?.length === 0 && (
        <p className="text-sm text-[var(--color-soft-ink)]">此分類暫無任務</p>
      )}
      <div className="space-y-2">
        {missions.data?.map((m) => (
          <Link key={m.id} to="/kocmax/$slug/mission/$missionSlug" params={{ slug, missionSlug: m.slug }}>
            <MissionCard title={m.title} category={m.category} points={m.points_reward} deadline={m.deadline} />
          </Link>
        ))}
      </div>
    </div>
  );
}
