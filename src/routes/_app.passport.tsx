import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { IdentityHeader } from "@/components/IdentityHeader";
import { LevelProgress } from "@/components/LevelProgress";
import { PassportTrustSummary } from "@/components/PassportTrustSummary";
import { ScoreRing } from "@/components/ScoreRing";
import { useI18n } from "@/lib/i18n";
import { useCreatePassportShare, useMe, useMyPassport, useRevokePassportShare } from "@/lib/queries/kocmax";
import { SCORE_META, SCORE_ORDER, BADGES } from "@/lib/passport";

export const Route = createFileRoute("/_app/passport")({ component: Passport });

const CARD = "rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)]";
const FLAT = "rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4";

function Passport() {
  const { t } = useI18n();
  const me = useMe();
  const passport = useMyPassport();
  const share = useCreatePassportShare();
  const revoke = useRevokePassportShare();
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  if (passport.isLoading) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-sm text-[var(--color-soft-ink)]">{t("common.loading")}</p>
      </div>
    );
  }
  if (passport.isError || !passport.data) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-sm text-[var(--color-magenta)]">{t("common.loadFailed")}</p>
      </div>
    );
  }

  const p = passport.data;
  const name = me.data?.display_name ?? "KOC";

  return (
    <div className="mx-auto w-full max-w-lg space-y-6 p-4 lg:max-w-5xl">
      <section className={`${CARD} p-5`}>
        <IdentityHeader name={name} avatarUrl={me.data?.avatar_url}>
          <LevelProgress xp={p.xp} effectiveLevelId={me.data?.effective_level} />
        </IdentityHeader>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <section className="space-y-3">
            <h2 className="font-heading font-bold">{t("app.passport.scores")}</h2>
            <div className={`grid grid-cols-2 gap-4 lg:grid-cols-4 ${CARD}`}>
              {SCORE_ORDER.map((k) => (
                <div key={k} className="flex flex-col items-center gap-1">
                  <ScoreRing value={p.scores[k]} label={t(SCORE_META[k].labelKey)} accent={SCORE_META[k].accent} />
                  {SCORE_META[k].noteKey && (
                    <p className="text-center text-[10px] leading-tight text-[var(--color-soft-ink)]">
                      {t(SCORE_META[k].noteKey!)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="font-heading font-bold">{t("app.passport.badges")}</h2>
            {p.badges.length ? (
              <div className="grid grid-cols-2 gap-3">
                {p.badges.map((id) => {
                  const b = BADGES[id];
                  if (!b) return null;
                  return (
                    <div key={id} className={`flex items-center gap-2 ${FLAT}`}>
                      <span className="text-2xl" aria-hidden>
                        {b.emoji}
                      </span>
                      <div className="min-w-0">
                        <p className="font-heading text-sm font-bold">{t(b.labelKey)}</p>
                        <p className="truncate text-xs text-[var(--color-soft-ink)]">{t(b.descKey)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-[var(--color-soft-ink)]">{t("app.passport.badgesEmpty")}</p>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <PassportTrustSummary socialTrust={p.socialTrust} />

          <section className={`space-y-3 ${CARD}`}>
            <h2 className="font-heading font-bold">{t("app.passport.shareTitle")}</h2>
            {shareUrl && <p className="break-all text-sm text-[var(--color-soft-ink)]">{shareUrl}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  const result = await share.mutateAsync();
                  setShareUrl(result.publicUrl);
                  await globalThis.navigator?.clipboard?.writeText?.(result.publicUrl);
                }}
                className="flex-1 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-2 text-sm font-bold"
              >
                {t("app.passport.createLink")}
              </button>
              <button
                type="button"
                onClick={async () => {
                  await revoke.mutateAsync();
                  setShareUrl(null);
                }}
                className="flex-1 rounded-full border-2 border-[var(--color-ink)] bg-white py-2 text-sm font-bold"
              >
                {t("app.passport.revokeLink")}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
