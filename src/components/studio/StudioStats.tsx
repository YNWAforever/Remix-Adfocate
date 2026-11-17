import { Link } from "@tanstack/react-router";
import { LEVELS, levelIndex, progressToNext } from "@/lib/levels";
import { useI18n } from "@/lib/i18n";
import type { Balance, Me } from "@/lib/queries/kocmax";
import { StudioSkeleton } from "./StudioSkeleton";
import { useStudioText } from "./StudioPrimitives";

type Queryish<T> = {
  data?: T;
  isError?: boolean;
  refetch?: () => unknown;
};

/**
 * Level, XP progress and points. Derived from the same numbers as the rest of
 * the app, so the tile never shows a raw level id.
 */
export function StudioStats({ me, balance }: { me: Queryish<Me>; balance: Queryish<Balance> }) {
  const tx = useStudioText();
  const { t } = useI18n();
  const profile = me.data;
  const points = balance.data;
  const effectiveLevel = profile?.effective_level ?? profile?.level;
  const level = effectiveLevel ? LEVELS[levelIndex(effectiveLevel)] : undefined;
  const progress = profile ? progressToNext(profile.xp) : undefined;
  const xpToNext =
    profile && progress?.next ? progress.next.xpRequired - profile.xp : 0;

  return (
    <section className="s-stats" aria-label={tx("你的成長紀錄", "Your progress")}>
      <Link to="/passport" className="s-stat">
        <small>{tx("等級", "Level")}</small>
        {profile && level ? (
          <strong>
            <span aria-hidden>{level.emoji}</span> {t(level.labelKey)}
          </strong>
        ) : me.isError ? (
          <strong>{tx("讀取失敗", "Unavailable")}</strong>
        ) : (
          <StudioSkeleton width="70%" height={20} />
        )}
      </Link>

      <div className="s-stat">
        <small>{tx("經驗值", "Experience")}</small>
        {profile ? <strong>{profile.xp.toLocaleString()} XP</strong> : <StudioSkeleton width="55%" height={20} />}
        {progress?.next ? (
          <>
            <progress
              value={progress.pct}
              max={100}
              aria-label={tx("升級進度", "Level progress")}
            />
            <small>
              {tx(
                `還差 ${xpToNext.toLocaleString()} XP 到 ${t(progress.next.labelKey)}`,
                `${xpToNext.toLocaleString()} XP to ${t(progress.next.labelKey)}`,
              )}
            </small>
          </>
        ) : progress ? (
          <small>{tx("已達最高等級", "Top level reached")}</small>
        ) : null}
      </div>

      <Link to="/wallet" className="s-stat">
        <small>{tx("可用積分", "Available points")}</small>
        {points ? (
          <strong aria-live="polite">✦ {points.balance.toLocaleString()}</strong>
        ) : balance.isError ? (
          <strong>{tx("讀取失敗", "Unavailable")}</strong>
        ) : (
          <StudioSkeleton width="45%" height={20} />
        )}
      </Link>
    </section>
  );
}
