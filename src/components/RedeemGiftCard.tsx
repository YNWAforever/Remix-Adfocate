import { useState } from "react";
import { RewardCard } from "./RewardCard";
import { useRedeemGift, type Gift } from "@/lib/queries/kocmax";

export function RedeemGiftCard({ gift, balance }: { gift: Gift; balance: number }) {
  const redeem = useRedeemGift();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const soldOut = gift.stock_remaining <= 0;
  const poor = balance < gift.points_cost;
  const disabled = soldOut || poor;

  function confirm() {
    redeem.mutate(gift.id, { onSuccess: (r) => setCode(r.code) });
  }

  return (
    <>
      <RewardCard
        name={gift.name}
        pointsCost={gift.points_cost}
        stockRemaining={gift.stock_remaining}
        imageUrl={gift.image_url}
        footer={
          <button
            type="button"
            disabled={disabled}
            onClick={() => { setCode(null); setOpen(true); }}
            className="mt-2 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-magenta)] px-3 py-1.5 font-heading text-sm font-bold text-white disabled:opacity-40"
          >
            {soldOut ? "已換罄" : poor ? "積分不足" : "兌換"}
          </button>
        }
      />
      {open && (
        <div
          role="dialog"
          aria-label="兌換"
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-5"
            onClick={(e) => e.stopPropagation()}
          >
            {code === null ? (
              <>
                <h2 className="font-display text-lg font-bold">確認兌換</h2>
                <p className="mt-2 text-sm">用 {gift.points_cost} 積分兌換「{gift.name}」？</p>
                {redeem.isError && <p className="mt-2 text-sm text-[var(--color-magenta)]">兌換失敗，請再試</p>}
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="flex-1 rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-3 py-2 font-heading text-sm font-bold"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={redeem.isPending}
                    onClick={confirm}
                    className="flex-1 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-magenta)] px-3 py-2 font-heading text-sm font-bold text-white disabled:opacity-40"
                  >
                    {redeem.isPending ? "處理中…" : "確認"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="font-display text-lg font-bold">兌換成功 🎉</h2>
                <p className="mt-2 text-sm">你的兌換碼：</p>
                <p className="mt-1 select-all rounded-[var(--radius)] border-2 border-dashed border-[var(--color-ink)] bg-[var(--color-muted,#F4F4F4)] p-3 text-center font-mono text-lg font-bold">
                  {code}
                </p>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(code)}
                  className="mt-3 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-3 py-2 font-heading text-sm font-bold"
                >
                  複製兌換碼
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="mt-2 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-ink)] px-3 py-2 font-heading text-sm font-bold text-white"
                >
                  完成
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
