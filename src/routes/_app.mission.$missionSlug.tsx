import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Lightbulb } from "lucide-react";
import { useMission, useMyMissions, useJoinMission, useSubmitMission, useApplyMission, useMe } from "@/lib/queries/kocmax";
import { BadgePill } from "@/components/BadgePill";
import { SkeletonCard } from "@/components/SkeletonCard";
import { HookPanel } from "@/components/HookPanel";
import { MissionFacts } from "@/components/MissionFacts";
import { MissionBrief } from "@/components/MissionBrief";
import { missionTypeLabel } from "@/lib/missionMeta";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/mission/$missionSlug")({ component: MissionDetail });

function MissionDetail() {
  const { missionSlug } = Route.useParams();
  const m = useMission(missionSlug);
  const mine = useMyMissions();
  const join = useJoinMission(missionSlug);
  const submit = useSubmitMission(missionSlug);
  const apply = useApplyMission(missionSlug);
  const me = useMe();
  const { t } = useI18n();
  const [urls, setUrls] = useState("");
  const [showHooks, setShowHooks] = useState(false);

  // Map API submission status codes to display labels via i18n.
  const STATUS_LABEL: Record<string, string> = {
    applied: t("app.mission.statusApplied"),
    joined: t("app.mission.statusJoined"),
    submitted: t("app.mission.statusApplied"),
    under_review: t("app.mission.statusApplied"),
    approved: t("app.mission.statusApproved"),
    rejected: t("app.mission.statusRejected"),
    expired: t("app.mission.statusExpired"),
    declined: t("app.mission.statusDeclined"),
  };

  if (m.isLoading) return <div className="mx-auto max-w-lg p-4 lg:max-w-5xl"><SkeletonCard className="h-96" /></div>;
  if (m.isError || !m.data) return (
    <div className="flex flex-col items-center gap-4 p-8 text-center">
      <p className="text-sm text-[var(--color-magenta)]">{t("app.mission.loadError")}</p>
      <Link to="/mission" className="text-sm underline">{t("app.mission.backToList")}</Link>
    </div>
  );

  const sub = mine.data?.find((s) => s.missions.slug === missionSlug);
  const isApplication = m.data.access_type === "application";

  async function onSubmit() {
    const list = urls.split("\n").map((u) => u.trim()).filter(Boolean);
    if (list.length === 0) return;
    await submit.mutateAsync({ content_urls: list });
    setUrls("");
  }

  return (
    <div className="mx-auto max-w-lg pb-6 lg:max-w-5xl">
      <header className="glass-panel sticky top-0 z-30 flex items-center gap-3 border-b-2 border-[var(--color-ink)] p-3">
        <Link to="/mission" aria-label={t("common.back")} className="grid h-9 w-9 place-items-center rounded-full border-2 border-[var(--color-ink)] bg-white"><ArrowLeft size={18} /></Link>
        <h1 className="truncate font-heading font-semibold">{m.data.title}</h1>
      </header>

      <div className="p-4 lg:grid lg:grid-cols-[1.5fr_1fr] lg:items-start lg:gap-6">
        {/* Facts — first on mobile (reward/quota/deadline/eligibility before the long brief, as on
            the pre-redesign single column); top of the right column on desktop. */}
        <div className="lg:col-start-2 lg:row-start-1">
          <MissionFacts mission={m.data} creatorLevel={me.data?.level} />
        </div>

        {/* Title + brief — left column on desktop, spanning both rows so the action zone tucks beside it. */}
        <div className="mt-4 space-y-4 lg:mt-0 lg:col-start-1 lg:row-start-1 lg:row-span-2">
          <div className="flex flex-wrap items-center gap-2">
            {m.data.category && <BadgePill>{m.data.category}</BadgePill>}
            <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-xs font-heading font-bold">{missionTypeLabel(m.data.mission_type)}</span>
          </div>
          <h2 className="font-display text-xl font-bold">{m.data.title}</h2>
          <MissionBrief mission={m.data} />
        </div>

        {/* Action zone + hooks — below Facts in the right column on desktop, after the brief on mobile */}
        <div className="mt-4 space-y-4 lg:mt-0 lg:col-start-2 lg:row-start-2">
          {/* Action zone */}
          {!sub ? (
            isApplication ? (
              <button onClick={() => apply.mutateAsync()} disabled={apply.isPending} className="btn-primary block w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 text-center font-heading font-bold text-[var(--color-ink)]">{apply.isPending ? t("app.mission.processing") : t("app.mission.applyCta")}</button>
            ) : (
              <button onClick={() => join.mutateAsync()} disabled={join.isPending} className="btn-primary block w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 text-center font-heading font-bold text-[var(--color-ink)]">{join.isPending ? t("app.mission.processing") : t("app.mission.joinCta")}</button>
            )
          ) : sub.status === "joined" ? (
            <section className="pastel-card space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
              <h3 className="font-heading font-bold">{t("app.mission.submitContent")}</h3>
              <textarea value={urls} onChange={(e) => setUrls(e.target.value)} rows={3} placeholder={t("app.mission.urlPlaceholder")} className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 text-sm" />
              <button onClick={onSubmit} disabled={submit.isPending} className="btn-primary block w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 text-center font-heading font-bold text-[var(--color-ink)]">{submit.isPending ? t("app.mission.submitting") : t("app.mission.submitContent")}</button>
            </section>
          ) : (
            <section className="pastel-card flex items-center justify-between rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
              <span className="font-heading font-bold">{t("app.mission.statusLabel")}</span>
              <span className="font-display">{STATUS_LABEL[sub.status] ?? sub.status}{sub.status === "approved" ? ` · ${t("app.mission.pointsAwarded", { n: sub.points_awarded ?? 0 })}` : ""}</span>
            </section>
          )}

          {!isApplication && (
            <>
              <button
                onClick={() => setShowHooks((v) => !v)}
                aria-label={t("app.mission.hooksCta")}
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
