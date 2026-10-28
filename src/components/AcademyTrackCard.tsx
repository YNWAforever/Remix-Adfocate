import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { eligibility } from "@/lib/missionMeta";
import type { AcademyTrack } from "@/lib/academy";

type Props = {
  track: AcademyTrack;
  /** Creator's RAW level (not effective) + trust flag — eligibility() applies the cap. */
  creatorLevel?: string | null;
  isTrusted?: boolean;
};

export function AcademyTrackCard({ track, creatorLevel, isTrusted }: Props) {
  const { t } = useI18n();
  const elig = eligibility(track.requiredLevel, creatorLevel, isTrusted ?? false);
  const levelLabel = track.meta.levelLabel ?? track.requiredLevel ?? "";

  if (elig.qualified) {
    return (
      <Link
        to="/guide/track/$trackId"
        params={{ trackId: track.slug }}
        className="pastel-card flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 no-underline hover:opacity-90 transition-opacity"
      >
        <span className="text-2xl" aria-hidden>{track.emoji}</span>
        <div className="min-w-0 flex-1">
          <h3 className="font-heading font-semibold leading-snug">{track.title}</h3>
          <p className="mt-0.5 text-sm text-[var(--color-soft-ink)]">
            {t(track.contentStatus === "available" || track.body?.trim() ? "app.guide.readContent" : "app.guide.contentPreparing")}
          </p>
        </div>
      </Link>
    );
  }

  const needsVerification = elig.labelKey === "app.eligibility.verifyToUnlock";
  const lockedCopy = needsVerification ? t("app.guide.verifyToUnlock") : t("app.guide.unlockAt", { level: levelLabel });
  const body = (
    <>
      <span className="text-2xl" aria-hidden>{track.emoji}</span>
      <div className="min-w-0 flex-1">
        <h3 className="font-heading font-semibold leading-snug text-[var(--color-soft-ink)]">{track.title}</h3>
        <p className="mt-0.5 text-sm text-[var(--color-soft-ink)]">🔒 {lockedCopy}</p>
      </div>
    </>
  );

  if (needsVerification) {
    return (
      <Link to="/profile" className="flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-muted,#E4E4E4)] p-3 no-underline hover:underline">
        {body}
      </Link>
    );
  }
  return <div className="flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-muted,#E4E4E4)] p-3">{body}</div>;
}
