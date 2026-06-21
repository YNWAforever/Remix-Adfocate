import { progressToNext, levelIndex, LEVELS } from "@/lib/levels";
import { useI18n } from "@/lib/i18n";

/** Level emoji + label, XP, progress bar and the "next level" hint, derived from xp.
 *  De-duplicates the block previously inlined in both /profile and /passport.
 *  Pass `effectiveLevelId` (from me.data.effective_level) to cap the displayed
 *  level for unverified creators who have already earned past L1 in XP. */
export function LevelProgress({ xp, effectiveLevelId }: { xp: number; effectiveLevelId?: string | null }) {
  const { t } = useI18n();
  const p = progressToNext(xp);
  const xpIdx = levelIndex(p.current.id);
  const effIdx = effectiveLevelId != null ? levelIndex(effectiveLevelId) : xpIdx;
  const capped = effIdx < xpIdx; // unverified creator whose XP exceeds their effective level
  const shownLevel = capped ? LEVELS[effIdx] : p.current;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-2xl" aria-hidden>
          {shownLevel.emoji}
        </span>
        <span className="font-heading font-bold">{t(shownLevel.labelKey)}</span>
        <span className="ml-auto text-sm text-[var(--color-soft-ink)]">{xp} XP</span>
      </div>
      {capped ? (
        // XP already meets the next level but creator is unverified — show verify hint
        <p className="text-sm text-[var(--color-soft-ink)]">
          {t("app.level.readyVerify", { level: t(p.current.labelKey) })}
        </p>
      ) : p.next ? (
        <>
          <div className="h-3 overflow-hidden rounded-full border-2 border-[var(--color-ink)] bg-white">
            <div className="h-full bg-[var(--color-acid)]" style={{ width: `${p.pct}%` }} />
          </div>
          <p className="text-sm text-[var(--color-soft-ink)]">
            {t("app.level.toNext", { n: (p.xpForNext ?? 0) - p.xpIntoCurrent, level: t(p.next.labelKey) })}
          </p>
          <p className="text-xs text-[var(--color-soft-ink)]">{t("app.level.unlock", { unlock: p.next.unlockKey ? t(p.next.unlockKey) : "" })}</p>
        </>
      ) : (
        <p className="text-sm font-heading font-bold">{t("app.level.max")}</p>
      )}
    </div>
  );
}
