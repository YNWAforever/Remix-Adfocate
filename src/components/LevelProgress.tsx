import { progressToNext } from "@/lib/levels";
import { useI18n } from "@/lib/i18n";

/** Level emoji + label, XP, progress bar and the "next level" hint, derived from xp.
 *  De-duplicates the block previously inlined in both /profile and /passport. */
export function LevelProgress({ xp }: { xp: number }) {
  const { t } = useI18n();
  const p = progressToNext(xp);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-2xl" aria-hidden>
          {p.current.emoji}
        </span>
        <span className="font-heading font-bold">{t(p.current.labelKey)}</span>
        <span className="ml-auto text-sm text-[var(--color-soft-ink)]">{xp} XP</span>
      </div>
      {p.next ? (
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
