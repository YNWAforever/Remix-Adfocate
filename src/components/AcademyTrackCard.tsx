import { useI18n } from "@/lib/i18n";
import { isTrackUnlocked } from "@/lib/academyGating";
import { LEVELS, levelIndex } from "@/lib/levels";
import type { AcademyTrack } from "@/data/academy";

type Props = {
  track: AcademyTrack;
  effectiveLevel?: string | null;
};

export function AcademyTrackCard({ track, effectiveLevel }: Props) {
  const { t } = useI18n();
  const unlocked = isTrackUnlocked(track.requiredLevel, effectiveLevel);

  if (unlocked) {
    return (
      <a
        href={`/guide/track/${track.id}`}
        className="pastel-card flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 no-underline hover:opacity-90 transition-opacity"
      >
        <span className="text-2xl" aria-hidden>
          {track.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-heading font-semibold leading-snug">{track.title}</h3>
          <p className="mt-0.5 text-sm text-[var(--color-soft-ink)]">{track.duration}</p>
        </div>
      </a>
    );
  }

  const levelLabel = t(LEVELS[levelIndex(track.requiredLevel)].labelKey);
  const unlockCopy = t("app.guide.unlockAt", { level: levelLabel });

  return (
    <div className="flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-muted,#E4E4E4)] p-3 opacity-60">
      <span className="text-2xl" aria-hidden>
        {track.emoji}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="font-heading font-semibold leading-snug text-[var(--color-soft-ink)]">
          {track.title}
        </h3>
        <p className="mt-0.5 text-sm text-[var(--color-soft-ink)]">
          🔒 {unlockCopy}
        </p>
      </div>
    </div>
  );
}
