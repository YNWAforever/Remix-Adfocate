import { WalletCards } from "lucide-react";
import { useId } from "react";
import { formatCreatorCurrency } from "../lib/creatorFormatting";
import { dict, type Locale } from "../lib/i18n.dict";
import type { Earnings } from "../lib/queries/kocmax";

export function EarningsSummaryCard({
  earnings,
  locale,
  isLoading,
  isError,
  onRetry,
}: {
  earnings?: Earnings;
  locale: Locale;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const headingId = useId();
  const t = (key: string) => dict[locale][key] ?? dict.en[key] ?? key;

  if (isLoading) {
    return (
      <section
        aria-labelledby={headingId}
        className="pastel-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-5"
      >
        <h2 id={headingId} className="font-heading text-lg font-bold">
          {t("app.activation.earnings.heading")}
        </h2>
        <p role="status" className="mt-3 text-sm text-[var(--color-soft-ink)]">
          {t("app.activation.earnings.loading")}
        </p>
      </section>
    );
  }

  if (isError || !earnings) {
    return (
      <section
        aria-labelledby={headingId}
        className="pastel-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-5"
      >
        <h2 id={headingId} className="font-heading text-lg font-bold">
          {t("app.activation.earnings.heading")}
        </h2>
        <div role="alert" className="mt-3 text-sm">
          <p>{t("app.activation.earnings.error")}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 min-h-11 rounded-full border-2 border-[var(--color-ink)] px-4 py-2 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {t("app.activation.earnings.retry")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="pastel-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-5"
    >
      <h2 id={headingId} className="flex items-center gap-2 font-heading text-lg font-bold">
        <WalletCards className="h-5 w-5" aria-hidden="true" />
        {t("app.activation.earnings.heading")}
      </h2>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-[var(--color-paper)] p-3">
          <dt className="text-xs text-[var(--color-soft-ink)]">
            {t("app.activation.earnings.available")}
          </dt>
          <dd className="mt-1 font-heading text-xl font-bold">
            {formatCreatorCurrency(earnings.available, locale)}
          </dd>
        </div>
        <div className="rounded-xl bg-[var(--color-paper)] p-3">
          <dt className="text-xs text-[var(--color-soft-ink)]">
            {t("app.activation.earnings.pending")}
          </dt>
          <dd className="mt-1 font-heading text-xl font-bold">
            {formatCreatorCurrency(earnings.pending, locale)}
          </dd>
        </div>
      </dl>
      <a
        href="/wallet"
        className="mt-3 inline-flex min-h-11 items-center px-1 text-sm font-bold underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {t("app.activation.earnings.walletLink")}
      </a>
    </section>
  );
}
