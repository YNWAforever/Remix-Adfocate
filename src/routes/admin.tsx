import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { OperatorAuthGate } from "@/components/operator/OperatorAuthGate";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { AdminAuthContext } from "@/components/admin/AdminAuthContext";
import { getAdminSecret } from "@/lib/admin";

export const Route = createFileRoute("/admin")({ component: AdminLayout });

function AdminLayout() {
  const [secret, setSecret] = useState<string | null>(getAdminSecret());
  const [authError, setAuthError] = useState<unknown>(null);
  return (
    <OperatorAuthGate
      error={authError}
      prompt="輸入管理密碼以進入營運後台"
      onSecretChange={(s) => {
        setSecret(s);
        setAuthError(null);
      }}
    >
      <AdminAuthContext.Provider value={{ secret, reportAuthError: setAuthError }}>
        <div className="mx-auto max-w-5xl space-y-4 p-4">
          <header className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
            <h1 className="font-display text-xl font-bold">營運後台</h1>
            <p className="text-sm text-[var(--color-soft-ink)]">申請、活躍創作者、作品審批與創作者審核。</p>
          </header>
          <AdminTabs />
          <Outlet />
        </div>
      </AdminAuthContext.Provider>
    </OperatorAuthGate>
  );
}
