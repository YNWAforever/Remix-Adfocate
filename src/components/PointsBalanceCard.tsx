import { Clock } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { formatCreatorDate } from "@/lib/creatorFormatting";

export function PointsBalanceCard({ balance, availableTo, loading = false }: { balance?: number | null; availableTo?: string | null; loading?: boolean }) {
  const { t, lang } = useI18n();
  return (
    <section className="wallet-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-ink)] p-6 text-[var(--color-paper)]">
      <p className="font-mono text-xs uppercase tracking-wide opacity-80">{t("app.wallet.balanceLabel")}</p>
      {loading ? (
        <div className="skeleton-acid skeleton-text mt-2 h-9 w-28" />
      ) : (
        <p className="s-balance mt-1 font-display text-4xl font-bold text-[var(--color-acid)]">{balance == null ? (lang === "en" ? "Unavailable" : "暫未能讀取") : balance.toLocaleString("en-US")}</p>
      )}
      {availableTo && (
        <p className="mt-2 flex items-center gap-1 text-xs opacity-80">
          <Clock size={14} aria-hidden /> {t("app.wallet.expiry", { date: formatCreatorDate(availableTo, lang) ?? availableTo })}
        </p>
      )}
    </section>
  );
}
