import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useBrandAuth } from "@/components/brand/BrandAuthContext";
import { BrandAuthError, brandKeys, fetchBrandBudget } from "@/lib/brand";

export const Route = createFileRoute("/brand/budget")({ component: BrandBudget });

function BrandBudget() {
  const { t } = useI18n();
  const { reportAuthError } = useBrandAuth();
  const q = useQuery({ queryKey: brandKeys.budget(), queryFn: fetchBrandBudget, retry: false });
  useEffect(() => {
    if (q.error instanceof BrandAuthError) reportAuthError(q.error);
  }, [q.error, reportAuthError]);

  if (q.isLoading) return <p className="text-sm">載入中…</p>;
  return (
    <div className="space-y-4">
      <div className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
        <p className="font-display text-2xl font-bold">HK${q.data?.budget.balance ?? 0}</p>
        <p className="text-sm text-[var(--color-soft-ink)]">
          {q.data?.budget.enforced ? t("app.brand.budget.enforced") : t("app.brand.budget.unenforced")}
        </p>
      </div>
      <ul className="space-y-2">
        {(q.data?.transactions.length ?? 0) === 0 && (
          <li className="text-sm text-[var(--color-soft-ink)]">{t("app.brand.budget.ledgerEmpty")}</li>
        )}
        {q.data?.transactions.map((tx) => (
          <li key={tx.id} className="flex items-center justify-between gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-2 text-sm">
            <span>{tx.type}{tx.description ? ` · ${tx.description}` : ""}</span>
            <span className="font-bold">{tx.delta > 0 ? "+" : ""}{tx.delta} → {tx.balance_after}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
