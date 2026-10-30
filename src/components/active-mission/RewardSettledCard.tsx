import { Link } from "@tanstack/react-router";
import type { CreatorPendingReward } from "@/lib/activeMission";
import { formatCreatorCurrency, formatHongKongDateTime } from "@/lib/creatorFormatting";
import { useI18n } from "@/lib/i18n";

/** Shown once finance has settled the hand-off: the reward is now in the creator's balances. */
export function RewardSettledCard({ missionTitle, pendingReward }: { missionTitle: string; pendingReward: CreatorPendingReward }) {
  const { t, lang } = useI18n();
  const { pointsAmount, cashAmount, xpAmount } = pendingReward.reward;
  const parts = [
    pointsAmount > 0 ? t("app.activeMission.rewardSettled.points", { n: new Intl.NumberFormat(lang === "zh" ? "zh-HK" : "en-HK").format(pointsAmount) }) : null,
    cashAmount > 0 ? formatCreatorCurrency(cashAmount, lang) : null,
    xpAmount > 0 ? t("app.activeMission.rewardSettled.xp", { n: xpAmount }) : null,
  ].filter(Boolean);
  const settledAt = pendingReward.settledAt ? formatHongKongDateTime(pendingReward.settledAt, lang === "zh" ? "zh-HK" : "en-HK") : null;
  return (
    <section
      aria-label={t("app.activeMission.rewardSettled.ariaLabel", { missionTitle })}
      className="min-w-0 max-w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)] sm:p-6"
    >
      <p className="font-mono text-xs font-bold uppercase tracking-wider text-[var(--color-soft-ink)]">{t("app.activeMission.rewardSettled.status")}</p>
      <h2 className="mt-2 break-words font-heading text-2xl font-black">{t("app.activeMission.rewardSettled.title")}</h2>
      {parts.length > 0 && <p className="mt-3 font-display text-lg font-bold">{parts.join(" · ")}</p>}
      {settledAt && <p className="mt-1 text-sm text-[var(--color-soft-ink)]">{t("app.activeMission.rewardSettled.when", { date: settledAt })}</p>}
      <Link to="/wallet" className="mt-4 inline-block text-sm font-semibold underline underline-offset-4">{t("app.activeMission.rewardSettled.walletLink")}</Link>
    </section>
  );
}
