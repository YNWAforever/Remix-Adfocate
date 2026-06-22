import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { OperatorAuthGate } from "@/components/operator/OperatorAuthGate";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { AdminAuthContext } from "@/components/admin/AdminAuthContext";
import { AdminWorkspaceProvider } from "@/components/admin/AdminWorkspaceContext";
import { WorkspaceSwitcher } from "@/components/admin/WorkspaceSwitcher";
import { getAdminSecret } from "@/lib/admin";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/admin")({ component: AdminLayout });

function AdminLayout() {
  const { t } = useI18n();
  const [secret, setSecret] = useState<string | null>(getAdminSecret());
  const [authError, setAuthError] = useState<unknown>(null);
  return (
    <OperatorAuthGate
      error={authError}
      prompt={t("app.admin.authPromptAdmin")}
      onSecretChange={(s) => {
        setSecret(s);
        setAuthError(null);
      }}
    >
      <AdminAuthContext.Provider value={{ secret, reportAuthError: setAuthError }}>
        <AdminWorkspaceProvider>
          <div className="mx-auto max-w-5xl space-y-4 p-4">
            <header className="flex items-center justify-between gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
              <div>
                <h1 className="font-display text-xl font-bold">{t("app.admin.title")}</h1>
                <p className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.subtitle")}</p>
              </div>
              <WorkspaceSwitcher />
            </header>
            <AdminTabs />
            <Outlet />
          </div>
        </AdminWorkspaceProvider>
      </AdminAuthContext.Provider>
    </OperatorAuthGate>
  );
}
