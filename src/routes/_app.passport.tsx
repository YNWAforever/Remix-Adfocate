import { createFileRoute } from "@tanstack/react-router";
import { useMe, useMyPassport } from "@/lib/queries/kocmax";
import { progressToNext, LEVELS, levelIndex } from "@/lib/levels";
import { SCORE_META, SCORE_ORDER, BADGES } from "@/lib/passport";
import { ScoreRing } from "@/components/ScoreRing";

export const Route = createFileRoute("/_app/passport")({ component: Passport });

function Passport() {
  const me = useMe();
  const passport = useMyPassport();

  if (passport.isLoading) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-sm text-[var(--color-soft-ink)]">載入中…</p>
      </div>
    );
  }
  if (passport.isError || !passport.data) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-sm text-[var(--color-magenta)]">載入失敗，請重試</p>
      </div>
    );
  }

  const p = passport.data;
  const prog = progressToNext(p.xp);
  const lvl = LEVELS[levelIndex(p.level)];
  const name = me.data?.display_name ?? "KOC";
  const initial = (name[0] ?? "?").toUpperCase();

  return (
    <div className="mx-auto max-w-lg space-y-6 p-4">
      <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-5 shadow-[4px_4px_0_0_var(--color-ink)]">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] font-display text-2xl font-bold">
            {me.data?.avatar_url ? <img src={me.data.avatar_url} alt="" className="h-full w-full object-cover" /> : initial}
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-display text-2xl font-bold">{name}</h1>
            <p className="font-heading font-bold">
              <span aria-hidden>{lvl.emoji}</span> {lvl.label} · {p.xp} XP
            </p>
          </div>
        </div>
        {prog.next ? (
          <>
            <div className="h-3 overflow-hidden rounded-full border-2 border-[var(--color-ink)] bg-white">
              <div className="h-full bg-[var(--color-acid)]" style={{ width: `${prog.pct}%` }} />
            </div>
            <p className="text-sm text-[var(--color-soft-ink)]">
              還需 {prog.xpForNext! - prog.xpIntoCurrent} XP 升至 {prog.next.label}
            </p>
          </>
        ) : (
          <p className="text-sm font-heading font-bold">最高等級</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-heading font-bold">創作者評分</h2>
        <div className="grid grid-cols-2 gap-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)]">
          {SCORE_ORDER.map((k) => (
            <ScoreRing key={k} value={p.scores[k]} label={SCORE_META[k].label} accent={SCORE_META[k].accent} />
          ))}
        </div>
        <p className="text-xs text-[var(--color-soft-ink)]">影響力為自填數據，未驗證。</p>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading font-bold">徽章</h2>
        {p.badges.length ? (
          <div className="grid grid-cols-2 gap-3">
            {p.badges.map((id) => {
              const b = BADGES[id];
              if (!b) return null;
              return (
                <div
                  key={id}
                  className="flex items-center gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3"
                >
                  <span className="text-2xl" aria-hidden>
                    {b.emoji}
                  </span>
                  <div className="min-w-0">
                    <p className="font-heading text-sm font-bold">{b.label}</p>
                    <p className="truncate text-xs text-[var(--color-soft-ink)]">{b.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-soft-ink)]">完成任務與連結社交帳號即可解鎖徽章。</p>
        )}
      </section>
    </div>
  );
}
