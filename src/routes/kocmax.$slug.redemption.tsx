import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useGifts, useBalance } from "@/lib/queries/kocmax";
import { PointsBalanceCard } from "@/components/PointsBalanceCard";
import { FilterPills } from "@/components/FilterPills";
import { RewardCard } from "@/components/RewardCard";
import { SkeletonCard } from "@/components/SkeletonCard";

export const Route = createFileRoute("/kocmax/$slug/redemption")({ component: Redemption });

const CATEGORIES = ["全部", "美容", "餐飲", "娛樂", "生活", "電子", "健康", "時尚"] as const;

function Redemption() {
  const [category, setCategory] = useState<string>("全部");
  const balance = useBalance();
  const gifts = useGifts(category === "全部" ? undefined : category);
  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <PointsBalanceCard balance={balance.data?.balance ?? 0} availableTo={balance.data?.available_to} loading={balance.isLoading} />
      {balance.isError && <p className="text-sm text-[var(--color-magenta)]">積分載入失敗</p>}
      <h1 className="font-display text-2xl font-bold">積分兌換</h1>
      <FilterPills options={CATEGORIES} value={category} onChange={setCategory} />
      {gifts.isLoading && (
        <div className="grid grid-cols-2 gap-3">
          <SkeletonCard className="h-48" />
          <SkeletonCard className="h-48" />
        </div>
      )}
      {gifts.isError && <p className="text-sm text-[var(--color-magenta)]">載入失敗</p>}
      {!gifts.isLoading && !gifts.isError && gifts.data?.length === 0 && (
        <p className="text-sm text-[var(--color-soft-ink)]">此分類暫無獎賞</p>
      )}
      {!gifts.isLoading && !gifts.isError && (gifts.data?.length ?? 0) > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {gifts.data!.map((g) => (
            <RewardCard key={g.id} name={g.name} pointsCost={g.points_cost} stockRemaining={g.stock_remaining} imageUrl={g.image_url} />
          ))}
        </div>
      )}
    </div>
  );
}
