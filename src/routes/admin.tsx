// src/routes/admin.tsx
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminAuthError } from "@/lib/admin";
import { AdminShell } from "@/components/admin/AdminShell";
import { StaffAuthGate } from "@/components/admin/StaffAuthGate";
import { AdminAuthContext } from "@/components/admin/AdminAuthContext";
import { AdminWorkspaceProvider } from "@/components/admin/AdminWorkspaceContext";

export const Route = createFileRoute("/admin")({ component: AdminLayout });

function AdminLayout() {
  const qc = useQueryClient();
  const [authRevision, setAuthRevision] = useState(0);
  const clearIdentityCache = useCallback(() => qc.clear(), [qc]);
  const reportAuthError = useCallback((error: unknown) => { if (error instanceof AdminAuthError) { qc.clear(); setAuthRevision((value) => value + 1); } }, [qc]);

  return (
    <StaffAuthGate refreshKey={authRevision} onIdentityChange={clearIdentityCache}>
      {(staff) => (
        <AdminAuthContext.Provider value={{ authed: true, staff, reportAuthError }}>
          <AdminWorkspaceProvider>
            <AdminShell><Outlet /></AdminShell>
          </AdminWorkspaceProvider>
        </AdminAuthContext.Provider>
      )}
    </StaffAuthGate>
  );
}
