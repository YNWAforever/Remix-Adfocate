import { LEVELS, levelIndex } from "@/lib/levels";
import { BADGES, SCORE_META, SCORE_ORDER } from "@/lib/passport";
import type { PublicPassport } from "@/lib/queries/kocmax";
import { ScoreRing } from "./ScoreRing";

const TRUST_BADGES: Record<string, string> = {
  social_scan_connected: "Social scan connected",
  active_creator: "Active creator",
  fresh_profile_activity: "Fresh profile activity",
};

export function PublicPassportView({ passport }: { passport: PublicPassport }) {
  const lvl = LEVELS[levelIndex(passport.creator.level)];
  const initial = (passport.creator.displayName[0] ?? "?").toUpperCase();

  return (
    <div className="mx-auto max-w-lg space-y-6 p-4">
      <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-5 shadow-[4px_4px_0_0_var(--color-ink)]">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] font-display text-2xl font-bold">
            {passport.creator.avatarUrl ? (
              <img src={passport.creator.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              initial
            )}
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-display text-2xl font-bold">{passport.creator.displayName}</h1>
            <p className="font-heading font-bold">
              <span aria-hidden>{lvl.emoji}</span> {lvl.label} · {passport.creator.xp} XP
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading font-bold">Creator scores</h2>
        <div className="grid grid-cols-2 gap-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)]">
          {SCORE_ORDER.map((key) => (
            <ScoreRing key={key} value={passport.scores[key]} label={SCORE_META[key].label} accent={SCORE_META[key].accent} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading font-bold">Trust badges</h2>
        <div className="grid grid-cols-2 gap-3">
          {passport.socialTrustBadges.map((id) => (
            <div key={id} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 text-sm font-bold">
              {TRUST_BADGES[id] ?? id}
            </div>
          ))}
          {passport.badges.map((id) => {
            const badge = BADGES[id];
            if (!badge) return null;

            return (
              <div key={id} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 text-sm font-bold">
                {badge.label}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
