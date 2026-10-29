import { Navigate, createFileRoute } from "@tanstack/react-router";
import { ADMIN_NAV_GROUPS } from "@/components/admin/adminNavItems";
import { canOpenStaffPage, useStaffAccess } from "@/components/admin/StaffAccessContext";

export const Route = createFileRoute("/admin/")({ component: AdminLanding });

/** First navigable page the signed-in role may open (Insights for most roles). */
export function firstStaffPage(access: ReturnType<typeof useStaffAccess>): string {
  for (const group of ADMIN_NAV_GROUPS) {
    for (const item of group.items) {
      if (!item.locked && canOpenStaffPage(access, item.to)) return item.to;
    }
  }
  return "/admin/insights";
}

// A role without creator.read (e.g. finance_viewer, content_editor) must not land on Insights
// and see a capability error; wait for the server-issued capabilities, then redirect.
function AdminLanding() {
  const access = useStaffAccess();
  if (access?.loading) return <p role="status" className="p-4 text-sm">…</p>;
  return <Navigate to={firstStaffPage(access) as "/admin/insights"} replace />;
}
