import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useGifts, useBalance } from "@/lib/queries/kocmax";
import { PointsBalanceCard } from "@/components/PointsBalanceCard";
import { FilterPills } from "@/components/FilterPills";
import { RedeemGiftCard } from "@/components/RedeemGiftCard";
import { SkeletonCard } from "@/components/SkeletonCard";
import { useI18n } from "@/lib/i18n";
import { categoryLabelKey } from "@/lib/labels";

export const Route = createFileRoute("/_app/redemption/")({ component: Redemption });

const CATEGORIES = ["全部", "美容", "餐飲", "娛樂", "生活", "電子", "健康", "時尚"] as const;

function Redemption() {
  const { t } = useI18n();
  const [category, setCategory] = useState<string>("全部");
  const balance = useBalance();
  const gifts = useGifts(category === "全部" ? undefined : category);
  return (
    <div className="mx-auto w-full max-w-lg space-y-4 p-4 lg:max-w-5xl">
      <PointsBalanceCard balance={balance.data?.balance ?? 0} availableTo={balance.data?.available_to} loading={balance.isLoading} />
      {balance.isError && <p className="text-sm text-[var(--color-magenta)]">{t("common.balanceError")}</p>}
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">{t("app.redemption.pageTitle")}</h1>
        <Link to="/redemption/history" className="text-sm font-bold text-[var(--color-magenta)]">{t("app.redemption.historyLabel")}</Link>
      </div>
      <FilterPills options={CATEGORIES} value={category} onChange={setCategory} renderLabel={(v) => t(categoryLabelKey(v))} />
      {gifts.isLoading && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <SkeletonCard className="h-48" />
          <SkeletonCard className="h-48" />
        </div>
      )}
      {gifts.isError && <p className="text-sm text-[var(--color-magenta)]">{t("app.redemption.loadError")}</p>}
      {!gifts.isLoading && !gifts.isError && gifts.data?.length === 0 && (
        <p className="text-sm text-[var(--color-soft-ink)]">{t("app.redemption.empty")}</p>
      )}
      {!gifts.isLoading && !gifts.isError && (gifts.data?.length ?? 0) > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {gifts.data!.map((g) => (
            <RedeemGiftCard key={g.id} gift={g} balance={balance.data?.balance ?? 0} />
          ))}
        </div>
      )}
    </div>
  );
}
