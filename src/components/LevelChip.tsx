import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { progressToNext, levelIndex, LEVELS } from "@/lib/levels";

/** Compact level pill for the Profile page that links to the full Passport.
 *  Pass `effectiveLevelId` (from me.data.effective_level) to display the
 *  capped level for unverified creators whose XP has already exceeded L1. */
export function LevelChip({ xp, effectiveLevelId }: { xp: number; effectiveLevelId?: string | null }) {
  const { t } = useI18n();
  const p = progressToNext(xp);
  const xpIdx = levelIndex(p.current.id);
  const effIdx = effectiveLevelId != null ? levelIndex(effectiveLevelId) : xpIdx;
  const shownLevel = effIdx < xpIdx ? LEVELS[effIdx] : p.current;
  return (
    <Link
      to="/passport"
      className="inline-flex max-w-full items-center gap-1 rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-sm font-bold"
    >
      <span aria-hidden className="shrink-0">{shownLevel.emoji}</span>
      {/* Truncate only the label (English level names run long, e.g. "Micro-Influencer");
          the emoji and the view-passport call-to-action stay visible so the chip never
          overflows a cramped mobile header. */}
      <span className="min-w-0 truncate">{t(shownLevel.labelKey)}</span>
      <span className="shrink-0">{t("app.level.viewPassport")}</span>
    </Link>
  );
}
