import { useState } from "react";
import { RewardCard } from "./RewardCard";
import { useRedeemGift, type Gift } from "@/lib/queries/kocmax";
import { useI18n } from "@/lib/i18n";

export function RedeemGiftCard({ gift, balance }: { gift: Gift; balance: number }) {
  const { t } = useI18n();
  const redeem = useRedeemGift();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const soldOut = gift.stock_remaining <= 0;
  const poor = balance < gift.points_cost;
  const disabled = soldOut || poor;

  function confirm() {
    redeem.mutate(gift.id, { onSuccess: (r) => setCode(r.code) });
  }

  const btnLabel = soldOut
    ? t("app.redemption.soldOut")
    : poor
      ? t("app.redemption.insufficient")
      : t("app.redemption.redeemBtn");

  return (
    <>
      <RewardCard
        name={gift.name}
        pointsCost={gift.points_cost}
        stockRemaining={gift.stock_remaining}
        imageUrl={gift.image_url}
        footer={
          <>
            <button
              type="button"
              disabled={disabled}
              aria-describedby={poor && !soldOut ? `need-more-${gift.id}` : undefined}
              onClick={() => { setCode(null); setOpen(true); }}
              className={
                disabled
                  ? "mt-2 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-muted,#E4E4E4)] px-3 py-1.5 font-heading text-sm font-bold text-[var(--color-soft-ink)]"
                  : "mt-2 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-magenta)] px-3 py-1.5 font-heading text-sm font-bold text-white"
              }
            >
              {btnLabel}
            </button>
            {poor && !soldOut && (
              <p id={`need-more-${gift.id}`} className="mt-1 text-center text-xs text-[var(--color-soft-ink)]">
                {t("app.redemption.needMore", { n: gift.points_cost - balance })}
              </p>
            )}
          </>
        }
      />
      {open && (
        <>
          <button
            type="button"
            aria-label={t("app.redemption.dialogTitle")}
            className="fixed inset-0 z-50 bg-black/50"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label={t("app.redemption.dialogTitle")}
            aria-modal="true"
            className="pointer-events-none fixed inset-0 z-[51] grid place-items-center p-4"
          >
          <div className="pointer-events-auto w-full max-w-sm rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-5">
            {code === null ? (
              <>
                <h2 className="font-display text-lg font-bold">{t("app.redemption.dialogTitle")}</h2>
                <p className="mt-2 text-sm">{t("app.redemption.dialogBody", { pts: gift.points_cost, name: gift.name })}</p>
                {redeem.isError && <p className="mt-2 text-sm text-[var(--color-magenta)]">{t("app.redemption.redeemError")}</p>}
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="flex-1 rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-3 py-2 font-heading text-sm font-bold"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    disabled={redeem.isPending}
                    onClick={confirm}
                    className="flex-1 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-magenta)] px-3 py-2 font-heading text-sm font-bold text-white disabled:opacity-40"
                  >
                    {redeem.isPending ? t("common.processing") : t("app.redemption.confirm")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="font-display text-lg font-bold">{t("app.redemption.successTitle")}</h2>
                <p className="mt-2 text-sm">{t("app.redemption.yourCode")}</p>
                <p className="mt-1 select-all rounded-[var(--radius)] border-2 border-dashed border-[var(--color-ink)] bg-[var(--color-muted,#F4F4F4)] p-3 text-center font-mono text-lg font-bold">
                  {code}
                </p>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(code)}
                  className="mt-3 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-3 py-2 font-heading text-sm font-bold"
                >
                  {t("app.redemption.copyCode")}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="mt-2 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-ink)] px-3 py-2 font-heading text-sm font-bold text-white"
                >
                  {t("app.redemption.done")}
                </button>
              </>
            )}
          </div>
          </div>
        </>
      )}
    </>
  );
}
