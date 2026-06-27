import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useBrandAuth } from "@/components/brand/BrandAuthContext";
import { BrandAuthError, brandKeys, fetchBrandBudget } from "@/lib/brand";

function useBudget() {
  const { reportAuthError } = useBrandAuth();
  const q = useQuery({ queryKey: brandKeys.budget(), queryFn: fetchBrandBudget, retry: false });
  useEffect(() => {
    if (q.error instanceof BrandAuthError) reportAuthError(q.error);
  }, [q.error, reportAuthError]);
  return q;
}

export function BrandBudgetCard() {
  const { t } = useI18n();
  const q = useBudget();
  if (!q.data) return null;
  const { balance, enforced } = q.data.budget;
  const low = enforced && balance <= 0;
  return (
    <div className="space-y-1 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-heading font-bold">{t("app.brand.budget.balance")}</span>
        <span className="font-display text-xl font-bold">HK${balance}</span>
      </div>
      <p className="text-xs text-[var(--color-soft-ink)]">
        {enforced ? t("app.brand.budget.enforced") : t("app.brand.budget.unenforced")}
      </p>
      {low && <p className="text-xs font-semibold">{t("app.brand.budget.lowHint")}</p>}
    </div>
  );
}

/** Compact one-line balance banner for the review page. */
export function BrandBudgetBanner() {
  const { t } = useI18n();
  const q = useBudget();
  if (!q.data || !q.data.budget.enforced) return null;
  return (
    <p className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 text-sm font-bold">
      {t("app.brand.budget.balance")}: HK${q.data.budget.balance}
    </p>
  );
}
