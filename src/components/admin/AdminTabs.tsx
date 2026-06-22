import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminKeys, fetchApplications, fetchSubmissions } from "@/lib/admin";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { useAdminWorkspace } from "./AdminWorkspaceContext";
import { useI18n } from "@/lib/i18n";

const base = "inline-flex h-9 items-center gap-2 rounded-full border-2 border-[var(--color-ink)] px-3 text-sm font-heading font-bold";

export function AdminTabs() {
  const { t } = useI18n();
  const { authed } = useAdminAuth();
  const { workspace } = useAdminWorkspace();

  const tabs = useMemo(
    () => [
      { to: "/admin/missions", label: t("app.admin.tabMissions") },
      { to: "/admin/applications", label: t("app.admin.tabApplications") },
      { to: "/admin/engaged", label: t("app.admin.tabEngaged") },
      { to: "/admin/submissions", label: t("app.admin.tabSubmissions") },
      { to: "/admin/creators", label: t("app.admin.tabCreators") },
    ] as const,
    [t],
  );

  // Shared query keys => these reuse the cache the tabs populate; no extra fetch.
  const apps = useQuery({
    queryKey: adminKeys.applications(workspace),
    queryFn: () => fetchApplications(workspace),
    enabled: authed,
    retry: false,
  });
  const subs = useQuery({
    queryKey: adminKeys.submissions("submitted", workspace),
    queryFn: () => fetchSubmissions("submitted", workspace),
    enabled: authed,
    retry: false,
  });
  const counts: Record<string, number | undefined> = {
    "/admin/applications": apps.data?.applications.length,
    "/admin/submissions": subs.data?.submissions.length,
  };
  return (
    <nav className="flex flex-wrap gap-2">
      {tabs.map((tab) => (
        <Link key={tab.to} to={tab.to} className={`${base} bg-white`} activeProps={{ className: `${base} bg-[var(--color-acid)]` }}>
          {tab.label}
          {counts[tab.to] ? (
            <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-1.5 text-xs">{counts[tab.to]}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
