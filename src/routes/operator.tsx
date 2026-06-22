import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { StaffAuthGate } from "@/components/admin/StaffAuthGate";
import { AdminAuthContext } from "@/components/admin/AdminAuthContext";
import { AdminWorkspaceProvider } from "@/components/admin/AdminWorkspaceContext";

// Layout for /operator/* detail pages (creator detail, mission selection). Shares the
// staff-auth gate + admin context with /admin so drill-in links work. The /operator index
// redirects to the unified /admin dashboard (see operator.index.tsx).
export const Route = createFileRoute("/operator")({ component: OperatorLayout });

function OperatorLayout() {
  const [, setAuthError] = useState<unknown>(null);
  return (
    <StaffAuthGate>
      {(staff) => (
        <AdminAuthContext.Provider value={{ authed: true, staff, reportAuthError: setAuthError }}>
          <AdminWorkspaceProvider>
            <Outlet />
          </AdminWorkspaceProvider>
        </AdminAuthContext.Provider>
      )}
    </StaffAuthGate>
  );
}
