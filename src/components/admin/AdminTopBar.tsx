// src/components/admin/AdminTopBar.tsx
import { useLocation } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n";
import { useAdminAuth } from "./AdminAuthContext";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { adminPageTitleKey } from "./adminNavItems";
import { useStaffAccess } from "./StaffAccessContext";

export function AdminTopBar({ onMenu, navOpen }: { onMenu: () => void; navOpen: boolean }) {
  const { t } = useI18n();
  const { staff } = useAdminAuth();
  const { pathname } = useLocation();
  const access=useStaffAccess();
  const roles={workspace_admin:"Workspace admin / 工作空間管理員",operator:"Operator / 營運員",reviewer:"Reviewer / 審稿員",finance_viewer:"Finance viewer / 財務檢視員"};

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  return (
    <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b-2 border-[var(--color-ink)] bg-[var(--color-paper)] px-4 py-3">
      <button
        type="button"
        onClick={onMenu}
        aria-label={navOpen ? t("app.admin.closeNav") : t("app.admin.openNav")}
        aria-expanded={navOpen}
        aria-controls="admin-mobile-nav"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white lg:hidden"
      >
        <Menu size={18} aria-hidden />
      </button>
      <h1 className="min-w-0 flex-1 basis-[calc(100%-3.5rem)] font-display text-lg font-bold [overflow-wrap:anywhere] lg:basis-full">{t(adminPageTitleKey(pathname))}</h1>
      <div className="ml-auto flex w-full min-w-0 flex-wrap items-center gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_auto]">
        <div className="min-w-0 lg:flex lg:min-h-16 lg:items-center"><WorkspaceSwitcher /></div>
        <div className="min-w-0 lg:flex lg:min-h-16 lg:items-center">
        {access?.loading&&<span role="status" className="text-xs">Checking access / 核實職責中…</span>}
        {access?.error?<div role="alert" className="max-w-sm text-sm"><p>Access unavailable / 暫時無法核實職責</p><button type="button" className="min-h-11 underline" onClick={()=>void access.refresh()}>Retry access / 重試職責</button></div>:access?.access&&<span aria-label="Staff role" className="max-w-xs text-xs [overflow-wrap:anywhere]">{access.access.workspace?.role?roles[access.access.workspace.role]:"No assigned workspace role / 未獲派營運職責"}{access.can("content.manage")?" · Content editor / 內容編輯":""}</span>}
        </div>
        {staff?.email ? (
          <span className="hidden max-w-xs truncate text-xs text-[var(--color-soft-ink)] lg:inline">{staff.email}</span>
        ) : null}
        <button
          type="button"
          onClick={handleSignOut}
          className="min-h-11 shrink-0 rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-sm font-heading font-bold"
        >
          {t("app.admin.signOut")}
        </button>
      </div>
    </header>
  );
}
