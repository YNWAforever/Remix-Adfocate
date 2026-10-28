import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Lock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMe } from "@/lib/queries/kocmax";
import { academyKeys, fetchAcademyTrack } from "@/lib/academy";
import { eligibility } from "@/lib/missionMeta";
import { useI18n } from "@/lib/i18n";
import { Markdown } from "@/components/Markdown";
import { ApiError } from "@/lib/api";
import { AcademyLearning } from "@/components/AcademyLearning";
import { useCanShowPreviousData } from "@/components/RequestFeedback";

export const Route = createFileRoute("/_app/guide/track/$trackId")({ component: TrackDetailPage });

function TrackDetailPage() {
  const { trackId } = useParams({ from: "/_app/guide/track/$trackId" });
  const me = useMe();
  const { t, lang } = useI18n();
  const uiLang = lang === "en" ? "en" : "zh-HK";
  const q = useQuery({ queryKey: academyKeys.track(trackId, uiLang), queryFn: () => fetchAcademyTrack(trackId, uiLang), retry: false });
  const showSavedTrack = useCanShowPreviousData(q, academyKeys.track(trackId, uiLang));
  const track = showSavedTrack ? q.data?.item : undefined;

  // apiFetch throws on a 404 → error state; gate not-found on q.isError, never on pending.
  if (q.isLoading) return <div className="p-4 text-sm">…</div>;
  if (q.isError && !track) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p role="alert" className="text-sm text-[var(--color-magenta)]">{t(q.error instanceof ApiError && q.error.status === 404 ? "app.guide.trackNotFound" : "app.guide.loadFailed")}</p>
        <button onClick={() => q.refetch()} className="text-sm underline">{t("common.retry")}</button>
        <Link to="/guide" className="text-sm underline">{t("common.back")}</Link>
      </div>
    );
  }
  if (!track) return <div className="p-4 text-sm">…</div>;

  const elig = eligibility(track.requiredLevel, me.data?.level, me.data?.is_trusted ?? false);
  const unlocked = elig.qualified;
  const needsVerification = elig.labelKey === "app.eligibility.verifyToUnlock";
  const levelLabel = track.meta.levelLabel ?? track.requiredLevel ?? "";
  const hasBody = Boolean(track.body?.trim());

  return (
    <div className="mx-auto max-w-lg pb-6 lg:max-w-5xl">
      <header className="glass-panel sticky top-0 z-30 flex items-center gap-3 border-b-2 border-[var(--color-ink)] p-3">
        <Link to="/guide" aria-label={t("common.back")} className="grid h-9 w-9 place-items-center rounded-full border-2 border-[var(--color-ink)] bg-white">
          <ArrowLeft size={18} />
        </Link>
        <span className="mr-1 text-xl">{track.emoji}</span>
        <h1 className="truncate font-heading font-semibold">{track.title}</h1>
      </header>

      <div className="p-4 space-y-4">
        {q.isError && <div role="alert"><p>{t("app.guide.staleContent")}</p><button onClick={() => q.refetch()} className="underline">{t("common.retry")}</button></div>}
        <div className="flex gap-2 text-sm text-[var(--color-ink-muted)]">
          <span>{levelLabel}</span>
        </div>
        {unlocked ? (
          hasBody ? <Markdown source={track.body!} /> : (
            <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-4">
              <h2 className="font-heading font-bold">{t("app.guide.contentPreparing")}</h2>
              <p className="text-sm">{t("app.guide.lessonsPreparing")}</p>
              {track.excerpt && <div><h3 className="text-sm font-bold">{t("app.guide.introduction")}</h3><p className="text-sm leading-relaxed">{track.excerpt}</p></div>}
            </section>
          )
        ) : (
          <div className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-cream)] p-5 space-y-3 text-center">
            <Lock size={32} className="mx-auto text-[var(--color-ink-muted)]" aria-hidden />
            <p className="font-heading font-bold">{lang === "en" ? track.meta.teaser_en : track.meta.teaser_zh}</p>
            {needsVerification ? (
              <>
                <p className="text-sm text-[var(--color-ink-muted)]">{t("app.guide.verifyToUnlock")}</p>
                <Link to="/profile" className="inline-block text-sm font-heading font-bold underline">{t("app.social.verifyNow")}</Link>
              </>
            ) : (
              <p className="text-sm text-[var(--color-ink-muted)]">{t("app.guide.unlockAt", { level: levelLabel })}</p>
            )}
          </div>
        )}
        {unlocked && track.learningEnabled && me.data?.id && <AcademyLearning key={me.data.id} creatorId={me.data.id} slug={track.slug} />}
      </div>
    </div>
  );
}
