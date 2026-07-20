import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ActiveMissionReview } from "@/components/admin/ActiveMissionReview";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { useAdminWorkspace } from "@/components/admin/AdminWorkspaceContext";
import {
  AdminAuthError,
  approveActiveMissionVersion,
  fetchActiveMissionWorkflow,
  grantActiveMissionRevision,
  markActiveMissionShipped,
  requestActiveMissionRevision,
  startActiveMissionReview,
} from "@/lib/admin";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/admin/active-missions/$workflowId")({
  validateSearch: (search: Record<string, unknown>) => ({
    workItemId: typeof search.workItemId === "string" ? search.workItemId : undefined,
  }),
  component: AdminActiveMissionReviewRoute,
});

export function AdminActiveMissionReviewRoute() {
  const { workflowId } = Route.useParams();
  const { workItemId } = Route.useSearch();
  return <AdminActiveMissionReviewView workflowId={workflowId} workItemId={workItemId} />;
}

export function AdminActiveMissionReviewView({
  workflowId,
  workItemId,
}: {
  workflowId: string;
  workItemId?: string;
}) {
  const { authed, reportAuthError } = useAdminAuth();
  const { workspace } = useAdminWorkspace();
  const queryClient = useQueryClient();
  const key = ["admin-active-mission", workspace, workflowId] as const;
  const { t } = useI18n();
  const detail = useQuery({
    queryKey: key,
    queryFn: () => fetchActiveMissionWorkflow(workflowId, workspace),
    enabled: authed && Boolean(workspace),
    retry: false,
  });

  useEffect(() => {
    if (detail.error instanceof AdminAuthError) reportAuthError(detail.error);
  }, [detail.error, reportAuthError]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: ["admin-active-missions", workspace] }),
    ]);
  };

  if (!workspace) return <p className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.activeMission.route.selectReview")}</p>;
  if (detail.isLoading) return <p className="text-sm">{t("app.admin.activeMission.route.loadingWorkflow")}</p>;
  if (detail.isError || !detail.data) return <p role="alert" className="text-sm font-bold text-red-700">{t("app.admin.activeMission.route.workflowError")}</p>;

  return (
    <ActiveMissionReview
      workflow={detail.data}
      selectedWorkItemId={workItemId}
      onStartReview={async (input) => {
        const result = await startActiveMissionReview(workflowId, input.workItemId, { workspace, expectedState: input.expectedState });
        await refresh();
        return result;
      }}
      onRequestRevision={async (input) => {
        const result = await requestActiveMissionRevision(workflowId, input.workItemId, { workspace, ...input });
        await refresh();
        return result;
      }}
      onGrantRevision={async (input) => {
        const result = await grantActiveMissionRevision(workflowId, input.workItemId, { workspace, reason: input.reason, grantedCount: input.grantedCount });
        await refresh();
        return result;
      }}
      onApproveVersion={async (input) => {
        const result = await approveActiveMissionVersion(workflowId, input.workItemId, { workspace, expectedState: input.expectedState, versionId: input.versionId });
        await refresh();
        return result;
      }}
      onMarkShipped={async (input) => {
        const result = await markActiveMissionShipped(workflowId, { workspace, note: input.note });
        await refresh();
        return result;
      }}
      onActionError={(error) => {
        if (error instanceof AdminAuthError) reportAuthError(error);
      }}
    />
  );
}
