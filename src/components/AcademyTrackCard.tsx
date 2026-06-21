import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { localized } from "@/data/legacyAdfocateContent";
import { eligibility } from "@/lib/missionMeta";
import type { AcademyTrack } from "@/data/academy";

type Props = {
  track: AcademyTrack;
  /** Creator's RAW level (not effective) + trust flag — eligibility() applies the cap. */
  creatorLevel?: string | null;
  isTrusted?: boolean;
};

export function AcademyTrackCard({ track, creatorLevel, isTrusted }: Props) {
  const { t, lang } = useI18n();
  // Reuse the mission-surface gate so Academy + missions stay consistent and
  // we can tell "need more XP" apart from "need verification". Defaults
  // (L0 / untrusted) make this fail closed.
  const elig = eligibility(track.requiredLevel, creatorLevel, isTrusted ?? false);

  if (elig.qualified) {
    return (
      <Link
        to="/guide/track/$trackId"
        params={{ trackId: track.id }}
        className="pastel-card flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 no-underline hover:opacity-90 transition-opacity"
      >
        <span className="text-2xl" aria-hidden>
          {track.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-heading font-semibold leading-snug">{localized(track.title, lang)}</h3>
          <p className="mt-0.5 text-sm text-[var(--color-soft-ink)]">{localized(track.duration, lang)}</p>
        </div>
      </Link>
    );
  }

  const needsVerification = elig.labelKey === "app.eligibility.verifyToUnlock";
  // Verification gate → point to /profile to verify; otherwise show the level needed.
  const lockedCopy = needsVerification
    ? t("app.eligibility.verifyToUnlock", { req: track.level })
    : t("app.guide.unlockAt", { level: track.level });

  const body = (
    <>
      <span className="text-2xl" aria-hidden>
        {track.emoji}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="font-heading font-semibold leading-snug text-[var(--color-soft-ink)]">
          {localized(track.title, lang)}
        </h3>
        <p className="mt-0.5 text-sm text-[var(--color-soft-ink)]">🔒 {lockedCopy}</p>
      </div>
    </>
  );

  // When the only thing missing is verification, make the card a link to /profile.
  if (needsVerification) {
    return (
      <Link
        to="/profile"
        className="flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-muted,#E4E4E4)] p-3 no-underline opacity-70 hover:opacity-90 transition-opacity"
      >
        {body}
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-muted,#E4E4E4)] p-3 opacity-60">
      {body}
    </div>
  );
}
