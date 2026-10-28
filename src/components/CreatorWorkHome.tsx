import { useQueries } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { ApiError } from "@/lib/api";
import { activeMissionNextBestAction, type NextBestAction } from "@/lib/creatorActivation";
import { useI18n } from "@/lib/i18n";
import { activeMissionQueryKey, activeMissionWorkspaceQueryOptions } from "@/lib/queries/activeMission";
import type { MyMission } from "@/lib/queries/kocmax";
import type { CreatorActivationQuerySection } from "@/lib/useCreatorActivation";
import { ActiveMissionSummary } from "./ActiveMissionSummary";
import { NextBestActionCard } from "./NextBestActionCard";
import { useCanShowPreviousData, useCanShowPreviousQueriesData } from "./RequestFeedback";

const active = (mission: MyMission) => Boolean(mission.active_workflow_id)
  || mission.creator_workflow_mode === "active_workspace"
  || mission.missions.creator_workflow_mode === "active_workspace";
const denied = (error: Error | null) => error instanceof ApiError && [401, 403, 404].includes(error.status);
const current = (mission: MyMission) => active(mission) || ["joined", "submitted", "under_review"].includes(mission.status);
const priority = (action: NextBestAction) => {
  if (action.kind === "revise" || action.kind === "revise_publication_proof") return 0;
  if (action.kind === "confirm_receipt") return 1;
  if (action.kind === "draft" || action.kind === "submit_proof") return 2;
  if (action.kind === "publish_and_submit_proof") return 3;
  return 4;
};

export function CreatorWorkHome({ missions, fallbackAction, onAction, onView }: {
  missions: CreatorActivationQuerySection<MyMission[]>;
  fallbackAction: NextBestAction;
  onAction: (action: NextBestAction) => void;
  onView: (action: NextBestAction) => void;
}) {
  const { lang, t } = useI18n();
  const showMissions = useCanShowPreviousData(missions, ["my-missions", "all"]);
  const candidates = showMissions ? (missions.data ?? []).filter(current) : [];
  const activeMissions = candidates.filter(active);
  const workspaces = useQueries({ queries: activeMissions.map(({ id }) => activeMissionWorkspaceQueryOptions(id)) });
  const showWorkspaces = useCanShowPreviousQueriesData(activeMissions.map(({ id }, index) => ({ read: workspaces[index], queryKey: activeMissionQueryKey(id) })));
  const byId = new Map(activeMissions.map((mission, index) => [mission.id, workspaces[index]]));
  const authorizedIds = new Set(activeMissions.filter((_, index) => showWorkspaces[index]).map(mission => mission.id));
  const actions = new Map<string, NextBestAction>();
  const visible = candidates.filter((mission) => !active(mission) || authorizedIds.has(mission.id));
  for (const mission of visible) {
    const workspace = byId.get(mission.id)?.data;
    if (active(mission)) {
      if (workspace) actions.set(mission.id, activeMissionNextBestAction(workspace));
    } else {
      const waiting = mission.status !== "joined";
      actions.set(mission.id, {
        kind: waiting ? "await_review" : "submit_proof",
        titleKey: waiting ? "app.activeMission.workspace.action.awaitReview" : "app.activation.next.submitProof.title",
        bodyKey: waiting ? "app.activeMission.workspace.responsible.awaitReview" : "app.activation.next.submitProof.body",
        ctaKey: waiting ? "app.activeMission.workspace.action.awaitReview" : "app.activation.next.submitProof.cta",
        to: `/mission/${encodeURIComponent(mission.missions.slug)}`,
      });
    }
  }
  const loading = missions.loading || workspaces.some((query) => query.isLoading);
  const errors = [missions.error, ...workspaces.map((query) => query.error)].filter(Boolean);
  const unavailable = errors.some((error) => denied(error ?? null));
  const stale = errors.length > 0 && !unavailable && actions.size > 0;
  const unresolved = candidates.some((mission) => active(mission) && !actions.has(mission.id));
  const action = [...actions.entries()].sort(([leftId, left], [rightId, right]) => {
    const order = priority(left) - priority(right);
    const date = (value: string | undefined) => value ? Date.parse(value) : Infinity;
    return order || (date(left.deadline) - date(right.deadline)) || leftId.localeCompare(rightId);
  })[0]?.[1];
  const retry = () => { void missions.refetch(); for (const query of workspaces) void query.refetch(); };
  const displayedAction = !loading && !unavailable && !unresolved && (!errors.length || stale)
    ? action ?? fallbackAction : null;
  const views = useRef(new Set<string>());
  useEffect(() => {
    if (!displayedAction) return;
    const key = `${displayedAction.kind}:${displayedAction.to}`;
    if (views.current.has(key)) return;
    views.current.add(key);
    onView(displayedAction);
  }, [displayedAction, onView]);

  return <>
    {loading ? <p role="status">{t("app.home.work.loading")}</p> : null}
    {errors.length ? <div role="alert" className="rounded-[var(--radius)] border-2 border-amber-800 bg-amber-50 p-4 text-sm">
      <p>{t(unavailable ? "app.home.work.unavailable" : stale ? "app.home.work.stale" : "app.home.work.error")}</p>
      <button type="button" onClick={retry} className="mt-3 min-h-11 rounded-full border-2 border-[var(--color-ink)] px-4 py-2 font-bold">{t("app.home.work.retry")}</button>
    </div> : null}
    {displayedAction ? <>
      {!candidates.length && !errors.length ? <p role="status">{t("app.home.work.empty")}</p> : null}
      <NextBestActionCard action={displayedAction} locale={lang} onAction={onAction} />
    </> : null}
    <ActiveMissionSummary missions={visible.filter((mission) => !active(mission) || actions.has(mission.id))} isLoading={false} isError={false} onRetry={retry}
      workActions={actions} getMissionHref={(mission) => active(mission) ? `/my/${encodeURIComponent(mission.id)}` : `/mission/${encodeURIComponent(mission.missions.slug)}`} />
  </>;
}
