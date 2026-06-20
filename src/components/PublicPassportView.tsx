import { LEVELS, levelIndex } from "@/lib/levels";
import { useI18n } from "@/lib/i18n";
import { SCORE_META, SCORE_ORDER } from "@/lib/passport";
import type { PublicPassport } from "@/lib/queries/kocmax";
import { ScoreRing } from "./ScoreRing";

const TRUST_BADGES: Record<string, string> = {
  social_scan_connected: "Social scan connected",
  active_creator: "Active creator",
  fresh_profile_activity: "Fresh profile activity",
};

export function PublicPassportView({ passport }: { passport: PublicPassport }) {
  const { t } = useI18n();
  const lvl = LEVELS[levelIndex(passport.creator.level)];
  const initial = (passport.creator.displayName[0] ?? "?").toUpperCase();

  return (
    <div className="mx-auto w-full max-w-lg space-y-6 p-4 lg:max-w-5xl">
      <div className="lg:grid lg:grid-cols-[1.4fr_1fr] lg:gap-6 lg:items-start">
        {/* Left column: identity hero */}
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
                <span aria-hidden>{lvl.emoji}</span> {t(lvl.labelKey)} · {passport.creator.xp} XP
              </p>
            </div>
          </div>
        </section>

        {/* Right column: scores, badges, highlights */}
        <div className="mt-6 space-y-6 lg:mt-0">
          <section className="space-y-3">
            <h2 className="font-heading font-bold">Creator scores</h2>
            <div className="grid grid-cols-2 gap-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)] lg:grid-cols-4">
              {SCORE_ORDER.map((key) => (
                <ScoreRing key={key} value={passport.scores[key]} label={t(SCORE_META[key].labelKey)} accent={SCORE_META[key].accent} />
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="font-heading font-bold">Trust badges</h2>
            <div className="grid grid-cols-2 gap-3">
              {passport.socialTrustBadges.flatMap((id) => {
                const label = TRUST_BADGES[id];
                if (!label) return [];

                return (
                  <div key={id} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 text-sm font-bold">
                    {label}
                  </div>
                );
              })}
            </div>
          </section>

          {passport.profileMedia.highlights.length > 0 ? (
            <section className="space-y-3">
              <h2 className="font-heading font-bold">Creator highlights</h2>
              <div className="space-y-3">
                {passport.profileMedia.highlights.map((highlight) => (
                  <a
                    key={`${highlight.url}-${highlight.sort_order}`}
                    href={highlight.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 shadow-[4px_4px_0_0_var(--color-ink)]"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-heading font-bold">{highlight.title}</span>
                      <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-2 py-0.5 text-xs font-bold">
                        {highlight.platform_type}
                      </span>
                    </div>
                    {highlight.caption ? <p className="mt-2 text-sm text-[var(--color-soft-ink)]">{highlight.caption}</p> : null}
                  </a>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
