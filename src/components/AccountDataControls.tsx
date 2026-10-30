import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";

/**
 * Self-service data export and account deletion (F-009). Deletion anonymises the account:
 * reward ledgers and review history stay under a pseudonymous id, personal data is removed.
 */
export function AccountDataControls() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");

  const exportData = useMutation({
    mutationFn: () => apiFetch<unknown>("/me/export"),
    onSuccess: (data) => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "adfocate-data.json";
      link.click();
      URL.revokeObjectURL(url);
    },
  });

  const deleteAccount = useMutation({
    mutationFn: () => apiFetch("/me/delete", { method: "POST", body: JSON.stringify({ confirm: "DELETE" }) }),
    onSuccess: async () => {
      await supabase.auth.signOut().catch(() => undefined);
      qc.clear();
      window.location.assign("/login");
    },
  });

  return (
    <div className="space-y-4">
      <h2 className="font-heading text-lg font-black">{t("app.account.title")}</h2>
      <div className="space-y-2">
        <p className="text-sm text-[var(--color-soft-ink)]">{t("app.account.exportBody")}</p>
        <button type="button" onClick={() => exportData.mutate()} disabled={exportData.isPending}
          className="rounded-full border-2 border-[var(--color-ink)] px-4 py-2 text-sm font-bold disabled:opacity-50">
          {exportData.isPending ? t("common.processing") : t("app.account.export")}
        </button>
        {exportData.isError && <p role="alert" className="text-sm text-[var(--color-magenta)]">{t("app.account.exportError")}</p>}
      </div>
      <div className="space-y-2">
        <p className="text-sm text-[var(--color-soft-ink)]">{t("app.account.deleteBody")}</p>
        {!confirming ? (
          <button type="button" onClick={() => setConfirming(true)}
            className="rounded-full border-2 border-[var(--color-magenta)] px-4 py-2 text-sm font-bold text-[var(--color-magenta)]">
            {t("app.account.delete")}
          </button>
        ) : (
          <div className="space-y-2">
            <label className="block text-sm font-semibold">
              {t("app.account.deleteConfirmLabel")}
              <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off"
                className="mt-1 block w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-3 py-2" />
            </label>
            {deleteAccount.isError && <p role="alert" className="text-sm text-[var(--color-magenta)]">{t("app.account.deleteError")}</p>}
            <div className="flex gap-3">
              <button type="button" onClick={() => { setConfirming(false); setTyped(""); }}
                className="text-sm font-semibold underline underline-offset-4">{t("common.cancel")}</button>
              <button type="button" disabled={typed !== "DELETE" || deleteAccount.isPending} onClick={() => deleteAccount.mutate()}
                className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-magenta)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                {deleteAccount.isPending ? t("common.processing") : t("app.account.deleteConfirm")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
