import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Lightbulb } from "lucide-react";
import { useMission, useMyMissions, useJoinMission, useSubmitMission, useApplyMission, useMe, useMissionMatch, type MyMission } from "@/lib/queries/kocmax";
import { BadgePill } from "@/components/BadgePill";
import { SkeletonCard } from "@/components/SkeletonCard";
import { HookPanel } from "@/components/HookPanel";
import { MissionFacts } from "@/components/MissionFacts";
import { MissionBrief } from "@/components/MissionBrief";
import { MissionCommitmentSummary } from "@/components/MissionCommitmentSummary";
import { missionTypeLabelKey } from "@/lib/missionMeta";
import { useI18n } from "@/lib/i18n";
import { trackActivationEvent } from "@/lib/activationAnalytics";
import { ApiError } from "@/lib/api";

export const Route = createFileRoute("/_app/mission/$missionSlug")({ component: MissionDetail });
function usesActiveWorkspace(submission: MyMission): boolean {
  return submission.creator_workflow_mode === "active_workspace"
    || submission.missions.creator_workflow_mode === "active_workspace";
}


function MissionDetail() {
  const { missionSlug } = Route.useParams();
  const m = useMission(missionSlug);
  const mine = useMyMissions();
  const join = useJoinMission(missionSlug);
  const apply = useApplyMission(missionSlug);
  const me = useMe();
  const matches = useMissionMatch();
  const { t, lang } = useI18n();
  const [showHooks, setShowHooks] = useState(false);
  const viewedMissions = useRef(new Set<string>());
  const activationTracked = useRef(false);
  const missionId = m.data?.id;
  const missionType = m.data?.mission_type;

  useEffect(() => {
    if (!missionId || !missionType) return;

    const viewKey = `${missionId}:${missionType}`;
    if (!viewedMissions.current.has(viewKey)) {
      viewedMissions.current.add(viewKey);
      trackActivationEvent("mission_viewed", {
        locale: lang,
        missionId,
        missionType,
      });
    }

    const isSuitable = matches.data?.some((match) => match.id === missionId && !match.locked) ?? false;
    if (!activationTracked.current && me.data?.onboarding_completed && isSuitable) {
      activationTracked.current = true;
      trackActivationEvent("creator_activated", {
        locale: lang,
        activationPath: "mission_viewed",
      });
    }
  }, [lang, matches.data, me.data?.onboarding_completed, missionId, missionType]);

  const STATUS_LABEL = useMemo<Record<string, string>>(
    () => ({
      applied: t("app.mission.statusApplied"),
      joined: t("app.mission.statusJoined"),
      submitted: t("app.mission.statusApplied"),
      under_review: t("app.mission.statusApplied"),
      approved: t("app.mission.statusApproved"),
      rejected: t("app.mission.statusRejected"),
      expired: t("app.mission.statusExpired"),
      declined: t("app.mission.statusDeclined"),
    }),
    [t],
  );

  if (m.isLoading) return <div className="mx-auto max-w-lg p-4 lg:max-w-5xl"><SkeletonCard className="h-96" /></div>;
  if (m.isError || !m.data) return (
    <div className="flex flex-col items-center gap-4 p-8 text-center">
      <p className="text-sm text-[var(--color-magenta)]">{t("app.mission.loadError")}</p>
      <Link to="/mission" className="text-sm underline">{t("app.mission.backToList")}</Link>
    </div>
  );

  const sub = mine.data?.find((submission) => submission.missions.slug === missionSlug);
  const isApplication = m.data.access_type === "application";


  return (
    <div className="mx-auto max-w-lg pb-6 lg:max-w-5xl">
      <header className="glass-panel sticky top-0 z-30 flex items-center gap-3 border-b-2 border-[var(--color-ink)] p-3">
        <Link to="/mission" aria-label={t("common.back")} className="grid h-9 w-9 place-items-center rounded-full border-2 border-[var(--color-ink)] bg-white"><ArrowLeft size={18} /></Link>
        <h1 className="truncate font-heading font-semibold">{m.data.title}</h1>
      </header>

      <div className="p-4 lg:grid lg:grid-cols-[1.5fr_1fr] lg:items-start lg:gap-6">
        <div className="lg:col-start-2 lg:row-start-1">
          <MissionFacts mission={m.data} creatorLevel={me.data?.level} isTrusted={me.data?.is_trusted ?? true} />
        </div>

        <div className="mt-4 space-y-4 lg:mt-0 lg:col-start-1 lg:row-start-1 lg:row-span-2">
          <div className="flex flex-wrap items-center gap-2">
            {m.data.category && <BadgePill>{m.data.category}</BadgePill>}
            <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-xs font-heading font-bold">{t(missionTypeLabelKey(m.data.mission_type))}</span>
          </div>
          <h2 className="font-display text-xl font-bold">{m.data.title}</h2>
          <MissionBrief mission={m.data} />
        </div>

        <div className="mt-4 space-y-4 lg:mt-0 lg:col-start-2 lg:row-start-2">
          {!sub ? (
            <>
              <MissionCommitmentSummary mission={m.data} locale={lang} />
              {isApplication ? (
                <button onClick={() => apply.mutateAsync()} disabled={apply.isPending} className="btn-primary block w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 text-center font-heading font-bold text-[var(--color-ink)]">{apply.isPending ? t("common.processing") : t("app.mission.applyCta")}</button>
              ) : (
                <button onClick={() => join.mutateAsync()} disabled={join.isPending} className="btn-primary block w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 text-center font-heading font-bold text-[var(--color-ink)]">{join.isPending ? t("common.processing") : t("app.mission.joinCta")}</button>
              )}
            </>
          ) : sub.status === "joined" ? (
            usesActiveWorkspace(sub) ? (
              <a href={`/my/${sub.id}`} className="btn-primary block w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 text-center font-heading font-bold text-[var(--color-ink)]">Continue mission</a>
            ) : (
              <LegacySubmissionForm missionSlug={missionSlug} />
            )
          ) : (
            <section className="pastel-card flex items-center justify-between rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
              <span className="font-heading font-bold">{t("app.mission.statusLabel")}</span>
              <span className="font-display">{STATUS_LABEL[sub.status] ?? sub.status}{sub.status === "approved" ? ` · ${t("app.mission.pointsAwarded", { n: sub.points_awarded ?? 0 })}` : ""}</span>
            </section>
          )}

          {(join.isError || apply.isError) && (() => {
            const err = (join.error ?? apply.error) as ApiError | null;
            const code = err instanceof ApiError ? err.code : null;
            if (code === "verification_required") {
              return (
                <div className="rounded-[var(--radius)] border-2 border-[var(--color-magenta)] bg-white p-3 text-sm text-[var(--color-magenta)]" role="alert">
                  <p>{t("app.mission.errorVerify")}</p>
                  <Link to="/profile" className="mt-1 inline-block font-bold underline">{t("app.social.verifyNow")}</Link>
                </div>
              );
            }
            const messageMap: Record<string, string> = {
              level_locked: t("app.mission.errorLevelLocked"),
              mission_full: t("app.mission.errorMissionFull"),
              closed: t("app.mission.errorClosed"),
              not_open: t("app.mission.errorClosed"),
              already_joined: t("app.mission.errorAlreadyJoined"),
              already_applied: t("app.mission.errorAlreadyApplied"),
              not_application: t("app.mission.errorNotApplication"),
            };
            const msg = code && messageMap[code] ? messageMap[code] : t("app.mission.actionError");
            return <p className="rounded-[var(--radius)] border-2 border-[var(--color-magenta)] bg-white p-3 text-sm text-[var(--color-magenta)]" role="alert">{msg}</p>;
          })()}

          {!isApplication && (
            <>
              <button
                onClick={() => setShowHooks((visible) => !visible)}
                className="flex w-full items-center justify-center gap-2 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-magenta)] py-3 text-center font-heading font-bold text-white"
              >
                <Lightbulb size={18} aria-hidden /> {t("app.mission.hooksCta")}
              </button>
              {showHooks && <HookPanel missionSlug={missionSlug} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function LegacySubmissionForm({ missionSlug }: { missionSlug: string }) {
  const submit = useSubmitMission(missionSlug);
  const { t } = useI18n();
  const [urls, setUrls] = useState("");

  async function submitUrls() {
    const list = urls.split("\n").map((url) => url.trim()).filter(Boolean);
    if (list.length === 0) return;
    await submit.mutateAsync({ content_urls: list });
    setUrls("");
  }

  return (
    <section className="pastel-card space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
      <h3 className="font-heading font-bold">{t("app.mission.submitContent")}</h3>
      <textarea value={urls} onChange={(event) => setUrls(event.target.value)} rows={3} placeholder={t("app.mission.urlPlaceholder")} className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 text-sm" />
      <button onClick={submitUrls} disabled={submit.isPending} className="btn-primary block w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 text-center font-heading font-bold text-[var(--color-ink)]">{submit.isPending ? t("app.mission.submitting") : t("app.mission.submitContent")}</button>
    </section>
  );
}
