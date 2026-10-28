import { createFileRoute, Link } from "@tanstack/react-router";
import { useMyMissions, type MyMission, type SubmissionStatus } from "@/lib/queries/kocmax";
import { SkeletonCard } from "@/components/SkeletonCard";
import { useI18n } from "@/lib/i18n";
import { RequestFeedback, useCanShowPreviousData } from "@/components/RequestFeedback";

export const Route = createFileRoute("/_app/my/")({ component: MyMissions });

type Group = { labelKey: string; statuses: SubmissionStatus[] };

const GROUPS: Group[] = [
  { labelKey: "app.mission.statusApplied", statuses: ["applied"] },
  { labelKey: "app.mission.statusJoined", statuses: ["joined"] },
  { labelKey: "app.mission.statusApplied", statuses: ["submitted", "under_review"] },
  { labelKey: "app.mission.statusApproved", statuses: ["approved"] },
  { labelKey: "app.mission.statusRejected", statuses: ["rejected", "expired"] },
  { labelKey: "app.mission.statusDeclined", statuses: ["declined"] },
];

function usesActiveWorkspace(submission: MyMission): boolean {
  return submission.creator_workflow_mode === "active_workspace"
    || submission.missions.creator_workflow_mode === "active_workspace";
}

function MissionSubmissionLink({ submission }: { submission: MyMission }) {
  const { t } = useI18n();
  const content = (
    <>
      <span className="font-heading">{submission.missions.title}</span>
      <span className="font-display text-sm">
        {submission.status === "approved"
          ? t("app.my.pointsAwarded", { n: String(submission.points_awarded) })
          : t("app.my.pointsReward", { n: String(submission.missions.points_reward) })}
      </span>
    </>
  );
  const className = "pastel-card flex items-center justify-between rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4";
  return submission.status === "joined" && usesActiveWorkspace(submission) ? (
    <Link
      to="/my/$submissionId"
      params={{ submissionId: submission.id }}
      className={className}
    >
      {content}
    </Link>
  ) : (
    <Link
      to="/mission/$missionSlug"
      params={{ missionSlug: submission.missions.slug }}
      className={className}
    >
      {content}
    </Link>
  );
}

function MyMissions() {
  const { t } = useI18n();
  const mine = useMyMissions();
  const showSavedMissions = useCanShowPreviousData(mine, ["my-missions", "all"]);
  if (mine.isLoading) {
    return (
      <div className="mx-auto w-full max-w-lg p-4 lg:max-w-5xl">
        <SkeletonCard className="h-40" />
      </div>
    );
  }
  const visibleMissions = showSavedMissions ? mine.data : undefined;
  const subs: MyMission[] = visibleMissions ?? [];

  return (
    <div className="mx-auto w-full max-w-lg space-y-6 p-4 pb-6 lg:max-w-5xl">
      <h1 className="font-display text-xl font-bold">{t("app.my.heading")}</h1>
      <RequestFeedback error={mine.error} stale={Boolean(visibleMissions)} retry={() => void mine.refetch()} />
      {!mine.isError && subs.length === 0 && (
        <p className="text-sm text-[var(--color-soft-ink)]">{t("app.my.empty")}</p>
      )}
      {GROUPS.map((group) => {
        const items = subs.filter((submission) => group.statuses.includes(submission.status));
        if (items.length === 0) return null;
        return (
          <section key={group.statuses.join("-")} className="space-y-2">
            <h2 className="font-heading font-bold">{t(group.labelKey)}</h2>
            <div className="grid gap-2 lg:grid-cols-2">
              {items.map((submission) => (
                <MissionSubmissionLink key={submission.id} submission={submission} />
              ))}
            </div>
          </section>
        );
      })}
      {subs.filter((submission) => !GROUPS.some((group) => group.statuses.includes(submission.status))).map((submission) => (
        <section key={submission.id}>
          <p role="alert">任務狀態未能辨認，請重試或聯絡營運。 / This task status is unavailable. Retry or contact the operator.</p>
          <MissionSubmissionLink submission={submission} />
        </section>
      ))}
    </div>
  );
}
