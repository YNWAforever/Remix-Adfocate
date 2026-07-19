import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ActiveMissionQueue, type ActiveMissionQueueUiFilters } from "@/components/admin/ActiveMissionQueue";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { useAdminWorkspace } from "@/components/admin/AdminWorkspaceContext";
import { AdminAuthError, fetchActiveMissionQueue } from "@/lib/admin";

export const Route = createFileRoute("/admin/active-missions")({ component: AdminActiveMissionsRoute });

export function AdminActiveMissionsRoute() {
  const { authed, reportAuthError } = useAdminAuth();
  const { workspace } = useAdminWorkspace();
  const [filters, setFilters] = useState<ActiveMissionQueueUiFilters>({});
  const queue = useQuery({
    queryKey: ["admin-active-missions", workspace, filters],
    queryFn: () => fetchActiveMissionQueue({ workspace, ...filters }),
    enabled: authed && Boolean(workspace),
    retry: false,
  });

  useEffect(() => {
    if (queue.error instanceof AdminAuthError) reportAuthError(queue.error);
  }, [queue.error, reportAuthError]);

  if (!workspace) return <p className="text-sm text-[var(--color-soft-ink)]">Select a workspace to open the active mission review queue.</p>;
  if (queue.isLoading) return <p className="text-sm">Loading active mission reviews…</p>;
  if (queue.isError) return <p role="alert" className="text-sm font-bold text-red-700">Unable to load active mission reviews.</p>;

  return <ActiveMissionQueue items={queue.data?.items ?? []} filters={filters} onFiltersChange={setFilters} />;
}
