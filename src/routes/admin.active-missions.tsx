import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/active-missions")({ component: AdminActiveMissionsLayout });

export function AdminActiveMissionsLayout() {
  return <Outlet />;
}