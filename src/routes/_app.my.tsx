import { createFileRoute, Link } from "@tanstack/react-router";
import { useMyMissions, type MyMission, type SubmissionStatus } from "@/lib/queries/kocmax";
import { SkeletonCard } from "@/components/SkeletonCard";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/my")({ component: MyMissions });

type Group = { labelKey: string; statuses: SubmissionStatus[] };

const GROUPS: Group[] = [
  { labelKey: "app.mission.statusJoined", statuses: ["joined"] },
  { labelKey: "app.mission.statusApplied", statuses: ["submitted", "under_review"] },
  { labelKey: "app.mission.statusApproved", statuses: ["approved"] },
  { labelKey: "app.mission.statusRejected", statuses: ["rejected", "expired"] },
];

function MyMissions() {
  const { t } = useI18n();
  const mine = useMyMissions();
  if (mine.isLoading) return <div className="mx-auto w-full max-w-lg p-4 lg:max-w-5xl"><SkeletonCard className="h-40" /></div>;
  const subs: MyMission[] = mine.data ?? [];

  return (
    <div className="mx-auto w-full max-w-lg space-y-6 p-4 pb-6 lg:max-w-5xl">
      <h1 className="font-display text-xl font-bold">{t("app.my.heading")}</h1>
      {subs.length === 0 && <p className="text-sm text-[var(--color-soft-ink)]">{t("app.my.empty")}</p>}
      {GROUPS.map((g) => {
        const items = subs.filter((s) => g.statuses.includes(s.status));
        if (items.length === 0) return null;
        return (
          <section key={g.labelKey} className="space-y-2">
            <h2 className="font-heading font-bold">{t(g.labelKey)}</h2>
            <div className="grid gap-2 lg:grid-cols-2">
            {items.map((s) => (
              <Link
                key={s.id}
                to="/mission/$missionSlug"
                params={{ missionSlug: s.missions.slug }}
                className="pastel-card flex items-center justify-between rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4"
              >
                <span className="font-heading">{s.missions.title}</span>
                <span className="font-display text-sm">
                  {s.status === "approved"
                    ? t("app.my.pointsAwarded", { n: String(s.points_awarded) })
                    : t("app.my.pointsReward", { n: String(s.missions.points_reward) })}
                </span>
              </Link>
            ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
