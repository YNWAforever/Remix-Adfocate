import { useI18n } from "@/lib/i18n";
import { useMe, useMarkLevelSeen } from "@/lib/queries/kocmax";
import { LEVELS, levelIndex } from "@/lib/levels";

/** Celebration shown over any page when the creator's level is ahead of the level they
 *  were last celebrated for. The big XP jump (operator approval) happens out-of-session,
 *  so this is server-tracked via level_seen and fires on the creator's next visit. */
export function LevelUpModal() {
  const { t } = useI18n();
  const me = useMe();
  const mark = useMarkLevelSeen();

  // Use the EFFECTIVE level (capped at L1 for unverified creators) so that raw XP
  // crossing into L2 territory does NOT fire the "Trusted KOC" celebration —
  // it only fires once the creator actually verifies (effective_level jumps L1→L2+).
  const level = me.data?.effective_level ?? me.data?.level;
  const seen = me.data?.level_seen;
  // No data, or level_seen not present yet → no celebration (avoid a false fire).
  if (!level || seen === undefined) return null;
  if (levelIndex(level) <= levelIndex(seen)) return null;

  const def = LEVELS[levelIndex(level)];
  return (
    <div role="dialog" aria-label={t("app.level.levelUp")} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-6 text-center shadow-[6px_6px_0_0_var(--color-ink)]">
        <p className="font-display text-2xl font-bold">🎉 {t("app.level.levelUp")}</p>
        <p className="text-5xl" aria-hidden>{def.emoji}</p>
        <p className="font-heading text-xl font-bold">{t(def.labelKey)}</p>
        {def.unlockKey && <p className="text-sm text-[var(--color-soft-ink)]">{t("app.level.unlock", { unlock: t(def.unlockKey) })}</p>}
        <button
          type="button"
          onClick={() => mark.mutate()}
          disabled={mark.isPending}
          className="btn-primary w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)] disabled:opacity-50"
        >
          {t("app.level.levelUpCta")}
        </button>
      </div>
    </div>
  );
}
