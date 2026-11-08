import { createFileRoute, Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useMe, useMissionMatch } from "@/lib/queries/kocmax";
import { MissionCard, missionCardDecisionProps } from "@/components/MissionCard";
import { SkeletonCard } from "@/components/SkeletonCard";

export const Route = createFileRoute("/_app/match")({ component: Match });

function Match() {
  const { t } = useI18n();
  const match = useMissionMatch();
  const me = useMe();
  const empty = !match.isLoading && !match.isError && (match.data?.length ?? 0) === 0;

  return (
    <div className="s-stack">
      <header className="s-stack" style={{ gap: 6 }}>
        <span className="s-eyebrow">ADFOCATE · KOCMAX</span>
        <h1 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={22} aria-hidden /> {t("app.match.pageTitle")}
        </h1>
        <p className="s-muted">{t("app.match.subTitle")}</p>
      </header>

      {match.isLoading ? (
        <div className="s-grid">
          <SkeletonCard className="h-24" />
          <SkeletonCard className="h-24" />
        </div>
      ) : null}
      {match.isError ? <p className="text-sm text-[var(--color-magenta)]">{t("common.loadFailed")}</p> : null}
      {empty ? (
        <p className="s-empty">
          {t("app.match.empty")}
        </p>
      ) : null}

      <div className="s-grid">
        {match.data?.map((mission) => (
          <Link
            key={mission.id}
            to="/mission/$missionSlug"
            params={{ missionSlug: mission.slug }}
            className={mission.locked ? "block opacity-60" : "block"}
          >
            <MissionCard
              {...missionCardDecisionProps(mission, me.data)}
              title={mission.title}
              category={mission.category ?? undefined}
              points={mission.points_reward}
              cashReward={mission.cash_reward}
              deadline={mission.deadline}
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
              <span className="s-tag mint">
                {t("app.match.fitScore", { score: mission.fit_score })}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
