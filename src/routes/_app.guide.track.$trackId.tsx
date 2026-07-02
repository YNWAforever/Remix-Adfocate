import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Lock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMe } from "@/lib/queries/kocmax";
import { academyKeys, fetchAcademyTrack } from "@/lib/academy";
import { eligibility } from "@/lib/missionMeta";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/guide/track/$trackId")({ component: TrackDetailPage });

function TrackDetailPage() {
  const { trackId } = useParams({ from: "/_app/guide/track/$trackId" });
  const me = useMe();
  const { t, lang } = useI18n();
  const uiLang = lang === "en" ? "en" : "zh-HK";
  const q = useQuery({ queryKey: academyKeys.track(trackId, uiLang), queryFn: () => fetchAcademyTrack(trackId, uiLang), retry: false });
  const track = q.data?.item;

  // apiFetch throws on a 404 → error state; gate not-found on q.isError, never on pending.
  if (q.isLoading) return <div className="p-4 text-sm">…</div>;
  if (q.isError) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="text-sm text-[var(--color-magenta)]">{t("app.guide.trackNotFound")}</p>
        <Link to="/guide" className="text-sm underline">{t("common.back")}</Link>
      </div>
    );
  }
  if (!track) return <div className="p-4 text-sm">…</div>;

  const elig = eligibility(track.requiredLevel, me.data?.level, me.data?.is_trusted ?? false);
  const unlocked = elig.qualified;
  const needsVerification = elig.labelKey === "app.eligibility.verifyToUnlock";
  const levelLabel = track.meta.levelLabel ?? track.requiredLevel ?? "";
  const bodyText = track.body && track.body.trim() ? track.body : track.excerpt;

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
        <div className="flex gap-2 text-sm text-[var(--color-ink-muted)]">
          <span>{track.meta.duration}</span><span>·</span><span>{levelLabel}</span>
        </div>
        {unlocked ? (
          <p className="text-sm leading-relaxed">{bodyText}</p>
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
      </div>
    </div>
  );
}
