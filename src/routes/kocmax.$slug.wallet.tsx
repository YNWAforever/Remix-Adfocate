import { createFileRoute } from "@tanstack/react-router";
import { useBalance, usePointHistory, useMe } from "@/lib/queries/kocmax";
import { useRealtimeBalance } from "@/lib/useRealtimeBalance";

export const Route = createFileRoute("/kocmax/$slug/wallet")({ component: Wallet });

function Wallet() {
  const me = useMe();
  const balance = useBalance();
  const history = usePointHistory();
  useRealtimeBalance(me.data?.id);
  return (
    <div className="p-4 space-y-4">
      <section className="rounded-xl bg-[var(--color-acid)] p-6 text-[var(--color-ink)]">
        <p className="text-sm">積分餘額</p>
        <p className="text-3xl font-bold">{balance.data?.balance ?? 0}</p>
      </section>
      <h2 className="font-bold">交易記錄</h2>
      {history.isLoading && <div className="skeleton-card h-24" />}
      <ul className="space-y-2">
        {history.data?.map((t) => (
          <li key={t.id} className="flex justify-between rounded border p-3 bg-white text-sm">
            <span>{t.description ?? t.type}</span>
            <span className={t.delta >= 0 ? "text-green-600" : "text-[var(--color-magenta)]"}>{t.delta >= 0 ? "+" : ""}{t.delta}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
