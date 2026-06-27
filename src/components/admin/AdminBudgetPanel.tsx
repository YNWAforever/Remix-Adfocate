import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import {
  AdminRequestError,
  adminKeys,
  fetchAdminBudget,
  topupAdminBudget,
  adjustAdminBudget,
  setAdminBudgetEnforcement,
} from "@/lib/admin";
import { useAdminWorkspace } from "@/components/admin/AdminWorkspaceContext";

export function AdminBudgetPanel() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { workspace: ws } = useAdminWorkspace();
  const [amount, setAmount] = useState("");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");

  const q = useQuery({
    queryKey: adminKeys.budget(ws),
    queryFn: () => fetchAdminBudget(ws),
    enabled: ws.length > 0,
    retry: false,
  });
  const onErr = (e: unknown) => window.alert(e instanceof AdminRequestError ? e.message : "操作失敗");
  const refetch = () => qc.invalidateQueries({ queryKey: adminKeys.budget(ws) });
  const topup = useMutation({ mutationFn: () => topupAdminBudget(ws, Number(amount)), onSuccess: () => { setAmount(""); refetch(); }, onError: onErr });
  const adjust = useMutation({ mutationFn: () => adjustAdminBudget(ws, Number(delta), reason || undefined), onSuccess: () => { setDelta(""); setReason(""); refetch(); }, onError: onErr });
  const toggle = useMutation({ mutationFn: (next: boolean) => setAdminBudgetEnforcement(ws, next), onSuccess: refetch, onError: onErr });

  if (!ws) return <p className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.budget.pickWorkspace")}</p>;

  return (
    <div className="space-y-4">
      {q.data && (
        <div className="space-y-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-heading text-lg font-bold">{t("app.admin.budget.balance")}: HK${q.data.budget.balance}</p>
            <label className="flex items-center gap-2 text-sm font-semibold">
              {t("app.admin.budget.enforcement")}
              <input type="checkbox" checked={q.data.budget.enforced} onChange={(e) => toggle.mutate(e.target.checked)} />
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={t("app.admin.budget.amount")}
              className="h-9 w-32 rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-2 text-sm" />
            <button onClick={() => topup.mutate()} disabled={!amount || topup.isPending}
              className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold">
              {t("app.admin.budget.topup")}
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <input value={delta} onChange={(e) => setDelta(e.target.value)} inputMode="decimal" placeholder="±"
              className="h-9 w-24 rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-2 text-sm" />
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("app.admin.budget.reason")}
              className="h-9 min-w-0 flex-1 rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-2 text-sm" />
            <button onClick={() => adjust.mutate()} disabled={!delta || adjust.isPending}
              className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold">
              {t("app.admin.budget.adjust")}
            </button>
          </div>
          <ul className="space-y-1 border-t-2 border-[var(--color-ink)] pt-2 text-sm">
            {q.data.transactions.length === 0 && <li className="text-[var(--color-soft-ink)]">{t("app.admin.budget.ledgerEmpty")}</li>}
            {q.data.transactions.map((tx) => (
              <li key={tx.id} className="flex justify-between gap-2">
                <span>{tx.type} {tx.description ? `· ${tx.description}` : ""}</span>
                <span className="font-bold">{tx.delta > 0 ? "+" : ""}{tx.delta} → {tx.balance_after}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
