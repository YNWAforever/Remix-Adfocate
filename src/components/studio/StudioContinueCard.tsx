import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useMyMissions } from "@/lib/queries/kocmax";
import { useI18n } from "@/lib/i18n";
import { trackActivationEvent } from "@/lib/activationAnalytics";
import { useStudioText } from "./StudioPrimitives";

/**
 * One unfinished mission, surfaced above the composer. Renders nothing until
 * there is something to continue, so a first-time creator sees no empty shell.
 */
export function StudioContinueCard() {
  const tx = useStudioText();
  const { lang } = useI18n();
  const mine = useMyMissions("joined");
  const joined = mine.data?.find((submission) => submission.status === "joined");
  if (!joined) return null;

  const usesWorkspace = joined.creator_workflow_mode === "active_workspace"
    || joined.missions.creator_workflow_mode === "active_workspace";
  const onClick = () => trackActivationEvent("continue_clicked", {
    locale: lang,
    target: usesWorkspace ? "workspace" : "mission",
  });

  const label = (
    <>
      {tx("繼續", "Continue")}
      <ArrowRight size={16} />
    </>
  );

  return (
    <section className="s-card s-stack" aria-label={tx("繼續任務", "Continue a mission")}>
      <small className="s-muted">{tx("未完成的任務", "In progress")}</small>
      <h2>{joined.missions.title}</h2>
      {usesWorkspace ? (
        <Link to="/my/$submissionId" params={{ submissionId: joined.id }} className="s-btn s-primary" onClick={onClick}>
          {label}
        </Link>
      ) : (
        <Link to="/mission/$missionSlug" params={{ missionSlug: joined.missions.slug }} className="s-btn s-primary" onClick={onClick}>
          {label}
        </Link>
      )}
    </section>
  );
}
