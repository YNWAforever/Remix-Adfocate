import { createFileRoute, Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useMissionMatch } from "@/lib/queries/kocmax";
import { MissionCard } from "@/components/MissionCard";
import { SkeletonCard } from "@/components/SkeletonCard";

export const Route = createFileRoute("/_app/match")({ component: Match });

function Match() {
  const { t } = useI18n();
  const match = useMissionMatch();
  const empty = !match.isLoading && !match.isError && (match.data?.length ?? 0) === 0;

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 p-4 lg:max-w-5xl">
      <header>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-soft-ink)]">ADFOCATE · KOCMAX</span>
        <h1 className="mt-1 flex items-center gap-2 font-display text-2xl font-bold leading-tight">
          <Sparkles size={22} aria-hidden /> {t("app.match.pageTitle")}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-soft-ink)]">{t("app.match.subTitle")}</p>
      </header>

      {match.isLoading ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <SkeletonCard className="h-24" />
          <SkeletonCard className="h-24" />
        </div>
      ) : null}
      {match.isError ? <p className="text-sm text-[var(--color-magenta)]">{t("common.loadFailed")}</p> : null}
      {empty ? (
        <p className="rounded-[var(--radius)] border-2 border-dashed border-[var(--color-ink)] p-6 text-center text-sm text-[var(--color-soft-ink)]">
          {t("app.match.empty")}
        </p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {match.data?.map((mission) => (
          <Link
            key={mission.id}
            to="/mission/$missionSlug"
            params={{ missionSlug: mission.slug }}
            className={mission.locked ? "block opacity-60" : "block"}
          >
            <MissionCard
              title={mission.title}
              category={mission.category ?? undefined}
              points={mission.points_reward}
              cashReward={mission.cash_reward}
              deadline={mission.deadline}
              missionType={mission.mission_type}
              quota={mission.quota}
              filled={mission.filled}
              requiredLevel={mission.required_level}
              matchRationale={mission.rationale}
              matchScore={mission.fit_score}
              status={t(
                mission.locked
                  ? "app.match.locked"
                  : mission.filled >= mission.quota
                    ? "app.mission.cardUnavailable"
                    : "app.match.unlocked",
              )}
            />
            <div className="mt-1">
              <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-2 py-0.5 font-mono text-xs font-bold">
                {t("app.match.fitScore", { score: mission.fit_score })}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
