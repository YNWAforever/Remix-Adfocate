import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Lock } from "lucide-react";
import { useMe } from "@/lib/queries/kocmax";
import { academyTracks } from "@/data/academy";
import { localized } from "@/data/legacyAdfocateContent";
import { eligibility } from "@/lib/missionMeta";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/guide/track/$trackId")({ component: TrackDetailPage });

function TrackDetailPage() {
  const { trackId } = Route.useParams();
  const me = useMe();
  const { t, lang } = useI18n();

  const track = academyTracks.find((tr) => tr.id === trackId);

  if (!track) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="text-sm text-[var(--color-magenta)]">{t("app.guide.trackNotFound")}</p>
        <Link to="/guide" className="text-sm underline">{t("common.back")}</Link>
      </div>
    );
  }

  // Gate via eligibility() (raw level + trust; defaults fail closed), so the
  // locked copy can distinguish "need more XP" from "need verification".
  const elig = eligibility(track.requiredLevel, me.data?.level, me.data?.is_trusted ?? false);
  const unlocked = elig.qualified;
  const needsVerification = elig.labelKey === "app.eligibility.verifyToUnlock";

  return (
    <div className="mx-auto max-w-lg pb-6 lg:max-w-5xl">
      <header className="glass-panel sticky top-0 z-30 flex items-center gap-3 border-b-2 border-[var(--color-ink)] p-3">
        <Link to="/guide" aria-label={t("common.back")} className="grid h-9 w-9 place-items-center rounded-full border-2 border-[var(--color-ink)] bg-white">
          <ArrowLeft size={18} />
        </Link>
        <span className="mr-1 text-xl">{track.emoji}</span>
        <h1 className="truncate font-heading font-semibold">{localized(track.title, lang)}</h1>
      </header>

      <div className="p-4 space-y-4">
        <div className="flex gap-2 text-sm text-[var(--color-ink-muted)]">
          <span>{localized(track.duration, lang)}</span>
          <span>·</span>
          <span>{track.level}</span>
        </div>

        {unlocked ? (
          <p className="text-sm leading-relaxed">{localized(track.description, lang)}</p>
        ) : (
          <div className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-cream)] p-5 space-y-3 text-center">
            <Lock size={32} className="mx-auto text-[var(--color-ink-muted)]" aria-hidden />
            <p className="font-heading font-bold">{t(track.teaserKey)}</p>
            {needsVerification ? (
              <>
                <p className="text-sm text-[var(--color-ink-muted)]">
                  {t("app.eligibility.verifyToUnlock", { req: track.level })}
                </p>
                <Link to="/profile" className="inline-block text-sm font-heading font-bold underline">
                  {t("app.guide.unlockAt", { level: track.level })}
                </Link>
              </>
            ) : (
              <p className="text-sm text-[var(--color-ink-muted)]">
                {t("app.guide.unlockAt", { level: track.level })}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
