// src/components/admin/AdminTopBar.tsx
import { useLocation } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n";
import { useAdminAuth } from "./AdminAuthContext";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { adminPageTitleKey } from "./adminNavItems";

export function AdminTopBar({ onMenu, navOpen }: { onMenu: () => void; navOpen: boolean }) {
  const { t } = useI18n();
  const { staff } = useAdminAuth();
  const { pathname } = useLocation();

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b-2 border-[var(--color-ink)] bg-[var(--color-paper)] px-4 py-3">
      <button
        type="button"
        onClick={onMenu}
        aria-label={navOpen ? t("app.admin.closeNav") : t("app.admin.openNav")}
        aria-expanded={navOpen}
        aria-controls="admin-mobile-nav"
        className="lg:hidden rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-2"
      >
        <Menu size={18} aria-hidden />
      </button>
      <h1 className="font-display text-lg font-bold">{t(adminPageTitleKey(pathname))}</h1>
      <div className="ml-auto flex items-center gap-3">
        <WorkspaceSwitcher />
        {staff?.email ? (
          <span className="hidden text-xs text-[var(--color-soft-ink)] sm:inline">{staff.email}</span>
        ) : null}
        <button
          type="button"
          onClick={handleSignOut}
          className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-sm font-heading font-bold"
        >
          {t("app.admin.signOut")}
        </button>
      </div>
    </header>
  );
}
