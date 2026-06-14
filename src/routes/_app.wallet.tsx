import { createFileRoute } from "@tanstack/react-router";
import { useBalance, usePointHistory, useMe } from "@/lib/queries/kocmax";
import { useRealtimeBalance } from "@/lib/useRealtimeBalance";
import { PointsBalanceCard } from "@/components/PointsBalanceCard";
import { SkeletonCard } from "@/components/SkeletonCard";

export const Route = createFileRoute("/_app/wallet")({ component: Wallet });

function Wallet() {
  const me = useMe();
  const balance = useBalance();
  const history = usePointHistory();
  useRealtimeBalance(me.data?.id);
  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <h1 className="font-display text-2xl font-bold">錢包</h1>
      <PointsBalanceCard balance={balance.data?.balance ?? 0} availableTo={balance.data?.available_to} loading={balance.isLoading} />
      {balance.isError && <p className="text-sm text-[var(--color-magenta)]">積分載入失敗</p>}
      <h2 className="font-heading font-bold">積分記錄</h2>
      {history.isLoading && <SkeletonCard className="h-24" />}
      {history.isError && <p className="text-sm text-[var(--color-magenta)]">記錄載入失敗</p>}
      <ul className="space-y-2">
        {history.data?.map((t) => (
          <li key={t.id} className="pastel-card flex items-center justify-between rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
            <div>
              <p className="font-heading font-semibold">{t.description ?? t.type}</p>
              <p className="text-xs text-[var(--color-soft-ink)]">{t.created_at.slice(0, 10)}</p>
            </div>
            <span className={`font-display font-bold ${t.delta >= 0 ? "text-[var(--color-ink)]" : "text-[var(--color-magenta)]"}`}>{t.delta >= 0 ? "+" : ""}{t.delta}</span>
          </li>
        ))}
        {!history.isLoading && !history.isError && history.data?.length === 0 && (
          <li className="text-sm text-[var(--color-soft-ink)]">暫無記錄</li>
        )}
      </ul>
    </div>
  );
}
