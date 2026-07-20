import { useId, useState } from "react";
import type { MissionFulfillment } from "@/lib/activeMission";
import { useI18n } from "@/lib/i18n";

type FulfillmentCardProps = {
  fulfillment: MissionFulfillment | null;
  onConfirmReceipt: () => Promise<unknown> | unknown;
  isConfirming?: boolean;
};

const STATUS_KEYS: Record<MissionFulfillment["status"], string> = {
  preparing: "app.activeMission.fulfillment.status.preparing",
  shipped: "app.activeMission.fulfillment.status.shipped",
  received: "app.activeMission.fulfillment.status.received",
};

function dateLabel(value: string, locale: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(parsed);
}

export function FulfillmentCard({ fulfillment, onConfirmReceipt, isConfirming = false }: FulfillmentCardProps) {
  const headingId = useId();
  const [isLocallyConfirming, setIsLocallyConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = isConfirming || isLocallyConfirming;
  const { lang, t } = useI18n();

  async function confirmReceipt() {
    setError(null);
    setIsLocallyConfirming(true);
    try {
      await onConfirmReceipt();
    } catch {
      setError(t("app.activeMission.fulfillment.confirmError"));
    } finally {
      setIsLocallyConfirming(false);
    }
  }

  if (!fulfillment) return null;

  return (
    <section aria-labelledby={headingId} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="font-heading text-lg font-bold">{t("app.activeMission.fulfillment.title")}</h2>
        <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-cyan)] px-3 py-1 text-sm font-bold">
          {t(STATUS_KEYS[fulfillment.status])}
        </span>
      </div>
      {fulfillment.shippedAt ? (
        <p className="mt-3 text-sm text-[var(--color-soft-ink)]">
          {t("app.activeMission.fulfillment.shipped")} <time dateTime={fulfillment.shippedAt}>{dateLabel(fulfillment.shippedAt, lang === "zh" ? "zh-HK" : "en-US")}</time>
        </p>
      ) : <p className="mt-3 text-sm text-[var(--color-soft-ink)]">{t("app.activeMission.fulfillment.preparing")}</p>}
      {fulfillment.operationalNote ? <p className="mt-2 break-words text-sm">{fulfillment.operationalNote}</p> : null}
      {fulfillment.status === "shipped" ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => void confirmReceipt()}
          className="mt-4 min-h-11 touch-manipulation rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-5 py-2 font-heading font-bold hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? t("app.activeMission.fulfillment.confirming") : t("app.activeMission.fulfillment.confirmReceipt")}
        </button>
      ) : null}
      {error ? <p role="alert" className="mt-3 text-sm font-semibold text-[var(--color-magenta)]">{error}</p> : null}
    </section>
  );
}
