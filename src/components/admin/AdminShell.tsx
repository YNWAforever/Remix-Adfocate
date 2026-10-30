import { useState, type ReactNode } from "react";
import { AdminSideNav } from "./AdminSideNav";
import { AdminTopBar } from "./AdminTopBar";
import { StaffAccessProvider } from "./StaffAccessContext";
import { STUDIO_SHELL } from "@/lib/features";
import "@/components/studio/studio.css";
export function AdminShell({ children }: { children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  return <StaffAccessProvider><div className={STUDIO_SHELL ? "studio s-staff" : undefined}><AdminSideNav /><div className="min-h-screen lg:pl-60">
    <AdminTopBar onMenu={() => setNavOpen((value) => !value)} navOpen={navOpen} />
    {navOpen && <div id="admin-mobile-nav" className="p-4 lg:hidden"><AdminSideNav mobile onNavigate={() => setNavOpen(false)} /></div>}
    <main className="mx-auto max-w-6xl space-y-4 p-4">{children}</main>
  </div></div></StaffAccessProvider>;
}
