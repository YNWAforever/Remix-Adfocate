import { createFileRoute, Link } from "@tanstack/react-router";
import { useMyMissions, type MyMission, type SubmissionStatus } from "@/lib/queries/kocmax";
import { SkeletonCard } from "@/components/SkeletonCard";

export const Route = createFileRoute("/_app/my")({ component: MyMissions });

const GROUPS: { label: string; statuses: SubmissionStatus[] }[] = [
  { label: "進行中", statuses: ["joined"] },
  { label: "審批中", statuses: ["submitted", "under_review"] },
  { label: "已通過", statuses: ["approved"] },
  { label: "未通過", statuses: ["rejected", "expired"] },
];

function MyMissions() {
  const mine = useMyMissions();
  if (mine.isLoading) return <div className="p-4"><SkeletonCard className="h-40" /></div>;
  const subs: MyMission[] = mine.data ?? [];

  return (
    <div className="mx-auto max-w-lg space-y-6 p-4 pb-6">
      <h1 className="font-display text-xl font-bold">我的任務</h1>
      {subs.length === 0 && <p className="text-sm text-[var(--color-soft-ink)]">尚未加入任何任務。</p>}
      {GROUPS.map((g) => {
        const items = subs.filter((s) => g.statuses.includes(s.status));
        if (items.length === 0) return null;
        return (
          <section key={g.label} className="space-y-2">
            <h2 className="font-heading font-bold">{g.label}</h2>
            {items.map((s) => (
              <Link
                key={s.id}
                to="/mission/$missionSlug"
                params={{ missionSlug: s.missions.slug }}
                className="pastel-card flex items-center justify-between rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4"
              >
                <span className="font-heading">{s.missions.title}</span>
                <span className="font-display text-sm">
                  {s.status === "approved" ? `+${s.points_awarded} 積分` : `${s.missions.points_reward} 積分`}
                </span>
              </Link>
            ))}
          </section>
        );
      })}
    </div>
  );
}
