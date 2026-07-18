import { useId, useState } from "react";
import type { MissionFulfillment } from "@/lib/activeMission";

type FulfillmentCardProps = {
  fulfillment: MissionFulfillment | null;
  onConfirmReceipt: () => Promise<unknown> | unknown;
  isConfirming?: boolean;
};

const STATUS_LABELS: Record<MissionFulfillment["status"], string> = {
  preparing: "Preparing",
  shipped: "Shipped",
  received: "Received",
};

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function dateLabel(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : DATE_TIME.format(parsed);
}

export function FulfillmentCard({ fulfillment, onConfirmReceipt, isConfirming = false }: FulfillmentCardProps) {
  const headingId = useId();
  const [isLocallyConfirming, setIsLocallyConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = isConfirming || isLocallyConfirming;

  async function confirmReceipt() {
    setError(null);
    setIsLocallyConfirming(true);
    try {
      await onConfirmReceipt();
    } catch {
      setError("Couldn’t confirm receipt. Try again.");
    } finally {
      setIsLocallyConfirming(false);
    }
  }

  if (!fulfillment) return null;

  return (
    <section aria-labelledby={headingId} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="font-heading text-lg font-bold">Product delivery</h2>
        <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-cyan)] px-3 py-1 text-sm font-bold">
          {STATUS_LABELS[fulfillment.status]}
        </span>
      </div>
      {fulfillment.shippedAt ? (
        <p className="mt-3 text-sm text-[var(--color-soft-ink)]">
          Shipped <time dateTime={fulfillment.shippedAt}>{dateLabel(fulfillment.shippedAt)}</time>
        </p>
      ) : <p className="mt-3 text-sm text-[var(--color-soft-ink)]">The product is being prepared.</p>}
      {fulfillment.operationalNote ? <p className="mt-2 break-words text-sm">{fulfillment.operationalNote}</p> : null}
      {fulfillment.status === "shipped" ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => void confirmReceipt()}
          className="mt-4 min-h-11 touch-manipulation rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-5 py-2 font-heading font-bold hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "Confirming…" : "Confirm receipt"}
        </button>
      ) : null}
      {error ? <p role="alert" className="mt-3 text-sm font-semibold text-[var(--color-magenta)]">{error}</p> : null}
    </section>
  );
}
