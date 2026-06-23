// src/routes/admin.tsx
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { StaffAuthGate } from "@/components/admin/StaffAuthGate";
import { AdminSideNav } from "@/components/admin/AdminSideNav";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { AdminAuthContext } from "@/components/admin/AdminAuthContext";
import { AdminWorkspaceProvider } from "@/components/admin/AdminWorkspaceContext";

export const Route = createFileRoute("/admin")({ component: AdminLayout });

function AdminLayout() {
  const [, setAuthError] = useState<unknown>(null);
  const [navOpen, setNavOpen] = useState(false);
  return (
    <StaffAuthGate>
      {(staff) => (
        <AdminAuthContext.Provider value={{ authed: true, staff, reportAuthError: setAuthError }}>
          <AdminWorkspaceProvider>
            <AdminSideNav />
            <div className="min-h-screen lg:pl-60">
              <AdminTopBar onMenu={() => setNavOpen((v) => !v)} navOpen={navOpen} />
              {navOpen ? (
                <div id="admin-mobile-nav" className="p-4 lg:hidden">
                  <AdminSideNav mobile onNavigate={() => setNavOpen(false)} />
                </div>
              ) : null}
              <main className="mx-auto max-w-5xl space-y-4 p-4">
                <Outlet />
              </main>
            </div>
          </AdminWorkspaceProvider>
        </AdminAuthContext.Provider>
      )}
    </StaffAuthGate>
  );
}
