import { createFileRoute } from "@tanstack/react-router";
import { useBalance, usePointHistory, useMe, useEarnings, useEarningsHistory } from "@/lib/queries/kocmax";
import { useRealtimeBalance } from "@/lib/useRealtimeBalance";
import { PointsBalanceCard } from "@/components/PointsBalanceCard";
import { SkeletonCard } from "@/components/SkeletonCard";
import { useI18n } from "@/lib/i18n";
import { formatCreatorCurrency, formatCreatorDate } from "@/lib/creatorFormatting";

export const Route = createFileRoute("/_app/wallet")({ component: Wallet });

function Wallet() {
  const { t, lang } = useI18n();
  const me = useMe();
  const balance = useBalance();
  const history = usePointHistory();
  const earnings = useEarnings();
  const earningsHistory = useEarningsHistory();
  useRealtimeBalance(me.data?.id);
  return (
    <div className="mx-auto w-full max-w-lg space-y-4 p-4 lg:max-w-5xl">
      <h1 className="font-display text-2xl font-bold">{t("app.wallet.pageTitle")}</h1>
      <div className="lg:grid lg:grid-cols-[1fr_1.4fr] lg:gap-6 lg:items-start">
        {/* Left column — points */}
        <div className="space-y-4">
          <PointsBalanceCard balance={balance.data?.balance ?? 0} availableTo={balance.data?.available_to} loading={balance.isLoading} />
          {balance.isError && <p className="text-sm text-[var(--color-magenta)]">{t("common.balanceError")}</p>}

          <h2 className="font-heading font-bold">{t("app.wallet.pointsHistory")}</h2>
          {history.isLoading && <SkeletonCard className="h-24" />}
          {history.isError && <p className="text-sm text-[var(--color-magenta)]">{t("app.wallet.historyError")}</p>}
          <ul className="space-y-2">
            {history.data?.map((tx) => (
              <li key={tx.id} className="pastel-card flex items-center justify-between rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
                <div>
                  <p className="font-heading font-semibold">{tx.description ?? tx.type}</p>
                  <p className="text-xs text-[var(--color-soft-ink)]">{formatCreatorDate(tx.created_at, lang)}</p>
                </div>
                <span className={`font-display font-bold ${tx.delta >= 0 ? "text-[var(--color-ink)]" : "text-[var(--color-magenta)]"}`}>{tx.delta >= 0 ? "+" : ""}{tx.delta}</span>
              </li>
            ))}
            {!history.isLoading && !history.isError && history.data?.length === 0 && (
              <li className="text-sm text-[var(--color-soft-ink)]">{t("app.wallet.historyEmpty")}</li>
            )}
          </ul>
        </div>

        {/* Right column — earnings */}
        <div className="mt-4 space-y-4 lg:mt-0">
          <h2 className="font-heading font-bold">{t("app.wallet.earningsTitle")}</h2>
          {/* Never show HK$0.00 for an unknown balance: it reads as "your money is gone". */}
          {earnings.isLoading && <SkeletonCard className="h-24" />}
          {earnings.data && (
            <div className="pastel-card grid grid-cols-2 gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
              <div>
                <p className="text-xs text-[var(--color-soft-ink)]">{t("app.wallet.earningsAvailable")}</p>
                <p className="font-display text-2xl font-bold">{formatCreatorCurrency(earnings.data.available, lang)}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--color-soft-ink)]">{t("app.wallet.earningsPending")}</p>
                <p className="font-display text-2xl font-bold text-[var(--color-soft-ink)]">{formatCreatorCurrency(earnings.data.pending, lang)}</p>
              </div>
            </div>
          )}
          {earnings.isError && <p role="alert" className="text-sm text-[var(--color-magenta)]">{t("app.wallet.earningsError")}</p>}
          {earningsHistory.isLoading && <SkeletonCard className="h-24" />}
          {earningsHistory.isError && <p role="alert" className="text-sm text-[var(--color-magenta)]">{t("app.wallet.earningsHistoryError")}</p>}
          <ul className="space-y-2">
            {earningsHistory.data?.map((tx) => (
              <li key={tx.id} className="pastel-card flex items-center justify-between rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
                <div>
                  <p className="font-heading font-semibold">{tx.description ?? tx.type}</p>
                  <p className="text-xs text-[var(--color-soft-ink)]">{formatCreatorDate(tx.created_at, lang)}</p>
                </div>
                <span className={`font-display font-bold ${tx.amount >= 0 ? "text-[var(--color-ink)]" : "text-[var(--color-magenta)]"}`}>{tx.amount >= 0 ? "+" : ""}{formatCreatorCurrency(tx.amount, lang)}</span>
              </li>
            ))}
            {!earningsHistory.isLoading && !earningsHistory.isError && earningsHistory.data?.length === 0 && (
              <li className="text-sm text-[var(--color-soft-ink)]">{t("app.wallet.earningsHistoryEmpty")}</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
