import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useGifts } from "@/lib/queries/kocmax";

export const Route = createFileRoute("/kocmax/$slug/redemption")({ component: Redemption });

const CATS = ["全部", "現金券", "美容", "餐飲", "寵物", "體驗", "數碼"] as const;

function Redemption() {
  const [cat, setCat] = useState<string>("全部");
  const { data, isLoading, isError } = useGifts(cat);
  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-2 overflow-x-auto">
        {CATS.map((c) => (
          <button key={c} onClick={() => setCat(c)}
            className={`px-3 py-1 rounded-full text-sm ${cat === c ? "bg-[var(--color-ink)] text-white" : "bg-white border"}`}>{c}</button>
        ))}
      </div>
      {isLoading && <div className="skeleton-card h-24" />}
      {isError && <p className="text-sm text-[var(--color-magenta)]">載入失敗</p>}
      <div className="grid grid-cols-2 gap-3">
        {data?.map((g) => (
          <div key={g.id} className="rounded border p-3 bg-white relative">
            {g.stock_remaining === 0 && <span className="absolute top-2 right-2 text-xs bg-[var(--color-ink)] text-white px-2 py-0.5 rounded">已換罄</span>}
            <p className="font-medium">{g.name}</p>
            <p className="text-sm">{g.points_cost} 積分</p>
          </div>
        ))}
      </div>
    </div>
  );
}
