import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ActiveMissionQueue, type ActiveMissionQueueUiFilters } from "@/components/admin/ActiveMissionQueue";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { useAdminWorkspace } from "@/components/admin/AdminWorkspaceContext";
import { AdminAuthError, fetchActiveMissionQueue } from "@/lib/admin";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/admin/active-missions")({ component: AdminActiveMissionsRoute });

export function AdminActiveMissionsRoute() {
  const { authed, reportAuthError } = useAdminAuth();
  const { workspaceSlug } = useAdminWorkspace();
  const [filters, setFilters] = useState<ActiveMissionQueueUiFilters>({});
  const { t } = useI18n();
  const queue = useQuery({
    queryKey: ["admin-active-missions", workspaceSlug, filters],
    queryFn: () => fetchActiveMissionQueue({ workspace: workspaceSlug, ...filters }),
    enabled: authed && Boolean(workspaceSlug),
    retry: false,
  });

  useEffect(() => {
    if (queue.error instanceof AdminAuthError) reportAuthError(queue.error);
  }, [queue.error, reportAuthError]);

  if (!workspaceSlug) return <p className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.activeMission.route.selectQueue")}</p>;
  if (queue.isLoading) return <p className="text-sm">{t("app.admin.activeMission.route.loadingQueue")}</p>;
  if (queue.isError) return <p role="alert" className="text-sm font-bold text-red-700">{t("app.admin.activeMission.route.queueError")}</p>;

  return <ActiveMissionQueue items={queue.data?.items ?? []} filters={filters} onFiltersChange={setFilters} />;
}
