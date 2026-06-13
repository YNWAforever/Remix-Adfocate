import { Clock } from "lucide-react";

export function PointsBalanceCard({ balance, availableTo, loading = false }: { balance: number; availableTo?: string | null; loading?: boolean }) {
  return (
    <section className="wallet-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-ink)] p-6 text-[var(--color-paper)]">
      <p className="font-mono text-xs uppercase tracking-wide opacity-80">你的積分餘額</p>
      {loading ? (
        <div className="skeleton-text mt-2 h-9 w-28" />
      ) : (
        <p className="mt-1 font-display text-4xl font-bold text-[var(--color-acid)]">{balance.toLocaleString("en-US")}</p>
      )}
      {availableTo && (
        <p className="mt-2 flex items-center gap-1 text-xs opacity-80">
          <Clock size={14} aria-hidden /> 到期：{availableTo.slice(0, 10)}
        </p>
      )}
    </section>
  );
}
