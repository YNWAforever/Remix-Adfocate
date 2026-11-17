import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useMissions } from "@/lib/queries/kocmax";
import { useMemo } from "react";
import { StudioSkeleton } from "./StudioSkeleton";
import { StudioError, useStudioText } from "./StudioPrimitives";

/**
 * One or two open missions as a concrete next step, with the level gate and
 * deadline that decide whether the creator can actually join.
 */
export function StudioTodayStep() {
  const tx = useStudioText();
  const missions = useMissions();
  const open = useMemo(() => (missions.data ?? []).slice(0, 2), [missions.data]);

  return (
    <section className="s-card mint s-stack">
      <div className="s-row">
        <Sparkles size={20} />
        <h3>{tx("今日可以前進一小步", "A small step for today")}</h3>
      </div>

      {missions.data === undefined && !missions.isError ? (
        <div className="s-stack">
          <StudioSkeleton width="80%" height={16} />
          <StudioSkeleton width="65%" height={12} />
        </div>
      ) : missions.isError ? (
        <StudioError onRetry={() => void missions.refetch()} />
      ) : open.length === 0 ? (
        <p className="s-muted">
          {tx("暫時沒有開放任務。先整理下一個靈感吧。", "No open missions. Plan your next idea meanwhile.")}
        </p>
      ) : (
        open.map((mission) => (
          <Link
            key={mission.id}
            to="/mission/$missionSlug"
            params={{ missionSlug: mission.slug }}
            className="s-source"
          >
            <h3>{mission.title}</h3>
            <span className="s-row">
              <span className="s-tag mint">✦ {mission.points_reward} {tx("分", "pts")}</span>
              {mission.required_level ? (
                <span className="s-tag ghost">{mission.required_level}</span>
              ) : null}
              {mission.deadline ? (
                <span className="s-tag ghost">{mission.deadline.slice(0, 10)}</span>
              ) : null}
            </span>
          </Link>
        ))
      )}

      <Link to="/campaigns" className="s-btn">
        {tx("每週挑戰與限時活動", "Weekly challenges & events")}
      </Link>
    </section>
  );
}
